import {copy,fromPolygons,validateOutline,deriveOutline,controls as segmentControls,cubic,insertAnchor,moveAnchor,moveHandle,segmentMode,smoothAnchor,cornerAnchor,removeAnchor,vectorPath,pointSegmentDistance} from './curves-core.js';

export function createCurveEditor(api){
 const {S,stage,ctx,$,setTool,changed,draw,controls,refreshLayers,renderMetrics,invalidateFourier,scheduleFourier,historySnapshot,say}=api;
 const point=event=>{const r=stage.getBoundingClientRect();return{x:Math.max(0,Math.min(stage.width,(event.clientX-r.left)*stage.width/r.width)),y:Math.max(0,Math.min(stage.height,(event.clientY-r.top)*stage.height/r.height))};};
 const selection={loop:0,anchor:0};let drag=null,space=false,insertMode=false,stamp='';
 const busy=()=>S.busy||S.batch||S.loading;
 const loop=()=>S.curveOutline?.loops[selection.loop];
 const node=()=>loop()?.nodes[selection.anchor];
 function selectPane(){document.querySelector('[data-left-tab="curves"]')?.click();}
 function enter({announce=true,history=true}={}){
  if(!S.derived?.loops.length||busy())return false;
  if(!S.curveOutline){const before=historySnapshot();const outline=fromPolygons(S.derived.loops);validateOutline(outline,stage.width,stage.height);const geometry=deriveOutline(outline,stage.width,stage.height);S.curveOutline=outline;S.derived=geometry;S.mask=rasterize();refreshLayers();if(history){S.history.push(before);if(S.history.length>8)S.history.shift();S.redo=[];}changed();}
  selection.loop=Math.min(selection.loop,S.curveOutline.loops.length-1);selection.anchor=Math.min(selection.anchor,loop().nodes.length-1);setTool('anchors');$('view').value='fourier';insertMode=false;selectPane();draw();update();
  if(announce)say('Drag a diamond to move an anchor. Hollow midpoint diamonds add points. Select an anchor, then Curve / Smooth to reveal its Bézier handles.');return true;
 }
 function rasterize(){const c=document.createElement('canvas');c.width=stage.width;c.height=stage.height;const context=c.getContext('2d',{willReadFrequently:true});context.fillStyle='white';context.fill(new Path2D(vectorPath(S.curveOutline)),'evenodd');const pixels=context.getImageData(0,0,c.width,c.height).data,mask=new Uint8Array(c.width*c.height);for(let i=0;i<mask.length;i++)mask[i]=pixels[i*4+3]>=128?1:0;return mask;}
 function remember(snapshot){S.history.push(snapshot);if(S.history.length>8)S.history.shift();S.redo=[];}
 function commit(before,{announce='Edited outline applied. Fourier and measurements now follow this boundary.'}={}){
  try{const geometry=deriveOutline(S.curveOutline,stage.width,stage.height);const mask=rasterize();remember(before);S.derived=geometry;S.mask=mask;S.provenance={...(S.provenance||{}),edited:true,boundaryEditor:'Cubic Bezier anchors',curveTolerance:.15};invalidateFourier();refreshLayers();changed();renderMetrics();draw();update();if($('autoFourier').checked)scheduleFourier();if(announce)say(announce);return true;}
  catch(error){S.curveOutline=copy(before.curveOutline);draw();update();say(error.message,true);return false;}
 }
 function transaction(fn,message){
  if(busy())return;if(!S.curveOutline&&!enter({announce:false}))return;const before=historySnapshot();try{fn();commit(before,{announce:message});}catch(error){S.curveOutline=copy(before.curveOutline);draw();update();say(error.message,true);}
 }
 function nearest(p){
  const current=loop();if(!current)return null;const radius=9/S.scale;let best=null;
  if(node())for(const [kind,segment]of [['in',(selection.anchor+current.nodes.length-1)%current.nodes.length],['out',selection.anchor]])if(current.nodes[segment].segment==='curve'&&Math.hypot(...node()[kind].map((v,i)=>v-node().p[i]))>1/S.scale){const d=Math.hypot(p.x-node()[kind][0],p.y-node()[kind][1]);if(d<radius&&(!best||d<best.d))best={kind,index:selection.anchor,d};}
  if(best)return best;
  for(let i=0;i<current.nodes.length;i++){const d=Math.hypot(p.x-current.nodes[i].p[0],p.y-current.nodes[i].p[1]);if(d<radius&&(!best||d<best.d))best={kind:'anchor',index:i,d};}
  if(best)return best;
  for(let i=0;i<current.nodes.length;i++){const m=current.nodes[i].segment==='curve'?cubic(segmentControls(current,i),.5):[(current.nodes[i].p[0]+current.nodes[(i+1)%current.nodes.length].p[0])/2,(current.nodes[i].p[1]+current.nodes[(i+1)%current.nodes.length].p[1])/2],d=Math.hypot(p.x-m[0],p.y-m[1]);if(d<7/S.scale&&(!best||d<best.d))best={kind:'midpoint',index:i,d,t:.5};}
  return best;
 }
 function nearestSegment(p){let best=null;const current=loop();if(!current)return null;for(let i=0;i<current.nodes.length;i++){
  const segment=segmentControls(current,i),steps=current.nodes[i].segment==='curve'?48:1;let a=segment[0];
  for(let j=1;j<=steps;j++){const b=current.nodes[i].segment==='curve'?cubic(segment,j/steps):segment[3],d=pointSegmentDistance([p.x,p.y],a,b);if(!best||d<best.d){const length=(b[0]-a[0])**2+(b[1]-a[1])**2,t=Math.max(0,Math.min(1,((p.x-a[0])*(b[0]-a[0])+(p.y-a[1])*(b[1]-a[1]))/(length||1)));best={kind:'segment',index:i,d,t:(j-1+t)/steps};}a=b;}
 }return best?.d<12/S.scale?best:null;}
 function capture(event){event.preventDefault();event.stopImmediatePropagation();stage.focus();try{stage.setPointerCapture(event.pointerId);}catch{}}
 stage.addEventListener('pointerdown',event=>{
  if(!S.source||busy())return;
  if(space||event.button===1||event.button===2){capture(event);drag={kind:'pan',x:event.clientX,y:event.clientY,left:api.wrap.scrollLeft,top:api.wrap.scrollTop};stage.style.cursor='grabbing';return;}
  if(S.tool!=='anchors'||!S.curveOutline||event.button!==0)return;capture(event);const p=point(event);let hit=nearest(p);const before=historySnapshot();
  if(insertMode){hit=nearestSegment(p);if(!hit){say('Click close to the segment where you want to add an anchor.');return;}selection.anchor=insertAnchor(loop(),hit.index,hit.t);drag={kind:'anchor',before,changed:true,index:selection.anchor};insertMode=false;}
  else if(hit?.kind==='midpoint'){selection.anchor=insertAnchor(loop(),hit.index,.5);drag={kind:'anchor',before,changed:true,index:selection.anchor};}
  else if(hit){selection.anchor=hit.index;drag={kind:hit.kind,before,changed:false,index:hit.index};}
  else{const segment=nearestSegment(p);if(segment)selection.anchor=segment.index;drag=null;}
  draw();update();
 },true);
 stage.addEventListener('pointermove',event=>{
  if(drag?.kind==='pan'){event.preventDefault();event.stopImmediatePropagation();api.wrap.scrollLeft=drag.left-(event.clientX-drag.x);api.wrap.scrollTop=drag.top-(event.clientY-drag.y);return;}
  if(S.tool!=='anchors'||!S.curveOutline)return;
  if(!drag){stage.style.cursor=nearest(point(event))?'grab':insertMode?'copy':'crosshair';return;}
  event.preventDefault();event.stopImmediatePropagation();const p=point(event),selected=loop().nodes[drag.index];if(drag.kind==='anchor')moveAnchor(selected,[p.x,p.y],stage.width,stage.height);else moveHandle(selected,drag.kind,[p.x,p.y],stage.width,stage.height);drag.changed=true;draw();update();
 },true);
 function end(event,cancel=false){if(!drag)return;event.preventDefault();event.stopImmediatePropagation();const previous=drag;drag=null;if(previous.kind==='pan'){stage.style.cursor=S.tool==='pan'?'grab':'crosshair';return;}if(cancel){S.curveOutline=copy(previous.before.curveOutline);draw();update();return;}if(previous.changed)commit(previous.before);else{draw();update();}}
 stage.addEventListener('pointerup',event=>end(event),true);stage.addEventListener('pointercancel',event=>end(event,true),true);
 stage.addEventListener('dblclick',event=>{if(S.tool!=='anchors'||!S.curveOutline||busy())return;event.preventDefault();event.stopImmediatePropagation();const hit=nearestSegment(point(event));if(hit)transaction(()=>{selection.anchor=insertAnchor(loop(),hit.index,hit.t);},'Anchor inserted on the selected segment.');},true);
 stage.addEventListener('wheel',event=>{if(!S.source)return;event.preventDefault();const rect=stage.getBoundingClientRect(),p={x:(event.clientX-rect.left)/S.scale,y:(event.clientY-rect.top)/S.scale};const zoom=Math.max(50,Math.min(1200,Number($('zoom').value)*Math.exp(-event.deltaY*.0015)));$('zoom').value=String(Math.round(zoom));api.updateLabels();api.fitCanvas();const after=stage.getBoundingClientRect();api.wrap.scrollLeft+=after.left+p.x*S.scale-event.clientX;api.wrap.scrollTop+=after.top+p.y*S.scale-event.clientY;},{passive:false});
 document.addEventListener('keydown',event=>{
  if(/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)||busy())return;
  if(event.code==='Space'){event.preventDefault();space=true;stage.style.cursor='grab';return;}
  if(S.tool!=='anchors'||!S.curveOutline||event.ctrlKey||event.metaKey)return;
  if(event.key==='Escape'){insertMode=false;if(drag){if(drag.before)S.curveOutline=copy(drag.before.curveOutline);drag=null;draw();}update();return;}
  if(['Delete','Backspace'].includes(event.key)){event.preventDefault();transaction(()=>{removeAnchor(loop(),selection.anchor);selection.anchor=Math.min(selection.anchor,loop().nodes.length-1);},'Anchor removed.');return;}
  const offsets={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(offsets[event.key]){event.preventDefault();const d=offsets[event.key],amount=event.shiftKey?10:1;transaction(()=>{moveAnchor(node(),[node().p[0]+d[0]*amount,node().p[1]+d[1]*amount],stage.width,stage.height);},'Anchor nudged in original image pixels.');}
 },true);
 document.addEventListener('keyup',event=>{if(event.code==='Space'){space=false;stage.style.cursor=S.tool==='pan'?'grab':'crosshair';}});
 const safely=fn=>()=>{try{fn();}catch(error){say(error.message,true);}};
 $('editAnchors').onclick=$('editAnchorsTop').onclick=safely(()=>enter());
 $('addAnchor').onclick=$('addAnchorTop').onclick=safely(()=>{if(!S.curveOutline&&!enter({announce:false}))return;setTool('anchors');insertMode=!insertMode;selectPane();update();say('Click an edge to insert a diamond anchor. Existing midpoint diamonds can also be dragged directly.');});
 $('lineSegment').onclick=()=>transaction(()=>segmentMode(loop(),selection.anchor,'line'),'Selected segment is straight. Other segments keep their curves.');
 $('curveSegment').onclick=()=>transaction(()=>segmentMode(loop(),selection.anchor,'curve'),'Bézier handles are visible. Drag a circular handle to bend this segment.');
 $('smoothAnchor').onclick=()=>transaction(()=>smoothAnchor(loop(),selection.anchor,stage.width,stage.height),'Smooth anchor applied. Its incoming and outgoing tangents are linked.');
 $('cornerAnchor').onclick=()=>transaction(()=>cornerAnchor(loop(),selection.anchor),'Sharp anchor applied. Other corners and curves are preserved.');
 $('smoothContour').onclick=()=>transaction(()=>{for(let i=0;i<loop().nodes.length;i++)smoothAnchor(loop(),i,stage.width,stage.height);},'Contour smoothed. Inspect its area change and edge fit; Undo restores it.');
 $('deleteAnchor').onclick=()=>transaction(()=>{removeAnchor(loop(),selection.anchor);selection.anchor=Math.min(selection.anchor,loop().nodes.length-1);},'Anchor removed.');
 $('curveLoop').onchange=()=>{selection.loop=Number($('curveLoop').value);selection.anchor=0;draw();update();};
 for(const id of ['nodeX','nodeY'])$(id).onchange=()=>transaction(()=>{const p=[Number($('nodeX').value),Number($('nodeY').value)];if(!p.every(Number.isFinite))throw Error('Enter finite anchor coordinates.');moveAnchor(node(),p,stage.width,stage.height);},'Anchor coordinates updated.');
 $('undoTop').onclick=()=>$('undo').click();$('redoTop').onclick=()=>$('redo').click();$('panTop').onclick=()=>setTool('pan');
 function update(){
  if(S.curveOutline){selection.loop=Math.max(0,Math.min(selection.loop,S.curveOutline.loops.length-1));selection.anchor=Math.max(0,Math.min(selection.anchor,loop().nodes.length-1));}
  const has=!!S.derived?.loops.length,enabled=!!S.curveOutline&&!busy(),current=loop(),selected=node();
  for(const id of ['editAnchors','editAnchorsTop'])$(id).disabled=!has||busy();for(const id of ['addAnchor','addAnchorTop'])$(id).disabled=!has||busy();
  for(const id of ['curveLoop','lineSegment','curveSegment','smoothAnchor','cornerAnchor','smoothContour','nodeX','nodeY'])$(id).disabled=!enabled;
  $('deleteAnchor').disabled=!enabled||!current||current.nodes.length<=3;$('undoTop').disabled=$('undo').disabled;$('redoTop').disabled=$('redo').disabled;$('panTop').disabled=!S.source||busy();
  $('editAnchorsTop').setAttribute('aria-pressed',String(S.tool==='anchors'));$('addAnchorTop').setAttribute('aria-pressed',String(insertMode));
  const signature=S.curveOutline?.loops.map(p=>p.role+':'+p.nodes.length).join('|')||'';
  if(signature!==stamp){stamp=signature;$('curveLoop').replaceChildren(...(S.curveOutline?.loops||[]).map((p,i)=>new Option(`Contour ${i+1} · ${p.role} · ${p.nodes.length} anchors`,String(i))));}
  $('curveLoop').value=String(selection.loop);$('anchorInfo').textContent=selected?'Anchor '+(selection.anchor+1)+' / '+current.nodes.length+' · '+selected.mode+' · outgoing '+selected.segment:'Generate a mask, then choose Edit anchors.';
  if(selected){if(document.activeElement!==$('nodeX'))$('nodeX').value=selected.p[0].toFixed(3);if(document.activeElement!==$('nodeY'))$('nodeY').value=selected.p[1].toFixed(3);}
  $('lineSegment').setAttribute('aria-pressed',String(selected?.segment==='line'));$('curveSegment').setAttribute('aria-pressed',String(selected?.segment==='curve'));
  $('curveState').textContent=S.curveOutline?S.curveOutline.loops.reduce((n,l)=>n+l.nodes.length,0)+' editable anchors · 0.15 px Fourier tolerance':'Mask boundary · click Edit anchors';
  $('outlineModeBadge').textContent=S.curveOutline?'BÉZIER OUTLINE':'MASK OUTLINE';
 }
 function diamond(p,radius,fill,stroke){ctx.save();ctx.translate(p[0],p[1]);ctx.rotate(Math.PI/4);ctx.lineWidth=1.2/S.scale;ctx.fillStyle=fill;ctx.strokeStyle=stroke;ctx.fillRect(-radius/S.scale,-radius/S.scale,2*radius/S.scale,2*radius/S.scale);ctx.strokeRect(-radius/S.scale,-radius/S.scale,2*radius/S.scale,2*radius/S.scale);ctx.restore();}
 function drawHandles(){
  if(S.tool!=='anchors'||!S.curveOutline||!loop())return;
  const current=loop(),selected=node();ctx.save();
  if(selected){for(const [kind,index]of [['in',(selection.anchor+current.nodes.length-1)%current.nodes.length],['out',selection.anchor]])if(current.nodes[index].segment==='curve'){
    const h=selected[kind];ctx.beginPath();ctx.strokeStyle='#95bfff';ctx.lineWidth=1/S.scale;ctx.moveTo(...selected.p);ctx.lineTo(...h);ctx.stroke();ctx.beginPath();ctx.arc(h[0],h[1],4.5/S.scale,0,2*Math.PI);ctx.fillStyle='#8bbcff';ctx.fill();ctx.strokeStyle='#0c2031';ctx.stroke();}}
  for(let i=0;i<current.nodes.length;i++){
   const a=current.nodes[i],b=current.nodes[(i+1)%current.nodes.length],mid=a.segment==='curve'?cubic(segmentControls(current,i),.5):[(a.p[0]+b.p[0])/2,(a.p[1]+b.p[1])/2];
   if(Math.hypot(a.p[0]-b.p[0],a.p[1]-b.p[1])*S.scale>22)diamond(mid,2.8,'#10253be0','#82b7ff');
   diamond(a.p,i===selection.anchor?5:3.5,i===selection.anchor?'#dbffb9':'#102c22','#c4f4a7');
  }ctx.restore();
 }
 return{enter,update,drawHandles,rasterize,selection,isDragging:()=>!!drag,vectorPath};
}
