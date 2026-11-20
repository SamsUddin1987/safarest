/**
 * SAFAR EDGE CAD - MOVE
 * Moves selected entities using a base point and destination point.
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;
    const Utils = global.CADModifyUtils;

    let objects = [];
    let basePoint = null;
    let previewObjects = [];
    let previewDelta = { x: 0, y: 0 };

    function clearPreview(context) {
        Utils.disposePreview(context, previewObjects);
        previewObjects = [];
        previewDelta = { x: 0, y: 0 };
    }

    function reset(context) {
        clearPreview(context);
        objects = [];
        basePoint = null;
    }

    CAD.registerTool('move', {
        onStart(context) {
            objects = Utils.selected(context, 'MOVE');
            if (!objects) {
                context.finishCurrentTool();
                return;
            }

            context.setPrompt(
                `MOVE — ${objects.length} object(s). Pick base point:`
            );
        },

        onClick(point, context) {
            if (objects.length === 0) return;

            if (!basePoint) {
                basePoint = point.clone();
                previewObjects = Utils.cloneForPreview(context, objects);
                context.updateState({ isDrawing: true, basePoint });
                context.setPrompt('MOVE — Pick destination point:');
                return;
            }

            const dx = point.x - basePoint.x;
            const dy = point.y - basePoint.y;

            if (Math.hypot(dx, dy) < 1e-8) {
                context.setPrompt('MOVE — Zero displacement. Pick another destination.');
                return;
            }

            const before = context.captureObjects(objects);
            context.translateObjects(objects, dx, dy);
            context.recordModify(objects, before);

            context.notify(`Moved ${objects.length} object(s).`);
            reset(context);
            context.finishCurrentTool();
        },

        onPreview(point, context) {
            if (!basePoint || previewObjects.length === 0) return;

            const dx = point.x - basePoint.x;
            const dy = point.y - basePoint.y;

            context.translateObjects(
                previewObjects,
                dx - previewDelta.x,
                dy - previewDelta.y
            );

            previewDelta = { x: dx, y: dy };
            context.setPrompt(
                `MOVE — X: ${context.formatValue(dx)} | Y: ${context.formatValue(dy)} | Click to place`
            );
        },

        onFinish(context) {
            reset(context);
        }
    });

    CAD.registerCommand({
        name: 'MOVE',
        aliases: ['M'],
        desc: 'Move selected objects',
        category: 'modify',
        execute: () => CAD.createContext().setToolName('move')
    });
})(window);
