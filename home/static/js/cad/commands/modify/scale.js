/**
 * SAFAR EDGE CAD - SCALE
 * Scales selected entities about a specified base point.
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;
    const Utils = global.CADModifyUtils;

    let objects = [];
    let basePoint = null;

    function scaleMatrix(THREE, point, factor) {
        return new THREE.Matrix4()
            .makeTranslation(point.x, point.y, 0)
            .multiply(new THREE.Matrix4().makeScale(factor, factor, 1))
            .multiply(new THREE.Matrix4().makeTranslation(-point.x, -point.y, 0));
    }

    function applyScale(factor, context) {
        if (!Number.isFinite(factor) || factor <= 0) {
            context.setPrompt('SCALE — Enter a positive scale factor.');
            return;
        }

        const before = context.captureObjects(objects);
        context.applyMatrix(
            objects,
            scaleMatrix(context.getThree(), basePoint, factor)
        );
        context.recordModify(objects, before);
        context.notify(`Scaled ${objects.length} object(s) by ${factor}.`);

        objects = [];
        basePoint = null;
        context.finishCurrentTool();
    }

    CAD.registerTool('scale', {
        onStart(context) {
            objects = Utils.selected(context, 'SCALE');
            if (!objects) {
                context.finishCurrentTool();
                return;
            }
            context.setPrompt('SCALE — Specify base point:');
        },

        onClick(point, context) {
            if (!basePoint) {
                basePoint = point.clone();
                context.updateState({ isDrawing: true, basePoint });
                context.setPrompt(
                    'SCALE — Type a positive scale factor, or pick a point to use its distance from the base:'
                );
                return;
            }

            applyScale(point.distanceTo(basePoint), context);
        },

        onOption(value, context) {
            const factor = Number(value);
            if (!Number.isFinite(factor)) return false;

            if (!basePoint) {
                context.setPrompt('SCALE — Specify base point first.');
                return true;
            }

            applyScale(factor, context);
            return true;
        },

        onFinish() {
            objects = [];
            basePoint = null;
        }
    });

    CAD.registerCommand({
        name: 'SCALE',
        aliases: ['SC'],
        desc: 'Scale selected objects',
        category: 'modify',
        execute: () => CAD.createContext().setToolName('scale')
    });
})(window);
