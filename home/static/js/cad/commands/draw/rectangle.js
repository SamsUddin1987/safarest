
/**
 * SAFAR EDGE CAD
 * Independent RECTANGLE Command
 *
 * Features:
 * - First corner
 * - Opposite corner
 * - Dynamic preview
 * - Width and height display
 * - Zero dimension validation
 */

(function (global) {
    'use strict';

    const CAD = global.CAD;
    const THREE = global.THREE;

    if (!CAD || !THREE) {
        throw new Error('RECTANGLE: CAD Registry or Three.js unavailable.');
    }

    function getDrawingAxes() {
        const frame = global.SafarEdge3D &&
            typeof global.SafarEdge3D.getDrawingFrame === 'function'
            ? global.SafarEdge3D.getDrawingFrame() : null;
        return frame || {
            u: new THREE.Vector3(1, 0, 0),
            v: new THREE.Vector3(0, 1, 0)
        };
    }

    function rectanglePoints(p1, p2) {
        const axes = getDrawingAxes();
        const delta = p2.clone().sub(p1);
        const width = delta.dot(axes.u);
        const height = delta.dot(axes.v);
        const p2u = p1.clone().addScaledVector(axes.u, width);
        const p2v = p1.clone().addScaledVector(axes.v, height);

        return [
            p1.clone(),
            p2u,
            p1.clone().addScaledVector(axes.u, width).addScaledVector(axes.v, height),
            p2v,
            p1.clone()
        ];
    }

    function commit(p1, p2, context) {

        const axes = getDrawingAxes();
        const delta = p2.clone().sub(p1);
        const width = delta.dot(axes.u);
        const height = delta.dot(axes.v);
        if (Math.abs(width) < 1e-9 || Math.abs(height) < 1e-9) {

            context.setPrompt(
                'RECTANG — Zero width or height, rectangle not created.'
            );

            return false;
        }

        const points = rectanglePoints(p1, p2);

        const geometry =
            new THREE.BufferGeometry().setFromPoints(points);

        const material =
            new THREE.LineBasicMaterial({
                color: 0xff9900,
                linewidth: 2
            });

        const rectangle = new THREE.Line(geometry, material);

        rectangle.userData = {
            type: 'rect',
            points: points,
            workPlane: getDrawingAxes().name || 'XY',
            originalColor: 0xff9900
        };

        context.addEntity(rectangle);

        return true;
    }

    function onClick(point, context) {

        context.clearPreview();

        const state = context.getState();

        // First corner
        if (!state.isDrawing) {

            context.updateState({
                basePoint: point,
                currentPoints: [point],
                isDrawing: true,
                toolStep: 1
            });

            context.setPrompt(
                'RECTANG — Pick opposite corner:'
            );

            return;
        }

        // Opposite corner
        commit(state.basePoint, point, context);

        // Keep RECTANGLE command active
        context.setTool('rect');
    }

    function onPreview(point, context) {

        const state = context.getState();

        if (!state.isDrawing || !state.basePoint) return;

        const points =
            rectanglePoints(state.basePoint, point);

        const geometry =
            new THREE.BufferGeometry().setFromPoints(points);

        const material =
            new THREE.LineBasicMaterial({
                color: 0x00ffff,
                linewidth: 1.5
            });

        const preview = new THREE.Line(geometry, material);

        context.setPreview(preview);

        const axes = getDrawingAxes();
        const delta = point.clone().sub(state.basePoint);
        const width = Math.abs(delta.dot(axes.u));
        const height = Math.abs(delta.dot(axes.v));

        context.setPrompt(
            `RECTANG — W: ${context.formatValue(width)}  H: ${context.formatValue(height)}`
        );
    }

    function onEnter(context) {

        const state = context.getState();

        if (state.isDrawing) {
            context.setTool('rect');
        } else {
            context.finishCurrentTool();
        }
    }

    CAD.registerTool('rect', {
        onClick: onClick,
        onPreview: onPreview,
        onEnter: onEnter
    });

    CAD.registerCommand({
        name: 'RECTANG',
        aliases: ['REC', 'RECTANGLE'],
        desc: 'Draw a rectangle',
        category: 'draw',

        execute(context) {
            context.setTool('rect');
        }
    });

})(window);
