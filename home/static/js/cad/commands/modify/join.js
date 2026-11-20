/**
 * SAFAR EDGE CAD - JOIN
 * Joins endpoint-connected LINE / POLYLINE / RECT entities.
 * Supports preselection or selecting objects after starting JOIN.
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;
    const THREE = global.THREE;
    let picked = [];

    if (!CAD || !THREE) throw new Error('JOIN: CAD Registry or Three.js unavailable.');

    const JOINABLE = new Set(['line', 'polyline', 'rect']);

    function typeOf(object) {
        return String((object && object.userData && object.userData.type) || '').toLowerCase();
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

    function entityColor(object) {
        const data = object.userData || {};
        if (Number.isFinite(data.originalColor)) return data.originalColor;
        const material = Array.isArray(object.material) ? object.material[0] : object.material;
        return material && material.color ? material.color.getHex() : 0xffffff;
    }

    function joinChains(context) {
        const liveObjects = context.getObjects();
        const candidates = picked.filter(object => liveObjects.includes(object) && JOINABLE.has(typeOf(object)));
        if (candidates.length < 2) {
            context.setPrompt('JOIN — Select at least two connected LINE/POLYLINE objects, then press ENTER:');
            return false;
        }

        const tolerance = Math.max(context.getPickTolerance(8), 1e-5);
        const remaining = candidates.map(object => ({ object, points: getWorldPoints(object) }))
            .filter(item => item.points.length >= 2);
        const replacements = [];
        const consumed = [];

        while (remaining.length) {
            const seed = remaining.shift();
            let chain = seed.points.map(point => point.clone());
            const members = [seed.object];
            let extended = true;

            while (extended) {
                extended = false;
                let best = null;

                remaining.forEach((item, index) => {
                    const pts = item.points;
                    const options = [
                        { endpoint: pts[0], prepend: false, points: pts },
                        { endpoint: pts[pts.length - 1], prepend: false, points: [...pts].reverse() },
                        { endpoint: pts[pts.length - 1], prepend: true, points: pts },
                        { endpoint: pts[0], prepend: true, points: [...pts].reverse() }
                    ];
                    options.forEach(option => {
                        const target = option.prepend ? chain[0] : chain[chain.length - 1];
                        const distance = target.distanceTo(option.endpoint);
                        if (distance <= tolerance && (!best || distance < best.distance)) {
                            best = { index, item, option, distance };
                        }
                    });
                });

                if (best) {
                    const points = best.option.points.map(point => point.clone());
                    if (best.option.prepend) chain = [...points.slice(0, -1), ...chain];
                    else chain = [...chain, ...points.slice(1)];
                    members.push(best.item.object);
                    remaining.splice(best.index, 1);
                    extended = true;
                }
            }

            if (members.length > 1) {
                // Remove adjacent duplicate vertices caused by tolerance matching.
                const clean = [];
                chain.forEach(point => {
                    if (!clean.length || clean[clean.length - 1].distanceTo(point) > 1e-8) clean.push(point);
                });
                const color = entityColor(seed.object);
                const geometry = new THREE.BufferGeometry().setFromPoints(clean);
                const entity = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, linewidth: 2 }));
                entity.userData = {
                    type: 'polyline',
                    points: clean.map(point => ({ x: point.x, y: point.y, z: point.z })),
                    originalColor: color,
                    joinedFrom: members.length
                };
                replacements.push(entity);
                members.forEach(object => { if (!consumed.includes(object)) consumed.push(object); });
            }
        }

        if (!replacements.length) {
            context.setPrompt('JOIN — No connected endpoints found. Select objects with matching endpoints and press ENTER:');
            return false;
        }

        context.clearSelection();
        consumed.forEach(object => context.removeEntity(object));
        replacements.forEach(object => context.addEntity(object, false));
        context.recordReplace(consumed, replacements);
        context.setSelection(replacements);
        context.notify(`JOIN — Joined ${consumed.length} source objects into ${replacements.length} polyline(s). Ctrl+Z to undo.`);
        return true;
    }

    CAD.registerTool('join', {
        onClick(point, context) {
            const object = context.getObjectAtPointer();
            if (!object) return;
            if (!JOINABLE.has(typeOf(object))) {
                context.setPrompt('JOIN — Only LINE, POLYLINE and RECT entities are supported.');
                return;
            }
            if (!picked.includes(object)) picked.push(object);
            context.setSelection(picked);
            context.setPrompt(`JOIN — ${picked.length} object(s) selected. Press ENTER to join:`);
        },
        onOption(value, context) {
            if (String(value).trim().toUpperCase() !== 'ALL') return false;
            picked = context.getObjects().filter(object => JOINABLE.has(typeOf(object)));
            context.setSelection(picked);
            context.setPrompt(`JOIN — ${picked.length} candidate object(s) selected. Press ENTER to join:`);
            return true;
        },
        onEnter(context) {
            if (joinChains(context)) {
                picked = [];
                context.finishCurrentTool();
            }
        },
        onFinish() { picked = []; }
    });

    CAD.registerCommand({
        name: 'JOIN', aliases: ['J'],
        desc: 'Join connected LINE, POLYLINE and RECT entities',
        category: 'modify',
        execute(context) {
            // AutoCAD-style preselection: if two or more supported entities
            // are already selected, the ENTER that submits JOIN performs it
            // immediately. No extra confirmation is required.
            picked = context.getSelectedObjects()
                .filter(object => JOINABLE.has(typeOf(object)));

            if (picked.length >= 2 && joinChains(context)) {
                picked = [];
                return;
            }

            // Otherwise activate postselection. A single ENTER or SPACE
            // after picking the entities commits JOIN through commandEnter().
            context.setToolName('join');
            context.updateState({ isDrawing: true });
            context.setPrompt(picked.length
                ? `JOIN — ${picked.length} preselected object(s). Select more or press ENTER once to join:`
                : 'JOIN — Select connected LINE/POLYLINE objects, then press ENTER or SPACE once:');
        }
    });
})(window);
