import {decodeMask} from './core.js';
let worker,pending,sequence=0;
export function cancelInference(){worker?.terminate();worker=null;if(pending){pending.reject(new Error('Model run cancelled.'));pending=null;}}
async function getWorker(onStatus){
 if(!worker){const module=await import('../assets/sam-engine.js');worker=module.createWorker();worker.onmessage=({data})=>{if(data.type==='status'){pending?.onStatus(data.message,data.progress);return;}if(!pending||data.id!==pending.id)return;if(data.type==='error')pending.reject(new Error(data.message));else if(data.type==='result')pending.resolve(data);else return;pending=null;};worker.onerror=()=>{const p=pending;pending=null;worker?.terminate();worker=null;p?.reject(new Error('The local model worker stopped. Retry, or close other memory-heavy applications.'));};}return worker;
}
export async function runInference({canvas,engine,text,points,box,roi,threshold=.2,signal,onStatus=()=>{}}){
 const r=roi?{x1:Math.floor(roi.x1),y1:Math.floor(roi.y1),x2:Math.ceil(roi.x2),y2:Math.ceil(roi.y2)}:{x1:0,y1:0,x2:canvas.width,y2:canvas.height};
 const crop=document.createElement('canvas');crop.width=r.x2-r.x1;crop.height=r.y2-r.y1;crop.getContext('2d').drawImage(canvas,r.x1,r.y1,crop.width,crop.height,0,0,crop.width,crop.height);
 const localPoints=points.filter(p=>p.x>=r.x1&&p.x<r.x2&&p.y>=r.y1&&p.y<r.y2).map(p=>({...p,x:p.x-r.x1,y:p.y-r.y1}));
 const localBox=box?{x1:Math.max(0,box.x1-r.x1),y1:Math.max(0,box.y1-r.y1),x2:Math.min(crop.width,box.x2-r.x1),y2:Math.min(crop.height,box.y2-r.y1)}:null;
 if(localBox&&(localBox.x1>=localBox.x2||localBox.y1>=localBox.y2))throw Error('The prompt box is outside the search crop. Clear or redraw it.');
 if((engine==='points'||engine==='sam3points')&&!localPoints.length&&!localBox)throw Error('Add an Include point or a box inside the search crop.');
 let data;
 if(engine.startsWith('sam3')){
  const check=await fetch('/api/sam/status',{cache:'no-store',signal});if(!check.ok)throw Error('Start the local Python server to use SAM 3.');const status=await check.json();if(!status.available)throw Error(status.message||'Run setup-sam3-windows.bat, then restart.');
  onStatus('Running SAM 3 on the local Python backend…');
  if(Math.max(crop.width,crop.height)>4096)throw Error('SAM 3 accepts up to 4096 pixels per side. Select a search crop.');
  const response=await fetch('/api/sam/segment',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({mode:engine==='sam3text'?'concept':'tracker',text:engine==='sam3text'?text:'',points:engine==='sam3text'?[]:localPoints,box:localBox,image:crop.toDataURL('image/png')})});
  data=await response.json();if(!response.ok)throw Error(data.error||'SAM 3 failed.');if(data.width!==crop.width||data.height!==crop.height)throw Error('SAM 3 returned mismatched dimensions.');
  data={...data,backend:data.engine+' · '+data.device,masks:data.masks.map(m=>({...m,mask:decodeMask(m.mask)}))};
 }else{
  const w=await getWorker(onStatus),pixels=crop.getContext('2d').getImageData(0,0,crop.width,crop.height).data,id=++sequence;
  data=await new Promise((resolve,reject)=>{pending={id,resolve,reject,onStatus};w.postMessage({type:engine==='text'?'text':'segment',id,imageId:'studio-'+id,width:crop.width,height:crop.height,pixels:pixels.buffer,text,points:localPoints,box:localBox,threshold},[pixels.buffer]);});
  if(data.width!==crop.width||data.height!==crop.height)throw Error('The local model returned mismatched dimensions.');
  data.masks=data.masks?data.masks.map(m=>({...m,mask:new Uint8Array(m.mask)})):[{mask:new Uint8Array(data.mask),score:data.score}];
 }
 const masks=data.masks.map(m=>{const full=new Uint8Array(canvas.width*canvas.height);for(let y=0;y<crop.height;y++)full.set(m.mask.subarray(y*crop.width,(y+1)*crop.width),(y+r.y1)*canvas.width+r.x1);return{...m,mask:full};});
 const union=new Uint8Array(canvas.width*canvas.height);for(const m of masks)for(let i=0;i<union.length;i++)union[i]|=m.mask[i];
 return{mask:union,masks,engine:data.backend,elapsed:data.elapsed,roi:r,query:text,modelScore:masks.length?masks.reduce((s,m)=>s+m.score,0)/masks.length:null,textRegions:data.textRegions??masks.length,truncated:!!data.truncated,createdAt:new Date().toISOString()};
}
