/**
 * SAFAR EDGE CAD - EXPLODE
 * Explodes RECT and POLYLINE entities into individual LINE segments.
 * Supports both preselection and postselection (start EXPLODE, then click).
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;
    const THREE = global.THREE;
    let picked = [];

    if (!CAD || !THREE) throw new Error('EXPLODE: CAD Registry or Three.js unavailable.');

    const EXPLODABLE = new Set(['polyline', 'rect', 'rectangle']);

    function typeOf(object) {
        return String((object && object.userData && object.userData.type) || '').toLowerCase();
    }

    function isExplodable(object) {
        return !!object && EXPLODABLE.has(typeOf(object));
    }

    function colorOf(object) {
        const data = object.userData || {};
        if (Number.isFinite(data.originalColor)) return data.originalColor;
        const material = Array.isArray(object.material) ? object.material[0] : object.material;
        return material && material.color ? material.color.getHex() : 0xffffff;
    }

    function getWorldPoints(object) {
        if (!object || !object.geometry) return [];
        object.updateMatrixWorld(true);
        const attr = object.geometry.getAttribute('position');
        if (!attr) return [];
        const points = [];
        for (let i = 0; i < attr.count; i++) {
            points.push(new THREE.Vector3().fromBufferAttribute(attr, i).applyMatrix4(object.matrixWorld));
        }
        return points;
    }

    function addPicked(object, context) {
        if (!isExplodable(object)) {
            context.setPrompt('EXPLODE — Select a RECT or POLYLINE object.');
            return false;
        }
        if (!context.getObjects().includes(object)) return false;
        if (!picked.includes(object)) picked.push(object);
        context.setSelection(picked);
        context.setPrompt(`EXPLODE — ${picked.length} object(s) selected. Press ENTER to explode, or select more.`);
        return true;
    }

    function syncPickedFromSelection(context) {
        const live = context.getObjects();
        const selected = context.getSelectedObjects().filter(object => live.includes(object) && isExplodable(object));
        selected.forEach(object => {
            if (!picked.includes(object)) picked.push(object);
        });
        picked = picked.filter(object => live.includes(object) && isExplodable(object));
        return picked;
    }

    function explodeSelected(context) {
        syncPickedFromSelection(context);
        const live = context.getObjects();
        const sources = picked.filter(object => live.includes(object) && isExplodable(object));
        if (!sources.length) {
            context.setPrompt('EXPLODE — Select RECT/POLYLINE objects first, then press ENTER.');
            return false;
        }

        const replacements = [];
        const consumed = [];

        sources.forEach(source => {
            const points = getWorldPoints(source);
            if (points.length < 2) return;

            // Closed entities repeat their first vertex at the end.
            const isClosed = points.length > 2 && points[0].distanceTo(points[points.length - 1]) <= 1e-5;
            const vertices = isClosed ? points.slice(0, -1) : points;
            const segmentCount = isClosed ? vertices.length : vertices.length - 1;
            if (segmentCount < 1) return;

            const color = colorOf(source);
            let createdForSource = 0;
            for (let i = 0; i < segmentCount; i++) {
                const a = vertices[i];
                const b = vertices[(i + 1) % vertices.length];
                if (a.distanceTo(b) <= 1e-8) continue;
                const geometry = new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
                const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, linewidth: 2 }));
                line.userData = {
                    type: 'line',
                    originalColor: color,
                    explodedFrom: typeOf(source)
                };
                replacements.push(line);
                createdForSource++;
            }
            if (createdForSource) consumed.push(source);
        });

        if (!consumed.length || !replacements.length) {
            context.setPrompt('EXPLODE — No valid RECT/POLYLINE segments found. Select supported objects and try again.');
            return false;
        }

        // Remove only successfully converted source objects. Unsupported or
        // malformed selections remain untouched in the drawing.
        context.clearSelection();
        consumed.forEach(object => context.removeEntity(object));
        replacements.forEach(object => context.addEntity(object, false));
        context.recordReplace(consumed, replacements);
        context.setSelection(replacements);
        context.notify(`EXPLODE — ${consumed.length} object(s) converted into ${replacements.length} LINE segment(s). Ctrl+Z to undo.`);
        return true;
    }

    CAD.registerTool('explode', {
        onClick(point, context) {
            // Prefer all raycast hits and choose the nearest supported CAD entity.
            // Fall back to the legacy single-hit picker for older core builds.
            const hits = typeof context.getObjectsAtPointer === 'function'
                ? context.getObjectsAtPointer()
                : [context.getObjectAtPointer()];
            const object = hits.find(isExplodable) || null;
            if (!object) {
                context.setPrompt('EXPLODE — Click a RECT or POLYLINE to add it to the selection. Press ENTER when finished.');
                return;
            }
            addPicked(object, context);
        },
        onOption(value, context) {
            const option = String(value).trim().toUpperCase();
            if (option !== 'ALL') return false;
            picked = context.getObjects().filter(isExplodable);
            context.setSelection(picked);
            context.setPrompt(`EXPLODE — ${picked.length} supported object(s) selected. Press ENTER to explode:`);
            return true;
        },
        onEnter(context) {
            // One ENTER/SPACE commits the current postselection set.
            const selected = context.getSelectedObjects()
                .filter(object => context.getObjects().includes(object) && isExplodable(object));
            selected.forEach(object => {
                if (!picked.includes(object)) picked.push(object);
            });

            if (!explodeSelected(context)) {
                context.setPrompt('EXPLODE — Nothing to explode. Select RECT/POLYLINE objects, then press ENTER once.');
                return;
            }

            picked = [];
            context.finishCurrentTool();
        },
        onFinish() { picked = []; }
    });

    CAD.registerCommand({
        name: 'EXPLODE', aliases: ['X'],
        desc: 'Explode RECT and POLYLINE entities into LINE segments',
        category: 'modify',
        execute(context) {
            // AutoCAD-style preselection: when supported objects are already
            // selected, the command-name ENTER executes EXPLODE immediately.
            // No second confirmation is required.
            picked = context.getSelectedObjects().filter(isExplodable);
            if (picked.length) {
                explodeSelected(context);
                picked = [];
                return;
            }

            // Without preselection, activate the command for postselection.
            context.setToolName('explode');
            context.updateState({ isDrawing: true });
            context.setPrompt('EXPLODE — Select RECT/POLYLINE objects, then press ENTER or SPACE once:');
        }
    });
})(window);
