(function(g){
'use strict';
const CAD=g.CAD;
CAD.registerCommand({name:'DIMSTYLE',aliases:['D'],desc:'Create and modify dimension styles',category:'dimension',execute(){CAD.Dimension.openStyleManager();}});
CAD.registerCommand({name:'DIM',aliases:[],desc:'Start linear dimension command',category:'dimension',execute(ctx){ctx.setTool('dimlinear');}});
CAD.registerCommand({name:'DIMUPDATE',aliases:['DUP'],desc:'Update selected/all dimensions to current style',category:'dimension',execute(ctx){
 const selected=ctx.getSelectedObjects().filter(o=>o.userData&&o.userData.type==='dimension');
 const targets=selected.length?selected:ctx.getObjects().filter(o=>o.userData&&o.userData.type==='dimension');
 targets.forEach(o=>CAD.Dimension.refreshEntity(o,true));
 ctx.setPrompt(`DIMUPDATE — Updated ${targets.length} dimension(s) to ${CAD.Dimension.getSettings().currentStyle}.`);
}});
CAD.registerCommand({name:'DIMEDIT',aliases:['DED'],desc:'Edit dimension text override',category:'dimension',execute(ctx){
 const selected=ctx.getSelectedObjects().filter(o=>o.userData&&o.userData.type==='dimension');
 if(!selected.length){ctx.setPrompt('DIMEDIT — Select a dimension first, then run DIMEDIT.');return;}
 const obj=selected[0];
 const value=g.prompt('Dimension text override (blank = measured value):',obj.userData.textOverride||'');
 if(value===null)return;
 CAD.Dimension.setTextOverride(obj,value);
 ctx.setPrompt('DIMEDIT — Dimension text updated.');
}});
CAD.registerCommand({name:'LAYER',aliases:['LA'],desc:'Manage CAD layers',category:'format',execute(){CAD.Dimension.openLayerManager();}});
CAD.registerCommand({name:'UNITS',aliases:['UN'],desc:'Set dimension display units and precision',category:'format',execute(){CAD.Dimension.openUnitsManager();}});
})(window);