import {traceContours,signedArea,simplifyClosed,pathData,decodeMask} from '../sam/geometry.js';
export {traceContours,signedArea,pathData,decodeMask};
export const VERSION=3;
export const MODEL_IDS={text:'Xenova/clipseg-rd64-refined · q8',sam:'SlimSAM-77 · patched box decoder · q8',sam3:'facebook/sam3 · optional local checkpoint'};
export function normalizeQuery(value){
 return String(value).trim().replace(/^(?:please\s+)?(?:can you\s+)?(?:draw|make|create|trace|find|segment|outline)\s+(?:(?:me\s+)?(?:an?\s+|the\s+)?(?:outline|boundary|contour|mask)\s+(?:of|around|for)\s+)?/i,'').replace(/[.!?]+$/,'').trim().slice(0,200);
}
export function encodeMask(mask,width,height){
 if(mask.length!==width*height)throw Error('Mask dimensions do not match.');
 const counts=[];let value=0,count=0;
 for(const v of mask){const bit=v?1:0;if(bit===value)count++;else{counts.push(count);count=1;value=bit;}}
 counts.push(count);return{width,height,counts};
}
export function components(mask,width,height,foreground=1){
 const visited=new Uint8Array(mask.length),queue=new Int32Array(mask.length),out=[];
 for(let start=0;start<mask.length;start++){
  if(visited[start]||(mask[start]?1:0)!==foreground)continue;
  let head=0,tail=1,minX=width,minY=height,maxX=0,maxY=0,touchesEdge=false;queue[0]=start;visited[start]=1;
  while(head<tail){const i=queue[head++],x=i%width,y=Math.floor(i/width);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);if(!x||!y||x===width-1||y===height-1)touchesEdge=true;
   for(const n of [x?i-1:-1,x<width-1?i+1:-1,y?i-width:-1,y<height-1?i+width:-1])if(n>=0&&!visited[n]&&(mask[n]?1:0)===foreground){visited[n]=1;queue[tail++]=n;}
  }
  out.push({indices:queue.slice(0,tail),area:tail,minX,minY,maxX,maxY,touchesEdge});
 }
 return out.sort((a,b)=>b.area-a.area);
}
function morphology(mask,width,height,radius,dilate){
 const temp=new Uint8Array(mask.length),out=new Uint8Array(mask.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let bit=dilate?0:1;for(let dx=-radius;dx<=radius;dx++){const xx=x+dx,v=xx>=0&&xx<width?mask[y*width+xx]:(dilate?0:1);bit=dilate?(bit|v):(bit&v);}temp[y*width+x]=bit;
 }
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let bit=dilate?0:1;for(let dy=-radius;dy<=radius;dy++){const yy=y+dy,v=yy>=0&&yy<height?temp[yy*width+x]:(dilate?0:1);bit=dilate?(bit|v):(bit&v);}out[y*width+x]=bit;
 }
 return out;
}
export function cleanupMask(mask,width,height,{minIsland=0,closeRadius=0,maxHole=0}={}){
 let out=mask.slice();
 if(closeRadius>0){const r=Math.min(5,Math.max(1,Math.round(closeRadius)));out=morphology(morphology(out,width,height,r,true),width,height,r,false);}
 if(minIsland>0)for(const c of components(out,width,height))if(c.area<minIsland)for(const i of c.indices)out[i]=0;
 if(maxHole>0)for(const c of components(out,width,height,0))if(!c.touchesEdge&&c.area<=maxHole)for(const i of c.indices)out[i]=1;
 return out;
}
export function selectRegion(mask,width,height,index){
 if(index<0)return mask.slice();const list=components(mask,width,height),out=new Uint8Array(mask.length);
 if(list[index])for(const i of list[index].indices)out[i]=1;return out;
}
export function paintStroke(mask,width,height,a,b,radius,value){
 const length=Math.hypot(b.x-a.x,b.y-a.y),steps=Math.max(1,Math.ceil(length/Math.max(1,radius/2)));
 for(let step=0;step<=steps;step++){
  const x=a.x+(b.x-a.x)*step/steps,y=a.y+(b.y-a.y)*step/steps;
  for(let yy=Math.max(0,Math.floor(y-radius));yy<=Math.min(height-1,Math.ceil(y+radius));yy++)for(let xx=Math.max(0,Math.floor(x-radius));xx<=Math.min(width-1,Math.ceil(x+radius));xx++)if((xx-x)**2+(yy-y)**2<=radius**2)mask[yy*width+xx]=value?1:0;
 }
 return mask;
}
function smoothLoop(points,iterations){
 let p=points;for(let step=0;step<iterations;step++){const q=[];for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];q.push([.75*a[0]+.25*b[0],.75*a[1]+.25*b[1]],[.25*a[0]+.75*b[0],.25*a[1]+.75*b[1]]);}p=q;}return p;
}
export function deriveContours(mask,width,height,tolerance=1,smoothing=0){
 const raw=traceContours(mask,width,height),loops=raw.map((p,index)=>{
  let points=simplifyClosed(p,tolerance);points=smoothLoop(points,Math.min(3,Math.max(0,smoothing)));
  if(Math.sign(signedArea(points))!==Math.sign(signedArea(p)))points=p;
  return{id:index,role:signedArea(p)>0?'outer':'hole',points,rawArea:signedArea(p),area:signedArea(points),perimeter:perimeter(points)};
 });
 return{raw,loops,rawArea:raw.reduce((s,p)=>s+signedArea(p),0),area:loops.reduce((s,p)=>s+p.area,0),perimeter:loops.reduce((s,p)=>s+p.perimeter,0)};
}
export function perimeter(points){let sum=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];sum+=Math.hypot(a[0]-b[0],a[1]-b[1]);}return sum;}
export function arcParameter(points){const t=[0];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];t.push(t.at(-1)+Math.hypot(a[0]-b[0],a[1]-b[1]));}const length=t.at(-1);if(!length)throw Error('The contour has zero length.');return t.map(v=>v/length);}
function samplePolygon(points,t,u){let lo=0,hi=points.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(t[mid]<=u)lo=mid;else hi=mid-1;}const a=points[lo],b=points[(lo+1)%points.length],v=(u-t[lo])/(t[lo+1]-t[lo]||1);return[a[0]+v*(b[0]-a[0]),a[1]+v*(b[1]-a[1])];}
export function reconstruct(coefficients,samples=512){const out=[];for(let j=0;j<samples;j++){let x=0,y=0;for(const c of coefficients){const angle=2*Math.PI*c.k*j/samples,cos=Math.cos(angle),sin=Math.sin(angle);x+=c.re*cos-c.im*sin;y+=c.re*sin+c.im*cos;}out.push([x,y]);}return out;}
export function fourierLoop(points,K=40,samples=512){
 const t=arcParameter(points),n=points.length,slopes=points.map((a,i)=>{const b=points[(i+1)%n],dt=t[i+1]-t[i];return dt>1e-15?[(b[0]-a[0])/dt,(b[1]-a[1])/dt]:[0,0];});
 let c0r=0,c0i=0;for(let j=0;j<n;j++){const dt=t[j+1]-t[j],a=points[j],b=points[(j+1)%n];c0r+=dt*(a[0]+b[0])/2;c0i+=dt*(a[1]+b[1])/2;}
 const coeffs=[{k:0,re:c0r,im:c0i,amplitude:Math.hypot(c0r,c0i),phase:Math.atan2(c0i,c0r)}];
 for(let k=-K;k<=K;k++)if(k){const w=2*Math.PI*k;let re=0,im=0;for(let j=0;j<n;j++){const dr=Math.cos(-w*t[j+1])-Math.cos(-w*t[j]),di=Math.sin(-w*t[j+1])-Math.sin(-w*t[j]);re+=slopes[j][0]*dr-slopes[j][1]*di;im+=slopes[j][0]*di+slopes[j][1]*dr;}re/=w*w;im/=w*w;coeffs.push({k,re,im,amplitude:Math.hypot(re,im),phase:Math.atan2(im,re)});}
 const reconstruction=reconstruct(coeffs,samples);let squared=0,maxError=0;
 for(let i=0;i<samples;i++){const a=samplePolygon(points,t,i/samples),b=reconstruction[i],d=Math.hypot(a[0]-b[0],a[1]-b[1]);squared+=d*d;maxError=Math.max(maxError,d);}
 const area=Math.PI*coeffs.reduce((s,c)=>s+c.k*c.amplitude*c.amplitude,0);
 return{coefficients:coeffs,reconstruction,area,rmse:Math.sqrt(squared/samples),maxError,samples};
}
export function computeFourier(loops,K=40){
 K=Math.round(Number(K));if(!Number.isInteger(K)||K<1||K>300)throw Error('Use a harmonic order from 1 to 300.');
 const anchors=loops.reduce((s,p)=>s+p.points.length,0);if(!loops.length)throw Error('Create a mask first.');if(loops.length>256||anchors>30000)throw Error('More than 256 contours or 30,000 vertices. Remove tiny islands or increase simplification before Fourier.');
 const results=loops.map(loop=>({...loop,...fourierLoop(loop.points,K)})),area=results.reduce((s,p)=>s+p.area,0),exact=loops.reduce((s,p)=>s+p.area,0),length=loops.reduce((s,p)=>s+p.perimeter,0);
 const orders=[...new Set([1,5,10,20,40,80,120,200,K].filter(k=>k<=K))].sort((a,b)=>a-b);
 const convergence=orders.map(k=>{const a=results.reduce((s,p)=>s+Math.PI*p.coefficients.filter(c=>Math.abs(c.k)<=k).reduce((v,c)=>v+c.k*c.amplitude*c.amplitude,0),0);return{order:k,area:a,relativeAreaError:exact?Math.abs(a-exact)/Math.abs(exact):0};});
 return{order:K,loops:results,area,exactArea:exact,relativeAreaError:exact?Math.abs(area-exact)/Math.abs(exact):0,rmse:Math.sqrt(results.reduce((s,p)=>s+p.rmse*p.rmse*p.perimeter,0)/(length||1)),maxError:Math.max(...results.map(p=>p.maxError)),convergence};
}
function boundaryPixels(mask,width,height){const out=new Uint8Array(mask.length);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;if(mask[i]&&(!x||!y||x===width-1||y===height-1||!mask[i-1]||!mask[i+1]||!mask[i-width]||!mask[i+width]))out[i]=1;}return out;}
export function benchmark(predicted,reference,width,height,tolerance=2){
 if(predicted.length!==width*height||reference.length!==predicted.length)throw Error('Reference and prediction dimensions must match.');
 let intersection=0,union=0,pixelsP=0,pixelsR=0;for(let i=0;i<predicted.length;i++){const p=!!predicted[i],r=!!reference[i];pixelsP+=p;pixelsR+=r;intersection+=p&&r;union+=p||r;}
 const bp=boundaryPixels(predicted,width,height),br=boundaryPixels(reference,width,height),dp=morphology(bp,width,height,tolerance,true),dr=morphology(br,width,height,tolerance,true);
 let np=0,nr=0,mp=0,mr=0;for(let i=0;i<bp.length;i++){np+=bp[i];nr+=br[i];mp+=!!(bp[i]&&dr[i]);mr+=!!(br[i]&&dp[i]);}
 const precision=np?mp/np:0,recall=nr?mr/nr:0;
 return{iou:union?intersection/union:1,dice:pixelsP+pixelsR?2*intersection/(pixelsP+pixelsR):1,boundaryF1:!np&&!nr?1:precision+recall?2*precision*recall/(precision+recall):0,tolerance,metric:'boundary tolerance uses a square (Chebyshev distance) neighborhood',foregroundPixels:pixelsR};
}
export function validateProject(project){
 if(!project||project.format!=='sector-map-outline-project'||project.version!==VERSION)throw Error('Not a supported V3 outline project.');
 const {width,height,dataURL}=project.image||{};
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>12000000||Math.max(width,height)>12000)throw Error('Invalid project image dimensions.');
 if(typeof dataURL!=='string'||dataURL.length>70000000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataURL))throw Error('Project image must be an embedded PNG, JPEG or WebP.');
 for(const name of ['mask','rawMask','reference'])if(project[name]){if(project[name].width!==width||project[name].height!==height)throw Error('Project mask dimensions do not match.');decodeMask(project[name]);}
 for(const p of project.prompts?.points||[])if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>=width||p.y>=height||![0,1].includes(p.label))throw Error('Invalid project prompt.');
 if((project.prompts?.points||[]).length>64)throw Error('Too many project prompts.');
 const box=project.prompts?.box,roi=project.roi;
 for(const b of [box,roi])if(b&&(![b.x1,b.y1,b.x2,b.y2].every(Number.isFinite)||b.x1<0||b.y1<0||b.x2>width||b.y2>height||b.x2<=b.x1||b.y2<=b.y1))throw Error('Invalid project crop or box.');
 const s=project.settings||{};if(!Number.isFinite(s.unitsPerPixel)||s.unitsPerPixel<=0||s.unitsPerPixel>1e9||!Number.isFinite(s.tolerance)||s.tolerance<0||s.tolerance>20||!Number.isInteger(s.smoothing)||s.smoothing<0||s.smoothing>3||!Number.isInteger(s.harmonics)||s.harmonics<1||s.harmonics>300)throw Error('Invalid project measurement settings.');
 if(!['text','points','sam3text','sam3points'].includes(s.engine)||typeof s.unit!=='string'||s.unit.length>20||typeof s.query!=='string'||s.query.length>200)throw Error('Invalid project model settings.');
 if(project.visibility!==undefined&&!['visible','partial','hidden','outside','unknown'].includes(project.visibility))throw Error('Invalid target visibility.');
 if(project.targets!==undefined){
  if(!Array.isArray(project.targets)||project.targets.length>20)throw Error('Use up to 20 named targets.');
  const ids=new Set();
  for(const target of project.targets){
   if(!target||typeof target.id!=='string'||target.id.length>100||ids.has(target.id)||typeof target.name!=='string'||target.name.length>60||!/^#[0-9a-f]{6}$/i.test(target.color))throw Error('Invalid or duplicate named target.');
   ids.add(target.id);validateProject({...project,...target,targets:undefined,image:project.image,format:project.format,version:project.version});
  }
 }
 return project;
}
export function csv(rows){return '\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');}
export function outlineSVG(loops,width,height){return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>Selected outline; holes preserved</title><path d="${pathData(loops.map(p=>p.points))}" fill="none" fill-rule="evenodd" stroke="#00a878" stroke-width="2" stroke-linejoin="round"/></svg>`;}
export function coordinateRows(loops,unitsPerPixel=1,unit='px'){
 const rows=[['contour','role','point','x_px','y_px','x_'+unit,'y_'+unit,'closed','origin','y_axis']];
 loops.forEach((loop,i)=>loop.points.forEach((p,j)=>rows.push([i,loop.role,j,p[0],p[1],p[0]*unitsPerPixel,p[1]*unitsPerPixel,true,'image top-left','down'])));return rows;
}
export function safeName(name){return String(name||'outline').replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,80)||'outline';}
const crcTable=Uint32Array.from({length:256},(_,i)=>{for(let k=0;k<8;k++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
function crc32(bytes){let c=0xffffffff;for(const byte of bytes)c=crcTable[(c^byte)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
export function makeZip(entries){
 const enc=new TextEncoder(),parts=[],central=[];let offset=0,total=0;
 for(const entry of entries){const name=enc.encode(entry.name),data=typeof entry.data==='string'?enc.encode(entry.data):entry.data;if(!(data instanceof Uint8Array))throw Error('Invalid ZIP data.');total+=data.length;if(total>512*1024*1024)throw Error('Export fewer than 512 MB at a time.');const crc=crc32(data),head=new Uint8Array(30+name.length),h=new DataView(head.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);head.set(name,30);parts.push(head,data);
  const dir=new Uint8Array(46+name.length),d=new DataView(dir.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);dir.set(name,46);central.push(dir);offset+=head.length+data.length;
 }
 const centralSize=central.reduce((s,p)=>s+p.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);return new Blob([...parts,...central,end],{type:'application/zip'});
}
