/* SAFAR EDGE CAD — view navigation and previous-view history.
 * Original implementation for this application's Three.js camera.
 */
(function (global) {
    'use strict';

    const history = [];
    const MAX_HISTORY = 30;
    const MIN_ZOOM = 0.000001; // Allows very large drawings to fit on screen.
    const MAX_ZOOM = 100;
    let lastCaptureAt = 0;

    function getCamera() {
        return typeof camera !== 'undefined' ? camera : null;
    }

    // renderer is declared with `let` in cad-core.js, so it is not
    // available as window.renderer. Read the shared script binding instead.
    function getRenderer() {

        // First try the original Three.js renderer.
        if (
            typeof renderer !== 'undefined' &&
            renderer &&
            renderer.domElement
        ) {
            return renderer;
        }

        // Fallback: find the actual CAD canvas.
        const canvas = document.querySelector(
            '#cad-canvas-container canvas'
        );

        if (canvas) {
            return {
                domElement: canvas
            };
        }

        return null;
    }

    function snapshot() {
        const cam = getCamera();
        if (!cam) return null;

        return {
            x: cam.position.x,
            y: cam.position.y,
            z: cam.position.z,
            zoom: cam.zoom
        };
    }

    function sameView(a, b) {
        return a && b &&
            Math.abs(a.x - b.x) < 1e-8 &&
            Math.abs(a.y - b.y) < 1e-8 &&
            Math.abs(a.zoom - b.zoom) < 1e-8;
    }

    function capture(label, grouped) {
        const view = snapshot();
        if (!view) return;

        const now = Date.now();

        if (grouped && now - lastCaptureAt < 250) {
            lastCaptureAt = now;
            return;
        }

        const previous = history[history.length - 1];

        if (!sameView(previous, view)) {
            history.push(view);

            if (history.length > MAX_HISTORY) {
                history.shift();
            }
        }

        lastCaptureAt = now;
    }

    function apply(view) {
        const cam = getCamera();
        if (!cam || !view) return false;

        cam.position.set(view.x, view.y, view.z);
        cam.zoom = Math.max(
            MIN_ZOOM,
            Math.min(Number(view.zoom) || 1, MAX_ZOOM)
        );

        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);

        return true;
    }

    function previous() {
        const current = snapshot();

        if (!current || !history.length) {
            if (typeof notify === 'function') {
                notify('ZOOM PREVIOUS — No previous view.');
            }
            return false;
        }

        const target = history.pop();

        apply(target);

        if (typeof notify === 'function') {
            notify('Previous view restored.');
        }

        return true;
    }

    function zoomAt(clientX, clientY, factor, grouped) {
        const cam = getCamera();
        const activeRenderer = getRenderer();

        if (!cam || !activeRenderer || !activeRenderer.domElement) return false;

        const rect = activeRenderer.domElement.getBoundingClientRect();

        if (!rect.width || !rect.height) return false;

        const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

        const halfW = (cam.right - cam.left) / 2;
        const halfH = (cam.top - cam.bottom) / 2;

        const oldZoom = cam.zoom || 1;

        const worldX = cam.position.x + (ndcX * halfW) / oldZoom;
        const worldY = cam.position.y + (ndcY * halfH) / oldZoom;

        const newZoom = Math.max(
            MIN_ZOOM,
            Math.min(oldZoom * factor, MAX_ZOOM)
        );

        if (Math.abs(newZoom - oldZoom) < 1e-10) {
            return false;
        }

        capture('zoom', !!grouped);

        cam.zoom = newZoom;

        cam.position.x = worldX - (ndcX * halfW) / newZoom;
        cam.position.y = worldY - (ndcY * halfH) / newZoom;

        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);

        return true;
    }

    function zoomBy(factor) {
        const cam = getCamera();

        if (!cam || !Number.isFinite(factor) || factor <= 0) {
            return false;
        }

        capture('zoom-scale', false);

        cam.zoom = Math.max(
            MIN_ZOOM,
            Math.min(cam.zoom * factor, MAX_ZOOM)
        );

        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);

        return true;
    }

    function zoomToWindow(p1, p2) {
        const cam = getCamera();

        if (!cam || !p1 || !p2) return false;

        const width = Math.max(Math.abs(p2.x - p1.x), 1e-6);
        const height = Math.max(Math.abs(p2.y - p1.y), 1e-6);

        const fit = Math.min(
            (cam.right - cam.left) / width,
            (cam.top - cam.bottom) / height
        );

        capture('zoom-window', false);

        cam.zoom = Math.max(MIN_ZOOM, Math.min(fit, MAX_ZOOM));

        cam.position.x = (p1.x + p2.x) / 2;
        cam.position.y = (p1.y + p2.y) / 2;

        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);

        if (typeof notify === 'function') {
            notify('Zoom Window.');
        }

        return true;
    }

    function zoomCenter(point, viewHeight) {
        const cam = getCamera();

        if (!cam || !point) return false;

        const height = Number(viewHeight);

        if (!Number.isFinite(height) || height <= 0) {
            return false;
        }

        capture('zoom-center', false);

        const currentWorldHeight = (cam.top - cam.bottom) / cam.zoom;

        cam.zoom = Math.max(
            MIN_ZOOM,
            Math.min((cam.top - cam.bottom) / height, MAX_ZOOM)
        );

        cam.position.x = point.x;
        cam.position.y = point.y;

        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);

        return Number.isFinite(currentWorldHeight);
    }

    global.CADView = Object.freeze({
        capture,
        apply,
        previous,
        zoomAt,
        zoomBy,
        zoomToWindow,
        zoomCenter,
        getHistoryLength: () => history.length,
        MIN_ZOOM,
        MAX_ZOOM
    });

})(window);