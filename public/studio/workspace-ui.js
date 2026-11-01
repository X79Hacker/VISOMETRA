export function mountWorkspace(){
 const $=id=>document.getElementById(id);
 const left=[...document.querySelectorAll('.controls>section')];for(const section of left)if(!section.dataset.leftPane)section.dataset.leftPane=section.querySelector('#engine')||section.querySelector('#brush')?'select':'measure';
 const right=[...document.querySelectorAll('.results>section')];right.forEach((section,i)=>section.dataset.rightPane=['export','benchmark','model'][i]);
 function tabs(buttonAttr,paneAttr,first){
  const buttons=[...document.querySelectorAll('['+buttonAttr+']')];
  const select=value=>{buttons.forEach(b=>b.setAttribute('aria-pressed',String(b.getAttribute(buttonAttr)===value)));document.querySelectorAll('['+paneAttr+']').forEach(p=>p.hidden=p.getAttribute(paneAttr)!==value);window.dispatchEvent(new Event('resize'));};
  buttons.forEach(button=>button.addEventListener('click',()=>select(button.getAttribute(buttonAttr))));select(first);
 }
 tabs('data-left-tab','data-left-pane','select');tabs('data-right-tab','data-right-pane','export');tabs('data-dock-tab','data-dock-pane','fourier');
 $('statusSlot').append($('status'));$('progressSlot').append($('progress'));$('cancelSlot').append($('cancel'));$('computeSlot').append($('compute'));
 const review=document.createElement('div');review.className='inspector-review';review.append($('approve'),$('reviewStatus'));right[0].append(review);
 $('compute').textContent='Run Fourier';$('saveFrame').textContent='Save episode frame';$('saveProject').textContent='Download complete project';
 document.querySelectorAll('.chips button').forEach(b=>b.title='Find '+b.dataset.query);
}
export function updateQuickMetrics(S,settings,format){
 const root=document.getElementById('quickMetrics');if(!root)return;if(['hidden','outside','unknown'].includes(S.visibility)){root.replaceChildren();const note=document.createElement('span');note.textContent='Target '+S.visibility+' · no measurements';root.append(note);return;}const s=settings(),d=S.derived,area=d?(d.curveArea??d.area)*s.unitsPerPixel**2:null;
 const values=[['Selected area',area===null?'—':format(area)+' '+s.unit+'²'],['Perimeter',d?format(d.perimeter*s.unitsPerPixel)+' '+s.unit:'—'],['Contours',d?String(d.loops.length):'—'],['Fourier error',S.fourier&&d?format(Math.abs(S.fourier.area-(d.curveArea??d.area))/Math.abs((d.curveArea??d.area)||1)*100,4)+'%':'—']];
 root.replaceChildren(...values.map(([label,value])=>{const box=document.createElement('div'),small=document.createElement('span'),strong=document.createElement('strong');small.textContent=label;strong.textContent=value;box.append(small,strong);return box;}));
}
