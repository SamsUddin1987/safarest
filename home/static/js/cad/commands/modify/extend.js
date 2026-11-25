/**
 * SAFAR EDGE CAD - EXTEND
 *
 * Required command flow:
 *   EX + ENTER          -> Boundary-pick mode: click one boundary, then click
 *                          the object/endpoint to extend to that boundary.
 *   EX + ENTER + ENTER  -> Quick mode: extend to the first boundary ahead.
 *
 * In boundary-pick mode the boundary remains highlighted until the extension
 * succeeds (or the command is cancelled). It is then restored automatically.
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;
    const Utils = global.CADModifyUtils;

    const PHASE = {
        PICK_BOUNDARY: 'pick-boundary',
        PICK_SOURCE: 'pick-source',
        QUICK: 'quick'
    };

    let phase = PHASE.PICK_BOUNDARY;
    let boundaryTarget = null;
    let changedCount = 0;

    const PICKBOX_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Crect x='1' y='1' width='10' height='10' fill='none' stroke='%23ffffff' stroke-width='1.2'/%3E%3C/svg%3E") 6 6, default`;

    function setPickbox(context, enabled) {
        if (global.SafarEdgeCadCursor && typeof global.SafarEdgeCadCursor.setMode === 'function') {
            global.SafarEdgeCadCursor.setMode(enabled ? 'extend' : 'select');
            return;
        }
        const renderer = context.getRenderer();
        if (renderer && renderer.domElement) {
            renderer.domElement.style.cursor = enabled ? PICKBOX_CURSOR : '';
        }
    }

    function isLive(object, context) {
        return !!object && context.getObjects().includes(object);
    }

    function isExtendable(object) {
        return !!(
            object && object.userData &&
            ['line', 'polyline', 'rect'].includes(object.userData.type)
        );
    }

    function getTargetAtPointer(context, excluded = []) {
        const hits = typeof context.getObjectsAtPointer === 'function'
            ? context.getObjectsAtPointer()
            : [context.getObjectAtPointer()];
        return hits.find(object =>
            object && !excluded.includes(object) && isExtendable(object)
        ) || null;
    }

    function highlightBoundary(object) {
        if (object && global.CADVisualState &&
            typeof global.CADVisualState.apply === 'function') {
            global.CADVisualState.apply(object, 'boundary');
        }
    }

    function restoreBoundary() {
        if (!boundaryTarget) return;
        if (global.CADVisualState &&
            typeof global.CADVisualState.clearBoundary === 'function') {
            global.CADVisualState.clearBoundary(boundaryTarget);
        } else if (global.CADVisualState &&
            typeof global.CADVisualState.apply === 'function') {
            global.CADVisualState.apply(boundaryTarget, 'normal');
        }
        boundaryTarget = null;
    }

    function finish(context) {
        restoreBoundary();
        setPickbox(context, false);
        context.finishCurrentTool();
    }

    function notifyFinished(context, count) {
        finish(context);
        context.notify(count
            ? `EXTEND — Finished. ${count} object(s) modified.`
            : 'EXTEND — Finished. No objects modified.');
    }

    CAD.registerTool('extend', {
        onStart(context) {
            phase = PHASE.PICK_BOUNDARY;
            boundaryTarget = null;
            changedCount = 0;
            setPickbox(context, true);
            context.setPrompt(
                'EXTEND — Select a boundary object, or press ENTER again for automatic first-boundary mode.'
            );
        },

        onClick(point, context) {
            if (phase === PHASE.PICK_BOUNDARY) {
                const pickedBoundary = getTargetAtPointer(context);
                if (!pickedBoundary) {
                    context.setPrompt('EXTEND — Select a LINE, POLYLINE or RECTANGLE as the boundary.');
                    return;
                }

                boundaryTarget = pickedBoundary;
                highlightBoundary(boundaryTarget);
                phase = PHASE.PICK_SOURCE;
                context.setPrompt(
                    'EXTEND — Boundary selected and highlighted. Click anywhere on the LINE/POLYLINE/RECTANGLE to extend it toward this boundary.'
                );
                return;
            }

            if (phase === PHASE.PICK_SOURCE) {
                if (!boundaryTarget || !isLive(boundaryTarget, context)) {
                    restoreBoundary();
                    phase = PHASE.PICK_BOUNDARY;
                    context.setPrompt('EXTEND — Boundary is no longer available. Select a boundary object.');
                    return;
                }

                const source = getTargetAtPointer(context, [boundaryTarget]);
                if (!source) {
                    context.setPrompt('EXTEND — Click the object/endpoint to extend. The selected boundary remains highlighted.');
                    return;
                }

                const before = context.captureObjects([source]);
                const tolerance = context.getPickTolerance
                    ? context.getPickTolerance(20)
                    : undefined;
                const changed = Utils.extendAt(
                    context,
                    source,
                    point,
                    [boundaryTarget],
                    tolerance,
                    { preferFarthest: true }
                );

                if (!changed) {
                    context.setPrompt('EXTEND — No valid intersection with the selected boundary in that direction. Click the source object again to retry. The boundary remains highlighted.');
                    return;
                }

                context.recordModify([source], before);
                changedCount += 1;
                // The selected target is temporary; restore its original
                // appearance and finish this one-target EXTEND operation.
                notifyFinished(context, changedCount);
                return;
            }

            if (phase === PHASE.QUICK) {
                const source = getTargetAtPointer(context);
                if (!source) {
                    context.setPrompt('EXTEND — Select an object/endpoint to extend, or press ENTER to finish.');
                    return;
                }

                const boundaries = context.getObjects().filter(object =>
                    object !== source && isExtendable(object)
                );
                if (!boundaries.length) {
                    context.setPrompt('EXTEND — No other eligible boundary objects are available.');
                    return;
                }

                const before = context.captureObjects([source]);
                const tolerance = context.getPickTolerance
                    ? context.getPickTolerance(20)
                    : undefined;
                const changed = Utils.extendAt(
                    context,
                    source,
                    point,
                    boundaries,
                    tolerance,
                    { preferFarthest: false }
                );

                if (changed) {
                    context.recordModify([source], before);
                    changedCount += 1;
                    context.setPrompt(`EXTEND — Extended to first boundary. ${changedCount} object(s) modified. Select another object or press ENTER to finish.`);
                } else {
                    context.setPrompt('EXTEND — No valid boundary ahead on the clicked side. Click the source object again to retry.');
                }
            }
        },

        onEnter(context) {
            if (phase === PHASE.PICK_BOUNDARY) {
                // A second ENTER with no boundary selected explicitly chooses
                // quick mode. Quick mode uses the first valid boundary only.
                phase = PHASE.QUICK;
                context.setPrompt('EXTEND — Automatic mode. Click an object/endpoint to extend to the first boundary ahead. Press ENTER to finish.');
                return;
            }

            if (phase === PHASE.PICK_SOURCE) {
                // Do not silently discard an accepted, highlighted boundary.
                // ENTER cancels this one-target operation and restores it.
                notifyFinished(context, changedCount);
                return;
            }

            if (phase === PHASE.QUICK) {
                notifyFinished(context, changedCount);
            }
        },

        onFinish(context) {
            restoreBoundary();
            setPickbox(context, false);
            phase = PHASE.PICK_BOUNDARY;
            changedCount = 0;
        }
    });

    CAD.registerCommand({
        name: 'EXTEND',
        aliases: ['EX'],
        desc: 'AutoCAD-style EXTEND',
        category: 'modify',
        execute: () => CAD.createContext().setToolName('extend')
    });

})(window);
