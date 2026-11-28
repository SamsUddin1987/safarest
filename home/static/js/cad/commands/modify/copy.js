/**
 * SAFAR EDGE CAD - COPY
 * Copies selected entities, supports repeated placement and clipboard paste.
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;
    const Utils = global.CADModifyUtils;

    let sourceObjects = [];
    let basePoint = null;
    let previewObjects = [];
    let previewDelta = { x: 0, y: 0, z: 0 };

    function cloneCadObject(source) {
        const copy = source.clone(true);
        copy.traverse(child => {
            if (child.geometry) child.geometry = child.geometry.clone();
            if (child.material) {
                child.material = Array.isArray(child.material)
                    ? child.material.map(material => material.clone())
                    : child.material.clone();
            }
        });
        copy.userData = JSON.parse(JSON.stringify(source.userData || {}));
        if (copy.material && copy.material.color) {
            copy.material.color.setHex(copy.userData.originalColor || 0xffffff);
        }
        return copy;
    }

    function clearPreview(context) {
        Utils.disposePreview(context, previewObjects);
        previewObjects = [];
        previewDelta = { x: 0, y: 0, z: 0 };
    }

    function reset(context) {
        clearPreview(context);
        sourceObjects = [];
        basePoint = null;
        window.SafarEdgeCommandGripObjects = null;
    }

    function copySelectedObjects() {
        if (selectedObjects.length === 0) {
            notify('COPY: Select at least one object first.');
            return;
        }

        cadClipboard = selectedObjects.map(cloneCadObject);

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        selectedObjects.forEach(object => {
            const bounds = getWorldBounds(object);
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
        });

        cadClipboardBasePoint = new THREE.Vector3(
            (minX + maxX) / 2,
            (minY + maxY) / 2,
            0
        );

        notify(`Copied ${cadClipboard.length} object(s).`);
    }

    function pasteCadObjects() {
        if (cadClipboard.length === 0) {
            notify('PASTE: Clipboard is empty. Use Ctrl+C first.');
            return;
        }

        setTool('copy', {
            sources: cadClipboard.map(cloneCadObject),
            basePoint: cadClipboardBasePoint
                ? cadClipboardBasePoint.clone()
                : new THREE.Vector3()
        });
    }

    global.cloneCadObject = cloneCadObject;
    global.copySelectedObjects = copySelectedObjects;
    global.pasteCadObjects = pasteCadObjects;

    CAD.registerTool('copy', {
        onStart(context, options) {
            sourceObjects = options && Array.isArray(options.sources)
                ? options.sources
                : context.getSelectedObjects();

            if (sourceObjects.length === 0) {
                context.notify('COPY: Select objects first.');
                context.finishCurrentTool();
                return;
            }

            // Refresh the same MOVE/COPY base-point grips.
            // These are pick-only markers, not stretching grips.
            if (typeof updateSelectionGrips === 'function') {
                updateSelectionGrips();
            }

            // COPY displays the exact same pick-only base-point markers as
            // MOVE, using its source objects rather than editable stretch grips.
            window.SafarEdgeCommandGripObjects = sourceObjects.slice();

            if (options && options.basePoint) {
                basePoint = options.basePoint.clone();
                previewObjects = Utils.cloneForPreview(context, sourceObjects);
                context.updateState({ isDrawing: true, basePoint });
                context.setPrompt('PASTECLIP — Move cursor to insertion point and click:');
            } else {
                context.setPrompt(
                    `COPY — ${sourceObjects.length} object(s). Pick base point:`
                );
            }
        },

        onClick(point, context) {
            if (sourceObjects.length === 0) return;

            if (!basePoint) {
                basePoint = point.clone();
                previewObjects = Utils.cloneForPreview(context, sourceObjects);
                context.updateState({ isDrawing: true, basePoint });
                context.setPrompt('COPY — Move cursor to destination and click to place:');
                return;
            }

            const dx = point.x - basePoint.x;
            const dy = point.y - basePoint.y;
            const dz = (point.z || 0) - (basePoint.z || 0);

            if (Math.hypot(dx, dy, dz) < 1e-8) {
                context.setPrompt('COPY — Zero displacement. Pick another destination.');
                return;
            }

            clearPreview(context);

            const copies = sourceObjects.map(source => {
                const copy = cloneCadObject(source);
                context.translateObjects([copy], dx, dy, dz);
                context.addEntity(copy, false);
                return copy;
            });

            undoStack.push({ type: 'add', objs: copies });
            redoStack = [];

            context.notify(
                `COPY — ${copies.length} object(s) placed. Pick next destination or press ENTER.`
            );

            previewObjects = Utils.cloneForPreview(context, sourceObjects);
            context.translateObjects(previewObjects, dx, dy, dz);
            previewDelta = { x: dx, y: dy, z: dz };
        },

        onPreview(point, context) {
            if (!basePoint || previewObjects.length === 0) return;

            const dx = point.x - basePoint.x;
            const dy = point.y - basePoint.y;
            const dz = (point.z || 0) - (basePoint.z || 0);

            context.translateObjects(
                previewObjects,
                dx - previewDelta.x,
                dy - previewDelta.y,
                dz - previewDelta.z
            );

            previewDelta = { x: dx, y: dy, z: dz };
            context.setPrompt(
                `COPY — X: ${context.formatValue(dx)} | Y: ${context.formatValue(dy)} | Z: ${context.formatValue(dz)} | Click to place`
            );
        },

        onEnter(context) {
            context.finishCurrentTool();
        },

        onFinish(context) {
            reset(context);
        }
    });

    CAD.registerCommand({
        name: 'COPY',
        aliases: ['CO', 'CP'],
        desc: 'Copy selected objects',
        category: 'modify',
        execute: () => CAD.createContext().setToolName('copy')
    });
})(window);
