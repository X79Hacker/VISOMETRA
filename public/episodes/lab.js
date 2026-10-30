import {cleanFrameInfo,projectMetrics,legacyMetrics,contentSignature,reviewState,graphRows} from './lab-core.js';
import {targetRecord,targetRecords,selectTargetProject,isVisible} from '../studio/sequence-core.js';
import {csv,safeName} from '../studio/core.js';
import {backupEpisode,restoreBackup,download} from './backup.js';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
const state={targetId:null,targets:new Map(),episode:null,frames:[],index:0,tab:'inspect',playing:false,timer:null,dirty:false,saving:false,allLoading:false,stopLoading:false,cache:new Map(),pending:new Map(),view:{zoom:1,x:0,y:0},draws:new Map(),graphPoints:[]};
const fmt=v=>Number.isFinite(v)?v.toLocaleString(undefined,{maximumFractionDigits:4}):'—';
function say(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
async function request(path,options={}){const r=await fetch(path,{cache:'no-store',...options});if(r.status===404)return null;const j=await r.json();if(!r.ok)throw Error(j.error||'Request failed: HTTP '+r.status);return j;}
const record=(store,id)=>request('api/store/'+store+'/'+encodeURIComponent(id));
function active(){return state.frames[state.index];}
function pause(){state.playing=false;clearTimeout(state.timer);$('play').textContent='Play sequence';}
function warn(error){pause();say(error.message||String(error),true);}
const action=fn=>async(...args)=>{try{await fn(...args);}catch(error){warn(error);}};
function release(entry){entry.bitmap?.close();}
async function entry(frame,force=false){
  if(!frame)throw Error('Choose a frame first.');
  if(force&&state.cache.has(frame.id)){release(state.cache.get(frame.id));state.cache.delete(frame.id);}
  if(state.cache.has(frame.id)){const e=state.cache.get(frame.id);state.cache.delete(frame.id);state.cache.set(frame.id,e);return e;}
  if(state.pending.has(frame.id))return state.pending.get(frame.id);
  const promise=(async()=>{
    const [project,trace,patches]=await Promise.all(['projects','traces','patches'].map(store=>record(store,frame.id)));
    const source={project,trace,patches,rows:frame.rows},e={source,bitmap:null,maskCanvas:null,geometry:null};
    for(const t of targetRecords(project))if(t)state.targets.set(t.id,t.name);updateTargetSelector();
    try{e.geometry=projectMetrics(project,state.targetId);}catch(error){frame.analysisError=error.message;}
    frame.metrics=e.geometry?(({mask,loops,width,height,...summary})=>summary)(e.geometry):(state.targetId||project?.targets||!isVisible(project?.visibility)?null:legacyMetrics(frame.rows));
    frame.signature=await contentSignature(source);frame.review=reviewState(frame.info,source,frame.signature);frame.loaded=true;
    e.source=source;state.cache.set(frame.id,e);
    while(state.cache.size>6){const key=state.cache.keys().next().value;if(key===frame.id)break;release(state.cache.get(key));state.cache.delete(key);}
    return e;
  })();state.pending.set(frame.id,promise);try{return await promise;}finally{state.pending.delete(frame.id);}
}
async function bitmap(frame,e){if(e.bitmap)return e.bitmap;const r=await fetch('api/store/blob/'+encodeURIComponent(frame.id));if(!r.ok)throw Error('Could not load image '+frame.name);const bmp=await createImageBitmap(await r.blob());if(bmp.width*bmp.height>12000000||Math.max(bmp.width,bmp.height)>12000){bmp.close();throw Error('Episode Lab supports images up to 12 megapixels and 12,000 pixels per side. Resize larger images explicitly.');}e.bitmap=bmp;return bmp;}
function tracePath(context,trace,image){
  const nodes=trace?.nodes;if(!nodes?.length||!trace.closed||!nodes.every(n=>Array.isArray(n.p)&&Array.isArray(n.hi)&&Array.isArray(n.ho)))return false;
  const side=Math.min(image.width,image.height),ox=(image.width-side)/2,oy=(image.height-side)/2,point=p=>[ox+p[0]*side/8000,oy+p[1]*side/8000];
  context.beginPath();context.moveTo(...point(nodes[0].p));for(let i=0;i<nodes.length;i++){const a=nodes[i],b=nodes[(i+1)%nodes.length];context.bezierCurveTo(...point(a.ho),...point(b.hi),...point(b.p));}context.closePath();return true;
}
async function drawCanvas(id,frame){
  const canvas=$(id);if(!frame||!canvas.offsetWidth)return;
  const token=(state.draws.get(id)||0)+1;state.draws.set(id,token);
  const e=await entry(frame),bmp=await bitmap(frame,e);if(state.draws.get(id)!==token||!canvas.offsetWidth)return;
  const W=canvas.clientWidth,H=canvas.clientHeight,dpr=Math.min(2,devicePixelRatio||1);canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);const c=canvas.getContext('2d');c.scale(dpr,dpr);c.clearRect(0,0,W,H);
  const scale=Math.min((W-24)/bmp.width,(H-24)/bmp.height)*state.view.zoom,w=bmp.width*scale,h=bmp.height*scale;
  c.translate((W-w)/2+state.view.x*W,(H-h)/2+state.view.y*H);c.scale(scale,scale);
  const mode=$('overlay').value;if(mode!=='mask')c.drawImage(bmp,0,0);else{c.fillStyle='#030b12';c.fillRect(0,0,bmp.width,bmp.height);}
  if(['both','mask'].includes(mode)&&e.geometry?.mask){
    if(!e.maskCanvas){const layer=document.createElement('canvas');layer.width=e.geometry.width;layer.height=e.geometry.height;const lc=layer.getContext('2d'),pixels=lc.createImageData(layer.width,layer.height);for(let i=0;i<e.geometry.mask.length;i++)if(e.geometry.mask[i]){pixels.data[i*4]=184;pixels.data[i*4+1]=236;pixels.data[i*4+2]=135;pixels.data[i*4+3]=255;}lc.putImageData(pixels,0,0);e.maskCanvas=layer;}
    c.globalAlpha=mode==='mask'?1:.3;c.drawImage(e.maskCanvas,0,0,bmp.width,bmp.height);c.globalAlpha=1;
  }
  if(['both','boundary'].includes(mode)){
    c.lineWidth=2/scale;c.strokeStyle='#b8ec87';c.lineJoin='round';
    if(e.geometry){for(const loop of e.geometry.loops){c.beginPath();loop.points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();c.strokeStyle=loop.role==='hole'?'#f5a6cc':'#b8ec87';c.setLineDash(loop.role==='hole'?[6/scale,4/scale]:[]);c.stroke();}}
    else if(!state.targetId&&!e.source.project?.targets&&isVisible(e.source.project?.visibility)&&tracePath(c,e.source.trace,bmp))c.stroke();
  }
}
function metrics(target,frame){
  const container=$(target);container.replaceChildren();const m=frame?.metrics;
  for(const [name,value] of [['Selected area',m?fmt(m.area)+' '+m.unit+'²':'—'],['Perimeter',m?fmt(m.perimeter)+' '+m.unit:'—'],['Centroid x / y',m?fmt(m.cx)+' / '+fmt(m.cy)+' '+m.unit:'—'],['Source',m?.source||'No saved measurement']]){
    const div=document.createElement('div'),small=document.createElement('small'),strong=document.createElement('strong');small.textContent=name;strong.textContent=value;div.append(small,strong);container.append(div);
  }
}
function updateCounts(){const approved=state.frames.filter(f=>f.review==='approved').length;$('approvalCount').textContent=approved+' / '+state.frames.length+' approved';$('checklistSummary').textContent=state.frames.filter(f=>f.loaded).length+' analyzed · '+approved+' approved';}
function renderTimeline(){
  $('timeline').replaceChildren();state.frames.forEach((frame,i)=>{
    const b=document.createElement('button');b.className=i===state.index?'active':'';b.setAttribute('aria-label','Open frame '+(i+1)+': '+frame.name);
    const img=document.createElement('img');img.loading='lazy';img.src='api/store/blob/'+encodeURIComponent(frame.id);img.alt='';
    const title=document.createElement('strong');title.textContent=String(i+1).padStart(3,'0')+' · '+frame.name;
    const status=document.createElement('small');status.textContent=frame.review||'Not analyzed';b.append(img,title,status);b.onclick=action(()=>choose(i));$('timeline').append(b);
  });$('framePosition').textContent='Frame '+(state.frames.length?state.index+1:0)+' / '+state.frames.length;
  $('previous').disabled=!state.index;$('next').disabled=state.index>=state.frames.length-1;$('play').disabled=state.frames.length<2;updateCounts();
}
function fillForm(frame){const info=frame.info||{};$('timestamp').value=info.timestamp||'';$('labels').value=(info.labels||[]).join(', ');$('notes').value=info.notes||'';for(const key of ['front','left','right','rear','speed','steering'])$(key).value=info.sensors?.[key]??'';state.dirty=false;$('savedState').textContent=info.editedAt?'Last saved '+new Date(info.editedAt).toLocaleString():'No capture metadata saved yet.';}
async function saveInfo({silent=false}={}){
  const f=active();if(!f||!state.dirty)return;if(state.saving)throw Error('Wait for the frame information to finish saving.');
  state.saving=true;$('saveMetadata').disabled=true;
  try{const clean=cleanFrameInfo({timestamp:$('timestamp').value,labels:$('labels').value.split(','),notes:$('notes').value,sensors:Object.fromEntries(['front','left','right','rear','speed','steering'].map(k=>[k,$(k).value]))});
    const info={...f.info,...clean,fileId:f.id,editedAt:Date.now(),editedBy:window.Session?.user||''};await request('api/store/frameinfo/'+encodeURIComponent(f.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(info)});f.info=info;state.dirty=false;$('savedState').textContent='Saved at '+new Date().toLocaleTimeString();if(!silent)say('Frame notes, event labels, capture timestamp and sensor readings saved.');renderReview();
  }finally{state.saving=false;$('saveMetadata').disabled=false;}
}
async function choose(index,{playing=false}={}){
  if(index<0||index>=state.frames.length)return;if(!playing)pause();await saveInfo({silent:true});const token=state.navigation=(state.navigation||0)+1;state.index=index;const f=active();fillForm(f);$('frameName').textContent=f.name;
  for(const [id,path] of [['openTrace','trace.html'],['openGrid','sector-map-matrix.html'],['openStudio','outline-studio.html']])$(id).href=Episodes.link(path+'?f='+encodeURIComponent(f.id));
  $('openTracking').href=Episodes.link('outline-studio.html?queue=episode&start='+encodeURIComponent(f.id)+'&tracking=1');
  const url=new URL(location.href);url.searchParams.set('f',f.id);history.replaceState(null,'',url);
  await entry(f);if(token!==state.navigation)return;$('frameReview').textContent=f.review+(f.analysisError?' · invalid saved project':'');metrics('frameMetrics',f);renderTimeline();renderReview();drawGraph();
  if(state.tab==='inspect')await drawCanvas('mainCanvas',f);$('timeline').children[index]?.scrollIntoView({block:'nearest',inline:'nearest',behavior:playing?'instant':'smooth'});
}
async function playStep(){
  if(!state.playing)return;
  let next=state.index+1;if(next>=state.frames.length){if(!$('loop').checked){pause();return;}next=0;}
  await choose(next,{playing:true});if(state.playing)state.timer=setTimeout(()=>playStep().catch(warn),1000/Number($('fps').value));
}
async function togglePlay(){if(state.playing){pause();return;}if(state.index===state.frames.length-1)await choose(0);await saveInfo({silent:true});state.playing=true;$('play').textContent='Pause';state.timer=setTimeout(()=>playStep().catch(warn),1000/Number($('fps').value));}
async function showTab(tab){pause();await saveInfo({silent:true});state.tab=tab;document.querySelectorAll('[data-view]').forEach(e=>e.hidden=e.dataset.view!==tab);document.querySelectorAll('[data-tab]').forEach(e=>e.setAttribute('aria-pressed',String(e.dataset.tab===tab)));
  if(tab==='inspect')await drawCanvas('mainCanvas',active());if(tab==='compare')await compare();if(tab==='graphs'||tab==='review'){renderReview();drawGraph();loadAll().catch(warn);}}
