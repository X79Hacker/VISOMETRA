export function buildPrompts(points, box, originalSizes, reshapedSizes) {
  const coords = points.map(p => [p.x, p.y]);
  const labels = points.map(p => p.label);
  // The ONNX SAM prompt encoder accepts box corner labels 2 and 3.
  if (box) { coords.push([box.x1, box.y1], [box.x2, box.y2]); labels.push(2, 3); }
  if (!coords.length) throw new Error('Add at least one point or a box.');
  const [oh, ow] = originalSizes[0], [rh, rw] = reshapedSizes[0];
  return { coords: coords.flatMap(([x,y]) => [x * rw / ow, y * rh / oh]), labels };
}

// Trace directed pixel edges. Closed paths preserve disconnected regions and holes.
export function traceContours(mask, width, height) {
  const stride = width + 1, edges = new Map();
  function edge(x1,y1,x2,y2) { const a=y1*stride+x1,b=y2*stride+x2; if(!edges.has(a)) edges.set(a,[]); edges.get(a).push(b); }
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=y*width+x; if(!mask[i]) continue;
    if(y===0||!mask[i-width]) edge(x,y,x+1,y);
    if(x===width-1||!mask[i+1]) edge(x+1,y,x+1,y+1);
    if(y===height-1||!mask[i+width]) edge(x+1,y+1,x,y+1);
    if(x===0||!mask[i-1]) edge(x,y+1,x,y);
  }
  const paths=[];
  while(edges.size) {
    const start=edges.keys().next().value; let current=start,previous=null; const path=[];
    do {
      path.push([current%stride,Math.floor(current/stride)]);
      const nexts=edges.get(current); if(!nexts?.length) break;
      let index=0;
      if(nexts.length>1 && previous!==null) {
        const dx=current%stride-previous%stride,dy=Math.floor(current/stride)-Math.floor(previous/stride);
        let best=-Infinity;
        nexts.forEach((n,i)=>{const nx=n%stride-current%stride,ny=Math.floor(n/stride)-Math.floor(current/stride);const cross=dx*ny-dy*nx,dot=dx*nx+dy*ny;const score=cross===1?3:dot===1?2:cross===-1?1:0;if(score>best){best=score;index=i;}});
      }
      const next=nexts.splice(index,1)[0]; if(!nexts.length) edges.delete(current);
      previous=current;current=next;
    } while(current!==start);
    if(path.length>=4) {
      const reduced=path.filter((b,i)=>{const a=path[(i+path.length-1)%path.length],c=path[(i+1)%path.length];return (b[0]-a[0])*(c[1]-b[1])!==(b[1]-a[1])*(c[0]-b[0]);});
      if(reduced.length>=3) paths.push(reduced);
    }
  }
  return paths;
}
export function pathData(paths) { return paths.map(p=>'M'+p.map(([x,y])=>`${x},${y}`).join('L')+'Z').join(''); }
export function svgBoundary(paths,width,height,lineWidth=2.5) { return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>Trace · SlimSAM boundary</title><path d="${pathData(paths)}" fill="none" stroke="#ff6846" stroke-width="${lineWidth}" stroke-linejoin="round"/></svg>`; }

export function signedArea(points){let area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];area+=a[0]*b[1]-b[0]*a[1];}return area/2;}
function simplifyOpen(points,tolerance){
  if(points.length<=2)return points;
  const keep=new Uint8Array(points.length);keep[0]=keep[points.length-1]=1;
  const stack=[[0,points.length-1]],limit=tolerance*tolerance;
  while(stack.length){const [first,last]=stack.pop(),a=points[first],b=points[last],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;let best=limit,index=-1;
    for(let i=first+1;i<last;i++){const p=points[i],t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0;const distance=(p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2;if(distance>best){best=distance;index=i;}}
    if(index>=0){keep[index]=1;stack.push([first,index],[index,last]);}
  }
  return points.filter((p,i)=>keep[i]);
}
export function simplifyClosed(points,tolerance=1){
  if(points.length<=4||tolerance<=0)return points.map(p=>p.slice());
  let split=1,distance=0;for(let i=1;i<points.length;i++){const d=(points[i][0]-points[0][0])**2+(points[i][1]-points[0][1])**2;if(d>distance){split=i;distance=d;}}
  const a=simplifyOpen(points.slice(0,split+1),tolerance),b=simplifyOpen([...points.slice(split),points[0]],tolerance);
  const result=[...a.slice(0,-1),...b.slice(0,-1)];return result.length>=3?result:points.map(p=>p.slice());
}
export function decodeMask(encoded){
  const {width,height,counts}=encoded||{};
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>12000000||!Array.isArray(counts))throw new Error('Invalid mask dimensions.');
  const mask=new Uint8Array(width*height);let offset=0,value=0;
  for(const count of counts){if(!Number.isInteger(count)||count<0||offset+count>mask.length)throw new Error('Invalid mask encoding.');if(value)mask.fill(1,offset,offset+count);offset+=count;value=1-value;}
  if(offset!==mask.length)throw new Error('Incomplete mask encoding.');return mask;
}
export function outlineNodes(points,width,height,targetWidth,targetHeight=targetWidth){return points.map(p=>{const q=[p[0]/width*targetWidth,p[1]/height*targetHeight];return {p:q,hi:q.slice(),ho:q.slice(),mode:'corner',line:true};});}

export function pointInPolygon(point,polygon){
  let inside=false;const [x,y]=point;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if(((a[1]>y)!==(b[1]>y))&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export function rankOuterRegions(paths,points=[]){
  return paths.filter(path=>signedArea(path)>0).map(path=>{
    let support=0;for(const p of points)if(pointInPolygon([p.x,p.y],path))support+=p.label?1:-1;
    return {path,support,area:signedArea(path)};
  }).sort((a,b)=>b.support-a.support||b.area-a.area).map(item=>item.path);
}
export function holesForRegion(paths,region){return region?paths.filter(p=>signedArea(p)<0&&pointInPolygon(p[0],region)):[];}
