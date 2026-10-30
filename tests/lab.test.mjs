import test from 'node:test';
import assert from 'node:assert/strict';
import {matchTranslation,guidedPrompts} from '../public/studio/tracking-core.js';
import {cleanFrameInfo,legacyMetrics,polygonCentroid,contentSignature,reviewState,graphRows} from '../public/episodes/lab-core.js';

test('tracking recovers a known textured translation and stops on flat appearance',()=>{
 const w=80,h=70,a=new Uint8Array(w*h),b=new Uint8Array(w*h),mask=new Uint8Array(w*h);let seed=17;
 const noise=()=>{seed=(seed*1664525+1013904223)>>>0;return seed>>>24;};for(let i=0;i<a.length;i++)a[i]=noise();
 for(let y=12;y<50;y++)for(let x=15;x<47;x++)mask[y*w+x]=1;
 for(let y=0;y<h-3;y++)for(let x=0;x<w-5;x++)b[(y+3)*w+x+5]=a[y*w+x];
 const found=matchTranslation(a,b,mask,w,h,{radius:10});assert.equal(found.accepted,true);assert.equal(found.dx,5);assert.equal(found.dy,3);assert.ok(found.score>.999);assert.equal(matchTranslation(a,b,mask,w,h,{radius:5}).accepted,false);
 assert.equal(matchTranslation(new Uint8Array(w*h),new Uint8Array(w*h),mask,w,h).accepted,false);
 const prompt=guidedPrompts(mask,w,h,w,h,found,w,h);assert.ok(prompt.points[0].x>=20&&prompt.points[0].x<52);assert.ok(prompt.points[0].y>=15&&prompt.points[0].y<53);
});
test('a periodic texture is rejected as ambiguous',()=>{
 const w=70,h=60,a=Uint8Array.from({length:w*h},(_,i)=>(i%w)%4<2?230:15),m=new Uint8Array(w*h);for(let y=15;y<40;y++)for(let x=15;x<40;x++)m[y*w+x]=1;
 assert.equal(matchTranslation(a,a,m,w,h,{radius:8}).accepted,false);
});
test('frame metadata preserves unknown fields as unknown and requires timezone and finite sensors',()=>{
 const info=cleanFrameInfo({timestamp:'2026-10-27T10:15:30+05:45',labels:['turn','turn',' obstacle '],sensors:{front:'0',speed:'-0.2',left:''}});
 assert.equal(info.timestamp,'2026-10-27T04:30:30.000Z');assert.deepEqual(info.labels,['turn','obstacle']);assert.deepEqual(info.sensors,{front:0,speed:-.2});
 assert.throws(()=>cleanFrameInfo({timestamp:'2026-10-27T10:15:30'}),/timezone/);assert.throws(()=>cleanFrameInfo({sensors:{front:-1}}));assert.throws(()=>cleanFrameInfo({sensors:{speed:'NaN'}}));
});
test('measurements select newest trace or latest cell sums without inventing a combined perimeter',()=>{
 const rows=[{scope:'cell',cell_row:0,cell_col:0,area_shoelace:'2',unit:'cm',saved_at:'2026-01-01'},{scope:'cell',cell_row:0,cell_col:0,area_shoelace:'3',unit:'cm',saved_at:'2026-01-02'},{scope:'cell',cell_row:0,cell_col:1,area_shoelace:'4',unit:'cm',saved_at:'2026-01-02'}];
 assert.equal(legacyMetrics(rows).area,7);assert.equal(legacyMetrics(rows).perimeter,null);
 assert.equal(legacyMetrics([...rows,{scope:'trace',area_bezier:'9',unit:'cm'}]).area,9);
 assert.equal(polygonCentroid([{points:[[0,0],[10,0],[10,10],[0,10]]}]).x,5);
});
test('approval is invalidated by geometry changes but survives ID/timestamp changes',async()=>{
 const source={trace:{nodes:[{p:[0,0]}],closed:true},rows:[{scope:'trace',image_id:'old',measurement_id:'old',saved_at:'old',area_shoelace:3}]};
 const signature=await contentSignature(source),info={review:{state:'approved',signature}};
 assert.equal(reviewState(info,source,signature),'approved');
 const restored=structuredClone(source);restored.rows[0].image_id='new';restored.rows[0].measurement_id='new';restored.rows[0].saved_at='new';assert.equal(await contentSignature(restored),signature);
 const changed=structuredClone(source);changed.trace.nodes[0].p=[1,1];assert.equal(reviewState(info,changed,await contentSignature(changed)),'needs review');
});
test('graph rows retain missing values and separate incompatible measurement series',()=>{
 const frames=[{metrics:{source:'Studio',unit:'cm',area:3},info:{timestamp:'2026-01-01T00:00:00Z',sensors:{front:0}}},{metrics:{source:'Studio',unit:'px',area:8},info:{sensors:{}}}];
 assert.deepEqual(graphRows(frames,'area','Studio | cm').map(r=>r.y),[3,null]);assert.deepEqual(graphRows(frames,'sensor:front','').map(r=>r.y),[0,null]);assert.equal(graphRows(frames,'area','Studio | cm','time')[1].x,null);
});
