/* SAFAR EDGE — Browser-side 3D modelling and navigation layer.
 * Uses the existing Three.js scene, renderer and CAD entity/history APIs.
 * No server-side geometry processing or additional Python packages.
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;
    const THREE = global.THREE;
    if (!CAD || !THREE) throw new Error('SAFAR EDGE 3D: CAD core or Three.js is unavailable.');

    let mode = '2D';
    let viewCube = null;
    let saved2DView = null;
    let modelExtent = 1000;
    let target = new THREE.Vector3(0, 0, 0);
    let drag = null;
    let lightsAdded = false;
    let button = null;
    let fillButton = null;
    let solidFillEnabled = true;

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    function context() { return CAD.createContext(); }
    function camera() { return context().getCamera(); }
    function renderer() { return context().getRenderer(); }
    function scene() { return context().getScene(); }

    function updateButton() {
        button = global.document.getElementById('cad-st-3d-view');
        if (button) {
            button.textContent = mode === '3D' ? '3D ✓' : '2D / 3D';
            button.classList.toggle('active', mode === '3D');
            button.setAttribute('aria-pressed', mode === '3D' ? 'true' : 'false');
            button.title = mode === '3D'
                ? '3D mode: left-click selects/edits; middle-drag orbits; right-drag pans; wheel zooms.'
                : 'Switch between 2D drafting and 3D modelling/navigation';
        }
        updateFillButton();
    }

    function updateFillButton() {
        fillButton = global.document.getElementById('cad-st-3d-fill');
        if (!fillButton) return;
        fillButton.textContent = solidFillEnabled ? 'FILL ON' : 'FILL OFF';
        fillButton.classList.toggle('active', mode === '3D' && solidFillEnabled);
        fillButton.setAttribute('aria-pressed', solidFillEnabled ? 'true' : 'false');
        fillButton.title = mode === '2D'
            ? 'Solid colours are always hidden in 2D. This setting controls filled solids when you switch to 3D.'
            : 'Toggle solid surface colours. Edges remain visible when fill is OFF.';
    }

    function ensureSolidEdges(object) {
        if (!object || !object.geometry || !object.children) return null;
        let edgeLines = object.children.find(child => child.userData && child.userData.isCadSolidEdges);
        if (!edgeLines) {
            edgeLines = new THREE.LineSegments(
                new THREE.EdgesGeometry(object.geometry, 25),
                new THREE.LineBasicMaterial({ color: 0x243746, depthTest: true })
            );
            edgeLines.userData.isCadSolidEdges = true;
            object.add(edgeLines);
        }
        return edgeLines;
    }

    function applySolidDisplay() {
        const objects = context().getObjects();
        objects.forEach(object => {
            if (!object || !object.userData || object.userData.type !== 'solid') return;
            ensureSolidEdges(object);
            // In 2D, retain only the profile/edge display. In 3D, surface fill
            // is controlled by the adjacent FILL button.
            if (object.material) {
                const materials = Array.isArray(object.material) ? object.material : [object.material];
                materials.forEach(material => { material.visible = mode === '3D' && solidFillEnabled; });
            }
            if (object.userData.isCadSolidEdges && object.visible === false) object.visible = true;
            if (object.children) object.children.forEach(child => {
                if (child.userData && child.userData.isCadSolidEdges) child.visible = true;
            });
        });
        updateFillButton();
    }

    function createFillButton() {
        const viewButton = global.document.getElementById('cad-st-3d-view');
        if (!viewButton || !viewButton.parentNode) return;
        let existing = global.document.getElementById('cad-st-3d-fill');
        if (!existing) {
            existing = global.document.createElement('button');
            existing.type = 'button';
            existing.id = 'cad-st-3d-fill';
            existing.style.cssText = viewButton.style.cssText;
            existing.className = viewButton.className;
            existing.addEventListener('mousedown', event => event.preventDefault());
            existing.addEventListener('click', event => {
                event.stopPropagation();
                solidFillEnabled = !solidFillEnabled;
                applySolidDisplay();
                if (global.SafarEdgeProjectFiles) global.SafarEdgeProjectFiles.markDirty();
            });
            viewButton.insertAdjacentElement('afterend', existing);
        }
        fillButton = existing;
        updateFillButton();
    }

    function addLighting() {
        if (lightsAdded) return;
        const s = scene();
        if (!s) return;
        const ambient = new THREE.HemisphereLight(0xffffff, 0x475569, 1.25);
        ambient.name = 'SAFAR_3D_HEMISPHERE';
        const key = new THREE.DirectionalLight(0xffffff, 1.65);
        key.name = 'SAFAR_3D_KEY_LIGHT';
        key.position.set(-600, -800, 1200);
        const fill = new THREE.DirectionalLight(0xb8d7ff, 0.55);
        fill.name = 'SAFAR_3D_FILL_LIGHT';
        fill.position.set(700, 500, 450);
        s.add(ambient, key, fill);
        lightsAdded = true;
    }

    function createViewCube() {
        if (viewCube) return viewCube;
        const pane = global.document.getElementById('cad-pane');
        if (!pane) return null;
        viewCube = global.document.createElement('div');
        viewCube.id = 'safar-3d-navigation';
        viewCube.style.cssText = 'position:absolute;right:18px;top:64px;z-index:1200;display:none;flex-direction:column;gap:5px;padding:8px;background:rgba(25,30,38,.94);border:1px solid #526071;border-radius:8px;box-shadow:0 5px 18px rgba(0,0,0,.35);font:12px Segoe UI,Arial,sans-serif;';
        const title = global.document.createElement('div');
        title.textContent = 'VIEW NAVIGATION';
        title.style.cssText = 'font-size:10px;letter-spacing:.08em;color:#9fb2c8;text-align:center;padding:0 3px 3px;';
        viewCube.appendChild(title);
        const rows = [
            [['TOP', 'top'], ['ISO', 'iso']],
            [['FRONT', 'front'], ['BACK', 'back']],
            [['LEFT', 'left'], ['RIGHT', 'right']],
            [['FIT', 'fit'], ['HOME', 'home']]
        ];
        rows.forEach(row => {
            const line = global.document.createElement('div');
            line.style.cssText = 'display:flex;gap:5px;';
            row.forEach(([label, view]) => {
                const btn = global.document.createElement('button');
                btn.type = 'button';
                btn.textContent = label;
                btn.style.cssText = 'min-width:58px;padding:6px 7px;color:#e5edf6;background:#303d4b;border:1px solid #536477;border-radius:4px;cursor:pointer;font-size:11px;';
                btn.addEventListener('click', event => { event.stopPropagation(); setStandardView(view); });
                line.appendChild(btn);
            });
            viewCube.appendChild(line);
        });
        pane.appendChild(viewCube);
        return viewCube;
    }

    function setViewVisible(visible) {
        const cube = createViewCube();
        if (cube) cube.style.display = visible ? 'flex' : 'none';
    }

    function save2DView() {
        const cam = camera();
        if (!cam) return;
        saved2DView = {
            position: cam.position.clone(),
            quaternion: cam.quaternion.clone(),
            up: cam.up.clone(),
            zoom: cam.zoom,
            near: cam.near,
            far: cam.far,
            target: target.clone()
        };
    }

    function setCameraPose(direction, up) {
        const cam = camera();
        const r = renderer();
        if (!cam || !r) return;
        const distance = Math.max(1000, modelExtent * 2.5);
        cam.up.copy(up || new THREE.Vector3(0, 0, 1));
        cam.position.copy(target).add(direction.clone().normalize().multiplyScalar(distance));
        cam.lookAt(target);
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);
    }

    function setStandardView(view) {
        if (mode !== '3D') return;
        const zUp = new THREE.Vector3(0, 0, 1);
        const yUp = new THREE.Vector3(0, 1, 0);
        if (view === 'top') setCameraPose(new THREE.Vector3(0, 0, 1), yUp);
        else if (view === 'front') setCameraPose(new THREE.Vector3(0, -1, 0), zUp);
        else if (view === 'back') setCameraPose(new THREE.Vector3(0, 1, 0), zUp);
        else if (view === 'left') setCameraPose(new THREE.Vector3(-1, 0, 0), zUp);
        else if (view === 'right') setCameraPose(new THREE.Vector3(1, 0, 0), zUp);
        else if (view === 'iso' || view === 'home') setCameraPose(new THREE.Vector3(1, -1, 0.85), zUp);
        else if (view === 'fit') fitModel();
    }

    function fitModel() {
        const objects = context().getObjects().filter(o => o && o.visible !== false);
        const cam = camera();
        if (!cam) return;
        const box = new THREE.Box3();
        objects.forEach(o => {
            if (typeof o.updateMatrixWorld === 'function') o.updateMatrixWorld(true);
            box.expandByObject(o);
        });
        if (box.isEmpty()) {
            target.set(0, 0, 0);
            modelExtent = 1000;
            cam.zoom = 1;
            setCameraPose(new THREE.Vector3(1, -1, 0.85), new THREE.Vector3(0, 0, 1));
            return;
        }
        box.getCenter(target);
        const size = box.getSize(new THREE.Vector3());
        modelExtent = Math.max(size.x, size.y, size.z, 1);
        setCameraPose(new THREE.Vector3(1, -1, 0.85), new THREE.Vector3(0, 0, 1));
        // Project all eight corners into the actual camera plane. This avoids
        // the old fit formula shrinking large drawings to near-invisible dots.
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const x of [box.min.x, box.max.x]) {
            for (const y of [box.min.y, box.max.y]) {
                for (const z of [box.min.z, box.max.z]) {
                    const v = new THREE.Vector3(x, y, z).sub(target);
                    const px = v.dot(right), py = v.dot(up);
                    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
                    minY = Math.min(minY, py); maxY = Math.max(maxY, py);
                }
            }
        }
        const frustumWidth = Math.abs(cam.right - cam.left);
        const frustumHeight = Math.abs(cam.top - cam.bottom);
        const projectedWidth = Math.max(maxX - minX, 1);
        const projectedHeight = Math.max(maxY - minY, 1);
        cam.zoom = clamp(0.8 * Math.min(frustumWidth / projectedWidth, frustumHeight / projectedHeight), 0.000001, 100000);
        cam.updateProjectionMatrix();
    }

    function toggleMode(forceMode) {
        const next = forceMode || (mode === '2D' ? '3D' : '2D');
        if (next === mode) return mode;
        const cam = camera();
        if (!cam) return mode;
        if (next === '3D') {
            save2DView();
            mode = '3D';
            addLighting();
            cam.near = 0.1;
            cam.far = 100000000;
            cam.updateProjectionMatrix();
            cam.up.set(0, 0, 1);
            setViewVisible(true);
            fitModel();
            context().setPrompt('3D MODE — Left-click: select/edit | Middle-drag: orbit | Right-drag: pan | Wheel: zoom | Type EXTRUDE for solids.');
        } else {
            mode = '2D';
            setViewVisible(false);
            if (saved2DView) {
                cam.position.copy(saved2DView.position);
                cam.quaternion.copy(saved2DView.quaternion);
                cam.up.copy(saved2DView.up);
                cam.zoom = saved2DView.zoom;
                cam.near = saved2DView.near;
                cam.far = saved2DView.far;
                target.copy(saved2DView.target);
                cam.updateProjectionMatrix();
                cam.updateMatrixWorld(true);
            } else {
                cam.up.set(0, 1, 0);
                cam.position.set(0, 0, 500);
                cam.lookAt(0, 0, 0);
                cam.zoom = 1;
                cam.updateProjectionMatrix();
            }
            context().setPrompt('2D MODE — Existing CAD drafting commands and snapping are active.');
        }
        applySolidDisplay();
        updateButton();
        if (global.SafarEdgeProjectFiles) global.SafarEdgeProjectFiles.markDirty();
        return mode;
    }

    function onDown(event) {
        if (mode !== '3D' || event.target.closest('#safar-3d-navigation')) return;
        // Preserve the CAD engine's left-button selection, direct manipulation
        // and command-point handling. Navigation uses middle/right drag only.
        if (event.button !== 1 && event.button !== 2) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const cam = camera();
        drag = {
            x: event.clientX,
            y: event.clientY,
            button: event.button,
            moved: false,
            kind: event.button === 1 ? 'orbit' : 'pan'
        };
        if (cam) drag.start = cam.position.clone();
    }

    function onMove(event) {
        if (mode !== '3D' || !drag) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const cam = camera();
        const r = renderer();
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
        if (!drag.moved) return;
        if (drag.kind === 'orbit') {
            // Z-up orbit, with small incremental angles rather than reapplying
            // the entire mouse displacement on every event.
            const offset = cam.position.clone().sub(target);
            const radius = Math.max(offset.length(), 1);
            let azimuth = Math.atan2(offset.y, offset.x);
            let elevation = Math.asin(clamp(offset.z / radius, -1, 1));
            azimuth -= dx * 0.002;
            elevation = clamp(elevation + dy * 0.002, -Math.PI / 2 + 0.03, Math.PI / 2 - 0.03);
            const horizontal = radius * Math.cos(elevation);
            offset.set(horizontal * Math.cos(azimuth), horizontal * Math.sin(azimuth), radius * Math.sin(elevation));
            cam.position.copy(target).add(offset);
            cam.up.set(0, 0, 1);
            cam.lookAt(target);
        } else {
            const height = r.domElement.clientHeight || 1;
            const worldPerPixel = Math.max(1e-6, (cam.top - cam.bottom) / Math.max(cam.zoom, 1e-6) / height);
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
            const shift = right.multiplyScalar(-dx * worldPerPixel).add(up.multiplyScalar(dy * worldPerPixel));
            cam.position.add(shift); target.add(shift);
        }
        cam.updateMatrixWorld(true);
    }

    function onUp(event) {
        if (mode !== '3D' || !drag) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        drag = null;
    }

    function pick3DObject(event) {
        const r = renderer();
        const cam = camera();
        if (!r || !cam) return;
        const rect = r.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        const ray = new THREE.Raycaster();
        ray.setFromCamera(mouse, cam);
        const objects = context().getObjects().filter(o => o.visible !== false);
        const hit = ray.intersectObjects(objects, true)[0];
        if (!hit) { context().clearSelection(); return; }
        let owner = hit.object;
        while (owner.parent && !objects.includes(owner)) owner = owner.parent;
        if (objects.includes(owner)) context().setSelection([owner]);
    }

    function onClickCapture(event) {
        if (mode !== '3D') return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    function onWheel(event) {
        if (mode !== '3D') return;
        event.preventDefault(); event.stopImmediatePropagation();
        const cam = camera();
        cam.zoom = clamp(cam.zoom * Math.exp(-event.deltaY * 0.0005), 0.0001, 100);
        cam.updateProjectionMatrix();
    }

    function bindNavigation() {
        const r = renderer();
        if (!r || r.domElement.dataset.safar3dBound) return;
        const el = r.domElement;
        el.dataset.safar3dBound = '1';
        el.addEventListener('mousedown', onDown, true);
        global.addEventListener('mousemove', onMove, true);
        global.addEventListener('mouseup', onUp, true);
        el.addEventListener('wheel', onWheel, { capture: true, passive: false });
        el.addEventListener('contextmenu', event => { if (mode === '3D') event.preventDefault(); }, true);
    }

    function polygonArea(points) {
        let sum = 0;
        for (let i = 0; i < points.length; i++) {
            const a = points[i], b = points[(i + 1) % points.length];
            sum += a.x * b.y - b.x * a.y;
        }
        return Math.abs(sum) / 2;
    }

    function profileToShape(object) {
        const data = object.userData || {};
        const shape = new THREE.Shape();
        if (data.type === 'circle' && data.center && Number(data.radius) > 0) {
            const center = data.center.isVector3 ? data.center.clone() : new THREE.Vector3(data.center.x, data.center.y, data.center.z || 0);
            object.localToWorld(center);
            shape.absarc(center.x, center.y, Number(data.radius), 0, Math.PI * 2, false);
            return { shape, area: Math.PI * Number(data.radius) ** 2, length: Number(data.radius) * 2, width: Number(data.radius) * 2 };
        }
        const source = Array.isArray(data.points) ? data.points : [];
        if (source.length < 4) return null;
        let pts = source.map(p => {
            const v = p.isVector3 ? p.clone() : new THREE.Vector3(Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0);
            object.localToWorld(v);
            return new THREE.Vector2(v.x, v.y);
        });
        if (pts.length > 2 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop();
        if (pts.length < 3) return null;
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
        const length = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        const width = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        if (length <= 1e-8 || width <= 1e-8) return null;
        shape.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
        shape.closePath();
        return { shape, area: polygonArea(pts), length, width };
    }

    function extrudeSelected(height) {
        const ctx = context();
        const selected = Array.from(new Set(ctx.getSelectedObjects())).filter(o =>
            ['rect', 'rectangle', 'square', 'polyline', 'circle'].includes(
                String((o.userData || {}).type).toLowerCase()
            )
        );
        if (!selected.length) {
            ctx.setPrompt('EXTRUDE — Select closed rectangle, circle or closed polyline profiles first, then run EXTRUDE.');
            return false;
        }
        const created = [];
        selected.forEach(profile => {
            const result = profileToShape(profile);
            if (!result) return;
            const geometry = new THREE.ExtrudeGeometry(result.shape, { depth: height, bevelEnabled: false, steps: 1, curveSegments: 48 });
            geometry.computeVertexNormals();
            geometry.computeBoundingBox();
            const material = new THREE.MeshStandardMaterial({ color: 0x8aa7bd, metalness: 0.18, roughness: 0.52, side: THREE.DoubleSide });
            // Surface fill is shown only in 3D and only when FILL is enabled.
            material.visible = mode === '3D' && solidFillEnabled;
            const solid = new THREE.Mesh(geometry, material);
            solid.castShadow = true;
            solid.receiveShadow = true;
            const edgeGeometry = new THREE.EdgesGeometry(geometry, 25);
            const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x243746, depthTest: true, transparent: false });
            const edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
            edgeLines.userData.isCadSolidEdges = true;
            solid.add(edgeLines);
            const factor = result.area / Math.max(result.length * result.width, 1e-12);
            solid.userData = {
                type: 'solid', closed: true, is3D: true,
                layer: (profile.userData && profile.userData.layer) || '0',
                height: height, baseArea: result.area, baseAreaFactor: factor,
                profileType: (profile.userData && profile.userData.type) || 'polyline',
                originalColor: 0x8aa7bd, colorMode: 'ByLayer', isCadSolidEdges: true
            };
            created.push({ profile, solid });
        });
        if (!created.length) { ctx.setPrompt('EXTRUDE — No valid closed profiles were found.'); return false; }
        // EXTRUDE is a replacement operation: remove each 2D profile from
        // the CAD registry before registering its corresponding 3D solid.
        // This prevents the original profile and its extrusion being measured
        // together. The same profile is processed only once.
        const replacedProfiles = new Set();
        created.forEach(item => {
            if (replacedProfiles.has(item.profile)) return;
            replacedProfiles.add(item.profile);
            ctx.removeEntity(item.profile);
            ctx.addEntity(item.solid, false);
        });
        ctx.recordReplace(created.map(x => x.profile), created.map(x => x.solid));
        ctx.clearSelection();
        ctx.setSelection(created.map(x => x.solid));
        applySolidDisplay();
        if (global.SafarEdgeMeasurements) global.SafarEdgeMeasurements.syncFromMenu({ source: 'manual' });
        ctx.setPrompt(`EXTRUDE — Created ${created.length} 3D solid(s), height ${height} mm. Switch to 3D to inspect.`);
        return true;
    }

    function beginExtrude(ctx) {
        const selected = ctx.getSelectedObjects();
        if (!selected.length) {
            ctx.setPrompt('EXTRUDE — Select closed profiles, then run EXTRUDE.');
            return;
        }
        ctx.setPrompt('EXTRUDE — Enter extrusion height in millimetres:');
        ctx.setPendingCommand({
            name: 'EXTRUDE',
            prompt: 'EXTRUDE — Enter extrusion height in millimetres:',
            onText: (upper, raw) => {
                const height = Number(raw);
                if (!Number.isFinite(height) || height <= 0) {
                    ctx.setPrompt('EXTRUDE — Height must be a positive number in millimetres. Enter height:');
                    return true;
                }
                extrudeSelected(height);
                ctx.setPendingCommand(null);
                return true;
            },
            onEnter: () => { ctx.setPendingCommand(null); ctx.setPrompt('EXTRUDE cancelled.'); }
        });
    }

    function setSelectedSolidHeight(height) {
        const ctx = context();
        const solids = ctx.getSelectedObjects().filter(object =>
            object && object.userData && object.userData.type === 'solid' && object.geometry
        );
        if (!solids.length) {
            ctx.setPrompt('SOLIDHEIGHT — Select one or more extruded solids first.');
            return false;
        }
        if (!Number.isFinite(height) || height <= 0) {
            ctx.setPrompt('SOLIDHEIGHT — Height must be a positive number in millimetres.');
            return false;
        }

        const before = ctx.captureObjects(solids);
        let changed = 0;
        solids.forEach(solid => {
            const geometry = solid.geometry;
            const position = geometry && geometry.getAttribute('position');
            if (!position) return;
            geometry.computeBoundingBox();
            const box = geometry.boundingBox;
            const oldHeight = Number(solid.userData.height) || (box.max.z - box.min.z);
            if (!Number.isFinite(oldHeight) || oldHeight <= 1e-9) return;
            const baseZ = box.min.z;
            const oldTopZ = baseZ + oldHeight;
            const tolerance = Math.max(1e-7, oldHeight * 1e-7);
            for (let i = 0; i < position.count; i++) {
                const z = position.getZ(i);
                if (Math.abs(z - oldTopZ) <= tolerance) {
                    position.setZ(i, baseZ + height);
                }
            }
            position.needsUpdate = true;
            geometry.computeVertexNormals();
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            solid.userData.height = height;
            // Rebuild the edge overlay to match the resized solid.
            const oldEdges = solid.children.find(child => child.userData && child.userData.isCadSolidEdges);
            if (oldEdges) {
                if (oldEdges.geometry) oldEdges.geometry.dispose();
                oldEdges.geometry = new THREE.EdgesGeometry(geometry, 25);
            }
            changed++;
        });
        if (!changed) {
            ctx.setPrompt('SOLIDHEIGHT — No editable extruded solids were found.');
            return false;
        }
        ctx.recordModify(solids, before);
        applySolidDisplay();
        if (global.SafarEdgeMeasurements) global.SafarEdgeMeasurements.syncFromMenu({ source: 'manual' });
        ctx.setPrompt(`SOLIDHEIGHT — Updated ${changed} solid(s) to ${height} mm.`);
        return true;
    }

    function beginSolidHeight(ctx) {
        const solids = ctx.getSelectedObjects().filter(object =>
            object && object.userData && object.userData.type === 'solid'
        );
        if (!solids.length) {
            ctx.setPrompt('SOLIDHEIGHT — Select one or more extruded solids first.');
            return;
        }
        ctx.setPrompt('SOLIDHEIGHT — Enter the new height in millimetres:');
        ctx.setPendingCommand({
            name: 'SOLIDHEIGHT',
            prompt: 'SOLIDHEIGHT — Enter the new height in millimetres:',
            onText: (upper, raw) => {
                const height = Number(raw);
                if (!Number.isFinite(height) || height <= 0) {
                    ctx.setPrompt('SOLIDHEIGHT — Enter a positive height in millimetres:');
                    return true;
                }
                setSelectedSolidHeight(height);
                ctx.setPendingCommand(null);
                return true;
            },
            onEnter: () => {
                ctx.setPendingCommand(null);
                ctx.setPrompt('SOLIDHEIGHT cancelled.');
            }
        });
    }

    function getNavigationState() {
        return {
            solidFillEnabled: solidFillEnabled,
            target: target.toArray(),
            saved2DView: saved2DView ? {
                position: saved2DView.position.toArray(),
                quaternion: saved2DView.quaternion.toArray(),
                up: saved2DView.up.toArray(),
                zoom: saved2DView.zoom,
                near: saved2DView.near,
                far: saved2DView.far,
                target: saved2DView.target.toArray()
            } : null
        };
    }

    function restoreNavigationState(state) {
        if (!state || typeof state !== 'object') return;
        if (typeof state.solidFillEnabled === 'boolean') solidFillEnabled = state.solidFillEnabled;
        if (Array.isArray(state.target) && state.target.length === 3) target.fromArray(state.target);
        const saved = state.saved2DView;
        if (saved && Array.isArray(saved.position) && Array.isArray(saved.quaternion) && Array.isArray(saved.up)) {
            saved2DView = {
                position: new THREE.Vector3().fromArray(saved.position),
                quaternion: new THREE.Quaternion().fromArray(saved.quaternion),
                up: new THREE.Vector3().fromArray(saved.up),
                zoom: Number(saved.zoom) || 1,
                near: Number(saved.near) || 1,
                far: Number(saved.far) || 2000,
                target: new THREE.Vector3().fromArray(Array.isArray(saved.target) ? saved.target : [0, 0, 0])
            };
        }
    }

    function restoreMode(savedMode) {
        mode = savedMode === '3D' ? '3D' : '2D';
        updateButton();
        setViewVisible(mode === '3D');
        if (mode === '3D') {
            addLighting();
            const cam = camera();
            if (cam) cam.up.set(0, 0, 1);
        }
        applySolidDisplay();
    }

    function initialize() {
        bindNavigation();
        createFillButton();
        applySolidDisplay();
        updateButton();
    }

    if (typeof CAD.registerCommand === 'function' && !CAD.getCommand('EXTRUDE')) {
        CAD.registerCommand({ name: 'EXTRUDE', aliases: ['EXTD'], desc: 'Create a 3D solid by extruding selected closed profiles', category: '3d', execute: beginExtrude });
    }
    if (typeof CAD.registerCommand === 'function' && !CAD.getCommand('SOLIDHEIGHT')) {
        CAD.registerCommand({ name: 'SOLIDHEIGHT', aliases: ['SHEIGHT'], desc: 'Edit the height of selected extruded solids', category: '3d', execute: beginSolidHeight });
    }

    global.SafarEdge3D = {
        toggleMode,
        getMode: () => mode,
        restoreMode,
        getNavigationState,
        restoreNavigationState,
        initialize,
        fitModel,
        setStandardView,
        extrudeSelected,
        setSelectedSolidHeight,
        setSolidFillEnabled: enabled => { solidFillEnabled = !!enabled; applySolidDisplay(); },
        isSolidFillEnabled: () => solidFillEnabled
    };

    // CAD canvas is initialized by the workspace after this script loads.
    global.addEventListener('load', initialize, { once: true });
})(window);
