import test from 'node:test';
import assert from 'node:assert/strict';
import {traceContours,signedArea,simplifyClosed,decodeMask,outlineNodes,buildPrompts,rankOuterRegions,holesForRegion} from '../public/sam/geometry.js';
test('closed pixel contours preserve holes, disconnected regions and image edges',()=>{
 const full=traceContours(new Uint8Array(6).fill(1),3,2);assert.deepEqual(full,[[[0,0],[3,0],[3,2],[0,2]]]);assert.equal(signedArea(full[0]),6);
 const ring=traceContours(new Uint8Array([1,1,1,1,0,1,1,1,1]),3,3);assert.equal(ring.length,2);assert.equal(ring.filter(p=>signedArea(p)<0).length,1);assert.equal(ring.reduce((a,p)=>a+signedArea(p),0),8);
 assert.equal(traceContours(new Uint8Array([1,0,0,1]),2,2).length,2);
});
test('backend RLE uses zero-first row-major counts and rejects corrupt masks',()=>{
 assert.deepEqual([...decodeMask({width:3,height:2,counts:[0,2,2,2]})],[1,1,0,0,1,1]);
 assert.throws(()=>decodeMask({width:2,height:2,counts:[5]}));assert.throws(()=>decodeMask({width:2,height:2,counts:[2]}));
});
test('a mask outline maps exactly to the pre-existing grid and cell coordinate systems',()=>{
 const p=[[0,0],[200,0],[200,100],[0,100]],nodes=outlineNodes(p,200,100,8000);
 assert.deepEqual(nodes.map(n=>n.p),[[0,0],[8000,0],[8000,8000],[0,8000]]);assert.ok(nodes.every(n=>n.line&&n.mode==='corner'));
 assert.deepEqual(outlineNodes(p,200,100,500).map(n=>n.p),[[0,0],[500,0],[500,500],[0,500]]);
});
test('closed contour simplification removes redundant edges without collapsing a region',()=>{
 const p=[[0,0],[1,0],[2,0],[3,0],[3,1],[3,2],[0,2],[0,1]],q=simplifyClosed(p,.5);assert.equal(q.length,4);assert.equal(signedArea(q),6);
});
test('native box and positive/negative prompts are scaled consistently',()=>{
 const p=buildPrompts([{x:50,y:25,label:1},{x:10,y:5,label:0}],{x1:0,y1:0,x2:80,y2:40},[[50,100]],[[512,1024]]);
 assert.deepEqual(p.labels,[1,0,2,3]);assert.deepEqual(p.coords,[512,256,102.4,51.2,0,0,819.2,409.6]);
});
test('the chosen Fourier region favors an included object over a larger excluded background',()=>{
 const background=[[0,0],[20,0],[20,20],[0,20]],object=[[30,0],[36,0],[36,8],[30,8]];
 const ranked=rankOuterRegions([background,object],[{x:32,y:4,label:1},{x:5,y:5,label:0}]);
 assert.equal(ranked[0],object);
});
test('holes in another component do not block the selected Fourier region',()=>{
 const a=[[0,0],[20,0],[20,20],[0,20]],b=[[30,0],[36,0],[36,8],[30,8]],hole=[[3,3],[3,5],[5,5],[5,3]];
 assert.equal(holesForRegion([a,b,hole],a).length,1);
 assert.equal(holesForRegion([a,b,hole],b).length,0);
});
