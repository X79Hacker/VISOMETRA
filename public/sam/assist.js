import {traceContours,pathData,signedArea,simplifyClosed,decodeMask,rankOuterRegions,holesForRegion} from './geometry.js';

export function attachSam(adapter){
 const dialog=document.createElement('dialog');dialog.className='sam-dialog';dialog.setAttribute('aria-label','AI boundary assistant');
 dialog.innerHTML=`<header class="sam-header"><div><span class="sam-kicker">SECTOR MAP / FOURIER OUTLINE · V2</span><h2>One object. One Fourier outline.</h2><p data-s="scope"></p></div><button data-s="close" class="sam-icon" aria-label="Close AI assistant">×</button></header>
 <div class="sam-layout"><aside class="sam-controls"><label>Segmentation engine<select data-s="engine"><option value="fast">SlimSAM · stable CPU (included)</option><option value="tracker">SAM 3 · points / box (setup required)</option><option value="concept">SAM 3 · text / exemplar (setup required)</option></select></label>
 <p data-s="engineInfo" class="sam-note">Stable CPU inference. No extra model download needed.</p>
 <label data-s="textRow" hidden>Object description<input data-s="text" maxlength="200" placeholder="e.g. leaf, red cup, damaged region"></label>
 <div class="sam-tool-row"><button data-tool="include" aria-pressed="true">+ Include</button><button data-tool="exclude" aria-pressed="false">− Exclude</button><button data-tool="box" aria-pressed="false">□ Box</button></div>
 <p class="sam-note" data-s="instruction">Start with ONE Include point inside the object. Green points select its interior; they are not boundary anchors.</p><div class="sam-prompt-row"><span data-s="promptCount">No prompts</span><button data-s="undo">Undo prompt</button><button data-s="reset">Reset</button></div>
 <button data-s="run" class="sam-primary">Segment object</button><progress data-s="progress" max="100" value="0" hidden></progress><p data-s="status" class="sam-status" role="status" aria-live="polite">Add a point or box to begin.</p>
 <div class="sam-settings"><label>Preview<select data-s="view"><option value="boundary">Fourier outline only (selected)</option><option value="both">Mask + selected outline</option><option value="mask">Mask only</option><option value="compare">Compare with original</option><option value="original">Original</option><option value="edges">All raw mask edges (diagnostics)</option></select></label><label>Mask opacity<input data-s="opacity" type="range" min="5" max="85" value="35"></label><label data-s="splitRow" hidden>Original ← → Result<input data-s="split" type="range" min="0" max="100" value="50"></label><label>Object / candidate<select data-s="candidate" disabled><option>Run segmentation first</option></select></label><label>Outer region to use<select data-s="region" disabled><option>No boundary yet</option></select></label><label>Outline simplification (pixels)<select data-s="tolerance"><option value="0.5">0.5 · more detail</option><option value="1" selected>1 · balanced</option><option value="2">2 · fewer anchors</option><option value="4">4 · simpler outline</option></select></label><label class="sam-check"><input data-s="showPrompts" type="checkbox" checked> Show prompt markers</label></div>
 <details class="sam-help"><summary>Text prompts & full-image tools</summary><p>Open Outline Studio V3 from the page toolbar for bundled text → SAM, mask brushes, true hole measurements, original image coordinates, portable projects and batch review. This quick grid assistant retains its centered square crop and single-outer-outline measurement workflow.</p><p>Official SAM 3 needs a separate authorized download and Python dependencies. Run setup-sam3-windows.bat once, then restart start-windows.bat.</p><a href="sam-help.html" target="_blank" rel="noreferrer">Open setup instructions ↗</a></details></aside>
 <section class="sam-preview"><div class="sam-image-label"><span data-s="name"></span><span data-s="resolution"></span></div><div class="sam-canvas-wrap"><canvas data-s="canvas" aria-label="AI prompt image" tabindex="0"></canvas><div class="sam-empty-hint" data-s="hint">Click the object, then Segment object.</div></div><div class="sam-result" data-s="stats">The green outline is the exact selected polygon that will be sent to Fourier.</div><p class="sam-note">GREEN = the selected Fourier outline. The binary mask and cutout exports keep the full predicted mask. Review the outline before applying.</p><label class="sam-hole-note" data-s="holeRow" hidden><input data-s="allowHoles" type="checkbox"> I understand that the existing single-outline measurements will fill internal holes.</label><div class="sam-export"><select data-s="format" aria-label="AI export format"><option value="overlay">Selected outline overlay PNG</option><option value="boundary">Outline only PNG (transparent)</option><option value="mask">Binary mask PNG</option><option value="cutout">Transparent cutout PNG</option></select><button data-s="export">Export PNG</button></div></section></div>
 <footer class="sam-footer"><span data-s="applyNote">1. One point inside → 2. Segment object → 3. Apply & run Fourier. You can refine the outline afterward.</span><div class="sam-footer-actions"><button data-s="apply">Use boundary only</button><button data-s="applyCompute" class="sam-primary">Apply & run Fourier</button></div></footer>`;
 document.body.append(dialog);
 const $=key=>dialog.querySelector(`[data-s="${key}"]`),canvas=$('canvas'),ctx=canvas.getContext('2d');
 let source=null,points=[],box=null,history=[],tool='include',drag=null,result=null,candidates=[],paths=[],regions=[],outline=[],maskLayer=null,backend=null,busy=false,generation=0,worker=null,workerPending=null,workerId=0,aborter=null;
 const say=(text,error=false)=>{$('status').textContent=text;$('status').classList.toggle('sam-error',error);};
 function controls(){
  const conceptual=$('engine').value==='concept',hasPrompt=conceptual?!!($('text').value.trim()||box):!!(points.length||box);
  $('run').disabled=busy||!source||!hasPrompt;$('run').textContent=busy?'Working…':'Segment object';$('reset').disabled=busy; $('undo').disabled=busy||!history.length;$('engine').disabled=busy;$('text').disabled=busy;
  $('export').disabled=busy||!result;$('apply').disabled=busy||!outline.length||($('holeRow').hidden===false&&!$('allowHoles').checked)||outline.length>2000;$('applyCompute').disabled=$('apply').disabled;
  $('candidate').disabled=busy||candidates.length<2;$('region').disabled=busy||!regions.length;
  dialog.querySelectorAll('[data-tool]').forEach(b=>{b.disabled=busy||(conceptual&&b.dataset.tool!=='box');b.setAttribute('aria-pressed',tool===b.dataset.tool);});
  $('promptCount').textContent=`${points.filter(p=>p.label===1).length} include · ${points.filter(p=>p.label===0).length} exclude${box?' · box':''}`;
 }
 function clearResult(){result=null;candidates=[];paths=[];regions=[];outline=[];maskLayer=null;$('candidate').replaceChildren(new Option('Run segmentation first'));$('region').replaceChildren(new Option('No boundary yet'));$('holeRow').hidden=true;$('allowHoles').checked=false;$('stats').textContent='The green outline will be sent to Fourier. Your saved outline is unchanged until you apply.';controls();draw();}
 function markChanged(){clearResult();$('hint').hidden=!!(points.length||box||$('text').value);say('Prompts ready. Segment object to update the preview.');}
 function checkpoint(){history.push({points:structuredClone(points),box:box?{...box}:null});}
 function reset(){points=[];box=null;history=[];drag=null;tool=$('engine').value==='concept'?'box':'include';$('text').value='';clearResult();$('hint').hidden=false;say('Prompts reset. Add a point or box.');}
 function position(e){const r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(canvas.width-1,(e.clientX-r.left)*canvas.width/r.width)),y:Math.max(0,Math.min(canvas.height-1,(e.clientY-r.top)*canvas.height/r.height))};}
 function strokeSelected(target){if(!outline.length)return;const path=new Path2D(pathData([outline]));target.lineJoin='round';target.lineCap='round';target.strokeStyle='#051b16';target.lineWidth=5;target.stroke(path);target.strokeStyle='#00ffad';target.lineWidth=2.5;target.stroke(path);}
 function drawOverlay(target){if(!result)return;const view=$('view').value;if(['both','mask','compare'].includes(view)){target.globalAlpha=Number($('opacity').value)/100;target.drawImage(maskLayer,0,0);target.globalAlpha=1;}if(view==='edges'){const path=new Path2D(pathData(paths));target.strokeStyle='#ff7051';target.lineWidth=1;target.stroke(path);}else if(view!=='mask')strokeSelected(target);}
 function draw(){if(!source)return;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0);if(result&&$('view').value!=='original'){if($('view').value==='compare'){const x=canvas.width*Number($('split').value)/100;ctx.save();ctx.beginPath();ctx.rect(x,0,canvas.width-x,canvas.height);ctx.clip();drawOverlay(ctx);ctx.restore();ctx.fillStyle='white';ctx.fillRect(x-1,0,2,canvas.height);}else drawOverlay(ctx);}const scale=canvas.width/(canvas.getBoundingClientRect().width||canvas.width);if(!$('showPrompts').checked)return;for(const p of points){ctx.beginPath();ctx.arc(p.x,p.y,4.5*scale,0,Math.PI*2);ctx.fillStyle=p.label?'#00ff9d':'#ff647a';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5*scale;ctx.stroke();}const b=drag?{x1:drag.start.x,y1:drag.start.y,x2:drag.end.x,y2:drag.end.y}:box;if(b){ctx.save();ctx.setLineDash([6*scale,4*scale]);ctx.strokeStyle='#00e8ff';ctx.lineWidth=2*scale;ctx.strokeRect(b.x1,b.y1,b.x2-b.x1,b.y2-b.y1);ctx.restore();}}
 function updateOutline(){
  const region=regions[Number($('region').value)||0];outline=region?simplifyClosed(region,Number($('tolerance').value)):[];
  const hadHoles=!$('holeRow').hidden,holes=holesForRegion(paths,region);$('holeRow').hidden=!holes.length;if(!hadHoles||!holes.length)$('allowHoles').checked=false;
  if(result){const area=result.mask.reduce((s,v)=>s+(v?1:0),0);$('stats').textContent=`${result.engine} · predicted score ${(Math.max(0,Math.min(1,result.score))*100).toFixed(1)}% · ${area.toLocaleString()} mask pixels · ${(result.elapsed/1000).toFixed(1)} s · GREEN: ${outline.length} Fourier anchors${outline.length>2000?' — increase simplification before applying':''}${result.score<.5?' · LOW SCORE: review the outline carefully':''}`;}
  controls();draw();
 }
 function chooseCandidate(){
  const candidate=candidates[Number($('candidate').value)||0];if(!candidate)return;
  result={...candidate,engine:candidate.engine||'SAM 3'};paths=traceContours(result.mask,canvas.width,canvas.height);regions=rankOuterRegions(paths,points).slice(0,200);
  $('region').replaceChildren(...regions.map((p,i)=>new Option(`Region ${i+1} · ${Math.round(signedArea(p))} px²`,String(i))));
  $('allowHoles').checked=false;
  maskLayer=document.createElement('canvas');maskLayer.width=canvas.width;maskLayer.height=canvas.height;const m=maskLayer.getContext('2d'),pixels=m.createImageData(canvas.width,canvas.height);for(let i=0;i<result.mask.length;i++)if(result.mask[i]){pixels.data[i*4]=0;pixels.data[i*4+1]=240;pixels.data[i*4+2]=175;pixels.data[i*4+3]=255;}m.putImageData(pixels,0,0);updateOutline();
 }
 async function getWorker(){
  if(worker)return worker;const module=await import('../assets/sam-engine.js');worker=module.createWorker();
  worker.onmessage=({data})=>{if(data.type==='status'){if(dialog.open){say(data.message);$('progress').hidden=data.progress===undefined;if(data.progress!==undefined)$('progress').value=data.progress;}return;}if(!workerPending)return;if(data.type==='result'&&data.id===workerPending.id){workerPending.resolve(data);workerPending=null;}else if(data.type==='error'){workerPending.reject(new Error(data.message));workerPending=null;}};
  worker.onerror=()=>{workerPending?.reject(new Error('The browser inference worker stopped. Close and reopen AI Assist to retry.'));workerPending=null;worker?.terminate();worker=null;};return worker;
 }
 async function run(){
  if(busy||!source)return;const current=generation;busy=true;clearResult();say('Preparing segmentation…');$('hint').hidden=true;controls();
  try{
   if($('engine').value==='fast'){
    const engine=await getWorker(),id=++workerId,pixels=source.getContext('2d').getImageData(0,0,source.width,source.height).data;
    const data=await new Promise((resolve,reject)=>{workerPending={id,resolve,reject};engine.postMessage({type:'segment',id,imageId:generation,pixels:pixels.buffer,width:source.width,height:source.height,points:structuredClone(points),box:box?{...box}:null},[pixels.buffer]);});
    if(current!==generation)return;
    candidates=[{mask:new Uint8Array(data.mask),score:data.score,engine:'SlimSAM · '+data.backend,elapsed:data.elapsed}];
   }else{
    if(!backend?.available)throw new Error(backend?.message||'SAM 3 is not set up. Run setup-sam3-windows.bat, then restart the app. Fast offline works now.');
    say('Loading/running real SAM 3 locally. The first request can take time…');aborter=new AbortController();
    const response=await fetch('/api/sam/segment',{method:'POST',headers:{'Content-Type':'application/json'},signal:aborter.signal,body:JSON.stringify({mode:$('engine').value,image:source.toDataURL('image/png'),points,box,text:$('text').value.trim()})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||`SAM 3 failed (${response.status}).`);if(current!==generation)return;
    if(data.width!==source.width||data.height!==source.height)throw new Error('Model result dimensions do not match this image.');
    candidates=data.masks.map(m=>({mask:decodeMask(m.mask),score:m.score,engine:data.engine+' · '+data.device,elapsed:data.elapsed}));
   }
   $('candidate').replaceChildren(...candidates.map((m,i)=>new Option(`Object ${i+1} · score ${(m.score*100).toFixed(1)}%`,String(i))));chooseCandidate();
   say(regions.length?'Review the GREEN outline. Apply & run Fourier sends this outline to the calculation.':'Empty mask. Reset, then place one point inside the object.',!regions.length);
  }catch(error){if(current===generation)say(error.message,true);}finally{if(current===generation){busy=false;$('progress').hidden=true;controls();}}
 }
 async function engineChanged(){
  clearResult();const conceptual=$('engine').value==='concept';$('textRow').hidden=!conceptual;
  if(conceptual){points=[];history=[];tool='box';}else if(tool!=='box')tool='include';
  $('instruction').textContent=conceptual?'Enter a short noun phrase or draw an exemplar box. Click prompts use the other SAM 3 mode.':'Start with ONE Include point inside the object. Green points select its interior; they are not boundary anchors.';
  if($('engine').value==='fast'){$('engineInfo').textContent='SlimSAM uses the tested CPU path. Real SAM 3 has its own optional GPU backend.';say('Fast offline model selected.');}
  else{$('engineInfo').textContent=backend?.message||'Checking local SAM 3 setup…';say(backend?.available?'Real SAM 3 is ready to load.':backend?.message||'SAM 3 setup is required.',!backend?.available);}controls();draw();
 }
 async function open(){
  if(dialog.open)return;generation++;busy=false;source=null;points=[];box=null;history=[];tool='include';clearResult();dialog.showModal();ctx.clearRect(0,0,canvas.width,canvas.height);$('scope').textContent=adapter.label;$('name').textContent='Loading current image…';say('Opening current image…');
  const current=generation;
  try{const snapshot=await adapter.getImage();if(current!==generation)return;source=snapshot.canvas;canvas.width=source.width;canvas.height=source.height;$('name').textContent=snapshot.name;$('resolution').textContent=`${source.width} × ${source.height} working pixels`;$('hint').hidden=false;draw();
    try{const response=await fetch('/api/sam/status',{cache:'no-store'});backend=response.ok?await response.json():{available:false,message:'Start the local Python server to enable SAM 3.'};}catch{backend={available:false,message:'Local SAM 3 backend unavailable. Fast offline works in the browser.'};}
    if(current!==generation)return;await engineChanged();
  }catch(error){say(error.message,true);}controls();
 }
 function close(){generation++;aborter?.abort();aborter=null;if(busy){workerPending?.reject(new Error('Cancelled'));workerPending=null;worker?.terminate();worker=null;}else worker?.postMessage({type:'clear'});busy=false;dialog.close();source=null;result=null;maskLayer=null;}
 $('close').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 dialog.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{tool=b.dataset.tool;controls();});
 canvas.addEventListener('contextmenu',e=>e.preventDefault());
 canvas.addEventListener('pointerdown',e=>{if(busy||!source||e.button!==0)return;e.preventDefault();canvas.focus();const p=position(e);if(tool==='box'&&!e.shiftKey){drag={start:p,end:p};canvas.setPointerCapture(e.pointerId);}else if($('engine').value!=='concept'){if(points.length>=64){say('Use up to 64 points. Undo or reset to add more.',true);return;}checkpoint();points.push({...p,label:tool==='exclude'||e.shiftKey?0:1});markChanged();}});
 canvas.addEventListener('pointermove',e=>{if(drag){drag.end=position(e);draw();}});
 canvas.addEventListener('pointerup',e=>{if(!drag)return;drag.end=position(e);const {start:a,end:b}=drag;drag=null;if(Math.abs(a.x-b.x)>2&&Math.abs(a.y-b.y)>2){checkpoint();box={x1:Math.min(a.x,b.x),y1:Math.min(a.y,b.y),x2:Math.max(a.x,b.x),y2:Math.max(a.y,b.y)};markChanged();}else draw();});
 canvas.addEventListener('pointercancel',()=>{drag=null;draw();});
 $('undo').onclick=()=>{if(history.length){const old=history.pop();points=old.points;box=old.box;markChanged();}};$('reset').onclick=reset;$('run').onclick=run;$('engine').onchange=engineChanged;$('text').oninput=markChanged;
 $('view').onchange=()=>{$('splitRow').hidden=$('view').value!=='compare';draw();};$('opacity').oninput=draw;$('split').oninput=draw;$('candidate').onchange=chooseCandidate;$('region').onchange=updateOutline;$('tolerance').onchange=updateOutline;$('allowHoles').onchange=controls;$('showPrompts').onchange=draw;
 async function applyBoundary(runFourier){if(!outline.length||busy||$('apply').disabled)return;busy=true;controls();try{await adapter.apply(outline.map(p=>p.slice()),{width:source.width,height:source.height,engine:result.engine,modelScore:result.score,tolerance:Number($('tolerance').value),maskPixels:result.mask.reduce((s,v)=>s+(v?1:0),0),region:Number($('region').value),holesFilled:!$('holeRow').hidden,createdAt:Date.now()});busy=false;close();if(runFourier)adapter.compute?.();}catch(error){busy=false;controls();say('Could not use this boundary: '+error.message,true);}}
 $('apply').onclick=()=>applyBoundary(false);$('applyCompute').onclick=()=>applyBoundary(true);
 $('export').onclick=async()=>{if(!result)return;const format=$('format').value,out=document.createElement('canvas');out.width=canvas.width;out.height=canvas.height;const context=out.getContext('2d');if(format==='overlay'||format==='boundary'){if(format==='overlay')context.drawImage(source,0,0);strokeSelected(context);}else{context.drawImage(source,0,0);const pixels=context.getImageData(0,0,out.width,out.height);for(let i=0;i<result.mask.length;i++){const bit=result.mask[i]?255:0;if(format==='mask'){pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=bit;pixels.data[i*4+3]=255;}else if(!bit)pixels.data[i*4+3]=0;}context.putImageData(pixels,0,0);}const blob=await new Promise(resolve=>out.toBlob(resolve,'image/png'));if(!blob){say('Export could not be created.',true);return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='sector-map-ai-'+format+'.png';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);say('PNG export downloaded.');};
 document.addEventListener('keydown',e=>{if(!dialog.open)return;e.stopImmediatePropagation();if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if(e.key==='Enter'){e.preventDefault();run();}if(e.key==='Escape'){e.preventDefault();close();}},true);
 adapter.button.addEventListener('click',open);return{open,close};
}
