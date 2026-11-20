/**
 * SAFAR EDGE CAD - ROTATE
 * Rotates selected entities around a specified base point.
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;
    const Utils = global.CADModifyUtils;

    let objects = [];
    let basePoint = null;

    function rotationMatrix(THREE, point, angle) {
        return new THREE.Matrix4()
            .makeTranslation(point.x, point.y, 0)
            .multiply(new THREE.Matrix4().makeRotationZ(angle))
            .multiply(new THREE.Matrix4().makeTranslation(-point.x, -point.y, 0));
    }

    function applyRotation(angle, context) {
        const before = context.captureObjects(objects);
        context.applyMatrix(
            objects,
            rotationMatrix(context.getThree(), basePoint, angle)
        );
        context.recordModify(objects, before);
        context.notify(
            `Rotated ${objects.length} object(s) by ${(angle * 180 / Math.PI).toFixed(2)}°.`
        );
        objects = [];
        basePoint = null;
        context.finishCurrentTool();
    }

    CAD.registerTool('rotate', {
        onStart(context) {
            objects = Utils.selected(context, 'ROTATE');
            if (!objects) {
                context.finishCurrentTool();
                return;
            }
            context.setPrompt('ROTATE — Specify base point:');
        },

        onClick(point, context) {
            if (!basePoint) {
                basePoint = point.clone();
                context.updateState({ isDrawing: true, basePoint });
                context.setPrompt(
                    'ROTATE — Pick a point to set the angle, or type an angle in degrees:'
                );
                return;
            }

            const angle = Math.atan2(
                point.y - basePoint.y,
                point.x - basePoint.x
            );
            applyRotation(angle, context);
        },

        onOption(value, context) {
            const degrees = Number(value);
            if (!Number.isFinite(degrees)) return false;

            if (!basePoint) {
                context.setPrompt('ROTATE — Specify base point first.');
                return true;
            }

            applyRotation(degrees * Math.PI / 180, context);
            return true;
        },

        onFinish() {
            objects = [];
            basePoint = null;
        }
    });

    CAD.registerCommand({
        name: 'ROTATE',
        aliases: ['RO'],
        desc: 'Rotate selected objects',
        category: 'modify',
        execute: () => CAD.createContext().setToolName('rotate')
    });
})(window);
