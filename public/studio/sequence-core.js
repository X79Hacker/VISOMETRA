import {decodeMask,encodeMask} from './core.js';

export const DEFAULT_TARGET={id:'target-main',name:'Target 1',color:'#38e6b0',visible:true};
export const TARGET_FIELDS=['mask','rawMask','reference','referenceVerified','curveOutline','prompts','roi','ruler','provenance','review','selectedContours','fourier','benchmark','visibility','keyframe','flags','corrected','settings'];
export const VISIBILITIES=['visible','partial','hidden','outside','unknown'];
export const isVisible=v=>!['hidden','outside','unknown'].includes(v);
export const clone=v=>v==null?v:structuredClone(v);
export function targetRecord(project,id=project?.activeTargetId||DEFAULT_TARGET.id){
 if(!project)return null;
 if(Array.isArray(project.targets))return project.targets.find(t=>t.id===id)||null;
 if(id!==DEFAULT_TARGET.id)return null;
 return {...DEFAULT_TARGET,...Object.fromEntries(TARGET_FIELDS.filter(k=>k in project).map(k=>[k,project[k]])),visibility:project.visibility||'visible'};
}
export function targetRecords(project){return project?.targets|| (project?[targetRecord(project,DEFAULT_TARGET.id)]:[]);}
export function recordFields(project){return Object.fromEntries(TARGET_FIELDS.filter(k=>k in project).map(k=>[k,clone(project[k])]));}
export function selectTargetProject(project,id,meta=DEFAULT_TARGET){
 const record=targetRecord(project,id),base={...project};
 for(const k of TARGET_FIELDS)delete base[k];
 return {...base,settings:clone(project.settings),mask:null,rawMask:null,reference:null,curveOutline:null,prompts:{points:[],box:null},roi:null,ruler:null,provenance:null,review:'not reviewed',selectedContours:[],fourier:null,visibility:'visible',keyframe:false,flags:[],corrected:false,...clone(record||{}),activeTargetId:id,targets:clone(targetRecords(project)),targetName:record?.name||meta.name};
}
export function mergeTarget(project,record){
 const targets=targetRecords(project).filter(t=>t.id!==record.id).map(clone);targets.push(clone(record));
 return {...project,...recordFields(record),targets,activeTargetId:record.id,targetName:record.name};
}
export function hasWork(record){return !!(record?.mask||record?.keyframe||['hidden','outside'].includes(record?.visibility));}
export function mayReplace(record,policy='empty'){
 if(!hasWork(record))return true;
 if(policy==='all')return true;
 if(record.review==='approved'||record.keyframe||record.corrected)return false;
 return policy==='suggestions';
}
export function selectedItems(queue){return queue.filter(q=>q.selected!==false);}
export function parseFrameRange(value,length){
 const indices=new Set();if(!String(value).trim())throw Error('Enter frame numbers, for example 1–20, 25, 30–40.');
 for(const token of String(value).replaceAll('–','-').replaceAll('—','-').split(',')){
  const m=token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!m)throw Error('Use frame numbers and ranges such as 1-20,25,30-40.');
  const a=Number(m[1]),b=Number(m[2]||m[1]);if(a<1||b<a||b>length)throw Error('Frame range must be within 1–'+length+'.');
  for(let n=a;n<=b;n++)indices.add(n-1);
 }return indices;
}
export function naturalFiles(files){return [...files].sort((a,b)=>String(a.webkitRelativePath||a.name).localeCompare(String(b.webkitRelativePath||b.name),undefined,{numeric:true,sensitivity:'base'}));}
export function imageFiles(files){return naturalFiles([...files].filter(f=>/\.(png|jpe?g|webp)$/i.test(f.name)&&(!f.type||['image/png','image/jpeg','image/webp'].includes(f.type))));}
export function maskStats(encoded){
 if(!encoded)return null;const m=decodeMask(encoded),W=encoded.width,H=encoded.height;let area=0,x=0,y=0,x0=W,y0=H,x1=0,y1=0;
 for(let i=0;i<m.length;i++)if(m[i]){const px=i%W,py=Math.floor(i/W);area++;x+=px+.5;y+=py+.5;x0=Math.min(x0,px);y0=Math.min(y0,py);x1=Math.max(x1,px+1);y1=Math.max(y1,py+1);}
 return{area,cx:area?x/area:null,cy:area?y/area:null,bbox:area?[x0,y0,x1-x0,y1-y0]:[0,0,0,0],width:W,height:H};
}
export function qualityFlags(current,previous,{areaThreshold=.5,motionThreshold=.2}={}){
 const flags=[];if(!isVisible(current?.visibility))return flags;
 const a=maskStats(current?.mask);if(!a?.area)return ['Empty target mask'];
 const b=isVisible(previous?.visibility)?maskStats(previous?.mask):null;
 if(!b?.area||a.width!==b.width||a.height!==b.height)return flags;
 if(Math.abs(a.area-b.area)/b.area>areaThreshold)flags.push('Area changed > '+Math.round(areaThreshold*100)+'%');
 if(Math.hypot(a.cx-b.cx,a.cy-b.cy)/Math.hypot(a.width,a.height)>motionThreshold)flags.push('Position jump > '+Math.round(motionThreshold*100)+'% of image diagonal');
 return flags;
}
export function reviewLabel(record){if(!record)return 'unprocessed';if(record.review==='approved')return 'approved';if(!isVisible(record.visibility))return record.visibility==='unknown'?'target missing':record.visibility;if(record.flags?.length)return 'flagged';if(record.corrected)return 'corrected';return record.mask?'needs review':'unprocessed';}
export function cocoRLE(encoded){
 const mask=decodeMask(encoded),counts=[];let last=0,n=0;
 for(let x=0;x<encoded.width;x++)for(let y=0;y<encoded.height;y++){const v=mask[y*encoded.width+x]?1:0;if(v===last)n++;else{counts.push(n);n=1;last=v;}}
 counts.push(n);return{size:[encoded.height,encoded.width],counts};
}
export function emptyMask(width,height){return encodeMask(new Uint8Array(width*height),width,height);}