async function compare(){
  const token=state.comparison=(state.comparison||0)+1;
  const a=state.frames[Number($('compareA').value)],b=state.frames[Number($('compareB').value)];if(!a||!b)return;
  await Promise.all([entry(a),entry(b)]);if(token!==state.comparison)return;$('compareNameA').textContent=a.name;$('compareNameB').textContent=b.name;metrics('compareMetricsA',a);metrics('compareMetricsB',b);
  await Promise.all([drawCanvas('compareCanvasA',a),drawCanvas('compareCanvasB',b)]);
  const same=a.metrics&&b.metrics&&a.metrics.unit===b.metrics.unit&&a.metrics.source===b.metrics.source;
  $('comparisonDifference').textContent=same?'Area difference B − A: '+fmt(b.metrics.area-a.metrics.area)+' '+a.metrics.unit+'². Compare viewpoints and calibration before interpreting the change.':'Use matching sources and calibration units for a numerical comparison. Overlays show saved Studio masks or the legacy whole-image trace; cell-only drawings remain in the Grid editor.';
}
async function redraw(){if(state.tab==='inspect')await drawCanvas('mainCanvas',active());if(state.tab==='compare')await compare();}
function seriesOptions(){const previous=$('series').value,options=[...new Set(state.frames.filter(f=>f.metrics).map(f=>f.metrics.source+' | '+f.metrics.unit))];$('series').replaceChildren(...options.map(s=>new Option(s,s)));if(options.includes(previous))$('series').value=previous;}
function drawGraph(){
  if(state.tab!=='graphs')return;seriesOptions();const metric=$('metric').value,sensor=metric.startsWith('sensor:');$('series').disabled=sensor;
  const rows=graphRows(state.frames,metric,$('series').value,$('xAxis').value),valid=rows.filter(r=>Number.isFinite(r.x)&&Number.isFinite(r.y));
  const canvas=$('graph'),c=canvas.getContext('2d'),W=canvas.width,H=canvas.height;c.clearRect(0,0,W,H);state.graphPoints=[];c.font='17px Segoe UI,sans-serif';c.fillStyle='#9db9c4';
  if(!valid.length){c.fillText('No saved values for this metric yet.',45,60);$('graphInfo').textContent='Add measurements or sensor readings. Missing capture timestamps are omitted on the time axis.';return;}
  let minX=Math.min(...valid.map(r=>r.x)),maxX=Math.max(...valid.map(r=>r.x)),minY=Math.min(...valid.map(r=>r.y)),maxY=Math.max(...valid.map(r=>r.y));if(minY===maxY){minY-=Math.max(.5,Math.abs(minY)*.05);maxY+=Math.max(.5,Math.abs(maxY)*.05);}const padding=(maxY-minY)*.1;minY-=padding;maxY+=padding;
  const X=x=>88+(x-minX)/(maxX-minX||1)*(W-130),Y=y=>H-60-(y-minY)/(maxY-minY)*(H-100);
  c.lineWidth=1;for(let i=0;i<5;i++){const y=40+i*(H-100)/4;c.strokeStyle='#263c48';c.beginPath();c.moveTo(85,y);c.lineTo(W-40,y);c.stroke();c.fillStyle='#8da8b4';c.fillText(fmt(maxY-i*(maxY-minY)/4),9,y+5);}
  c.strokeStyle='#b8ec87';c.lineWidth=3;c.beginPath();let open=false;for(const row of rows){if(!Number.isFinite(row.x)||!Number.isFinite(row.y)){open=false;continue;}const x=X(row.x),y=Y(row.y);open?c.lineTo(x,y):c.moveTo(x,y);open=true;state.graphPoints.push({x,y,index:row.index,value:row.y});}c.stroke();
  for(const point of state.graphPoints){c.fillStyle=point.index===state.index?'#f1c790':'#b8ec87';c.beginPath();c.arc(point.x,point.y,point.index===state.index?7:5,0,2*Math.PI);c.fill();}
  c.fillStyle='#8da8b4';const time=$('xAxis').value==='time';for(let i=0;i<5;i++){const x=minX+i*(maxX-minX)/4;c.fillText(time?new Date(x).toISOString().slice(11,23):fmt(x),Math.min(W-150,X(x)-20),H-23);}
  $('graphInfo').textContent=valid.length+' / '+state.frames.length+' frames have a value. '+(sensor?'Sensor units are shown in the metric selector.':$('series').value)+'. Click a plotted point to inspect its frame.';
}
function missing(frame){const parts=[];if(!frame.loaded)parts.push('not analyzed');if(!frame.metrics)parts.push('measurement');if(!frame.info?.timestamp)parts.push('capture time');if(frame.analysisError)parts.push('valid project');return parts.join(', ')||'—';}
function renderReview(){
  const filter=$('reviewFilter').value,query=$('eventFilter').value.trim().toLowerCase();$('reviewRows').replaceChildren();
  state.frames.forEach((f,i)=>{if(filter!=='all'&&(f.review||'unprocessed')!==filter)return;if(query&&![(f.info?.labels||[]).join(' '),f.info?.notes||''].join(' ').toLowerCase().includes(query))return;
    const tr=document.createElement('tr');for(const [j,value] of [i+1,f.name,f.metrics?.source||(f.loaded?'No measurement':'Not analyzed'),f.review||'Not analyzed',f.info?.timestamp||'—',(f.info?.labels||[]).join(', ')||'—',missing(f)].entries()){
      const td=document.createElement('td');td.textContent=String(value);if(j===3)td.className=f.review==='approved'?'approved':f.review==='flagged'?'flagged':'';if(j===5)td.className='event-cell';if(j===6)td.className='missing';tr.append(td);}
    const td=document.createElement('td'),button=document.createElement('button');button.textContent='Inspect';button.onclick=action(async()=>{await showTab('inspect');await choose(i);});td.append(button);tr.append(td);$('reviewRows').append(tr);
  });updateCounts();
}
function loadAll(){
  if(state.loadPromise)return state.loadPromise;
  state.allLoading=true;state.stopLoading=false;
  const job=Promise.resolve().then(async()=>{
    try{for(let i=0;i<state.frames.length;i++){if(state.stopLoading)break;if(!state.frames[i].loaded)await entry(state.frames[i]);say('Reading saved frame analysis '+(i+1)+' / '+state.frames.length+'…');renderReview();drawGraph();}renderTimeline();say(state.stopLoading?'Analysis paused. Reopen Graphs / Review to continue.':'Saved frame measurements and review checklist updated.');}
    finally{state.allLoading=false;}
  });
  state.loadPromise=job;const clear=()=>{if(state.loadPromise===job)state.loadPromise=null;};job.then(clear,clear);return job;
}
async function markReview(status){
  pause();await saveInfo({silent:true});const f=active();if(!f)return;const e=await entry(f,true);
  if(status==='approved'&&reviewState({...f.info,review:null},e.source,f.signature)==='unprocessed')throw Error('Create an outline or measurement before approving this frame.');
  const info={...f.info,fileId:f.id,review:status?{state:status,signature:f.signature,by:Session.user,at:Date.now()}:null};
  await request('api/store/frameinfo/'+encodeURIComponent(f.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(info)});f.info=info;f.review=reviewState(info,e.source,f.signature);if(active()?.id===f.id)$('frameReview').textContent=f.review;renderTimeline();renderReview();say(status==='approved'?'Frame approved for its current saved geometry and settings.':status==='flagged'?'Frame flagged for correction.':'Frame-level review cleared. Studio mask approval, if any, remains visible.');
}
async function exportTable(){await saveInfo({silent:true});await loadAll();const headings=['frame','image_id','filename','capture_timestamp','event_labels','notes','review','source','unit','area','perimeter','centroid_x','centroid_y','reconstruction_error','front_mm','left_mm','right_mm','rear_mm','speed_m_s','steering_deg'];const rows=state.frames.map((f,i)=>[i+1,f.id,f.name,f.info.timestamp,(f.info.labels||[]).join('; '),f.info.notes,f.review,f.metrics?.source,f.metrics?.unit,f.metrics?.area,f.metrics?.perimeter,f.metrics?.cx,f.metrics?.cy,f.metrics?.reconstruction,...['front','left','right','rear','speed','steering'].map(k=>f.info.sensors?.[k])]);download(new Blob([csv([headings,...rows])],{type:'text/csv'}),safeName(state.episode.name)+'-frames.csv');say('Frame table exported, including metadata, review status and saved measurements.');}
async function restore(file){if(!file)return;pause();await saveInfo({silent:true});say('Validating and restoring the complete episode backup…');const result=await restoreBackup(file);location.href=Episodes.link('episode-lab.html',result.episode_id);}
function wire(){
  $('previous').onclick=action(()=>choose(state.index-1));$('next').onclick=action(()=>choose(state.index+1));$('play').onclick=action(togglePlay);$('fps').onchange=()=>{if(state.playing){pause();togglePlay().catch(warn);}};
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=action(()=>showTab(b.dataset.tab)));
  $('metadataForm').onsubmit=event=>{event.preventDefault();saveInfo().catch(warn);};$('metadataForm').oninput=()=>{state.dirty=true;pause();$('savedState').textContent='Unsaved changes · saved when you switch frames.';};
  $('approve').onclick=action(()=>markReview('approved'));$('flag').onclick=action(()=>markReview('flagged'));$('clearReview').onclick=action(()=>markReview(null));
  $('overlay').onchange=()=>redraw().catch(warn);$('zoom').oninput=()=>{state.view.zoom=Number($('zoom').value)/100;$('zoomLabel').textContent=$('zoom').value+'%';redraw().catch(warn);};$('fit').onclick=()=>{state.view={zoom:1,x:0,y:0};$('zoom').value=100;$('zoomLabel').textContent='100%';redraw().catch(warn);};
  for(const id of ['mainCanvas','compareCanvasA','compareCanvasB']){const c=$(id);let drag=null;c.onpointerdown=e=>{pause();drag={x:e.clientX,y:e.clientY,px:state.view.x,py:state.view.y};c.setPointerCapture(e.pointerId);};c.onpointermove=e=>{if(!drag)return;state.view.x=drag.px+(e.clientX-drag.x)/c.clientWidth;state.view.y=drag.py+(e.clientY-drag.y)/c.clientHeight;redraw().catch(warn);};c.onpointerup=c.onpointercancel=()=>{drag=null;};c.onwheel=e=>{e.preventDefault();state.view.zoom=Math.max(1,Math.min(6,state.view.zoom*Math.exp(-e.deltaY*.001)));$('zoom').value=Math.round(state.view.zoom*100);$('zoomLabel').textContent=Math.round(state.view.zoom*100)+'%';redraw().catch(warn);};}
  $('compareA').onchange=$('compareB').onchange=()=>compare().catch(warn);$('swap').onclick=()=>{const a=$('compareA').value;$('compareA').value=$('compareB').value;$('compareB').value=a;compare().catch(warn);};
  for(const id of ['metric','series','xAxis'])$(id).onchange=drawGraph;for(const id of ['reviewFilter','eventFilter'])$(id).oninput=renderReview;
  $('graph').onclick=action(async event=>{const rect=$('graph').getBoundingClientRect(),x=(event.clientX-rect.left)*$('graph').width/rect.width,y=(event.clientY-rect.top)*$('graph').height/rect.height;const nearest=state.graphPoints.slice().sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0];if(nearest&&Math.hypot(nearest.x-x,nearest.y-y)<45){await showTab('inspect');await choose(nearest.index);}});
  $('refresh').onclick=action(async()=>{pause();await saveInfo({silent:true});location.reload();});$('exportTable').onclick=action(exportTable);$('backup').onclick=action(async()=>{pause();await saveInfo({silent:true});say('Preparing complete episode backup…');await backupEpisode(state.episode.id,state.episode.name);say('Complete episode backup downloaded. Saved Studio projects, metadata, images and legacy history are included.');});$('restore').onclick=()=>$('restoreFile').click();$('restoreFile').onchange=action(()=>restore($('restoreFile').files[0]));
  addEventListener('resize',()=>{redraw().catch(warn);drawGraph();});addEventListener('beforeunload',event=>{if(state.dirty||state.saving){event.preventDefault();event.returnValue='';}});document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  document.addEventListener('keydown',event=>{if(/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;if(event.code==='Space'){event.preventDefault();togglePlay().catch(warn);}if(event.key==='ArrowLeft'){event.preventDefault();choose(state.index-1).catch(warn);}if(event.key==='ArrowRight'){event.preventDefault();choose(state.index+1).catch(warn);}});
}
function updateTargetSelector(){const select=$('labTarget');if(!select)return;const selected=state.targetId||'';select.replaceChildren(new Option('Saved active target per frame',''),...[...state.targets].map(([id,name])=>new Option(name,id)));select.value=selected;}
async function changeLabTarget(){pause();state.targetId=$('labTarget').value||null;for(const e of state.cache.values())release(e);state.cache.clear();state.pending.clear();for(const f of state.frames){f.loaded=false;f.metrics=null;f.analysisError=null;}await choose(state.index);if(state.tab==='graphs'||state.tab==='review')await loadAll();await redraw();drawGraph();}
async function init(){
  const targetBar=document.createElement('div');targetBar.className='compare-controls panel';targetBar.style.padding='10px 16px';targetBar.innerHTML='<label>Analyze target <select id="labTarget"><option value="">Saved active target per frame</option></select></label><span class="lab-note">Named targets are separate series. Hidden or missing targets leave gaps.</span>';document.querySelector('main').prepend(targetBar);$('labTarget').onchange=action(changeLabTarget);
  wire();await Session.ready;if(!Episodes.context)throw Error('Open an episode from the dashboard, then select Episode Lab.');
  const [episode,files,results,infoRecords]=await Promise.all([Episodes.get(Episodes.context),request('api/store/files'),request('api/results'),request('api/store/frameinfo')]);if(!episode)throw Error('Episode not found.');
  state.episode=episode;const infoById=new Map((infoRecords?.records||[]).map(i=>[i.fileId,i])),byImage=new Map();for(const row of results?.rows||[]){if(!byImage.has(row.image_id))byImage.set(row.image_id,[]);byImage.get(row.image_id).push(row);}
  state.frames=Episodes.order(files?.records||[],episode).map(f=>({...f,info:infoById.get(f.id)||{sensors:{},labels:[],notes:''},rows:byImage.get(f.id)||[],loaded:false}));
  $('episodeName').textContent=episode.name;$('episodeNotes').textContent=episode.notes||'An ordered capture session.';$('frameCount').textContent=state.frames.length+' frames';$('dashboard').href=Episodes.link('dashboard-front.html');
  for(const id of ['compareA','compareB'])$(id).replaceChildren(...state.frames.map((f,i)=>new Option(String(i+1).padStart(3,'0')+' · '+f.name,String(i))));$('compareB').value=String(Math.min(1,state.frames.length-1));
  if(!state.frames.length){renderTimeline();say('This episode is empty. Return to the workspace to add frames.');for(const button of document.querySelectorAll('button'))if(!['restore','refresh'].includes(button.id))button.disabled=true;return;}
  await choose(Math.max(0,state.frames.findIndex(f=>f.id===params.get('f'))));say('Episode ready. Play the timeline, compare frames, or open Graphs / Review to load saved analysis.');
}
init().catch(warn);
