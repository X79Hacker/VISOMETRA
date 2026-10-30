import {guidedPrompts} from './tracking-core.js';
export {guidedPrompts};
const SIZE=192;
function gray(canvas){const c=document.createElement('canvas');c.width=SIZE;c.height=SIZE;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0,SIZE,SIZE);const pixels=ctx.getImageData(0,0,SIZE,SIZE).data,out=new Uint8Array(SIZE*SIZE);for(let i=0;i<out.length;i++)out[i]=Math.round(.299*pixels[i*4]+.587*pixels[i*4+1]+.114*pixels[i*4+2]);return out;}
export function estimateMotion(previous,current,mask,{signal,radius=24}={}) {
  const a=gray(previous),b=gray(current),small=new Uint8Array(SIZE*SIZE);
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++)small[y*SIZE+x]=mask[Math.min(previous.height-1,Math.floor((y+.5)/SIZE*previous.height))*previous.width+Math.min(previous.width-1,Math.floor((x+.5)/SIZE*previous.width))];
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./tracking.worker.js',import.meta.url),{type:'module'});
    const abort=()=>{worker.terminate();reject(new DOMException('Tracking stopped.','AbortError'));};if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
    const end=()=>{signal?.removeEventListener('abort',abort);worker.terminate();};
    worker.onmessage=({data})=>{end();data.error?reject(Error(data.error)):resolve(data.result);};worker.onerror=()=>{end();reject(Error('Tracking worker stopped.'));};
    worker.postMessage({previous:a,current:b,mask:small,width:SIZE,height:SIZE,options:{radius}});
  });
}
