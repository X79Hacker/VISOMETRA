import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {normalizeQuery,encodeMask,decodeMask,cleanupMask,selectRegion,paintStroke,deriveContours,computeFourier,benchmark,validateProject,makeZip} from '../public/studio/core.js';
import {executeBatch} from '../public/studio/queue.js';
const rectangle=(mask,w,x1,y1,x2,y2,value=1)=>{for(let y=y1;y<y2;y++)for(let x=x1;x<x2;x++)mask[y*w+x]=value;};
test('plain object descriptions retain attributes and common outline request prefixes are removed',()=>{
 assert.equal(normalizeQuery('Please trace the outline of the red bench!'),'the red bench');
 assert.equal(normalizeQuery('outline the person'),'the person');assert.equal(normalizeQuery('wooden bench'),'wooden bench');
});
test('portable masks roundtrip, including foreground first pixel',()=>{const m=new Uint8Array([1,1,0,1,0,0]);assert.deepEqual(decodeMask(encodeMask(m,3,2)),m);});
test('cleanup removes only requested islands and small enclosed holes; open background remains',()=>{
 const m=new Uint8Array(100);rectangle(m,10,1,1,8,8);m[3*10+3]=0;m[99]=1;const c=cleanupMask(m,10,10,{minIsland:2,maxHole:1});assert.equal(c[99],0);assert.equal(c[33],1);assert.equal(c[0],0);
});
test('retaining an object preserves its hole and excludes disconnected regions',()=>{
 const m=new Uint8Array(144);rectangle(m,12,1,1,8,8);rectangle(m,12,3,3,5,5,0);rectangle(m,12,10,10,12,12);const c=selectRegion(m,12,12,0);assert.equal(c.reduce((a,b)=>a+b,0),45);assert.equal(c[3*12+3],0);assert.equal(c[11*12+11],0);
});
test('brush interpolates long strokes and erases independently',()=>{
 const m=new Uint8Array(400);paintStroke(m,20,20,{x:2,y:10},{x:17,y:10},2,1);for(let x=2;x<=17;x++)assert.equal(m[10*20+x],1);paintStroke(m,20,20,{x:10,y:10},{x:10,y:10},1,0);assert.equal(m[210],0);assert.equal(m[204],1);
});
test('multiple objects and holes have exact net mask area and independent signed Fourier series',()=>{
 const m=new Uint8Array(120*100);rectangle(m,120,4,4,64,64);rectangle(m,120,14,14,34,34,0);rectangle(m,120,90,10,110,30);
 const d=deriveContours(m,120,100,0);assert.equal(d.rawArea,3600);assert.equal(d.area,3600);assert.equal(d.loops.filter(p=>p.role==='hole').length,1);assert.equal(d.loops.length,3);
 const f=computeFourier(d.loops,80);assert.equal(f.loops.length,3);assert.ok(f.loops.find(p=>p.role==='hole').area<0);assert.ok(Math.abs(f.area-3600)<.05);assert.ok(f.relativeAreaError<.00002);assert.ok(f.convergence.at(-1).relativeAreaError<f.convergence[0].relativeAreaError);
 assert.ok(f.loops[0].coefficients.find(p=>p.k===0).re>0);assert.ok(f.rmse<.05);
});
test('benchmark uses an independent mask, catches errors and defines empty overlap',()=>{
 const a=new Uint8Array(400),b=new Uint8Array(400);rectangle(a,20,2,2,8,8);rectangle(b,20,3,2,9,8);const same=benchmark(a,a,20,20);assert.equal(same.iou,1);assert.equal(same.dice,1);assert.equal(same.boundaryF1,1);const shifted=benchmark(a,b,20,20);assert.ok(shifted.iou<1);assert.equal(shifted.boundaryF1,1);assert.equal(benchmark(new Uint8Array(4),new Uint8Array(4),2,2).iou,1);
});
test('portable project guards reject corrupt geometry and settings',()=>{
 const p={format:'sector-map-outline-project',version:3,image:{width:2,height:2,dataURL:'data:image/png;base64,AAAA'},settings:{engine:'text',query:'bench',unit:'px',unitsPerPixel:1,tolerance:1,smoothing:0,harmonics:20},mask:encodeMask(new Uint8Array(4),2,2)};assert.equal(validateProject(p),p);assert.throws(()=>validateProject({...p,mask:{width:2,height:2,counts:[5]}}));assert.throws(()=>validateProject({...p,prompts:{points:[{x:3,y:0,label:1}]}}));assert.throws(()=>validateProject({...p,settings:{...p.settings,harmonics:999}}));
});
test('batch export creates a standard ZIP with distinct named entries',async()=>{
 const blob=makeZip([{name:'one/boundary.csv',data:'x,y\n1,2\n'},{name:'batch-summary.csv',data:'approved\nfalse\n'}]);const b=new Uint8Array(await blob.arrayBuffer());assert.equal(new DataView(b.buffer).getUint32(0,true),0x04034b50);assert.equal(new DataView(b.buffer).getUint32(b.length-22,true),0x06054b50);if(process.env.STUDIO_TEST_ZIP)await fs.writeFile(process.env.STUDIO_TEST_ZIP,b);
});
test('batch jobs run sequentially and isolate a failed image',async()=>{
 const events=[];let running=0;
 const r=await executeBatch(['first','bad','last'],{process:async name=>{assert.equal(running,0);running++;events.push(name);await Promise.resolve();running--;if(name==='bad')throw Error('bad image');},onFailure:(item,e)=>{events.push(e.message);}});
 assert.deepEqual(events,['first','bad','bad image','last']);assert.deepEqual(r,{completed:2,failed:1,stopped:false});
});
test('cancelling a batch prevents subsequent model jobs from starting',async()=>{
 let stop=false;const processed=[];const r=await executeBatch([1,2,3],{shouldStop:()=>stop,process:async i=>{processed.push(i);stop=true;}});assert.deepEqual(processed,[1]);assert.equal(r.stopped,true);assert.equal(r.failed,0);
});
