/**
 * SAFAR EDGE CAD - EXTEND
 * AutoCAD-style workflow: optionally preselect boundary edges, then click
 * an endpoint/polyline node to extend. Without preselection, the nearest
 * valid boundary ahead of the clicked node is used automatically.
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;
    const Utils = global.CADModifyUtils;
    let boundaryTargets = [];
    let finishKeyCount = 0;

    // Same square pickbox used by selection, without crosshair projections.
    const PICKBOX_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Crect x='1' y='1' width='10' height='10' fill='none' stroke='%23ffffff' stroke-width='1.2'/%3E%3C/svg%3E") 6 6, default`;

    function setPickbox(context, enabled) {
        const renderer = context.getRenderer();
        if (renderer && renderer.domElement) {
            renderer.domElement.style.cursor = enabled ? PICKBOX_CURSOR : '';
        }
    }

    CAD.registerTool('extend', {
        onStart(context) {
            // Preselected entities are explicit extension boundaries.
            boundaryTargets = context.getSelectedObjects();
            finishKeyCount = 0;
            setPickbox(context, true);
            context.setPrompt(boundaryTargets.length
                ? 'EXTEND — Selected objects are boundary targets. Click an endpoint or polyline node to extend up to the selected boundary. ENTER/SPACE twice to finish.'
                : 'EXTEND — Click an endpoint or polyline node. The nearest valid boundary ahead will be used. ENTER/SPACE twice to finish.');
        },

        onClick(point, context) {
            finishKeyCount = 0;
            const selectedBoundaries = boundaryTargets.filter(object => context.getObjects().includes(object));
            const clicked = context.getObjectAtPointer() ||
                Utils.findObjectAtPoint(context, point, selectedBoundaries);

            if (!clicked || selectedBoundaries.includes(clicked)) {
                context.setPrompt('EXTEND — Click an endpoint or polyline node on the object to extend.');
                return;
            }

            const boundaries = selectedBoundaries.length
                ? selectedBoundaries
                : context.getObjects().filter(object => object !== clicked);

            if (!boundaries.length) {
                context.setPrompt('EXTEND — No boundary objects are available.');
                return;
            }

            const before = context.captureObjects([clicked]);
            const tolerance = context.getPickTolerance ? context.getPickTolerance(18) : undefined;
            const changed = Utils.extendAt(context, clicked, point, boundaries, tolerance);

            if (changed) {
                context.recordModify([clicked], before);
                context.notify('EXTEND — Node extended to the nearest valid boundary. Continue or press ENTER/SPACE twice to finish.');
            } else {
                context.setPrompt('EXTEND — No boundary ahead of the picked node, or the click was not close enough to a node.');
            }
        },

        onEnter(context) {
            finishKeyCount += 1;
            if (finishKeyCount < 2) {
                context.setPrompt('EXTEND — Press ENTER/SPACE again to finish, or continue extending.');
                return;
            }
            boundaryTargets = [];
            context.finishCurrentTool();
        },

        onFinish(context) {
            boundaryTargets = [];
            finishKeyCount = 0;
            setPickbox(context, false);
        }
    });

    CAD.registerCommand({
        name: 'EXTEND', aliases: ['EX'],
        desc: 'Extend endpoints or polyline nodes to selected or nearest boundaries',
        category: 'modify',
        execute: () => CAD.createContext().setToolName('extend')
    });
})(window);
