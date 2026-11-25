
/**
 * SAFAR EDGE CAD - EXTEND
 * AutoCAD-style selection workflow.
 *
 * QUICK MODE:
 * EX + Enter -> Click objects to extend -> Enter to finish.
 *
 * STANDARD-STYLE MODE:
 * Preselect boundary objects -> EX + Enter
 * -> Enter to accept boundaries
 * -> Click objects to extend -> Enter to finish.
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;
    const Utils = global.CADModifyUtils;

    let boundaryTargets = [];
    let standardBoundariesAccepted = false;
    let changedCount = 0;

    const PICKBOX_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Crect x='1' y='1' width='10' height='10' fill='none' stroke='%23ffffff' stroke-width='1.2'/%3E%3C/svg%3E") 6 6, default`;

    function setPickbox(context, enabled) {
        const renderer = context.getRenderer();
        if (renderer && renderer.domElement) {
            renderer.domElement.style.cursor =
                enabled ? PICKBOX_CURSOR : '';
        }
    }

    function isLive(object, context) {
        return !!object && context.getObjects().includes(object);
    }

    function isExtendable(object) {
        return !!(
            object &&
            object.userData &&
            ['line', 'polyline', 'rect'].includes(
                object.userData.type
            )
        );
    }

    function getTargetAtPointer(context, excluded) {
        if (typeof context.getObjectsAtPointer === 'function') {
            return context.getObjectsAtPointer().find(object =>
                !excluded.includes(object) &&
                isExtendable(object)
            ) || null;
        }

        const object = context.getObjectAtPointer();

        return object &&
            !excluded.includes(object) &&
            isExtendable(object)
                ? object
                : null;
    }

    function finish(context) {
        boundaryTargets = [];
        standardBoundariesAccepted = false;
        setPickbox(context, false);
        context.finishCurrentTool();
    }

    CAD.registerTool('extend', {

        onStart(context) {

            // Preselected objects are explicit boundary edges.
            boundaryTargets = context.getSelectedObjects()
                .filter(object =>
                    isLive(object, context) &&
                    isExtendable(object)
                );

            standardBoundariesAccepted =
                boundaryTargets.length === 0;

            changedCount = 0;

            setPickbox(context, true);

            if (boundaryTargets.length) {

                context.setPrompt(
                    `EXTEND — ${boundaryTargets.length} boundary object(s) preselected and highlighted. They remain the active boundaries until EXTEND finishes. Press ENTER to accept, then select objects to extend.`
                );

            } else {

                context.setPrompt(
                    'EXTEND — QUICK mode: Select objects to extend. All other eligible objects are potential boundaries. Press ENTER to finish.'
                );

            }
        },

        onClick(point, context) {

            // Standard mode requires ENTER to accept boundaries first.
            if (!standardBoundariesAccepted) {

                context.setPrompt(
                    'EXTEND — Press ENTER to accept the highlighted boundary objects before selecting objects to extend.'
                );

                return;
            }

            const liveBoundaries = boundaryTargets.filter(
                object => isLive(object, context)
            );

            const clicked = getTargetAtPointer(
                context,
                liveBoundaries
            );

            if (!clicked) {

                context.setPrompt(
                    'EXTEND — Select a LINE, POLYLINE or RECTANGLE near the endpoint/vertex to extend. Press ENTER to finish.'
                );

                return;
            }

            // Quick mode: all other eligible entities are boundaries.
            // Standard mode: only accepted boundary entities are used.
            const boundaries = liveBoundaries.length
                ? liveBoundaries
                : context.getObjects().filter(object =>
                    object !== clicked &&
                    isExtendable(object)
                );

            if (!boundaries.length) {

                context.setPrompt(
                    'EXTEND — No valid boundary objects are available.'
                );

                return;
            }

            const before = context.captureObjects([clicked]);

            const tolerance = context.getPickTolerance
                ? context.getPickTolerance(20)
                : undefined;

            const changed = Utils.extendAt(
                context,
                clicked,
                point,
                boundaries,
                tolerance
            );

            if (changed) {

                context.recordModify([clicked], before);

                changedCount += 1;

                context.setPrompt(
                    liveBoundaries.length
                        ? `EXTEND — Extended to selected boundary. ${changedCount} object(s) modified. Select another object or press ENTER to finish.`
                        : `EXTEND — Extended to first valid boundary. ${changedCount} object(s) modified. Select another object or press ENTER to finish.`
                );

            } else {

                context.setPrompt(
                    'EXTEND — No valid boundary in the picked direction. Select nearer the endpoint and try again, or press ENTER to finish.'
                );

            }
        },

        onEnter(context) {

            // First ENTER accepts preselected Standard-mode boundaries.
            if (
                boundaryTargets.length &&
                !standardBoundariesAccepted
            ) {

                standardBoundariesAccepted = true;

                context.setPrompt(
                    'EXTEND — Boundary edges accepted and retained. Select objects/endpoints to extend. Press ENTER to finish.'
                );

                return;
            }

            const count = changedCount;

            finish(context);

            context.notify(
                count
                    ? `EXTEND — Finished. ${count} object(s) modified.`
                    : 'EXTEND — Finished. No objects modified.'
            );
        },

        onFinish(context) {

            boundaryTargets = [];
            standardBoundariesAccepted = false;
            changedCount = 0;

            setPickbox(context, false);
        }

    });

    CAD.registerCommand({

        name: 'EXTEND',
        aliases: ['EX'],

        desc: 'AutoCAD-style EXTEND',

        category: 'modify',

        execute: () =>
            CAD.createContext().setToolName('extend')

    });

})(window);
