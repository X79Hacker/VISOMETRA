/* Editable closed Bézier loops. Original coordinates; outer loops and holes stay separate. */
import {signedArea,perimeter} from './core.js';
export const CURVE_TOLERANCE=.15;
export const copy=value=>structuredClone(value);
const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
export function controls(loop,index){const a=loop.nodes[index],b=loop.nodes[(index+1)%loop.nodes.length];return a.segment==='curve'?[a.p,a.out,b.in,b.p]:[a.p,a.p,b.p,b.p];}
export function cubic(points,t){const a=lerp(points[0],points[1],t),b=lerp(points[1],points[2],t),c=lerp(points[2],points[3],t);return lerp(lerp(a,b,t),lerp(b,c,t),t);}
export function splitCubic(p,t=.5){const a=lerp(p[0],p[1],t),b=lerp(p[1],p[2],t),c=lerp(p[2],p[3],t),d=lerp(a,b,t),e=lerp(b,c,t),m=lerp(d,e,t);return[[p[0].slice(),a,d,m],[m.slice(),e,c,p[3].slice()]];}
export function fromPolygons(loops){return{version:1,tolerance:CURVE_TOLERANCE,loops:loops.map((loop,i)=>({id:i,role:loop.role,nodes:loop.points.map(p=>({p:p.slice(),in:p.slice(),out:p.slice(),mode:'corner',segment:'line'}))}))};}
export function validateOutline(outline,width,height){
 if(!outline||outline.version!==1||!Array.isArray(outline.loops)||!outline.loops.length||outline.loops.length>256)throw Error('Invalid editable outline.');
 if(outline.tolerance!==CURVE_TOLERANCE)throw Error('Unsupported editable-curve flattening tolerance.');
 let count=0;for(const loop of outline.loops){if(!['outer','hole'].includes(loop.role)||!Array.isArray(loop.nodes)||loop.nodes.length<3)throw Error('Each contour needs at least three anchors.');count+=loop.nodes.length;
  for(const node of loop.nodes){if(!['line','curve'].includes(node.segment)||!['corner','smooth'].includes(node.mode))throw Error('Invalid anchor or segment mode.');for(const point of [node.p,node.in,node.out])if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite)||point[0]<0||point[1]<0||point[0]>width||point[1]>height)throw Error('An outline control point is outside the image.');}}
 if(count>5000)throw Error('Editable outlines support up to 5,000 anchors. Simplify the mask before entering anchor editing.');return outline;
}
export function insertAnchor(loop,index,t=.5){
 const a=loop.nodes[index],b=loop.nodes[(index+1)%loop.nodes.length];t=Math.max(.001,Math.min(.999,t));
 if(a.segment==='line'){const p=lerp(a.p,b.p,t);loop.nodes.splice(index+1,0,{p,in:p.slice(),out:p.slice(),mode:'corner',segment:'line'});}
 else{const [left,right]=splitCubic(controls(loop,index),t);a.out=left[1];b.in=right[2];loop.nodes.splice(index+1,0,{p:left[3],in:left[2],out:right[1],mode:'smooth',segment:'curve'});}
 return index+1;
}
function rayClamp(p,handle,width,height){let ratio=1;const dx=handle[0]-p[0],dy=handle[1]-p[1];if(dx>0)ratio=Math.min(ratio,(width-p[0])/dx);if(dx<0)ratio=Math.min(ratio,-p[0]/dx);if(dy>0)ratio=Math.min(ratio,(height-p[1])/dy);if(dy<0)ratio=Math.min(ratio,-p[1]/dy);return[p[0]+dx*ratio,p[1]+dy*ratio];}
export function moveAnchor(node,point,width,height){const p=[Math.max(0,Math.min(width,point[0])),Math.max(0,Math.min(height,point[1]))],delta=[p[0]-node.p[0],p[1]-node.p[1]];node.p=p;node.in=rayClamp(p,[node.in[0]+delta[0],node.in[1]+delta[1]],width,height);node.out=rayClamp(p,[node.out[0]+delta[0],node.out[1]+delta[1]],width,height);}
export function moveHandle(node,kind,point,width,height){node[kind]=rayClamp(node.p,point,width,height);if(node.mode==='smooth'){const other=kind==='in'?'out':'in';node[other]=rayClamp(node.p,[2*node.p[0]-node[kind][0],2*node.p[1]-node[kind][1]],width,height);}}
export function segmentMode(loop,index,mode){const a=loop.nodes[index],b=loop.nodes[(index+1)%loop.nodes.length];if(mode==='curve'&&a.segment!=='curve'){a.out=lerp(a.p,b.p,1/3);b.in=lerp(a.p,b.p,2/3);}a.segment=mode;}
export function smoothAnchor(loop,index,width,height){const nodes=loop.nodes,n=nodes.length,previous=(index+n-1)%n,a=nodes[previous],b=nodes[index],c=nodes[(index+1)%n];segmentMode(loop,previous,'curve');segmentMode(loop,index,'curve');const tangent=[(c.p[0]-a.p[0])/6,(c.p[1]-a.p[1])/6];b.in=rayClamp(b.p,[b.p[0]-tangent[0],b.p[1]-tangent[1]],width,height);b.out=rayClamp(b.p,[b.p[0]+tangent[0],b.p[1]+tangent[1]],width,height);b.mode='smooth';}
export function cornerAnchor(loop,index){const b=loop.nodes[index];b.mode='corner';b.in=b.p.slice();b.out=b.p.slice();}
export function removeAnchor(loop,index){if(loop.nodes.length<=3)throw Error('A closed contour needs at least three anchors.');loop.nodes.splice(index,1);}
export function pointSegmentDistance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
function flattenSegment(p,tolerance,out,depth=0){
 if(pointSegmentDistance(p[1],p[0],p[3])<=tolerance&&pointSegmentDistance(p[2],p[0],p[3])<=tolerance){out.push(p[3].slice());return;}
 if(depth>=22||out.length>30000)throw Error('Curve is too complex to flatten safely. Simplify the outline.');
 const [a,b]=splitCubic(p);flattenSegment(a,tolerance,out,depth+1);flattenSegment(b,tolerance,out,depth+1);
}
export function flattenLoop(loop,tolerance=CURVE_TOLERANCE){const points=[loop.nodes[0].p.slice()];for(let i=0;i<loop.nodes.length;i++){if(loop.nodes[i].segment==='line')points.push(loop.nodes[(i+1)%loop.nodes.length].p.slice());else flattenSegment(controls(loop,i),tolerance,points);}points.pop();return points.filter((p,i)=>!i||Math.hypot(p[0]-points[i-1][0],p[1]-points[i-1][1])>1e-9);}
const GL3=[[.5-Math.sqrt(15)/10,5/18],[.5,8/18],[.5+Math.sqrt(15)/10,5/18]];
export function exactLoopArea(loop){let area=0;for(let i=0;i<loop.nodes.length;i++){const p=controls(loop,i);for(const [t,w]of GL3){const q=cubic(p,t),u=1-t,dx=3*u*u*(p[1][0]-p[0][0])+6*u*t*(p[2][0]-p[1][0])+3*t*t*(p[3][0]-p[2][0]),dy=3*u*u*(p[1][1]-p[0][1])+6*u*t*(p[2][1]-p[1][1])+3*t*t*(p[3][1]-p[2][1]);area+=w*(q[0]*dy-q[1]*dx)/2;}}return area;}
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function intersects(a,b,c,d,sameLoop){
 const x=cross(a,b,c),y=cross(a,b,d),z=cross(c,d,a),w=cross(c,d,b),eps=1e-8;
 if(x*y<-eps&&z*w<-eps)return true;
 const touch=(p,u,v)=>pointSegmentDistance(p,u,v)<eps;
 if(![touch(a,c,d),touch(b,c,d),touch(c,a,b),touch(d,a,b)].some(Boolean))return false;
 if(sameLoop)return true;
 // Separate pixel contours may meet at a corner without sharing area.
 const eq=(p,q)=>Math.hypot(p[0]-q[0],p[1]-q[1])<eps;
 if(eq(a,c)||eq(a,d)||eq(b,c)||eq(b,d)){
  if(Math.abs(x)+Math.abs(y)+Math.abs(z)+Math.abs(w)>eps)return false;
  const axis=Math.abs(b[0]-a[0])>=Math.abs(b[1]-a[1])?0:1,overlap=Math.min(Math.max(a[axis],b[axis]),Math.max(c[axis],d[axis]))-Math.max(Math.min(a[axis],b[axis]),Math.min(c[axis],d[axis]));
  if(overlap<=eps)return false;
 }
 return true;
}
function inside(point,polygon){let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
export function validateTopology(loops,width,height){
 const grid=new Map(),cell=Math.max(1,Math.max(width,height)/32);let id=0;
 for(let l=0;l<loops.length;l++){const points=loops[l].points;for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length];if(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-8)throw Error('Two neighboring anchors coincide. Move or remove one.');
  const keys=[];for(let x=Math.floor(Math.min(a[0],b[0])/cell);x<=Math.floor(Math.max(a[0],b[0])/cell);x++)for(let y=Math.floor(Math.min(a[1],b[1])/cell);y<=Math.floor(Math.max(a[1],b[1])/cell);y++)keys.push(x+','+y);
  const candidates=new Map();for(const key of keys)for(const e of grid.get(key)||[])candidates.set(e.id,e);
  for(const e of candidates.values()){if(e.loop===l&&(Math.abs(e.index-i)===1||(e.index===0&&i===points.length-1)))continue;if(intersects(a,b,e.a,e.b,e.loop===l))throw Error('The edited outline crosses itself or another contour. This edit was undone; keep holes inside their object.');}
  const segment={id:id++,a,b,loop:l,index:i};for(const key of keys){if(!grid.has(key))grid.set(key,[]);grid.get(key).push(segment);}
 }}
 for(let i=0;i<loops.length;i++){const depth=loops.reduce((n,p,j)=>n+(j!==i&&inside(loops[i].points[0],p.points)?1:0),0);if((depth%2===0)!==(loops[i].role==='outer'))throw Error('This edit changes the hole/object nesting. It was undone to preserve valid measurements.');}
}
export function deriveOutline(outline,width,height,{topology=true}={}){
 validateOutline(outline,width,height);let count=0;
 const loops=outline.loops.map((loop,index)=>{let points=flattenLoop(loop,CURVE_TOLERANCE);count+=points.length;if(count>30000)throw Error('The edited outline exceeds 30,000 Fourier vertices. Simplify it.');const sign=loop.role==='outer'?1:-1;if(signedArea(points)*sign<0)points=points.reverse();const area=signedArea(points);if(Math.abs(area)<1e-6)throw Error('A contour has collapsed to zero area.');return{id:index,role:loop.role,points,area,rawArea:area,perimeter:perimeter(points),curveArea:sign*Math.abs(exactLoopArea(loop))};});
 if(topology)validateTopology(loops,width,height);
 return{loops,raw:loops.map(p=>p.points),area:loops.reduce((s,p)=>s+p.area,0),rawArea:loops.reduce((s,p)=>s+p.area,0),perimeter:loops.reduce((s,p)=>s+p.perimeter,0),curveArea:loops.reduce((s,p)=>s+p.curveArea,0),curveTolerance:CURVE_TOLERANCE};
}
export function vectorPath(outline){return outline.loops.map(loop=>{let s='M '+loop.nodes[0].p.join(' ');for(let i=0;i<loop.nodes.length;i++){const a=loop.nodes[i],b=loop.nodes[(i+1)%loop.nodes.length];s+=a.segment==='curve'?' C '+a.out.join(' ')+' '+b.in.join(' ')+' '+b.p.join(' '):' L '+b.p.join(' ');}return s+' Z';}).join(' ');}
export function curveSVG(outline,width,height){return`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>Editable Bezier outline; holes preserved</title><path d="${vectorPath(outline)}" fill="none" fill-rule="evenodd" stroke="#00a878" stroke-width="2"/></svg>`;}
