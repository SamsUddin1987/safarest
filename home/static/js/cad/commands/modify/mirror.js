/**
 * SAFAR EDGE CAD - MIRROR
 * Mirrors selected entities about a line defined by two points.
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;
    const Utils = global.CADModifyUtils;

    let objects = [];
    let firstPoint = null;

    function mirrorMatrix(THREE, pointA, pointB) {
        const angle = Math.atan2(
            pointB.y - pointA.y,
            pointB.x - pointA.x
        );

        return new THREE.Matrix4()
            .makeTranslation(pointA.x, pointA.y, 0)
            .multiply(new THREE.Matrix4().makeRotationZ(angle))
            .multiply(new THREE.Matrix4().makeScale(1, -1, 1))
            .multiply(new THREE.Matrix4().makeRotationZ(-angle))
            .multiply(new THREE.Matrix4().makeTranslation(-pointA.x, -pointA.y, 0));
    }

    CAD.registerTool('mirror', {
        onStart(context) {
            objects = Utils.selected(context, 'MIRROR');
            if (!objects) {
                context.finishCurrentTool();
                return;
            }
            context.setPrompt('MIRROR — Specify first point of mirror line:');
        },

        onClick(point, context) {
            if (!firstPoint) {
                firstPoint = point.clone();
                context.updateState({ isDrawing: true, basePoint: firstPoint });
                context.setPrompt('MIRROR — Specify second point of mirror line:');
                return;
            }

            if (point.distanceTo(firstPoint) < 1e-8) {
                context.setPrompt('MIRROR — Mirror line must have a length.');
                return;
            }

            const before = context.captureObjects(objects);
            context.applyMatrix(
                objects,
                mirrorMatrix(context.getThree(), firstPoint, point)
            );
            context.recordModify(objects, before);
            context.notify(`Mirrored ${objects.length} object(s).`);

            objects = [];
            firstPoint = null;
            context.finishCurrentTool();
        },

        onFinish() {
            objects = [];
            firstPoint = null;
        }
    });

    CAD.registerCommand({
        name: 'MIRROR',
        aliases: ['MI'],
        desc: 'Mirror selected objects',
        category: 'modify',
        execute: () => CAD.createContext().setToolName('mirror')
    });
})(window);
