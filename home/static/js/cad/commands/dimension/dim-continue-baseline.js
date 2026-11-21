(function(g){
'use strict';
const CAD=g.CAD, T=g.THREE;
function registerContinuation(name,alias,baseline){
 let base=null;
 CAD.registerTool(baseline?'dimbaseline':'dimcontinue',{
  onStart(ctx){
   base=CAD.Dimension.getLastLinear();
   if(!base){ctx.setPrompt(`${name} — Create a linear/aligned dimension first.`);ctx.finishCurrentTool();return;}
   ctx.setPrompt(`${name} — Specify next extension line origin:`);
  },
  onClick(p,ctx){
   if(!base){ctx.finishCurrentTool();return;}
   const p1=new T.Vector3(...(baseline?base.p1:base.p2));
   const p2=p.clone();
   let loc;
   if(baseline){
    const b1=new T.Vector3(...base.p1), bl=new T.Vector3(...base.location);
    const dir=bl.sub(b1);const step=CAD.Dimension.currentStyle().textHeight*3;
    loc=p1.clone().add(dir).add(new T.Vector3(0,step,0));
   }else{
    const b2=new T.Vector3(...base.p2), bl=new T.Vector3(...base.location);
    loc=p2.clone().add(bl.sub(b2));
   }
   const e=CAD.Dimension.createLinear(p1,p2,loc,!!base.aligned);
   if(e){ctx.addEntity(e);CAD.Dimension.setLastLinear({p1:p1.toArray(),p2:p2.toArray(),location:loc.toArray(),aligned:!!base.aligned});}
   ctx.setPrompt(`${name} — Dimension created.`);
   ctx.finishCurrentTool();
  },
  onPreview(p,ctx){
   if(!base)return;
   const p1=new T.Vector3(...(baseline?base.p1:base.p2));
   const p2=p.clone();
   const b2=new T.Vector3(...(baseline?base.p1:base.p2));
   const bl=new T.Vector3(...base.location);
   const loc=baseline?p2.clone().add(new T.Vector3(0,CAD.Dimension.currentStyle().textHeight*3,0)):p2.clone().add(bl.sub(b2));
   const previewStyle={dimensionColor:'#00ffff',extensionColor:'#00ffff',textColor:'#00ffff'};
   const e=CAD.Dimension.createLinear(p1,p2,loc,!!base.aligned,previewStyle);if(e)ctx.setPreview(e);
  },
  onEnter(ctx){ctx.clearPreview();ctx.finishCurrentTool();},
  onFinish(ctx){ctx.clearPreview();base=null;}
 });
 CAD.registerCommand({name,aliases:[alias],desc:baseline?'Create baseline dimension':'Continue dimension from previous dimension',category:'dimension',execute(ctx){ctx.setTool(baseline?'dimbaseline':'dimcontinue');}});
}
registerContinuation('DIMCONTINUE','DCO',false);
registerContinuation('DIMBASELINE','DBA',true);
})(window);