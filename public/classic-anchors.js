/* Shared interaction layer for the original Trace and grid-cell editors.
   De Casteljau insertion preserves the current cubic exactly. */
(function(root){
 'use strict';
 const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
 function point(segment,t){const a=mix(segment[0],segment[1],t),b=mix(segment[1],segment[2],t),c=mix(segment[2],segment[3],t);return mix(mix(a,b,t),mix(b,c,t),t);}
 function insert(nodes,index,t=.5){
  t=Math.max(.001,Math.min(.999,t));for(const n of nodes)if(n.mode==='auto')n.mode='smooth';
  const a=nodes[index],b=nodes[(index+1)%nodes.length],line=!!a.line;
  if(line){const p=mix(a.p,b.p,t);nodes.splice(index+1,0,{p,hi:p.slice(),ho:p.slice(),mode:'smooth',line:true});return index+1;}
  const q0=mix(a.p,a.ho,t),q1=mix(a.ho,b.hi,t),q2=mix(b.hi,b.p,t),r0=mix(q0,q1,t),r1=mix(q1,q2,t),p=mix(r0,r1,t);
  a.ho=q0;b.hi=q2;if(a.mode==='corner')a.mode='smooth';if(b.mode==='corner')b.mode='smooth';nodes.splice(index+1,0,{p,hi:r0,ho:r1,mode:'smooth',line:false});return index+1;
 }
 function mount(api){
  const bar=document.createElement('div');bar.className='legacy-anchor-bar';bar.innerHTML='<button data-action="edit">◇ Edit anchors</button><button data-action="add">+ Point</button><button data-action="line">Straight</button><button data-action="curve">Curve</button><button data-action="smooth">Smooth</button><button data-action="sharp">Sharp</button><button data-action="delete">Delete point</button><button data-action="magnify">Magnifier</button><small>Drag diamonds · hollow diamonds insert · double-click an edge to add</small>';
  api.toolbar.after(bar);let selected=0,adding=false,magnify=false,lastInserted=0;
  const lens=document.createElement('canvas');lens.width=216;lens.height=180;lens.className='legacy-lens';lens.hidden=true;document.body.append(lens);
  function ensure(){api.ensure();selected=Math.min(selected,Math.max(0,api.nodes().length-1));return api.nodes();}
  function apply(fn){const N=ensure();if(!N.length){api.say('Create an outline first, then select an anchor.');return;}api.checkpoint();fn(N,selected);api.commit();api.render();}
  for(const button of bar.querySelectorAll('button'))button.onclick=()=>{try{const action=button.dataset.action;
   if(action==='magnify'){magnify=!magnify;button.setAttribute('aria-pressed',magnify);lens.hidden=!magnify;return;}
   if(action==='edit'){ensure();adding=false;api.render();api.say('Drag anchors or round handles. Click hollow diamonds to insert points.');return;}
   if(action==='add'){ensure();adding=!adding;button.setAttribute('aria-pressed',adding);api.say('Click the edge where you want a new diamond anchor.');return;}
   apply((N,i)=>{const nd=N[i];if(action==='delete'){if(api.closed()&&N.length<=3)throw Error('A closed outline needs at least 3 anchors.');N.splice(i,1);selected=Math.min(i,N.length-1);return;}
    if(action==='line'||action==='curve'){nd.line=action==='line';if(nd.line){nd.ho=nd.p.slice();N[(i+1)%N.length].hi=N[(i+1)%N.length].p.slice();}else{for(const n of [nd,N[(i+1)%N.length]])n.mode='auto';}return;}
    if(action==='sharp'){nd.mode='corner';nd.hi=nd.p.slice();nd.ho=nd.p.slice();}else if(action==='smooth'){nd.mode='auto';nd.line=false;N[(i+N.length-1)%N.length].line=false;}
   });api.say('Outline updated. Re-run Fourier / Compute to measure the edited boundary.');
  }catch(e){api.say(e.message);}};
  function segmentHit(p,midpointOnly=false){const N=api.nodes(),r=(midpointOnly?8:12)*api.pixel();let best=null;for(let i=0;i<(api.closed()?N.length:N.length-1);i++){const a=N[i],b=N[(i+1)%N.length],segment=[a.p,a.ho,b.hi,b.p],steps=midpointOnly?1:48;
    if(midpointOnly){const q=a.line?mix(a.p,b.p,.5):point(segment,.5),d=Math.hypot(p[0]-q[0],p[1]-q[1]);if(d<r&&(!best||d<best.d))best={index:i,t:.5,d};continue;}
    let prev=a.p;for(let j=1;j<=steps;j++){const q=a.line?mix(a.p,b.p,j/steps):point(segment,j/steps),v=[q[0]-prev[0],q[1]-prev[1]],l=v[0]**2+v[1]**2,u=Math.max(0,Math.min(1,((p[0]-prev[0])*v[0]+(p[1]-prev[1])*v[1])/(l||1))),d=Math.hypot(p[0]-prev[0]-u*v[0],p[1]-prev[1]-u*v[1]);if(d<r&&(!best||d<best.d))best={index:i,t:(j-1+u)/steps,d};prev=q;}
   }return best;}
  const stop=e=>{e.preventDefault();e.stopImmediatePropagation();};
  const cv=api.canvas;
  cv.addEventListener('pointerdown',e=>{if(e.button!==0||!api.editable())return;const p=api.point(e),hit=api.hit(p);if(hit){selected=hit.i;return;}
   const segment=segmentHit(p,!adding);if(!segment)return;stop(e);api.checkpoint();selected=insert(api.nodes(),segment.index,segment.t);lastInserted=performance.now();adding=false;bar.querySelector('[data-action=add]').setAttribute('aria-pressed','false');api.commit();api.render();api.say('Anchor inserted without changing the curve. Drag the new diamond to adjust it.');
  },true);
  cv.addEventListener('dblclick',e=>{if(!api.editable())return;if(performance.now()-lastInserted<600){stop(e);return;}const p=api.point(e);if(api.hit(p))return;const hit=segmentHit(p);if(!hit)return;stop(e);api.checkpoint();selected=insert(api.nodes(),hit.index,hit.t);api.commit();api.render();},true);
  cv.addEventListener('pointermove',e=>{if(!magnify)return;const r=cv.getBoundingClientRect(),x=(e.clientX-r.left)*cv.width/r.width,y=(e.clientY-r.top)*cv.height/r.height,c=lens.getContext('2d');lens.hidden=false;c.fillStyle='#06111a';c.fillRect(0,0,lens.width,lens.height);c.drawImage(cv,x-27,y-22.5,54,45,0,0,lens.width,lens.height);c.strokeStyle='#fff';c.beginPath();c.moveTo(98,90);c.lineTo(118,90);c.moveTo(108,80);c.lineTo(108,100);c.stroke();});cv.addEventListener('pointerleave',()=>lens.hidden=true);
  function drawHandles(context){if(!api.editable())return;const N=api.nodes(),u=api.pixel();context.save();context.lineWidth=1.3*u;for(let i=0;i<(api.closed()?N.length:N.length-1);i++){const a=N[i],b=N[(i+1)%N.length],p=a.line?mix(a.p,b.p,.5):point([a.p,a.ho,b.hi,b.p],.5),d=4*u;context.strokeStyle='#93e7ce';context.fillStyle='#10252b';context.beginPath();context.moveTo(p[0],p[1]-d);context.lineTo(p[0]+d,p[1]);context.lineTo(p[0],p[1]+d);context.lineTo(p[0]-d,p[1]);context.closePath();context.fill();context.stroke();}
   N.forEach((n,i)=>{const p=n.p,d=(i===selected?6:4.5)*u;context.fillStyle=i===selected?'#7aefc6':'#0b2028';context.strokeStyle='#f5d47f';context.beginPath();context.moveTo(p[0],p[1]-d);context.lineTo(p[0]+d,p[1]);context.lineTo(p[0],p[1]+d);context.lineTo(p[0]-d,p[1]);context.closePath();context.fill();context.stroke();});context.restore();}
  return{draw:drawHandles};
 }
 root.ClassicAnchors={mount,insert,point};
})(globalThis);
