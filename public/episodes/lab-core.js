import {decodeMask,deriveContours,validateProject} from '../studio/core.js';
import {targetRecord,selectTargetProject,isVisible} from '../studio/sequence-core.js';
import {deriveOutline} from '../studio/curves-core.js';

export function cleanFrameInfo(value = {}) {
  const info={notes:String(value.notes||'').slice(0,8000),labels:[...new Set((Array.isArray(value.labels)?value.labels:[]).map(v=>String(v).trim().slice(0,60)).filter(Boolean))].slice(0,30),timestamp:null,sensors:{}};
  if(value.timestamp){if(!/(Z|[+-]\d{2}:\d{2})$/i.test(value.timestamp))throw Error('Capture timestamps need an explicit timezone, such as Z or +05:45.');const date=new Date(value.timestamp);if(!Number.isFinite(date.getTime()))throw Error('Enter a valid capture timestamp.');info.timestamp=date.toISOString();}
  for(const key of ['front','left','right','rear','speed','steering']) {
    const raw=value.sensors?.[key]; if(raw===null||raw===undefined||raw==='')continue;
    const number=Number(raw);if(!Number.isFinite(number)||(key!=='speed'&&key!=='steering'&&number<0))throw Error('Sensor fields must contain finite values. ToF distances cannot be negative.');
    info.sensors[key]=number;
  }
  return info;
}

export function polygonCentroid(loops) {
  let crossSum=0,x=0,y=0;
  for(const loop of loops)for(let i=0;i<loop.points.length;i++){
    const a=loop.points[i],b=loop.points[(i+1)%loop.points.length],cross=a[0]*b[1]-b[0]*a[1];crossSum+=cross;x+=(a[0]+b[0])*cross;y+=(a[1]+b[1])*cross;
  }
  return Math.abs(crossSum)>1e-12?{x:x/(3*crossSum),y:y/(3*crossSum)}:null;
}
export function projectMetrics(project, targetId=null) {
  if(targetId){if(!targetRecord(project,targetId))return null;project=selectTargetProject(project,targetId);}
  if(!project?.mask||!isVisible(project.visibility))return null;
  validateProject(project);
  const {width,height}=project.image,s=project.settings,mask=decodeMask(project.mask),geometry=project.curveOutline?deriveOutline(project.curveOutline,width,height):deriveContours(mask,width,height,s.tolerance,s.smoothing),centroid=polygonCentroid(geometry.loops),scale=s.unitsPerPixel;
  return{area:(geometry.curveArea??geometry.area)*scale**2,perimeter:geometry.perimeter*scale,cx:centroid?centroid.x*scale:null,cy:centroid?centroid.y*scale:null,reconstruction:Number.isFinite(project.fourier?.rmse)?project.fourier.rmse*scale:null,unit:s.unit,source:(project.curveOutline?'Studio curves':'Studio')+(project.targets?' · '+(project.targetName||'Target')+' ['+project.activeTargetId+']':''),loops:geometry.loops,mask,width,height};
}
const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
export function legacyMetrics(rows) {
  const sorted=rows.slice().sort((a,b)=>String(b.saved_at).localeCompare(String(a.saved_at)));
  const r=sorted.find(r=>r.scope==='trace');
  if(r)return{area:number(r.area_bezier)??number(r.area_shoelace),perimeter:number(r.perimeter),cx:number(r.centroid_x),cy:number(r.centroid_y),reconstruction:number(r.recon_error),unit:r.unit||'px',source:'Whole trace'};
  const cells=new Map();for(const r of sorted)if(r.scope==='cell'&&!cells.has(r.cell_row+','+r.cell_col))cells.set(r.cell_row+','+r.cell_col,r);
  const measured=[...cells.values()];if(!measured.length)return null;
  if(new Set(measured.map(r=>r.unit)).size!==1)return null;
  return{area:measured.reduce((sum,r)=>sum+(number(r.area_bezier)??number(r.area_shoelace)??0),0),perimeter:null,cx:null,cy:null,reconstruction:null,unit:measured[0].unit||'px',source:'Cell area sum'};
}

export async function contentSignature({project=null,trace=null,patches=null,rows=[]}) {
  // Saved timestamps, frame IDs and review flags do not change the underlying geometry.
  const geometry={project:project?{mask:project.mask,...(project.curveOutline?{curveOutline:project.curveOutline}:{}),...(project.targets?{targets:project.targets.map(t=>({id:t.id,mask:t.mask,curveOutline:t.curveOutline,settings:t.settings,visibility:t.visibility,reference:t.reference,referenceVerified:t.referenceVerified})),activeTargetId:project.activeTargetId}:{}),...(project.visibility?{visibility:project.visibility}:{}),settings:project.settings,reference:project.reference,referenceVerified:project.referenceVerified}:null,
    trace:trace?{nodes:trace.nodes,closed:trace.closed,finished:trace.finished,seg:trace.seg}:null,
    patches:(patches?.patches||[]).map(p=>p?{points:p.points,bezier:p.bezier,measurements:p.measurements}:null),
    rows:rows.map(r=>[r.scope,r.cell_row,r.cell_col,r.area_bezier,r.area_shoelace,r.area_fourier,r.perimeter,r.centroid_x,r.centroid_y,r.unit]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};
  const bytes=new TextEncoder().encode(JSON.stringify(geometry));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}
export function reviewState(info, source, signature) {
  const outlined=!!(source.project?.mask||source.trace?.closed||(source.patches?.patches||[]).some(p=>p?.points?.length)),measured=!!(source.project?.fourier||source.rows?.length||(source.patches?.patches||[]).some(p=>p?.measurements));
  if(info?.review?.state==='flagged')return'flagged';
  if(!outlined&&!measured)return'unprocessed';
  if(info?.review?.state==='approved')return info.review.signature===signature?'approved':'needs review';
  if(source.project?.targets){const targets=source.project.targets.filter(t=>t.mask||['hidden','outside'].includes(t.visibility));return targets.length&&targets.every(t=>t.review==='approved')?'approved':'needs review';}
  if(source.project?.review==='approved')return'approved';
  return measured?'measured':'needs review';
}
export function graphRows(frames, metric, series, xMode='frame') {
  const sensor=metric.startsWith('sensor:'),key=metric.replace('sensor:','');
  return frames.map((f,i)=>{
    const value=sensor?number(f.info?.sensors?.[key]):(f.metrics&&series===f.metrics.source+' | '+f.metrics.unit?number(f.metrics[metric]):null);
    return{index:i,x:xMode==='time'?(f.info?.timestamp?Date.parse(f.info.timestamp):null):i+1,y:value};
  });
}
