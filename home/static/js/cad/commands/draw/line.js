
/**
 * SAFAR EDGE CAD
 * Independent LINE Command
 *
 * Responsibilities:
 * - Start LINE command through registry
 * - Handle first and subsequent points
 * - Create line entities
 * - Generate dynamic preview
 * - Handle CLOSE and UNDO options
 * - Restore line continuation after undo
 */

(function (global) {

    'use strict';

    const CAD = global.CAD;
    const THREE = global.THREE;

    if (!CAD || !THREE) {
        throw new Error('LINE: CAD Registry or Three.js unavailable.');
    }


    // =====================================
    // CREATE LINE ENTITY
    // =====================================

    function commit(p1, p2, context) {

        const geometry =
            new THREE.BufferGeometry().setFromPoints([p1, p2]);

        const material =
            new THREE.LineBasicMaterial({
                color: 0xffffff,
                linewidth: 2
            });

        const line = new THREE.Line(geometry, material);

        line.userData = {
            type: 'line',
            workPlane: global.SafarEdge3D
                ? global.SafarEdge3D.getWorkPlane()
                : 'XY',
            originalColor: 0xffffff
        };

        context.addEntity(line);

        return line;

    }

    // =====================================
    // DYNAMIC PREVIEW
    // =====================================

    function onPreview(point, context) {

        const state = context.getState();

        if (!state.basePoint) return;

        const geometry =
            new THREE.BufferGeometry().setFromPoints([
                state.basePoint,
                point
            ]);

        const material =
            new THREE.LineBasicMaterial({
                color: 0x00ffff,
                linewidth: 1.5
            });

        const preview = new THREE.Line(
            geometry,
            material
        );

        context.setPreview(preview);

        context.setPrompt(
            `LINE — Dist: ${context.formatValue(
                state.basePoint.distanceTo(point)
            )}`
        );

    }


    // =====================================
    // CLOSE / UNDO OPTIONS
    // =====================================

    function onOption(input, context) {

        const state = context.getState();

        if (!state.isDrawing) return false;

        const isClose =
            input === 'C' || input === 'CLOSE';

        const isUndo =
            input === 'U' || input === 'UNDO';


        // CLOSE LINE CHAIN
        if (isClose) {

            if (
                state.lineChainStart &&
                state.lineSegCount > 1
            ) {

                commit(
                    state.basePoint,
                    state.lineChainStart,
                    context
                );

            } else {

                context.writeHistory(
                    'LINE — need at least 2 segments to close.'
                );

            }

            context.setTool('line');

            return true;
        }


        // UNDO LAST LINE SEGMENT
        if (isUndo) {

            if (state.lineSegCount > 0) {

                // afterUndo() will restore the point
                // and decrement the segment count.
                context.undo();

            } else {

                context.setTool('line');

            }

            return true;
        }

        return false;
    }


    // =====================================
    // RESTORE STATE AFTER UNDO
    // =====================================

    function onClick(point, context) {

        // Remove the previous temporary preview.
        context.clearPreview();

        const state = context.getState();

        // First point
        if (!state.isDrawing) {

            context.updateState({

                basePoint: point,
                currentPoints: [point],
                lineChainStart: point,
                lineSegCount: 0,
                isDrawing: true,
                toolStep: 1

            });

            context.setPrompt(
                'LINE — Specify next point (C = Close, U = Undo):'
            );

            return;
        }

        // Subsequent point
        commit(state.basePoint, point, context);

        context.updateState({

            basePoint: point,
            lineSegCount: state.lineSegCount + 1

        });

        context.setPrompt(
            'LINE — Specify next point (C = Close, U = Undo):'
        );

    }

    // =====================================
    // RESTORE STATE AFTER UNDO
    // =====================================

    function afterUndo(action, context) {

        const state = context.getState();

        if (
            state.currentTool !== 'line' ||
            !state.isDrawing
        ) {
            return;
        }

        const object =
            action &&
            action.objs &&
            action.objs[0];

        if (
            !object ||
            !object.geometry ||
            !object.userData ||
            object.userData.type !== 'line'
        ) {
            return;
        }

        const position = object.geometry.attributes.position;

        if (!position || position.count < 2) return;

        const previousPoint = new THREE.Vector3(
            position.getX(0),
            position.getY(0),
            0
        );

        context.updateState({

            basePoint: previousPoint,

            lineSegCount: Math.max(
                0,
                state.lineSegCount - 1
            )

        });

        context.clearPreview();

        context.setPrompt(
            'LINE — Specify next point (C = Close, U = Undo):'
        );

    }

    // =====================================
    // REGISTER LINE TOOL
    // =====================================

    CAD.registerTool('line', {

        onClick: onClick,

        onPreview: onPreview,

        onOption: onOption,

        afterUndo: afterUndo

    });


    // =====================================
    // REGISTER LINE COMMAND
    // =====================================

    CAD.registerCommand({

        name: 'LINE',

        aliases: ['L'],

        desc: 'Draw straight line segments',

        category: 'draw',

        execute(context) {

            context.setTool('line');

        }

    });

})(window);
