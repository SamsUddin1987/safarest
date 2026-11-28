
/**
 * SAFAR EDGE CAD
 * Independent POLYLINE Command
 *
 * Features:
 * - Continuous connected vertices
 * - Dynamic preview
 * - Close (C)
 * - Undo last vertex (U)
 * - Enter to finish
 * - Preserve completed vertices when leaving command
 */

(function (global) {
    'use strict';

    const CAD = global.CAD;
    const THREE = global.THREE;

    if (!CAD || !THREE) {
        throw new Error('POLYLINE: CAD Registry or Three.js unavailable.');
    }

    const PROMPT =
        'PLINE — Next point (C = Close, U = Undo, ENTER = finish):';

    function commit(points, context) {

        if (!Array.isArray(points) || points.length < 2) {
            return null;
        }

        // Work on a clean copy. A closed polyline is represented by one
        // THREE.Line entity; its segments are vertices of this entity, not
        // separate CAD measurement entities.
        const committedPoints = points.map(p => p.clone());
        const firstPoint = committedPoints[0];
        const lastPoint = committedPoints[committedPoints.length - 1];
        const closed = committedPoints.length > 2 &&
            firstPoint.distanceTo(lastPoint) <= 1e-7;

        // Remove consecutive duplicate vertices. This prevents a repeated
        // click at the closing point from creating a zero-length final edge.
        const cleanPoints = [];
        committedPoints.forEach(point => {
            if (!cleanPoints.length ||
                cleanPoints[cleanPoints.length - 1].distanceTo(point) > 1e-7) {
                cleanPoints.push(point);
            }
        });
        if (closed && cleanPoints.length > 2 &&
            cleanPoints[0].distanceTo(cleanPoints[cleanPoints.length - 1]) > 1e-7) {
            cleanPoints.push(cleanPoints[0].clone());
        }
        if (cleanPoints.length < 2) return null;

        const geometry =
            new THREE.BufferGeometry().setFromPoints(cleanPoints);

        const material =
            new THREE.LineBasicMaterial({
                color: 0x00ff00,
                linewidth: 2
            });

        const polyline = new THREE.Line(geometry, material);

        polyline.userData = {
            type: 'polyline',
            entityKind: 'polyline',
            points: cleanPoints,
            closed: closed,
            isClosed: closed,
            workPlane: global.SafarEdge3D
                ? global.SafarEdge3D.getWorkPlane()
                : 'XY',
            originalColor: 0x00ff00
        };

        context.addEntity(polyline);

        return polyline;
    }

    function onClick(point, context) {

        context.clearPreview();

        const state = context.getState();

        // First vertex
        if (!state.isDrawing) {

            context.updateState({
                basePoint: point,
                currentPoints: [point],
                isDrawing: true,
                toolStep: 1
            });

            context.setPrompt(PROMPT);

            return;
        }

        // Add subsequent vertex
        const points = [
            ...state.currentPoints,
            point.clone()
        ];

        context.updateState({
            currentPoints: points,
            basePoint: point
        });

        context.setPrompt(PROMPT);
    }

    function onPreview(point, context) {

        const state = context.getState();

        if (!state.isDrawing || state.currentPoints.length === 0) {
            return;
        }

        const points = [
            ...state.currentPoints,
            point.clone()
        ];

        const geometry =
            new THREE.BufferGeometry().setFromPoints(points);

        const material =
            new THREE.LineBasicMaterial({
                color: 0x00ffff,
                linewidth: 1.5
            });

        const preview = new THREE.Line(geometry, material);

        context.setPreview(preview);
    }

    function onOption(input, context) {

        const state = context.getState();

        if (!state.isDrawing) return false;

        const isClose =
            input === 'C' || input === 'CLOSE';

        const isUndo =
            input === 'U' || input === 'UNDO';

        // Close polyline
        if (isClose) {

            if (state.currentPoints.length > 2) {

                const points = [
                    ...state.currentPoints,
                    state.currentPoints[0].clone()
                ];

                // Reset before registering the closed entity so a later
                // finish callback cannot register this chain again.
                context.updateState({
                    currentPoints: [],
                    basePoint: null,
                    isDrawing: false,
                    toolStep: 0
                });
                commit(points, context);

                // Keep POLYLINE active, but clear the committed chain so
                // onFinish cannot commit the same vertices a second time.
                context.clearPreview();
                context.setPrompt('PLINE — Pick start point:');

            } else {

                context.writeHistory(
                    'PLINE — need at least 3 points to close.'
                );

            }

            return true;
        }

        // Undo last vertex
        if (isUndo) {

            const points = [...state.currentPoints];

            points.pop();

            if (points.length === 0) {

                context.updateState({
                    currentPoints: [],
                    basePoint: null,
                    isDrawing: false,
                    toolStep: 0
                });
                context.clearPreview();
                context.setPrompt('PLINE — Pick start point:');

            } else {

                context.updateState({
                    currentPoints: points,
                    basePoint: points[points.length - 1]
                });

                context.clearPreview();

                context.setPrompt(
                    'PLINE — Last vertex removed. Next point:'
                );
            }

            return true;
        }

        return false;
    }

    // ENTER behavior
    function onEnter(context) {

        const state = context.getState();

        if (state.currentPoints.length > 1) {

            // Clear the active chain BEFORE registering the entity. If the
            // command framework subsequently calls onFinish, it cannot commit
            // the same polyline a second time.
            const pointsToCommit = state.currentPoints.slice();
            context.updateState({
                currentPoints: [],
                basePoint: null,
                isDrawing: false,
                toolStep: 0
            });
            commit(pointsToCommit, context);
            context.clearPreview();
            context.setPrompt('PLINE — Pick start point:');

        } else if (state.isDrawing) {

            // Discard incomplete first point but keep command active.
            context.updateState({
                currentPoints: [],
                basePoint: null,
                isDrawing: false,
                toolStep: 0
            });
            context.clearPreview();
            context.setPrompt('PLINE — Pick start point:');

        } else {

            context.finishCurrentTool();

        }
    }

    // Called when another command starts or ESC is pressed.
    function onFinish(context) {

        const state = context.getState();
        const pointsToCommit = state.isDrawing && state.currentPoints.length > 1
            ? state.currentPoints.slice()
            : [];

        // Always reset first. Tool finish may be triggered through multiple
        // command-exit paths; a second invocation must never register the
        // same vertex chain again.
        context.updateState({
            currentPoints: [],
            basePoint: null,
            isDrawing: false,
            toolStep: 0
        });
        context.clearPreview();

        if (pointsToCommit.length > 1) {
            commit(pointsToCommit, context);
        }
    }

    CAD.registerTool('polyline', {
        onClick: onClick,
        onPreview: onPreview,
        onOption: onOption,
        onEnter: onEnter,
        onFinish: onFinish
    });

    CAD.registerCommand({
        name: 'PLINE',
        aliases: ['PL'],
        desc: 'Draw a 2D polyline',
        category: 'draw',

        execute(context) {
            context.setTool('polyline');
        }
    });

})(window);
