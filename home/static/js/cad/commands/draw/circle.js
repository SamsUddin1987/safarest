
/**
 * SAFAR EDGE CAD
 * Independent CIRCLE Command
 *
 * Features:
 * - Center point
 * - Radius input through cursor or coordinates
 * - Dynamic preview
 * - Circle creation
 */

(function (global) {
    'use strict';

    const CAD = global.CAD;
    const THREE = global.THREE;

    if (!CAD || !THREE) {
        throw new Error('CIRCLE: CAD Registry or Three.js unavailable.');
    }

    const SEGMENTS = 64;

    function circlePoints(center, radius) {

        const points = [];

        for (let i = 0; i <= SEGMENTS; i++) {

            const theta =
                (i / SEGMENTS) * Math.PI * 2;

            points.push(
                new THREE.Vector3(
                    center.x + Math.cos(theta) * radius,
                    center.y + Math.sin(theta) * radius,
                    0
                )
            );
        }

        return points;
    }

    function commit(center, radius, context) {

        const points = circlePoints(center, radius);

        const geometry =
            new THREE.BufferGeometry().setFromPoints(points);

        const material =
            new THREE.LineBasicMaterial({
                color: 0xffff00,
                linewidth: 2
            });

        const circle = new THREE.Line(geometry, material);

        circle.userData = {
            type: 'circle',
            center: center.clone(),
            radius: radius,
            originalColor: 0xffff00
        };

        context.addEntity(circle);

        return circle;
    }

    function onClick(point, context) {

        context.clearPreview();

        const state = context.getState();

        // Center point
        if (!state.isDrawing) {

            context.updateState({
                basePoint: point,
                currentPoints: [point],
                isDrawing: true,
                toolStep: 1
            });

            context.setPrompt(
                'CIRCLE — Specify radius:'
            );

            return;
        }

        // Radius
        const radius =
            state.basePoint.distanceTo(point);

        commit(state.basePoint, radius, context);

        // Keep CIRCLE command active
        context.setTool('circle');
    }

    function onPreview(point, context) {

        const state = context.getState();

        if (!state.isDrawing || !state.basePoint) return;

        const radius =
            state.basePoint.distanceTo(point);

        const points =
            circlePoints(state.basePoint, radius);

        const geometry =
            new THREE.BufferGeometry().setFromPoints(points);

        const material =
            new THREE.LineBasicMaterial({
                color: 0x00ffff,
                linewidth: 1.5
            });

        const preview = new THREE.Line(geometry, material);

        context.setPreview(preview);

        context.setPrompt(
            `CIRCLE — Radius: ${context.formatValue(radius)}`
        );
    }

    function onEnter(context) {

        const state = context.getState();

        if (state.isDrawing) {
            context.setTool('circle');
        } else {
            context.finishCurrentTool();
        }
    }

    CAD.registerTool('circle', {
        onClick: onClick,
        onPreview: onPreview,
        onEnter: onEnter
    });

    CAD.registerCommand({
        name: 'CIRCLE',
        aliases: ['C'],
        desc: 'Draw a circle (centre, radius)',
        category: 'draw',

        execute(context) {
            context.setTool('circle');
        }
    });

})(window);
