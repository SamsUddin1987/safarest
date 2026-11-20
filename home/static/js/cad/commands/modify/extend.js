/**
 * SAFAR EDGE CAD - EXTEND
 * Extends selected line/polyline endpoints to unselected linework.
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;
    const Utils = global.CADModifyUtils;

    let targetObjects = [];

    CAD.registerTool('extend', {
        onStart(context) {
            targetObjects = Utils.selected(context, 'EXTEND');
            if (!targetObjects) {
                context.finishCurrentTool();
                return;
            }

            context.setPrompt(
                'EXTEND — Click near the endpoint of a selected line/polyline to extend. Unselected linework acts as boundaries. Press ENTER when done.'
            );
        },

        onClick(point, context) {
            const boundaries = context.getObjects().filter(
                object => !targetObjects.includes(object)
            );

            // Choose the selected entity whose endpoint is closest to the click.
            let chosenObject = null;
            let bestDistance = Infinity;

            targetObjects.forEach(object => {
                const points = Utils.pointFromGeometry(object);
                if (points.length < 2) return;

                const distance = Math.min(
                    points[0].distanceTo(point),
                    points[points.length - 1].distanceTo(point)
                );

                if (distance < bestDistance) {
                    bestDistance = distance;
                    chosenObject = object;
                }
            });

            let changed = false;
            if (chosenObject) {
                const before = context.captureObjects([chosenObject]);
                changed = Utils.extendAt(
                    context,
                    chosenObject,
                    point,
                    boundaries
                );
                if (changed) context.recordModify([chosenObject], before);
            }

            if (changed) {
                context.notify('EXTEND — Object extended. Continue or press ENTER.');
            } else {
                context.setPrompt('EXTEND — No valid boundary intersection found.');
            }
        },

        onEnter(context) {
            targetObjects = [];
            context.finishCurrentTool();
        },

        onFinish() {
            targetObjects = [];
        }
    });

    CAD.registerCommand({
        name: 'EXTEND',
        aliases: ['EX'],
        desc: 'Extend selected linework to unselected boundaries',
        category: 'modify',
        execute: () => CAD.createContext().setToolName('extend')
    });
})(window);
