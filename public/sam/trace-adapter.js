import {attachSam} from './assist.js';
import {outlineNodes} from './geometry.js';
const studioLink=document.getElementById('openStudioV3');if(studioLink){studioLink.href='outline-studio.html'+location.search;}

attachSam({
 button:document.getElementById('btnSam'),
 label:'Whole-image assist · uses the same centered square crop as your 16 × 16 grid.',
 async getImage(){
  if(!T.f||!T.bmp)throw new Error('Load an image from the Dashboard first.');
  const side=Math.min(T.bmp.width,T.bmp.height),size=Math.min(1536,Math.round(side));
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  canvas.getContext('2d').drawImage(T.bmp,(T.bmp.width-side)/2,(T.bmp.height-side)/2,side,side,0,0,size,size);
  return {canvas,name:T.f.name};
 },
 async apply(points,meta){
  if(!T.f)throw new Error('The image is no longer open.');
  History.checkpoint();
  T.nodes=outlineNodes(points,meta.width,meta.height,W);T.closed=true;T.finished=false;
  T.cells=[];T.cellMap=null;T.cellsMeasured=false;T.drag=null;T.hover=null;T.samMeta=meta;
  $('panelCells').classList.add('hidden');$('rSum').textContent='—';$('rCells').textContent='—';
  changed();
  setStatus('AI boundary applied as '+T.nodes.length+' editable straight anchors. Refine it, then FINISH → GRID. Model: '+meta.engine,'ok');
  await saveTrace();
 },
 compute(){document.getElementById('btnFourier').click();}
});
