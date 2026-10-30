import test from 'node:test';
import assert from 'node:assert/strict';
import {fromPolygons,controls,cubic,insertAnchor,segmentMode,moveHandle,smoothAnchor,cornerAnchor,deriveOutline,exactLoopArea,curveSVG,validateOutline} from '../public/studio/curves-core.js';
import {computeFourier} from '../public/studio/core.js';
import {contentSignature} from '../public/episodes/lab-core.js';
const square=()=>fromPolygons([{role:'outer',points:[[20,50],[80,50],[80,90],[20,90]]}]);
function arch(){const o=square(),loop=o.loops[0];segmentMode(loop,0,'curve');loop.nodes[0].out=[20,10];loop.nodes[1].in=[80,10];return o;}
test('analytic cubic area matches a polynomial integral, with explicit Fourier flattening error',()=>{
 const outline=arch(),d=deriveOutline(outline,100,100);assert.ok(Math.abs(d.curveArea-3840)<1e-9);assert.ok(Math.abs(d.area-d.curveArea)<10);assert.ok(d.loops[0].points.length>4);
 const fourier=computeFourier(d.loops,100);assert.ok(Math.abs(fourier.area-d.area)<1);assert.equal(d.curveTolerance,.15);
});
test('inserting a diamond on a curve preserves the complete shape and analytic area',()=>{
 const outline=arch(),loop=outline.loops[0],original=controls(loop,0),area=exactLoopArea(loop),split=.37;insertAnchor(loop,0,split);
 for(let i=0;i<=100;i++){const t=i/100,expected=cubic(original,t),actual=t<=split?cubic(controls(loop,0),t/split):cubic(controls(loop,1),(t-split)/(1-split));assert.ok(Math.hypot(expected[0]-actual[0],expected[1]-actual[1])<1e-10);}
 assert.ok(Math.abs(exactLoopArea(loop)-area)<1e-9);assert.equal(loop.nodes.length,5);
});
test('straight segments stay straight until handles are adjusted; smoothing and corners are local',()=>{
 const o=square(),l=o.loops[0];segmentMode(l,0,'curve');assert.ok(Math.abs(exactLoopArea(l)-2400)<1e-9);moveHandle(l.nodes[0],'out',[30,20],100,100);assert.ok(exactLoopArea(l)>2400);
 assert.equal(l.nodes[2].segment,'line');smoothAnchor(l,1,100,100);assert.equal(l.nodes[1].mode,'smooth');moveHandle(l.nodes[1],'in',[60,40],100,100);assert.deepEqual(l.nodes[1].out,[100,60]);cornerAnchor(l,1);assert.deepEqual(l.nodes[1].out,l.nodes[1].p);assert.equal(l.nodes[1].mode,'corner');
});
test('independent holes retain signed area and invalid contour intersections are rejected',()=>{
 const outline=fromPolygons([{role:'outer',points:[[0,0],[100,0],[100,100],[0,100]]},{role:'hole',points:[[40,40],[40,60],[60,60],[60,40]]}]);assert.ok(Math.abs(deriveOutline(outline,100,100).curveArea-9600)<1e-8);
 const broken=square();broken.loops[0].nodes[0].p=[40,95];assert.throws(()=>deriveOutline(broken,100,100),/cross|collapsed|nesting/);
 for(const n of outline.loops[1].nodes)for(const key of ['p','in','out'])n[key]=n[key].map(v=>v+110);assert.throws(()=>deriveOutline(outline,200,200),/nesting/);
});
test('touching diagonal pixel components remain separate valid contours',()=>{
 const o=fromPolygons([{role:'outer',points:[[0,0],[10,0],[10,10],[0,10]]},{role:'outer',points:[[10,10],[20,10],[20,20],[10,20]]}]);assert.ok(Math.abs(deriveOutline(o,30,30).curveArea-200)<1e-8);
});
test('saved curve controls roundtrip to real cubic SVG and invalidate approval on subpixel changes',async()=>{
 const outline=arch(),saved=JSON.parse(JSON.stringify(outline));validateOutline(saved,100,100);assert.ok(curveSVG(saved,100,100).includes(' C '));
 const before=await contentSignature({project:{mask:null,settings:{},curveOutline:saved}});saved.loops[0].nodes[0].out[1]+=.01;const after=await contentSignature({project:{mask:null,settings:{},curveOutline:saved}});assert.notEqual(before,after);
});
