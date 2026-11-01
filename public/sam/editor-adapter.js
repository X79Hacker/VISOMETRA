import {attachSam} from './assist.js';
import {outlineNodes} from './geometry.js';
const studioLink=document.getElementById('openStudioV3');if(studioLink){const id=new URLSearchParams(location.search).get('f');studioLink.href='outline-studio.html'+(id?'?f='+encodeURIComponent(id):'');}

attachSam({
 button:document.getElementById('btnSam'),
 label:'Cell assist · replaces only this cell’s outline. Use Compute afterward to update its Fourier results.',
 async getImage(){
  const file=fileNow();if(!file||S.cell<0)throw new Error('Open a cell from the Matrix first.');
  const bitmap=await new Promise(resolve=>fileBitmap(file,resolve));
  if(!bitmap)throw new Error('This cell has no image to segment.');
  const side=Math.min(bitmap.width,bitmap.height),r=Math.floor(S.cell/GRID),c=S.cell%GRID;
  const size=Math.min(1024,Math.max(256,Math.round(side/GRID))),canvas=document.createElement('canvas');
  canvas.width=canvas.height=size;
  canvas.getContext('2d').drawImage(bitmap,(bitmap.width-side)/2+c*side/GRID,(bitmap.height-side)/2+r*side/GRID,side/GRID,side/GRID,0,0,size,size);
  return {canvas,name:file.name+' · cell ['+coordOf(S.cell)+']'};
 },
 async apply(points,meta){
  const file=fileNow();if(!file||S.cell<0)throw new Error('The cell is no longer open.');
  History.checkpoint();setTool('bezier');
  const nodes=outlineNodes(points,meta.width,meta.height,S.patchW,S.patchH),patch=patchOf(file,S.cell);
  S.bez={nodes,closed:true};S.bezDrag=null;S.bezHover=null;
  patch.bezier={nodes:bezCopy(nodes)};patch.points=bezSample(nodes,true);patch.fromTrace=false;
  patch.coeffs=null;patch.active=null;patch.centroid=null;patch.tableData=null;patch.measurements=null;patch.marked=false;patch.samMeta=meta;
  S.currentPoints=[];S.drawing=false;S.drawingPaused=false;S.lastEndPoint=null;S.expectedArea=null;S.trail=[];S.t=0;
  showPatchState(patch);refreshProgress();
  setStatus('AI boundary applied to this cell. Drag its anchors to refine, then COMPUTE. Model: '+meta.engine,'ok');
  await savePatches(file);
 },
 compute(){document.getElementById('btnCompute').click();}
});
