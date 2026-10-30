import { SamModel, AutoProcessor, AutoTokenizer, CLIPSegForImageSegmentation, RawImage, Tensor, env } from '@huggingface/transformers';
import { buildPrompts } from './geometry.js';
import {components} from '../../../public/studio/core.js';
env.allowRemoteModels=false;
env.allowLocalModels=true;
env.localModelPath='/models/';
env.backends.onnx.wasm.wasmPaths='/runtime/';
env.backends.onnx.wasm.numThreads=1;
env.backends.onnx.wasm.proxy=false;
let model,processor,loading,backend,embeddings,sizes,preparedId;
let textModel,textProcessor,tokenizer,textLoading;
const MODEL='slimsam-trace-v1';
const TEXT_MODEL='clipseg-trace-v1';
const report=(message,extra={})=>self.postMessage({type:'status',message,...extra});
function dispose(value){if(value) for(const tensor of Object.values(value)) tensor?.dispose?.();}
async function load() {
  if(model) return;
  if(loading) return loading;
  loading=(async()=>{
    const progress=new Map();
    const progress_callback=p=>{if(p.status==='progress'){progress.set(p.file,{loaded:p.loaded,total:p.total});let loaded=0,total=0;for(const v of progress.values()){loaded+=v.loaded;total+=v.total;}report('Downloading SlimSAM model…',{progress:total?Math.round(loaded/total*90):0});}};
    processor=await AutoProcessor.from_pretrained(MODEL,{local_files_only:true});
    // Use the verified WASM path. WebGPU can produce fragmented/checkerboard
    // outputs on some adapters with this export; do not auto-select that path.
    report('Initializing stable CPU inference…');
    model=await SamModel.from_pretrained(MODEL,{device:'wasm',dtype:'q8',local_files_only:true,progress_callback});
    backend='WebAssembly · CPU (stable)';
    self.postMessage({type:'ready',backend});
  })().catch(e=>{loading=null;throw e;});
  return loading;
}
async function loadText(){
 if(textModel)return;if(textLoading)return textLoading;
 textLoading=(async()=>{
  report('Loading bundled text model on stable CPU…');
  tokenizer=await AutoTokenizer.from_pretrained(TEXT_MODEL,{local_files_only:true});
  textProcessor=await AutoProcessor.from_pretrained(TEXT_MODEL,{local_files_only:true});
  textModel=await CLIPSegForImageSegmentation.from_pretrained(TEXT_MODEL,{device:'wasm',dtype:'q8',local_files_only:true,progress_callback:p=>{if(p.status==='progress')report('Loading bundled text model…',{progress:Math.round(p.progress||0)});}});
 })().catch(error=>{textLoading=null;throw error;});return textLoading;
}
async function prepareImage(data){
 await load();
 if(preparedId===data.imageId)return;
 dispose(embeddings);embeddings=null;preparedId=null;report('Encoding image on your device…');
 const inputs=await processor(new RawImage(new Uint8Array(data.pixels),data.width,data.height,4));
 try{embeddings=await model.get_image_embeddings(inputs);sizes={original:inputs.original_sizes,reshaped:inputs.reshaped_input_sizes};preparedId=data.imageId;}finally{inputs.pixel_values.dispose?.();}
}
async function predictSam(points,box,width,height){
 const prompts=buildPrompts(points,box,sizes.original,sizes.reshaped);
 const input_points=new Tensor('float32',new Float32Array(prompts.coords),[1,1,prompts.labels.length,2]);
 const input_labels=new Tensor('int64',BigInt64Array.from(prompts.labels.map(BigInt)),[1,1,prompts.labels.length]);
 let outputs,masks;
 try{
  outputs=await model({...embeddings,input_points,input_labels});
  masks=await processor.post_process_masks(outputs.pred_masks,sizes.original,sizes.reshaped);
  const scores=Array.from(outputs.iou_scores.data);let index=0;for(let i=1;i<scores.length;i++)if(scores[i]>scores[index])index=i;
  const area=width*height;return{mask:Uint8Array.from(masks[0].data.subarray(index*area,(index+1)*area)),score:scores[index],scores};
 }finally{input_points.dispose?.();input_labels.dispose?.();dispose(outputs);masks?.forEach(m=>m.dispose?.());}
}
async function predictText(data){
 await loadText();report('Finding “'+data.text+'” from your text prompt…');
 const tokens=tokenizer([data.text],{padding:true,truncation:true}),inputs=await textProcessor(new RawImage(new Uint8Array(data.pixels),data.width,data.height,4));let output;
 try{
  output=await textModel({...tokens,...inputs});
  const dims=output.logits.dims,h=dims.at(-2),w=dims.at(-1),probabilities=Float32Array.from(output.logits.data,v=>1/(1+Math.exp(-v))),lowMask=Uint8Array.from(probabilities,v=>v>=data.threshold?1:0);
  const found=components(lowMask,w,h).filter(c=>c.area>=Math.max(12,w*h*.0004));
  if(!found.length){let peak=0;for(const p of probabilities)peak=Math.max(peak,p);throw Error('No text region above threshold '+Number(data.threshold).toFixed(2)+'. Maximum text response was '+peak.toFixed(2)+'. Lower Text response threshold, use a shorter object name, or select points / a box.');}
  if(found.length>8)report('Found more than 8 text regions; refining the 8 largest. Review the result.');
  await prepareImage(data);const results=[];
  for(const [index,c] of found.slice(0,8).entries()){
   report('SAM is refining text region '+(index+1)+' of '+Math.min(found.length,8)+'…');
   let peak=c.indices[0];for(const i of c.indices)if(probabilities[i]>probabilities[peak])peak=i;
   const scaleX=data.width/w,scaleY=data.height/h,pad=2;
   const box={x1:Math.max(0,(c.minX-pad)*scaleX),y1:Math.max(0,(c.minY-pad)*scaleY),x2:Math.min(data.width,(c.maxX+1+pad)*scaleX),y2:Math.min(data.height,(c.maxY+1+pad)*scaleY)};
   const point={x:Math.min(data.width-1,(peak%w+.5)*scaleX),y:Math.min(data.height-1,(Math.floor(peak/w)+.5)*scaleY),label:1};
   const result=await predictSam([point],box,data.width,data.height);results.push({mask:result.mask.buffer,score:result.score,textPeak:probabilities[peak],box});
  }
  return{masks:results,textRegions:found.length,refinedRegions:results.length,truncated:found.length>8,backend:'CLIPSeg q8 → SlimSAM q8 · stable CPU'};
 }finally{dispose(tokens);dispose(inputs);dispose(output);}
}
self.onmessage=async({data})=>{
 const {type,id}=data;
 try{
  if(type==='init'){await load();return;}
  if(type==='clear'){dispose(embeddings);embeddings=null;sizes=null;preparedId=null;return;}
  if(type!=='segment'&&type!=='text') return;
  const start=performance.now();
  if(type==='text'){
   const result=await predictText(data);self.postMessage({type:'result',id,width:data.width,height:data.height,elapsed:performance.now()-start,...result},result.masks.map(m=>m.mask));return;
  }
  await prepareImage(data);
  report('Decoding prompts & tracing mask…');
  const result=await predictSam(data.points,data.box,data.width,data.height);
  self.postMessage({type:'result',id,imageId:data.imageId,mask:result.mask.buffer,width:data.width,height:data.height,score:result.score,scores:result.scores,backend,elapsed:performance.now()-start},[result.mask.buffer]);
 }catch(e){self.postMessage({type:'error',id,message:e.message||String(e)});}
};
