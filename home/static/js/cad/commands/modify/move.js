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
    let previewDelta = { x: 0, y: 0, z: 0 };

    function clearPreview(context) {
        Utils.disposePreview(context, previewObjects);
        previewObjects = [];
        previewDelta = { x: 0, y: 0, z: 0 };
    }

    function reset(context) {
        clearPreview(context);
        objects = [];
        basePoint = null;
        window.SafarEdgeCommandGripObjects = null;
    }

    CAD.registerTool('move', {
        onStart(context) {
            objects = Utils.selected(context, 'MOVE');
            if (!objects) {
                context.finishCurrentTool();
                return;
            }

            // Use the selected source list for the shared MOVE/COPY base-point
            // overlay. Stretch grips are not used by either command.
            window.SafarEdgeCommandGripObjects = objects.slice();

            context.setPrompt(
                `MOVE — ${objects.length} object(s). Pick base node/point (OSNAP works in all views):`
            );
        },

        onClick(point, context) {
            if (objects.length === 0) return;

            if (!basePoint) {
                basePoint = point.clone();
                previewObjects = Utils.cloneForPreview(context, objects);
                context.updateState({ isDrawing: true, basePoint });
                context.setPrompt('MOVE — Pick a destination node/point. OSNAP uses true 3D vertices in Top, Front, Side and ISO views. Original remains until confirmed.');
                return;
            }

            const dx = point.x - basePoint.x;
            const dy = point.y - basePoint.y;
            const dz = (point.z || 0) - (basePoint.z || 0);

            if (Math.hypot(dx, dy, dz) < 1e-8) {
                context.setPrompt('MOVE — Zero displacement. Pick another destination.');
                return;
            }

            const before = context.captureObjects(objects);
            context.translateObjects(objects, dx, dy, dz);
            context.recordModify(objects, before);

            context.notify(`Moved ${objects.length} object(s).`);
            reset(context);
            context.finishCurrentTool();
        },

        onPreview(point, context) {
            if (!basePoint || previewObjects.length === 0) return;

            const dx = point.x - basePoint.x;
            const dy = point.y - basePoint.y;
            const dz = (point.z || 0) - (basePoint.z || 0);

            context.translateObjects(
                previewObjects,
                dx - previewDelta.x,
                dy - previewDelta.y,
                dz - previewDelta.z
            );

            previewDelta = { x: dx, y: dy, z: dz };
            context.setPrompt(
                `MOVE — X: ${context.formatValue(dx)} | Y: ${context.formatValue(dy)} | Z: ${context.formatValue(dz)} | Click to place`
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
