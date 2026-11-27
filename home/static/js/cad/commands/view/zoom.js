/* ZOOM helpers for the SafarEdge CAD viewport. */
(function (global) {
    'use strict';

    function zoomExtentsTracked() {
        if (global.CADView) {
            global.CADView.capture('zoom-extents', false);
        }

        if (global.SafarEdge3D && typeof global.SafarEdge3D.fitModel === 'function') {
            global.SafarEdge3D.fitModel();
        } else if (typeof zoomExtents === 'function') {
            zoomExtents();
        }
    }

    function zoomAll() {
        if (typeof camera === 'undefined' || !camera) return;

        if (global.CADView) global.CADView.capture('zoom-all', false);

        // Zoom All must frame the complete 3D model in the current camera
        // orientation. The old implementation changed only camera X/Y and
        // therefore failed in ISO and side views.
        if (global.SafarEdge3D && typeof global.SafarEdge3D.fitModel === 'function') {
            let limitsBounds = null;
            if (sysLimits && sysLimits.active && global.THREE) {
                limitsBounds = new global.THREE.Box3(
                    new global.THREE.Vector3(sysLimits.minX, sysLimits.minY, -1),
                    new global.THREE.Vector3(sysLimits.maxX, sysLimits.maxY, 1)
                );
            }
            global.SafarEdge3D.fitModel(limitsBounds || undefined);
            if (typeof notify === 'function') {
                notify('Zoom All — all visible model objects fit to the viewport.');
            }
            return;
        }

        // Compatibility fallback for the original 2D-only viewport.
        if (typeof zoomExtents === 'function') zoomExtents();
        if (typeof notify === 'function') notify('Zoom All — drawing extents.');
    }

    global.cadZoomExtents = zoomExtentsTracked;
    global.cadZoomAll = zoomAll;

})(window);