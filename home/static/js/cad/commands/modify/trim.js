/**
 * SAFAR EDGE CAD - TRIM
 * AutoCAD-style workflow: optional preselected cutting edges, then click
 * the segment to remove. With no preselection, every other entity is a
 * candidate cutting edge.
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;
    const Utils = global.CADModifyUtils;
    let cuttingEdges = [];
    let finishKeyCount = 0;

    // Small pickbox only: deliberately no crosshair projection lines.
    const PICKBOX_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Crect x='1' y='1' width='10' height='10' fill='none' stroke='%23ffffff' stroke-width='1.2'/%3E%3C/svg%3E") 6 6, default`;

    function setPickbox(context, enabled) {
        if (global.SafarEdgeCadCursor && typeof global.SafarEdgeCadCursor.setMode === 'function') {
            global.SafarEdgeCadCursor.setMode(enabled ? 'trim' : 'select');
            return;
        }
        const renderer = context.getRenderer();
        if (renderer && renderer.domElement) {
            renderer.domElement.style.cursor = enabled ? PICKBOX_CURSOR : '';
        }
    }

    CAD.registerTool('trim', {
        onStart(context) {
            cuttingEdges = context.getSelectedObjects();
            finishKeyCount = 0;
            setPickbox(context, true);
            context.setPrompt(cuttingEdges.length
                ? 'TRIM — Selected objects are cutting edges. Click the portion of another object to remove. ENTER/SPACE twice to finish.'
                : 'TRIM — Click the portion of an object to remove. Other objects act as cutting edges. ENTER/SPACE twice to finish.');
        },

        onClick(point, context) {
            finishKeyCount = 0;
            const selectedEdges = cuttingEdges.filter(object => context.getObjects().includes(object));
            const clicked = context.getObjectAtPointer() ||
                Utils.findObjectAtPoint(context, point, selectedEdges);

            if (!clicked || selectedEdges.includes(clicked)) {
                context.setPrompt('TRIM — Click a target segment, not a cutting edge.');
                return;
            }

            const boundaries = selectedEdges.length
                ? selectedEdges
                : context.getObjects().filter(object => object !== clicked);

            if (!boundaries.length) {
                context.setPrompt('TRIM — No cutting edges are available. Draw or select a boundary first.');
                return;
            }

            const before = context.captureObjects([clicked]);
            const changed = Utils.trimAt(context, clicked, point, boundaries);
            if (changed) {
                context.recordModify([clicked], before);
                context.notify('TRIM — Segment trimmed. Continue or press ENTER/SPACE twice to finish.');
            } else {
                context.setPrompt('TRIM — No intersection found on this segment.');
            }
        },

        onEnter(context) {
            finishKeyCount += 1;
            if (finishKeyCount < 2) {
                context.setPrompt('TRIM — Press ENTER/SPACE again to finish, or continue trimming.');
                return;
            }
            cuttingEdges = [];
            context.finishCurrentTool();
        },

        onFinish(context) {
            cuttingEdges = [];
            finishKeyCount = 0;
            setPickbox(context, false);
        }
    });

    CAD.registerCommand({
        name: 'TRIM', aliases: ['TR'],
        desc: 'Trim geometry using selected or automatically detected cutting edges',
        category: 'modify',
        execute: () => CAD.createContext().setToolName('trim')
    });
})(window);
