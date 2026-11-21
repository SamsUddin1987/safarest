(function(g){
'use strict';
const CAD=g.CAD, T=g.THREE, H=CAD.DimensionTools;
function centerInfo(o){
 if(!o||!o.userData)return null;
 const d=o.userData;
 if(d.center&&Number.isFinite(Number(d.radius)))return {center:H.point(d.center),radius:Number(d.radius)};
 if(d.type==='circle'&&o.geometry&&o.geometry.attributes.position){
  const b=new T.Box3().setFromObject(o);return {center:b.getCenter(new T.Vector3()),radius:Math.max(b.max.x-b.min.x,b.max.y-b.min.y)/2};
 }
 return null;
}
CAD.registerTool('dimcenter',{
 onStart(ctx){
  const selected=ctx.getSelectedObjects();
  const info=selected.map(centerInfo).find(Boolean);
  if(info){const e=CAD.Dimension.createCenterMark(info.center,info.radius);if(e)ctx.addEntity(e);ctx.finishCurrentTool();return;}
  ctx.setPrompt('DIMCENTER — Select circle or arc:');
 },
 onClick(p,ctx){const selected=ctx.getSelectedObjects();const obj=selected[0]||H.entityAt(ctx);const info=centerInfo(obj);if(!info){ctx.setPrompt('DIMCENTER — Select a circle or arc.');return;}const e=CAD.Dimension.createCenterMark(info.center,info.radius);if(e)ctx.addEntity(e);ctx.finishCurrentTool();},
 onEnter(ctx){ctx.finishCurrentTool();}
});
CAD.registerCommand({name:'DIMCENTER',aliases:['DCE'],desc:'Create circle or arc centre mark',category:'dimension',execute(ctx){ctx.setTool('dimcenter');}});
})(window);