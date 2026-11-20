/**
 * SAFAR EDGE CAD - TRIM
 * Trims selected line/polyline targets against unselected linework.
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;
    const Utils = global.CADModifyUtils;

    let targetObjects = [];

    CAD.registerTool('trim', {
        onStart(context) {
            targetObjects = Utils.selected(context, 'TRIM');
            if (!targetObjects) {
                context.finishCurrentTool();
                return;
            }

            context.setPrompt(
                'TRIM — Click the portion of a selected line/polyline to remove. Unselected linework acts as cutting edges. Press ENTER when done.'
            );
        },

        onClick(point, context) {
            const boundaries = context.getObjects().filter(
                object => !targetObjects.includes(object)
            );

            // Work on the selected target nearest to the click.
            let chosenObject = null;
            let bestDistance = Infinity;

            targetObjects.forEach(object => {
                const points = Utils.pointFromGeometry(object);
                for (let i = 1; i < points.length; i++) {
                    const midpoint = points[i - 1].clone()
                        .add(points[i])
                        .multiplyScalar(0.5);
                    const distance = midpoint.distanceTo(point);

                    if (distance < bestDistance) {
                        bestDistance = distance;
                        chosenObject = object;
                    }
                }
            });

            let changed = false;
            if (chosenObject) {
                const before = context.captureObjects([chosenObject]);
                changed = Utils.trimAt(
                    context,
                    chosenObject,
                    point,
                    boundaries
                );
                if (changed) context.recordModify([chosenObject], before);
            }

            if (changed) {
                context.notify('TRIM — Object segment trimmed. Continue or press ENTER.');
            } else {
                context.setPrompt(
                    'TRIM — No intersection found. Click a target segment near a cutting edge.'
                );
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
        name: 'TRIM',
        aliases: ['TR'],
        desc: 'Trim selected linework to unselected boundaries',
        category: 'modify',
        execute: () => CAD.createContext().setToolName('trim')
    });
})(window);
