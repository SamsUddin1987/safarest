/**
 * SAFAR EDGE CAD - MIRROR
 * Mirrors selected entities about a line and asks whether to erase originals.
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;
    const Utils = global.CADModifyUtils;

    let sourceObjects = [];
    let firstPoint = null;
    let secondPoint = null;
    let awaitingEraseAnswer = false;

    function mirrorMatrix(THREE, pointA, pointB) {
        const angle = Math.atan2(pointB.y - pointA.y, pointB.x - pointA.x);
        return new THREE.Matrix4()
            .makeTranslation(pointA.x, pointA.y, 0)
            .multiply(new THREE.Matrix4().makeRotationZ(angle))
            .multiply(new THREE.Matrix4().makeScale(1, -1, 1))
            .multiply(new THREE.Matrix4().makeRotationZ(-angle))
            .multiply(new THREE.Matrix4().makeTranslation(-pointA.x, -pointA.y, 0));
    }

    function reset() {
        sourceObjects = [];
        firstPoint = null;
        secondPoint = null;
        awaitingEraseAnswer = false;
    }

    function completeMirror(eraseOriginals, context) {
        if (!sourceObjects.length || !firstPoint || !secondPoint) return;

        const matrix = mirrorMatrix(context.getThree(), firstPoint, secondPoint);
        const mirroredObjects = sourceObjects.map(source => {
            const copy = context.cloneObject(source);
            context.applyMatrix([copy], matrix);
            return copy;
        });

        // Record the two operations separately so existing undo/redo handlers
        // can reverse them in the correct order.
        if (eraseOriginals) {
            sourceObjects.forEach(object => {
                if (object.material && object.material.color) {
                    object.material.color.setHex(object.userData.originalColor || 0xffffff);
                }
                context.removeEntity(object);
            });
            undoStack.push({ type: 'delete', objs: [...sourceObjects] });
        }

        mirroredObjects.forEach(object => context.addEntity(object, false));
        undoStack.push({ type: 'add', objs: mirroredObjects });
        redoStack = [];

        context.clearSelection();
        context.notify(
            `MIRROR — ${mirroredObjects.length} mirrored object(s) created. ` +
            (eraseOriginals ? 'Original objects deleted.' : 'Original objects retained.')
        );
        reset();
        context.finishCurrentTool();
    }

    CAD.registerTool('mirror', {
        onStart(context) {
            sourceObjects = Utils.selected(context, 'MIRROR') || [];
            if (!sourceObjects.length) {
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

            if (!secondPoint) {
                if (point.distanceTo(firstPoint) < 1e-8) {
                    context.setPrompt('MIRROR — Mirror line must have a length. Specify another point:');
                    return;
                }
                secondPoint = point.clone();
                awaitingEraseAnswer = true;
                context.setPrompt('MIRROR — Delete source objects? [Yes/No] <No>:');
            }
        },

        onOption(value, context) {
            if (!awaitingEraseAnswer) return false;
            const answer = String(value || '').trim().toUpperCase();
            if (['Y', 'YES'].includes(answer)) {
                completeMirror(true, context);
                return true;
            }
            if (['N', 'NO'].includes(answer)) {
                completeMirror(false, context);
                return true;
            }
            context.setPrompt('MIRROR — Delete source objects? [Yes/No] <No>:');
            return true;
        },

        onEnter(context) {
            // AutoCAD default is No when the user simply presses Enter/Space.
            if (awaitingEraseAnswer) completeMirror(false, context);
        },

        onFinish() { reset(); }
    });

    CAD.registerCommand({
        name: 'MIRROR',
        aliases: ['MI'],
        desc: 'Mirror selected objects',
        category: 'modify',
        execute: () => CAD.createContext().setToolName('mirror')
    });
})(window);
