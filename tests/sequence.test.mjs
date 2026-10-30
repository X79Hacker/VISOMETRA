import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {encodeMask,decodeMask,validateProject} from '../public/studio/core.js';
import {DEFAULT_TARGET,targetRecord,targetRecords,selectTargetProject,mergeTarget,parseFrameRange,imageFiles,mayReplace,qualityFlags,cocoRLE,reviewLabel} from '../public/studio/sequence-core.js';
import {projectMetrics,contentSignature} from '../public/episodes/lab-core.js';

const mask=(W,H,positions)=>{const m=new Uint8Array(W*H);for(const i of positions)m[i]=1;return encodeMask(m,W,H);};
const settings={engine:'points',query:'person',threshold:.2,tolerance:0,smoothing:0,harmonics:10,unitsPerPixel:1,unit:'px'};
const base=()=>({format:'sector-map-outline-project',version:3,image:{width:4,height:3,dataURL:'data:image/png;base64,AAAA'},mask:mask(4,3,[0,1,4,5]),settings,review:'approved',prompts:{points:[],box:null}});

test('range selection validates all tokens before returning and natural folder order keeps subpaths',()=>{
 assert.deepEqual([...parseFrameRange('2–4, 1, 4, 7',8)],[1,2,3,0,6]);
 for(const s of ['0-2','2-1','1-9','2,x','1.5',''])assert.throws(()=>parseFrameRange(s,8));
 const files=[{name:'frame10.jpg',type:'image/jpeg',webkitRelativePath:'ep/frame10.jpg'},{name:'notes.txt',type:'text/plain'},{name:'frame2.jpg',type:'image/jpeg',webkitRelativePath:'ep/frame2.jpg'}];
 assert.deepEqual(imageFiles(files).map(f=>f.name),['frame2.jpg','frame10.jpg']);
});
test('named targets cannot borrow another target mask; legacy projects migrate without losing approval',()=>{
 const p=base(),a=targetRecord(p,DEFAULT_TARGET.id);assert.equal(a.review,'approved');
 const empty=selectTargetProject(p,'person-b',{name:'Person B'});assert.equal(empty.mask,null);assert.deepEqual(targetRecord(p,'person-b'),null);assert.deepEqual(targetRecords(empty)[0].mask,p.mask);
 const b={id:'person-b',name:'Person B',color:'#62cfff',mask:mask(4,3,[10,11]),settings,visibility:'partial',review:'needs review'};
 const merged=mergeTarget(p,b);assert.equal(merged.targets.length,2);assert.deepEqual(targetRecord(merged,DEFAULT_TARGET.id).mask,p.mask);assert.deepEqual(selectTargetProject(merged,'person-b').mask,b.mask);assert.equal(selectTargetProject(merged,DEFAULT_TARGET.id).review,'approved');validateProject(merged);
 assert.throws(()=>validateProject({...merged,targets:[b,b]}),/duplicate/);
 assert.throws(()=>validateProject({...merged,targets:[{...b,mask:{...b.mask,width:8}}]}),/dimensions/);
});
test('batch protection keeps corrections, keyframes and approved targets unless replace-all is explicit',()=>{
 assert.equal(mayReplace(null),true);assert.equal(mayReplace({mask:{},review:'needs review'}),false);
 assert.equal(mayReplace({mask:{},review:'needs review'},'suggestions'),true);
 for(const r of [{mask:{},review:'approved'},{mask:{},corrected:true},{mask:{},keyframe:true},{visibility:'hidden',keyframe:true}]){assert.equal(mayReplace(r,'suggestions'),false);assert.equal(mayReplace(r,'all'),true);}
});
test('quality flags identify mask discontinuities without calling them confidence, and hidden measurements stay absent',async()=>{
 const a={mask:mask(100,100,[0,1,100,101]),visibility:'visible'},b={mask:mask(100,100,[9999]),visibility:'visible'};
 assert.equal(qualityFlags(b,a).length,2);assert.deepEqual(qualityFlags({...b,visibility:'hidden'},a),[]);assert.deepEqual(qualityFlags({mask:mask(4,3,[]),visibility:'visible'},null),['Empty target mask']);
 assert.equal(reviewLabel({mask:{},flags:['Area changed']}),'flagged');
 const p=base();for(const visibility of ['hidden','outside','unknown'])assert.equal(projectMetrics({...p,visibility}),null);
 const signature=await contentSignature({project:p});assert.notEqual(signature,await contentSignature({project:{...p,visibility:'hidden'}}));
});
test('research COCO masks transpose app row-major RLE to column-major RLE including holes',()=>{
 const m=mask(4,3,[0,3,4,10,11]),r=cocoRLE(m),flat=[];r.counts.forEach((n,i)=>{for(let j=0;j<n;j++)flat.push(i%2);});assert.deepEqual(r.size,[3,4]);const restored=new Uint8Array(12);for(let x=0;x<4;x++)for(let y=0;y<3;y++)restored[y*4+x]=flat[x*3+y];assert.deepEqual(restored,decodeMask(m));
});
test('classic Trace/cell insertion preserves every cubic sample and freezes auto handles',()=>{
 const sandbox={};vm.runInNewContext(readFileSync(new URL('../public/classic-anchors.js',import.meta.url),'utf8'),sandbox);const {insert,point}=sandbox.ClassicAnchors;
 const nodes=[{p:[0,0],hi:[0,0],ho:[10,20],mode:'auto',line:false},{p:[30,0],hi:[20,20],ho:[30,0],mode:'auto',line:false},{p:[30,30],hi:[30,30],ho:[0,30],mode:'corner',line:true}];
 const original=[nodes[0].p.slice(),nodes[0].ho.slice(),nodes[1].hi.slice(),nodes[1].p.slice()];insert(nodes,0,.37);assert.equal(nodes.length,4);assert.equal(nodes[0].mode,'smooth');
 const left=[nodes[0].p,nodes[0].ho,nodes[1].hi,nodes[1].p],right=[nodes[1].p,nodes[1].ho,nodes[2].hi,nodes[2].p];for(let k=0;k<=100;k++){const t=k/100,a=point(original,t),b=t<=.37?point(left,t/.37):point(right,(t-.37)/.63);assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-10);}
});
