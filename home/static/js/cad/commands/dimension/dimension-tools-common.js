/**
 * Shared helpers for independent dimension commands.
 */
(function(global){
    'use strict';
    const CAD=global.CAD, THREE=global.THREE;
    if(!CAD||!THREE||!CAD.Dimension) throw new Error('Dimension command helpers loaded before dimension engine.');
    function point(v){return v&&v.isVector3?v.clone():new THREE.Vector3(v.x,v.y,v.z||0);}
    function entityAt(context){
        const selected=context.getSelectedObjects().filter(o=>o&&o.userData);
        if(selected.length)return selected[0];
        const hits=context.getObjectsAtPointer();
        return hits.find(o=>o&&o.userData)||null;
    }
    function circleInfo(object){
        if(!object||!object.userData)return null;
        const d=object.userData;
        if(!['circle','arc'].includes(d.type)||!d.center||!Number.isFinite(Number(d.radius)))return null;
        return {center:point(d.center),radius:Number(d.radius),object};
    }
    function registerLinearTool(toolName, commandName, alias, aligned){
        let pts=[];
        CAD.registerTool(toolName,{
            onStart(ctx){pts=[];ctx.setPrompt(`${commandName} — Specify first extension line origin:`);},
            onClick(p,ctx){
                pts.push(point(p));ctx.clearPreview();
                if(pts.length===1)ctx.setPrompt(`${commandName} — Specify second extension line origin:`);
                else if(pts.length===2)ctx.setPrompt(`${commandName} — Specify dimension line location:`);
                else{
                    const entity=CAD.Dimension.createLinear(pts[0],pts[1],pts[2],aligned);
                    if(entity){ctx.addEntity(entity);CAD.Dimension.setLastLinear({p1:pts[0].toArray(),p2:pts[1].toArray(),location:pts[2].toArray(),aligned:!!aligned});ctx.setPrompt(`${commandName} — Dimension created: ${entity.userData.dimensionText}`);}
                    else ctx.setPrompt(`${commandName} — Invalid points; dimension not created.`);
                    ctx.finishCurrentTool();
                }
            },
            onPreview(p,ctx){
                if(pts.length===2){const previewStyle={dimensionColor:'#00ffff',extensionColor:'#00ffff',textColor:'#00ffff'};
                    const e=CAD.Dimension.createLinear(pts[0],pts[1],p,aligned,previewStyle);
                    if(e)ctx.setPreview(e);}
            },
            onEnter(ctx){ctx.clearPreview();ctx.finishCurrentTool();},
            onFinish(ctx){ctx.clearPreview();pts=[];}
        });
        CAD.registerCommand({name:commandName,aliases:alias?[alias]:[],desc:aligned?'Create aligned dimension':'Create horizontal or vertical linear dimension',category:'dimension',execute(ctx){ctx.setTool(toolName);}});
    }
    function registerRadialTool(toolName,commandName,alias,diameter){
        let info=null;
        CAD.registerTool(toolName,{
            onStart(ctx){
                info=null;
                const selected=ctx.getSelectedObjects().map(circleInfo).find(Boolean);
                if(selected)info=selected;
                ctx.setPrompt(info?`${commandName} — Specify dimension line location:`:`${commandName} — Select a circle or arc:`);
            },
            onClick(p,ctx){
                if(!info){
                    info=circleInfo(entityAt(ctx));
                    if(!info){ctx.setPrompt(`${commandName} — Select a circle or arc.`);return;}
                    ctx.setPrompt(`${commandName} — Specify dimension line location:`);return;
                }
                const e=CAD.Dimension.createRadial(info.center,info.radius,p,diameter);
                if(e)ctx.addEntity(e);
                ctx.finishCurrentTool();
            },
            onPreview(p,ctx){if(info){const previewStyle={dimensionColor:'#00ffff',extensionColor:'#00ffff',textColor:'#00ffff'};
                const e=CAD.Dimension.createRadial(info.center,info.radius,p,diameter,previewStyle);
                if(e)ctx.setPreview(e);}},
            onEnter(ctx){ctx.clearPreview();ctx.finishCurrentTool();},
            onFinish(ctx){ctx.clearPreview();info=null;}
        });
        CAD.registerCommand({name:commandName,aliases:[alias],desc:diameter?'Create diameter dimension':'Create radius dimension',category:'dimension',execute(ctx){ctx.setTool(toolName);}});
    }
    CAD.DimensionTools={point,entityAt,circleInfo,registerLinearTool,registerRadialTool};
})(window);
