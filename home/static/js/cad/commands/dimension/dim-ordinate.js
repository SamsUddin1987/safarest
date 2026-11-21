(function(g){
'use strict';
const CAD=g.CAD;
let p1=null,axis='X';
CAD.registerTool('dimordinate',{
 onStart(ctx){p1=null;axis='X';ctx.setPrompt('DIMORDINATE — Specify feature point:');},
 onOption(value,ctx){if(value==='X'||value==='Y'){axis=value;ctx.setPrompt(`DIMORDINATE — ${axis} ordinate; specify leader endpoint:`);return true;}return false;},
 onClick(p,ctx){if(!p1){p1=p.clone();ctx.updateState({isDrawing:true});ctx.setPrompt('DIMORDINATE — Specify leader endpoint (X/Y option):');return;}const e=CAD.Dimension.createOrdinate(p1,p,axis);if(e)ctx.addEntity(e);ctx.finishCurrentTool();},
 onPreview(p,ctx){if(p1){const previewStyle={dimensionColor:'#00ffff',extensionColor:'#00ffff',textColor:'#00ffff'};const e=CAD.Dimension.createOrdinate(p1,p,axis,previewStyle);if(e)ctx.setPreview(e);}},
 onEnter(ctx){ctx.clearPreview();ctx.finishCurrentTool();},
 onFinish(ctx){ctx.clearPreview();p1=null;}
});
CAD.registerCommand({name:'DIMORDINATE',aliases:['DOR'],desc:'Create X/Y ordinate dimension',category:'dimension',execute(ctx){ctx.setTool('dimordinate');}});
})(window);