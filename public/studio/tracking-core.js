/* Translation-only normalized correlation. A match score is not segmentation accuracy. */
export function matchTranslation(previous,current,mask,width,height,{radius=24,minScore=.7,minMargin=.02}={}) {
  if(previous.length!==width*height||current.length!==previous.length||mask.length!==previous.length)throw Error('Tracking image dimensions do not match.');
  let left=width,top=height,right=-1,bottom=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(mask[y*width+x]){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  if(right<left||bottom<top)return{accepted:false,reason:'The seed mask is empty.'};
  const margin=3;left=Math.max(0,left-margin);right=Math.min(width-1,right+margin);top=Math.max(0,top-margin);bottom=Math.min(height-1,bottom+margin);
  const step=Math.max(1,Math.ceil(Math.sqrt((right-left+1)*(bottom-top+1)/1000))),points=[];
  for(let y=top;y<=bottom;y+=step)for(let x=left;x<=right;x+=step)points.push({x,y,value:previous[y*width+x]});
  const n=points.length;if(n<12)return{accepted:false,reason:'The object is too small at tracking resolution.'};
  const mean=points.reduce((s,p)=>s+p.value,0)/n;let variance=0;for(const p of points){p.value-=mean;variance+=p.value*p.value;}
  if(variance/n<8)return{accepted:false,reason:'The object has too little texture for reliable matching. Select the next frame manually.'};
  const candidates=[];radius=Math.min(40,Math.max(1,Math.round(radius)));
  for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
    if(left+dx<0||top+dy<0||right+dx>=width||bottom+dy>=height)continue;
    let sum=0,squared=0,cross=0;for(const p of points){const value=current[(p.y+dy)*width+p.x+dx];sum+=value;squared+=value*value;cross+=p.value*value;}
    const denominator=Math.sqrt(variance*Math.max(0,squared-sum*sum/n));const score=denominator>1e-9?cross/denominator:-1;
    candidates.push({dx,dy,score});
  }
  candidates.sort((a,b)=>b.score-a.score||Math.hypot(a.dx,a.dy)-Math.hypot(b.dx,b.dy));const best=candidates[0];if(!best)return{accepted:false,reason:'The search region is outside the image.'};
  const alternate=candidates.find(c=>Math.hypot(c.dx-best.dx,c.dy-best.dy)>3),gap=best.score-(alternate?.score??-1);
  const atLimit=Math.abs(best.dx)===radius||Math.abs(best.dy)===radius;
  return{...best,margin:gap,accepted:best.score>=minScore&&gap>=minMargin&&!atLimit,
    reason:atLimit?'Motion reached the search limit. Check this frame manually.':best.score<minScore?'Appearance match is weak; review this frame manually.':gap<minMargin?'Several positions look similar; object identity is ambiguous.':'Translation proposal ready.',bounds:{left,top,right,bottom},width,height};
}
export function guidedPrompts(mask,width,height,nextWidth,nextHeight,match,trackingWidth=192,trackingHeight=192) {
  if(!match.accepted)throw Error(match.reason||'Tracking match was rejected.');
  let minX=width,minY=height,maxX=-1,maxY=-1,sumX=0,sumY=0,count=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(mask[y*width+x]){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);sumX+=x;sumY+=y;count++;}
  if(!count)throw Error('The seed mask is empty.');
  const cx=sumX/count,cy=sumY/count;let nearest=null,distance=Infinity;
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++)if(mask[y*width+x]){const d=(x-cx)**2+(y-cy)**2;if(d<distance){distance=d;nearest={x,y};}}
  const shiftX=match.dx/trackingWidth,shiftY=match.dy/trackingHeight;
  const x=v=>Math.max(0,Math.min(nextWidth-1,(v/width+shiftX)*nextWidth)),y=v=>Math.max(0,Math.min(nextHeight-1,(v/height+shiftY)*nextHeight));
  const box={x1:Math.floor(x(minX)),y1:Math.floor(y(minY)),x2:Math.ceil(Math.min(nextWidth,(maxX+1)/width*nextWidth+shiftX*nextWidth)),y2:Math.ceil(Math.min(nextHeight,(maxY+1)/height*nextHeight+shiftY*nextHeight))};
  if(box.x2<=box.x1||box.y2<=box.y1)throw Error('The proposed object left the image.');
  return{points:[{x:x(nearest.x),y:y(nearest.y),label:1}],box};
}
