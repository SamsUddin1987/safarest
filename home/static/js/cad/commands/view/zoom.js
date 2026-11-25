/* ZOOM helpers for the SafarEdge CAD viewport. */
(function (global) {
    'use strict';

    function zoomExtentsTracked() {
        if (global.CADView) {
            global.CADView.capture('zoom-extents', false);
        }

        if (typeof zoomExtents === 'function') {
            zoomExtents();
        }
    }

    function zoomAll() {
        if (typeof camera === 'undefined' || !camera) {
            return;
        }

        if (!sysLimits || !sysLimits.active) {
            zoomExtentsTracked();
            return;
        }

        let minX = sysLimits.minX;
        let minY = sysLimits.minY;
        let maxX = sysLimits.maxX;
        let maxY = sysLimits.maxY;

        // Include geometry extending beyond active drawing limits.
        if (
            Array.isArray(drawnObjects) &&
            typeof getWorldBounds === 'function'
        ) {
            drawnObjects.forEach(obj => {
                const b = getWorldBounds(obj);

                if (!b) return;

                minX = Math.min(minX, b.minX);
                minY = Math.min(minY, b.minY);
                maxX = Math.max(maxX, b.maxX);
                maxY = Math.max(maxY, b.maxY);
            });
        }

        const width = Math.max(maxX - minX, 1);
        const height = Math.max(maxY - minY, 1);

        const fit = Math.min(
            (camera.right - camera.left) / (width * 1.05),
            (camera.top - camera.bottom) / (height * 1.05)
        );

        global.CADView.capture('zoom-all', false);

        const minZoom = global.CADView ? global.CADView.MIN_ZOOM : 0.000001;
        const maxZoom = global.CADView ? global.CADView.MAX_ZOOM : 100;
        camera.zoom = Math.max(minZoom, Math.min(fit, maxZoom));

        camera.position.x = (minX + maxX) / 2;
        camera.position.y = (minY + maxY) / 2;

        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);

        if (typeof notify === 'function') {
            notify('Zoom All — drawing limits and geometry.');
        }
    }

    global.cadZoomExtents = zoomExtentsTracked;
    global.cadZoomAll = zoomAll;

})(window);