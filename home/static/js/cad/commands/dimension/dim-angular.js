(function(g){
'use strict';
const CAD=g.CAD, T=g.THREE;
let pts=[];
CAD.registerTool('dimangular',{
 onStart(ctx){pts=[];ctx.setPrompt('DIMANGULAR — Specify vertex of angle:');},
 onClick(p,ctx){
  pts.push(p.clone());ctx.clearPreview();
  const prompts=['','DIMANGULAR — Specify point on first angle line:','DIMANGULAR — Specify point on second angle line:','DIMANGULAR — Specify arc location:'];
  if(pts.length<4){ctx.setPrompt(prompts[pts.length]);return;}
  const e=CAD.Dimension.createAngular(pts[0],pts[1],pts[2],pts[3]);
  if(e)ctx.addEntity(e);ctx.finishCurrentTool();
 },
 onPreview(p,ctx){
  if(pts.length===3){
   const previewStyle={dimensionColor:'#00ffff',extensionColor:'#00ffff',textColor:'#00ffff'};
   const e=CAD.Dimension.createAngular(pts[0],pts[1],pts[2],p,previewStyle);
   if(e)ctx.setPreview(e);
  }
 },
 onEnter(ctx){ctx.clearPreview();ctx.finishCurrentTool();},
 onFinish(ctx){ctx.clearPreview();pts=[];}
});
CAD.registerCommand({name:'DIMANGULAR',aliases:['DAN'],desc:'Create angular dimension',category:'dimension',execute(ctx){ctx.setTool('dimangular');}});
})(window);