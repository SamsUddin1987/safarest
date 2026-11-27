/* SAFAR EDGE — Browser-side 3D modelling and navigation layer.
 * Uses the existing Three.js scene, renderer and CAD entity/history APIs.
 * No server-side geometry processing or additional Python packages.
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;
    const THREE = global.THREE;
    if (!CAD || !THREE) throw new Error('SAFAR EDGE 3D: CAD core or Three.js is unavailable.');

    // SAFAR EDGE now runs as one continuous 3D model workspace.
    let mode = '3D';
    let activeStandardView = 'top';
    let orbitEnabled = false;
    let viewCube = null;
    let sidePanel = null;
    let layerQuickPanel = null;
    let layerQuickSelect = null;
    let extrudeHeightInput = null;
    let extrudeHeightMm = 3000;
    const viewButtons = Object.create(null);
    let saved2DView = null; // retained only for backwards-compatible project files
    let modelExtent = 1000;
    let target = new THREE.Vector3(0, 0, 0);
    let drag = null;
    let navigationGestureActive = false;
    let suppressNavigationClick = false;
    let benchmarkRL = 100.0; // project datum: world Z=0 corresponds to RL 100.000 m
    let lightsAdded = false;
    let button = null;
    let fillButton = null;
    let solidFillEnabled = true;
    const SOLID_DISPLAY_STATE_VERSION = 2;
    // Keep the user's last FILL setting synchronously in browser storage as
    // well as in the .est/recovery snapshot. This closes the refresh window
    // where pagehide/async autosave may not finish before the browser reloads.
    const SOLID_FILL_STORAGE_PREFIX = 'safaredge.solidFillPreference.v1:';
    let restoreFitToken = 0;
    let environmentControl = null;
    let environmentTexture = null;
    let environmentTarget = null;
    let environmentSource = null;
    let environmentLoadToken = 0;
    let environmentReady = false;
    const ENVIRONMENTS = {
        'Studio softbox': 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',
        'Outdoor daylight': 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_1k.hdr',
        'Sunset': 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/venice_sunset_1k.hdr'
    };

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    function context() { return CAD.createContext(); }
    function camera() { return context().getCamera(); }
    function renderer() { return context().getRenderer(); }
    function scene() { return context().getScene(); }

    function updateButton() {
        // Backward compatibility: remove the obsolete 2D/3D mode switch.
        const obsolete = global.document.getElementById('cad-st-3d-view');
        if (obsolete) obsolete.remove();
        updateFillButton();
    }

    function solidFillStorageKey() {
        let projectId = null;
        try {
            const projectFiles = global.SafarEdgeProjectFiles;
            if (projectFiles && typeof projectFiles.getCurrentProjectId === 'function') {
                projectId = projectFiles.getCurrentProjectId();
            }
        } catch (_) {}
        return SOLID_FILL_STORAGE_PREFIX + (projectId ? String(projectId) : 'unsaved-workspace');
    }

    function persistSolidFillPreference() {
        try {
            global.localStorage.setItem(solidFillStorageKey(), solidFillEnabled ? '1' : '0');
        } catch (_) {
            // The .est navigation state remains the fallback when storage is unavailable.
        }
    }

    function readSolidFillPreference() {
        try {
            const stored = global.localStorage.getItem(solidFillStorageKey());
            if (stored === '1') return true;
            if (stored === '0') return false;
        } catch (_) {}
        return null;
    }

    function updateFillButton() {
        fillButton = global.document.getElementById('cad-st-3d-fill');
        if (!fillButton) return;
        fillButton.textContent = solidFillEnabled ? 'FILL ON' : 'FILL OFF';
        fillButton.classList.toggle('active', solidFillEnabled);
        fillButton.setAttribute('aria-pressed', solidFillEnabled ? 'true' : 'false');
        fillButton.title = 'Toggle 3D solid surface colours. Edges remain visible when fill is OFF.';
    }

    function getSolidLayerColor(object) {
        const layerName = String(
            (object && object.userData && object.userData.layer) || '0'
        );

        const settings = CAD.Dimension &&
            typeof CAD.Dimension.getSettings === 'function'
            ? (CAD.Dimension.getSettings() || {})
            : {};

        const layer = (settings.layers || {})[layerName];

        return layer && layer.color ? layer.color : '#ffffff';
    }

    function ensureSolidEdges(object) {
        if (!object || !object.geometry || !object.children) return null;

        const position = object.geometry.getAttribute('position');
        if (!position || !position.count) return null;

        const positionVersion = position.version || 0;
        let edgeLines = object.children.find(child =>
            child && child.userData && child.userData.isCadSolidEdges
        );

        const edgePosition = edgeLines && edgeLines.geometry &&
            edgeLines.geometry.getAttribute &&
            edgeLines.geometry.getAttribute('position');
        const edgeGeometryInvalid = !edgePosition || !edgePosition.count;

        const needsGeometry = !edgeLines ||
            edgeGeometryInvalid ||
            edgeLines.userData.sourceGeometryId !== object.geometry.uuid ||
            edgeLines.userData.sourcePositionVersion !== positionVersion;

        if (!edgeLines) {
            edgeLines = new THREE.LineSegments(
                new THREE.EdgesGeometry(object.geometry, 1.5),
                new THREE.LineBasicMaterial({
                    color: getSolidLayerColor(object),
                    depthTest: false,
                    depthWrite: false,
                    transparent: false,
                    toneMapped: false
                })
            );
            edgeLines.name = 'SAFAR_EDGE_SOLID_OUTLINES';
            edgeLines.userData = edgeLines.userData || {};
            edgeLines.userData.isCadSolidEdges = true;
            object.add(edgeLines);
        } else if (needsGeometry) {
            if (edgeLines.geometry) edgeLines.geometry.dispose();
            edgeLines.geometry = new THREE.EdgesGeometry(object.geometry, 1.5);
        }

        const rebuiltPosition = edgeLines.geometry &&
            edgeLines.geometry.getAttribute('position');
        if (!rebuiltPosition || !rebuiltPosition.count) {
            edgeLines.visible = false;
            return edgeLines;
        }

        edgeLines.userData.sourceGeometryId = object.geometry.uuid;
        edgeLines.userData.sourcePositionVersion = positionVersion;
        edgeLines.visible = !solidFillEnabled;
        edgeLines.renderOrder = 1000;
        edgeLines.frustumCulled = false;
        if (edgeLines.material) {
            edgeLines.material.visible = true;
            edgeLines.material.color.set(getSolidLayerColor(object));
            edgeLines.material.depthTest = false;
            edgeLines.material.depthWrite = false;
            edgeLines.material.transparent = false;
            edgeLines.material.toneMapped = false;
            edgeLines.material.needsUpdate = true;
        }
        return edgeLines;
    }

    // Edges are a render helper, not authoritative project geometry. Rebuild
    // them from each restored solid's actual mesh instead of trusting a
    // serialized EdgesGeometry child, whose cached BufferGeometry can be stale
    // or incomplete after ObjectLoader restores a project.
    function rebuildSolidEdgesAfterRestore() {
        const objects = context().getObjects();
        objects.forEach(object => {
            if (!object || !object.userData ||
                String(object.userData.type || '').toLowerCase() !== 'solid' ||
                !object.geometry || !object.children) return;

            const oldEdges = object.children.filter(child =>
                child && (
                    (child.userData && child.userData.isCadSolidEdges) ||
                    child.name === 'SAFAR_EDGE_SOLID_OUTLINES'
                )
            );

            oldEdges.forEach(edge => {
                object.remove(edge);
                if (edge.geometry && typeof edge.geometry.dispose === 'function') {
                    edge.geometry.dispose();
                }
                const materials = Array.isArray(edge.material)
                    ? edge.material
                    : (edge.material ? [edge.material] : []);
                materials.forEach(material => {
                    if (material && typeof material.dispose === 'function') {
                        material.dispose();
                    }
                });
            });

            ensureSolidEdges(object);
        });
    }

    function applySolidDisplay() {
        context().getObjects().forEach(object => {
            if (!object || !object.userData ||
                String(object.userData.type || '').toLowerCase() !== 'solid') return;
            object.visible = true;
            const materials = Array.isArray(object.material)
                ? object.material
                : (object.material ? [object.material] : []);
            materials.forEach(material => {
                if (!material) return;
                material.visible = true;
                material.colorWrite = solidFillEnabled;
                material.depthWrite = true;
                material.needsUpdate = true;
            });
            const edgeLines = ensureSolidEdges(object);
            if (edgeLines) edgeLines.visible = !solidFillEnabled;
        });
        updateFillButton();
    }

    function createFillButton() {
        const anchorButton = global.document.getElementById('cad-st-split-view');
        if (!anchorButton || !anchorButton.parentNode) return;
        let existing = global.document.getElementById('cad-st-3d-fill');
        if (!existing) {
            existing = global.document.createElement('button');
            existing.type = 'button';
            existing.id = 'cad-st-3d-fill';
            existing.style.cssText = anchorButton.style.cssText;
            existing.className = anchorButton.className;
            existing.addEventListener('mousedown', event => event.preventDefault());
            existing.addEventListener('click', event => {
                event.stopPropagation();
                solidFillEnabled = !solidFillEnabled;
                persistSolidFillPreference();
                applySolidDisplay();
                if (global.SafarEdgeProjectFiles) global.SafarEdgeProjectFiles.markDirty();
            });
            anchorButton.insertAdjacentElement('afterend', existing);
        }
        fillButton = existing;
        updateFillButton();
    }

    function setEnvironmentStatus(message) {
        if (environmentControl) environmentControl.title = message;
    }

    function loadEnvironment(name) {
        const s = scene();
        const r = renderer();
        if (!s || !r || !THREE.RGBELoader || !THREE.PMREMGenerator) {
            setEnvironmentStatus('HDR environment loader is unavailable; using standard CAD lighting.');
            return Promise.resolve(false);
        }
        const url = ENVIRONMENTS[name];
        if (!url) {
            if (s.environment) s.environment = null;
            if (environmentTarget) { environmentTarget.dispose(); environmentTarget = null; environmentTexture = null; }
            environmentSource = null;
            setEnvironmentStatus('HDR reflections disabled.');
            return Promise.resolve(true);
        }
        if (environmentSource === url && environmentTexture) return Promise.resolve(true);
        const token = ++environmentLoadToken;
        setEnvironmentStatus('Loading HDR environment…');
        const loader = new THREE.RGBELoader();
        loader.setDataType(THREE.UnsignedByteType);
        return new Promise(resolve => {
            loader.load(url, hdr => {
                if (token !== environmentLoadToken) { hdr.dispose(); resolve(false); return; }
                const pmrem = new THREE.PMREMGenerator(r);
                pmrem.compileEquirectangularShader();
                let generated;
                try { generated = pmrem.fromEquirectangular(hdr); }
                catch (error) { console.warn('SAFAR EDGE HDR conversion failed:', error); hdr.dispose(); pmrem.dispose(); setEnvironmentStatus('HDR conversion failed; standard lighting remains active.'); resolve(false); return; }
                const nextTexture = generated.texture;
                const previousTarget = environmentTarget;
                s.environment = nextTexture;
                environmentTarget = generated;
                environmentTexture = nextTexture;
                environmentSource = url;
                hdr.dispose();
                pmrem.dispose();
                if (previousTarget && previousTarget !== generated) previousTarget.dispose();
                setEnvironmentStatus('HDR reflections active: ' + name);
                resolve(true);
            }, undefined, error => {
                if (token === environmentLoadToken) setEnvironmentStatus('Could not load HDR environment. Check network/CORS; standard lighting remains active.');
                console.warn('SAFAR EDGE HDR load failed:', error);
                resolve(false);
            });
        });
    }

    function createEnvironmentControls() {
        const pane = global.document.getElementById('cad-pane');
        if (!pane) return;
        if (environmentControl && environmentControl.isConnected) return;
        const wrap = global.document.createElement('div');
        wrap.id = 'safar-hdri-controls';
        wrap.style.cssText = 'display:flex;flex-direction:column;align-items:stretch;gap:3px;padding:5px 1px 0;margin-top:2px;border-top:1px solid #435367;font:11px Segoe UI,Arial,sans-serif;color:#dce6f2;';
        const label = global.document.createElement('label');
        label.textContent = 'ENV';
        label.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:.1em;color:#9fb2c8;';
        const select = global.document.createElement('select');
        select.id = 'safar-hdri-select';
        select.style.cssText = 'box-sizing:border-box;width:100%;min-width:0;max-width:100%;background:#263545;color:#edf3f9;border:1px solid #50647a;border-radius:3px;padding:5px 4px;font:10px Segoe UI,Arial,sans-serif;';
        [['Studio softbox','Studio softbox'],['Outdoor daylight','Outdoor daylight'],['Sunset','Sunset'],['No HDR','No HDR']].forEach(([value,text])=>{
            const option=global.document.createElement('option'); option.value=value; option.textContent=text; select.appendChild(option);
        });
        select.value = 'Studio softbox';
        select.addEventListener('mousedown', event => event.stopPropagation());
        select.addEventListener('click', event => event.stopPropagation());
        select.addEventListener('change', () => loadEnvironment(select.value === 'No HDR' ? null : select.value));
        wrap.append(label, select);
        const nav = createViewCube();
        if (nav) nav.appendChild(wrap); else pane.appendChild(wrap);
        environmentControl = select;
        environmentControl.title = 'Choose an HDR environment for realistic material reflections. The selected 1K map is loaded only when needed.';
    }

    function addLighting() {
        if (lightsAdded) return;
        const s = scene();
        if (!s) return;
        const ambient = new THREE.HemisphereLight(0xeaf2ff, 0x66584a, 1.05);
        ambient.name = 'SAFAR_3D_HEMISPHERE';
        const key = new THREE.DirectionalLight(0xfff1dc, 2.15);
        key.name = 'SAFAR_3D_KEY_LIGHT';
        key.position.set(-600, -800, 1200);
        key.castShadow = true;
        if (key.shadow) {
            key.shadow.mapSize.set(1024, 1024);
            key.shadow.camera.near = 1;
            key.shadow.camera.far = 5000;
            key.shadow.bias = -0.00015;
            key.shadow.normalBias = 0.025;
        }
        const fill = new THREE.DirectionalLight(0xc8ddff, 0.72);
        fill.name = 'SAFAR_3D_FILL_LIGHT';
        fill.position.set(700, 500, 450);
        const rim = new THREE.DirectionalLight(0xffffff, 0.38);
        rim.name = 'SAFAR_3D_RIM_LIGHT';
        rim.position.set(0, 900, 650);
        s.add(ambient, key, fill, rim);
        lightsAdded = true;
    }

    function updateViewButtonStates() {
        Object.keys(viewButtons).forEach(view => {
            const btn = viewButtons[view];
            if (!btn) return;
            const active = activeStandardView === view;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            btn.style.background = active ? '#0e7490' : '#303d4b';
            btn.style.borderColor = active ? '#67e8f9' : '#536477';
            btn.style.color = '#ffffff';
            btn.style.boxShadow = active ? 'inset 0 0 0 1px rgba(103,232,249,.35),0 0 7px rgba(34,211,238,.25)' : 'none';
        });
    }

    function getOrCreateCadSidePanel() {
        const pane = global.document.getElementById('cad-pane');
        if (!pane) return null;
        if (sidePanel && sidePanel.isConnected) return sidePanel;
        sidePanel = global.document.getElementById('safar-cad-side-panel');
        if (!sidePanel) {
            sidePanel = global.document.createElement('div');
            sidePanel.id = 'safar-cad-side-panel';
            sidePanel.setAttribute('aria-label', 'CAD Side Panel');
            sidePanel.style.cssText = 'position:absolute;right:6px;top:6px;z-index:1200;display:flex;flex-direction:column;align-items:stretch;gap:5px;width:190px;max-width:calc(100% - 12px);max-height:calc(100% - 12px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;box-sizing:border-box;padding:4px;background:rgba(10,16,24,.22);border:1px solid rgba(110,130,150,.35);border-radius:7px;backdrop-filter:blur(5px);font:10px Segoe UI,Arial,sans-serif;pointer-events:auto;scrollbar-width:thin;';
            const panelTitle = global.document.createElement('div');
            panelTitle.textContent = 'CAD SIDE PANEL';
            panelTitle.style.cssText = 'flex:none;padding:5px 7px;text-align:center;background:rgba(20,29,40,.97);border:1px solid #435367;border-radius:5px;color:#dce6f2;font-size:9px;font-weight:700;letter-spacing:.12em;box-shadow:0 2px 8px rgba(0,0,0,.22);pointer-events:auto;';
            sidePanel.appendChild(panelTitle);
            pane.appendChild(sidePanel);
        }
        return sidePanel;
    }

    function createViewCube() {
        if (viewCube && viewCube.isConnected) return viewCube;
        const panel = getOrCreateCadSidePanel();
        if (!panel) return null;
        viewCube = global.document.createElement('div');
        viewCube.id = 'safar-cad-side-panel-navigation';
        viewCube.style.cssText = 'position:relative;flex:none;display:flex;flex-direction:column;gap:4px;padding:5px;background:rgba(20,29,40,.97);border:1px solid #435367;border-radius:5px;box-shadow:0 3px 12px rgba(0,0,0,.28);font:11px Segoe UI,Arial,sans-serif;pointer-events:auto;';
        const title = global.document.createElement('div');
        title.textContent = 'VIEW NAVIGATION';
        title.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:.1em;color:#9fb2c8;text-align:left;padding:0 1px 3px;';
        viewCube.appendChild(title);
        const rows = [
            [['TOP', 'top'], ['ISO', 'iso']],
            [['FRONT', 'front'], ['BACK', 'back']],
            [['LEFT', 'left'], ['RIGHT', 'right']],
            [['BOTTOM', 'bottom'], ['FIT', 'fit']]
        ];
        rows.forEach(row => {
            const line = global.document.createElement('div');
            line.style.cssText = 'display:flex;gap:4px;';
            row.forEach(([label, view]) => {
                const btn = global.document.createElement('button');
                btn.type = 'button';
                btn.textContent = label;
                btn.style.cssText = 'flex:1;min-width:0;padding:5px 3px;color:#e5edf6;background:#293747;border:1px solid #46596d;border-radius:3px;cursor:pointer;font-size:10px;font-weight:600;letter-spacing:.02em;transition:background .12s,border-color .12s,box-shadow .12s;';
                btn.title = view === 'iso' ? '3D isometric view: hold the mouse wheel and drag to pan; use the view controls to change orientation' : `${label} orthographic view: hold the mouse wheel and drag to pan`;
                btn.addEventListener('click', event => { event.stopPropagation(); setStandardView(view); });
                viewButtons[view] = btn;
                line.appendChild(btn);
            });
            viewCube.appendChild(line);
        });
        panel.appendChild(viewCube);
        updateViewButtonStates();
        return viewCube;
    }

    function getLayerNames() {
        if (!CAD.Dimension || typeof CAD.Dimension.getSettings !== 'function') return ['0'];
        const settings = CAD.Dimension.getSettings() || {};
        const names = Object.keys(settings.layers || {}).sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
        );
        return names.length ? names : ['0'];
    }

    function getCurrentLayerName() {
        const settings = CAD.Dimension && CAD.Dimension.getSettings
            ? (CAD.Dimension.getSettings() || {}) : {};
        return CAD.Dimension && CAD.Dimension.getCurrentLayer
            ? CAD.Dimension.getCurrentLayer()
            : (settings.currentLayer || '0');
    }

    function refreshObjectLayerOptions() {
        if (!layerQuickSelect) return;
        const ctx = CAD.createContext();
        const selected = (ctx.getSelectedObjects() || []).filter(Boolean);
        const layerNames = getLayerNames();
        const selectedLayers = [...new Set(selected.map(object =>
            String((object.userData || {}).layer || '0')
        ))];
        const currentLayer = getCurrentLayerName();

        layerQuickSelect.innerHTML = '';
        layerNames.forEach(name => {
            const option = global.document.createElement('option');
            option.value = name;
            option.textContent = name;
            layerQuickSelect.appendChild(option);
        });

        if (selected.length && selectedLayers.length > 1) {
            const mixed = global.document.createElement('option');
            mixed.value = '__mixed__';
            mixed.textContent = `Mixed layers (${selected.length})`;
            mixed.disabled = true;
            layerQuickSelect.insertBefore(mixed, layerQuickSelect.firstChild);
            layerQuickSelect.value = '__mixed__';
            layerQuickSelect.title = `${selected.length} selected objects belong to different layers. Choose a layer to assign all of them.`;
        } else {
            const shownLayer = selected.length ? selectedLayers[0] : currentLayer;
            if (shownLayer && !layerNames.includes(shownLayer)) {
                const option = global.document.createElement('option');
                option.value = shownLayer;
                option.textContent = shownLayer;
                layerQuickSelect.appendChild(option);
            }
            layerQuickSelect.value = shownLayer;
            layerQuickSelect.title = selected.length
                ? `Layer of ${selected.length} selected object(s). Change to move the selection to another layer.`
                : 'Current drawing layer. Choose a layer for newly created objects.';
        }

        layerQuickSelect.disabled = false;
        layerQuickSelect.dataset.selectionCount = String(selected.length);
    }

    function assignSelectedObjectsToLayer(layerName) {
        const ctx = CAD.createContext();
        const selected = (ctx.getSelectedObjects() || []).filter(Boolean);
        if (!selected.length || !layerName) return false;
        const before = ctx.captureObjects(selected);
        selected.forEach(object => {
            object.userData = object.userData || {};
            object.userData.layer = layerName;
            object.userData.layerName = layerName;
        });
        ctx.recordModify(selected, before);
        if (global.SafarEdgeProjectFiles) global.SafarEdgeProjectFiles.markDirty();
        refreshObjectLayerOptions();
        ctx.setPrompt(`LAYER — Assigned ${selected.length} selected object(s) to layer "${layerName}".`);
        return true;
    }

    function createQuickLayerSelector() {
        const panel = getOrCreateCadSidePanel();
        const nav = createViewCube();
        if (!panel || !nav) return null;
        if (layerQuickPanel && layerQuickPanel.isConnected) {
            refreshObjectLayerOptions();
            return layerQuickPanel;
        }

        layerQuickPanel = global.document.createElement('div');
        layerQuickPanel.id = 'safar-cad-side-panel-object-layer';
        layerQuickPanel.style.cssText = 'position:relative;flex:none;display:flex;flex-direction:column;gap:4px;padding:5px;background:rgba(20,29,40,.97);border:1px solid #435367;border-radius:5px;box-shadow:0 3px 12px rgba(0,0,0,.28);font:11px Segoe UI,Arial,sans-serif;pointer-events:auto;';

        const label = global.document.createElement('label');
        label.htmlFor = 'safar-object-layer-select';
        label.textContent = 'OBJECT LAYER';
        label.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:.1em;color:#9fb2c8;padding:0 1px 2px;';

        layerQuickSelect = global.document.createElement('select');
        layerQuickSelect.id = 'safar-object-layer-select';
        layerQuickSelect.style.cssText = 'box-sizing:border-box;width:100%;min-width:0;background:#263545;color:#edf3f9;border:1px solid #50647a;border-radius:3px;padding:6px 5px;font:11px Segoe UI,Arial,sans-serif;outline:none;';
        layerQuickSelect.addEventListener('mousedown', event => event.stopPropagation());
        layerQuickSelect.addEventListener('click', event => event.stopPropagation());
        layerQuickSelect.addEventListener('focus', refreshObjectLayerOptions);
        layerQuickSelect.addEventListener('change', () => {
            const value = layerQuickSelect.value;
            if (!value || value === '__mixed__') {
                refreshObjectLayerOptions();
                return;
            }
            const selected = CAD.createContext().getSelectedObjects().filter(Boolean);
            if (selected.length) {
                assignSelectedObjectsToLayer(value);
            } else if (CAD.Dimension && CAD.Dimension.setCurrentLayer(value)) {
                if (global.SafarEdgeProjectFiles) global.SafarEdgeProjectFiles.markDirty();
                refreshObjectLayerOptions();
            }
        });

        layerQuickPanel.append(label, layerQuickSelect);
        panel.appendChild(layerQuickPanel);
        createExtrudeHeightControl(panel);
        refreshObjectLayerOptions();
        return layerQuickPanel;
    }

    let dimensionInputs = {};
    function createExtrudeHeightControl(panel) {
        if (!panel) return null;
        let section = global.document.getElementById('safar-cad-side-panel-extrude');
        if (section && section.isConnected) {
            extrudeHeightInput = section.querySelector('#safar-extrude-height-input');
            dimensionInputs = {
                length: section.querySelector('#safar-object-length-input'),
                width: section.querySelector('#safar-object-width-input'),
                radius: section.querySelector('#safar-object-radius-input'),
                benchmark: section.querySelector('#safar-benchmark-rl-input'),
                bottomRL: section.querySelector('#safar-bottom-rl-input'),
                topRL: section.querySelector('#safar-top-rl-input')
            };
            refreshDimensionPanel();
            return section;
        }
        section = global.document.createElement('div');
        section.id = 'safar-cad-side-panel-extrude';
        section.style.cssText = 'position:relative;flex:none;display:grid;grid-template-columns:1fr;gap:4px;padding:6px;background:rgba(20,29,40,.98);border:1px solid #435367;border-radius:5px;box-shadow:0 3px 12px rgba(0,0,0,.28);font:10px Segoe UI,Arial,sans-serif;pointer-events:auto;box-sizing:border-box;';
        const makeField = (id, labelText, title) => {
            const wrap = global.document.createElement('label');
            wrap.style.cssText = 'display:grid;grid-template-columns:minmax(78px, .9fr) minmax(0,1.1fr);align-items:center;gap:5px;color:#b7c7d8;font-size:9px;font-weight:650;letter-spacing:.02em;min-width:0;';
            wrap.textContent = labelText;
            const input = global.document.createElement('input');
            input.type = 'number'; input.id = id; input.min = '-100000000'; input.step = 'any'; input.title = title;
            input.style.cssText = 'box-sizing:border-box;width:100%;min-width:0;height:25px;background:#263545;color:#edf3f9;border:1px solid #50647a;border-radius:3px;padding:3px 5px;font:10px Segoe UI,Arial,sans-serif;outline:none;';
            input.addEventListener('mousedown', event => event.stopPropagation());
            input.addEventListener('click', event => event.stopPropagation());
            wrap.appendChild(input); section.appendChild(wrap); return input;
        };
        extrudeHeightInput = makeField('safar-extrude-height-input', 'EXTRUDE HEIGHT (mm)', 'Select a profile and press Enter to extrude, or a solid and press Enter to change its height.');
        dimensionInputs.length = makeField('safar-object-length-input', 'LENGTH (mm)', 'Selected object overall length. Edit and press Enter to apply.');
        dimensionInputs.width = makeField('safar-object-width-input', 'WIDTH (mm)', 'Selected object overall width. Edit and press Enter to apply.');
        dimensionInputs.radius = makeField('safar-object-radius-input', 'RADIUS (mm)', 'Selected circle/cylinder radius. Edit and press Enter to apply.');
        dimensionInputs.benchmark = makeField('safar-benchmark-rl-input', 'DATUM RL (m)', 'Editable project benchmark. World Z=0 corresponds to this RL.');
        dimensionInputs.bottomRL = makeField('safar-bottom-rl-input', 'BOTTOM RL (m)', 'Selected solid bottom reduced level. Edit and press Enter to move vertically.');
        dimensionInputs.topRL = makeField('safar-top-rl-input', 'TOP RL (m)', 'Selected solid top reduced level. Edit and press Enter to adjust its height.');
        dimensionInputs.benchmark.value = benchmarkRL.toFixed(3);
        [extrudeHeightInput, dimensionInputs.length, dimensionInputs.width, dimensionInputs.radius, dimensionInputs.benchmark, dimensionInputs.bottomRL, dimensionInputs.topRL].forEach(input => {
            input.addEventListener('keydown', event => {
                if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); applyDimensionInput(input); }
            });
        });
        extrudeHeightInput.addEventListener('input', () => {
            const value = Number(extrudeHeightInput.value);
            if (Number.isFinite(value) && value > 0) extrudeHeightMm = value;
        });
        panel.appendChild(section);
        refreshDimensionPanel();
        return section;
    }

    function localGeometryBounds(object) {
        if (!object || !object.geometry) return null;
        object.geometry.computeBoundingBox();
        const box = object.geometry.boundingBox;
        return box && !box.isEmpty() ? box.clone() : null;
    }

    function refreshDimensionPanel() {
        if (!extrudeHeightInput || !extrudeHeightInput.isConnected) return;
        const selected = context().getSelectedObjects().filter(Boolean);
        const single = selected.length === 1 ? selected[0] : null;
        const data = single && single.userData ? single.userData : {};
        const isSolid = data.type === 'solid';
        const box = single ? localGeometryBounds(single) : null;
        const dims = box ? { length: box.max.x - box.min.x, width: box.max.y - box.min.y, height: box.max.z - box.min.z } : null;
        const circle = single && (data.type === 'circle' || String(data.profileType || '').toLowerCase() === 'circle');
        if (isSolid) {
            const h = Number(data.height) || (dims && dims.height) || extrudeHeightMm;
            extrudeHeightInput.value = String(h);
            extrudeHeightInput.title = 'Selected solid height. Change and press Enter to resize.';
        } else if (!selected.length) {
            extrudeHeightInput.value = String(extrudeHeightMm);
            extrudeHeightInput.title = 'Default extrusion height. Select a closed profile and press Enter.';
        } else {
            extrudeHeightInput.value = String(extrudeHeightMm);
            extrudeHeightInput.title = 'Select a closed profile, enter height and press Enter to extrude.';
        }
        if (dimensionInputs.length) dimensionInputs.length.value = dims ? String(dims.length) : '';
        if (dimensionInputs.width) dimensionInputs.width.value = dims ? String(dims.width) : '';
        if (dimensionInputs.radius) {
            dimensionInputs.radius.value = circle ? String(Number(data.radius) || (dims ? Math.max(dims.length, dims.width) / 2 : '')) : '';
            dimensionInputs.radius.closest('label').style.display = circle ? 'grid' : 'none';
        }
        ['length','width'].forEach(key => { if (dimensionInputs[key]) dimensionInputs[key].disabled = !single || !!circle; });
        const worldBox = single ? new THREE.Box3().setFromObject(single) : null;
        const showLevels = !!(isSolid && worldBox && !worldBox.isEmpty());
        if (dimensionInputs.benchmark) {
            if (global.document.activeElement !== dimensionInputs.benchmark) dimensionInputs.benchmark.value = benchmarkRL.toFixed(3);
        }
        if (dimensionInputs.bottomRL) {
            dimensionInputs.bottomRL.value = showLevels ? (benchmarkRL + worldBox.min.z / 1000).toFixed(3) : '';
            dimensionInputs.bottomRL.disabled = !showLevels;
        }
        if (dimensionInputs.topRL) {
            dimensionInputs.topRL.value = showLevels ? (benchmarkRL + worldBox.max.z / 1000).toFixed(3) : '';
            dimensionInputs.topRL.disabled = !showLevels;
        }
        if (dimensionInputs.benchmark) dimensionInputs.benchmark.disabled = false;
        if (extrudeHeightInput) extrudeHeightInput.disabled = selected.length > 1;
    }

    function applyDimensionInput(input) {
        const value = Number(input.value);
        const isElevationField = input === dimensionInputs.benchmark || input === dimensionInputs.bottomRL || input === dimensionInputs.topRL;
        if (!Number.isFinite(value) || (!isElevationField && value <= 0)) { context().setPrompt('DIMENSION — Enter a valid positive dimension or a valid elevation.'); return; }
        const selected = context().getSelectedObjects().filter(Boolean);
        if (input === dimensionInputs.benchmark) {
            benchmarkRL = value;
            refreshDimensionPanel();
            if (global.SafarEdgeProjectFiles) global.SafarEdgeProjectFiles.markDirty();
            context().setPrompt(`DATUM RL — Project benchmark set to ${benchmarkRL.toFixed(3)} m.`);
            return;
        }
        if (input === dimensionInputs.bottomRL || input === dimensionInputs.topRL) {
            if (selected.length !== 1 || !selected[0].userData || selected[0].userData.type !== 'solid') {
                context().setPrompt('LEVEL — Select exactly one extruded solid to edit its levels.'); return;
            }
            const object = selected[0];
            const worldBox = new THREE.Box3().setFromObject(object);
            if (worldBox.isEmpty()) return;
            const before = context().captureObjects([object]);
            if (input === dimensionInputs.bottomRL) {
                const targetWorldZ = (value - benchmarkRL) * 1000;
                object.position.z += targetWorldZ - worldBox.min.z;
            } else {
                const bottomRL = benchmarkRL + worldBox.min.z / 1000;
                const requestedHeight = (value - bottomRL) * 1000;
                if (requestedHeight <= 0) { context().setPrompt('LEVEL ERROR — Top RL must be higher than bottom RL.'); return; }
                setSelectedSolidHeight(requestedHeight);
                return;
            }
            object.updateMatrixWorld(true);
            context().recordModify([object], before);
            if (global.SafarEdgeProjectFiles) global.SafarEdgeProjectFiles.markDirty();
            refreshDimensionPanel();
            context().setPrompt('LEVEL — Selected solid elevation updated.');
            return;
        }
        if (input === extrudeHeightInput) {
            extrudeHeightMm = value;
            const solids = selected.filter(o => o.userData && o.userData.type === 'solid');
            const profiles = selected.filter(o => o.userData && ['rect','rectangle','square','polyline','circle'].includes(String(o.userData.type).toLowerCase()));
            if (solids.length && !profiles.length) setSelectedSolidHeight(value);
            else if (profiles.length && !solids.length) extrudeSelected(value);
            else if (!selected.length) context().setPrompt(`EXTRUDE HEIGHT — ${value} mm saved as default. Select a closed profile and press Enter.`);
            else context().setPrompt('DIMENSION — Select only profiles or only solids.');
            return;
        }
        if (selected.length !== 1) { context().setPrompt('DIMENSION — Select exactly one object to edit its dimensions.'); return; }
        const object = selected[0], data = object.userData || {}, isCircle = data.type === 'circle' || String(data.profileType || '').toLowerCase() === 'circle';
        if (input === dimensionInputs.radius && isCircle) resizeGeometryAroundCenter(object, value, value);
        else if (input === dimensionInputs.length) resizeGeometryAroundCenter(object, value, null);
        else if (input === dimensionInputs.width) resizeGeometryAroundCenter(object, null, value);
        else { context().setPrompt('DIMENSION — This field is not applicable to the selected object.'); return; }
        if (isCircle && input === dimensionInputs.radius) data.radius = value;
        updateSolidEdges(object);
        if (context().recordModify) context().recordModify([object], context().captureObjects([object]));
        if (global.SafarEdgeProjectFiles) global.SafarEdgeProjectFiles.markDirty();
        if (global.SafarEdgeMeasurements) {
            global.SafarEdgeMeasurements.syncFromMenu({ source: 'manual' });
            const audit = global.SafarEdgeMeasurements.auditCurrentDrawing && global.SafarEdgeMeasurements.auditCurrentDrawing();
            if (audit && !audit.ok) console.warn('SAFAR EDGE measurement audit found issues:', audit);
        }
        refreshDimensionPanel();
        context().setPrompt('DIMENSION — Updated selected object; measurement check completed.');
    }

    function resizeGeometryAroundCenter(object, targetLength, targetWidth) {
        const geometry = object.geometry;
        if (!geometry) return false;
        const box = localGeometryBounds(object); if (!box) return false;
        const oldX = box.max.x - box.min.x, oldY = box.max.y - box.min.y;
        const isCircle = object.userData && (object.userData.type === 'circle' || String(object.userData.profileType || '').toLowerCase() === 'circle');
        const wantedX = targetLength || (isCircle ? targetWidth : oldX);
        const wantedY = targetWidth || (isCircle ? targetLength : oldY);
        const sx = wantedX && oldX > 0 ? wantedX / oldX : 1;
        const sy = wantedY && oldY > 0 ? wantedY / oldY : 1;
        const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2;
        const pos = geometry.getAttribute('position'); if (!pos) return false;
        for (let i = 0; i < pos.count; i++) { pos.setX(i, cx + (pos.getX(i) - cx) * sx); pos.setY(i, cy + (pos.getY(i) - cy) * sy); }
        pos.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        if (isCircle && object.userData) object.userData.radius = Number(object.userData.radius || oldX / 2) * Math.max(sx, sy);
        return true;
    }

    function updateSolidEdges(object) {
        if (!object || !object.geometry) return;
        const edge = object.children && object.children.find(child =>
            child.userData && child.userData.isCadSolidEdges
        );
        if (edge && edge.geometry) edge.geometry.dispose();
        if (edge) edge.userData.sourcePositionVersion = -1;
        ensureSolidEdges(object);
        applySolidDisplay();
    }

    function getSharedExtrudeHeight() {
        if (extrudeHeightInput) {
            const value = Number(extrudeHeightInput.value);
            if (Number.isFinite(value) && value > 0) extrudeHeightMm = value;
        }
        return Number.isFinite(extrudeHeightMm) && extrudeHeightMm > 0 ? extrudeHeightMm : null;
    }

    global.SafarEdgeRefreshSidePanel = function () {
        refreshObjectLayerOptions();
        // Keep this public refresh hook aligned with the actual side-panel
        // implementation. It is called during project open and AutoSave restore.
        refreshDimensionPanel();
    };
    function setViewVisible(visible) {
        const cube = createViewCube();
        if (cube) cube.style.display = 'flex';
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
        cam.near = 0.1;
        cam.far = Math.max(5000, distance + modelExtent * 10);
        cam.up.copy(up || new THREE.Vector3(0, 0, 1));
        cam.position.copy(target).add(direction.clone().normalize().multiplyScalar(distance));
        cam.lookAt(target);
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);
    }

    function getVisibleModelBounds() {
        const objects = context().getObjects().filter(o => o && o.visible !== false);
        const box = new THREE.Box3();
        objects.forEach(o => {
            if (typeof o.updateMatrixWorld === 'function') o.updateMatrixWorld(true);
            box.expandByObject(o);
        });
        return box;
    }

    function setStandardView(view) {
        const zUp = new THREE.Vector3(0, 0, 1);
        const yUp = new THREE.Vector3(0, 1, 0);
        activeStandardView = view;
        orbitEnabled = (view === 'iso' || view === 'home');
        if (view === 'fit') {
            // FIT frames the model without changing its coordinates or forcing
            // the camera into ISO. The current view direction is retained.
            fitModel();
        } else {
            // Re-aim the camera at the model's actual world-space centre every
            // time the view changes. Never translate or rotate the CAD objects.
            const box = getVisibleModelBounds();
            if (!box.isEmpty()) {
                box.getCenter(target);
                const size = box.getSize(new THREE.Vector3());
                modelExtent = Math.max(size.x, size.y, size.z, 1);
            }
            if (view === 'top') setCameraPose(new THREE.Vector3(0, 0, 1), yUp);
            else if (view === 'front') setCameraPose(new THREE.Vector3(0, -1, 0), zUp);
            else if (view === 'back') setCameraPose(new THREE.Vector3(0, 1, 0), zUp);
            else if (view === 'left') setCameraPose(new THREE.Vector3(-1, 0, 0), zUp);
            else if (view === 'right') setCameraPose(new THREE.Vector3(1, 0, 0), zUp);
            else if (view === 'bottom') setCameraPose(new THREE.Vector3(0, 0, -1), yUp);
            else if (view === 'iso' || view === 'home') setCameraPose(new THREE.Vector3(1, -1, 0.85), zUp);
        }
        updateViewButtonStates();
    }

    function fitModel(extraBounds) {
        const box = getVisibleModelBounds();
        if (extraBounds && extraBounds.isBox3 && !extraBounds.isEmpty()) {
            box.union(extraBounds);
        }
        const cam = camera();
        if (!cam) return;
        if (box.isEmpty()) {
            target.set(0, 0, 0);
            modelExtent = 1000;
            cam.zoom = 1;
            cam.position.copy(target).add(new THREE.Vector3(1, -1, 0.85).normalize().multiplyScalar(modelExtent * 2.5));
            cam.up.set(0, 0, 1);
            cam.lookAt(target);
            cam.updateProjectionMatrix();
            cam.updateMatrixWorld(true);
            return;
        }

        box.getCenter(target);
        const size = box.getSize(new THREE.Vector3());
        modelExtent = Math.max(size.x, size.y, size.z, 1);

        // Keep the current camera direction and projection. Move only the
        // camera target to the model centre, then calculate a zoom that fits
        // every visible object's bounding-box corners inside the viewport.
        let direction = cam.position.clone().sub(target);
        if (direction.lengthSq() < 1e-8) direction.set(1, -1, 0.85);
        direction.normalize();
        const currentUp = cam.up.clone();
        const fitDistance = Math.max(1000, modelExtent * 2.5);
        cam.near = 0.1;
        cam.far = Math.max(5000, fitDistance + modelExtent * 10);
        cam.position.copy(target).add(direction.multiplyScalar(fitDistance));
        cam.up.copy(currentUp);
        cam.lookAt(target);
        cam.updateMatrixWorld(true);

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
        cam.zoom = clamp(0.82 * Math.min(frustumWidth / projectedWidth, frustumHeight / projectedHeight), 0.000001, 100000);
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);
    }

    // Return the active drafting plane and its screen-aligned local axes.
    // Top/ISO use the world XY plane; Front/Back use XZ; Left/Right use YZ.
    // The plane passes through the current view target so cursor rays always
    // intersect it instead of becoming parallel to the old fixed XY plane.
    function getDrawingFrame() {
        const cam = camera();
        if (!cam) {
            const origin = new THREE.Vector3(0, 0, 0);
            const u = new THREE.Vector3(1, 0, 0);
            const v = new THREE.Vector3(0, 1, 0);
            const normal = new THREE.Vector3(0, 0, 1);
            return { origin, u, v, normal, plane: new THREE.Plane(normal, 0) };
        }

        cam.updateMatrixWorld(true);
        const origin = target.clone();
        let normal;
        if (activeStandardView === 'front' || activeStandardView === 'back') {
            normal = new THREE.Vector3(0, 1, 0);
        } else if (activeStandardView === 'left' || activeStandardView === 'right') {
            normal = new THREE.Vector3(1, 0, 0);
        } else {
            normal = new THREE.Vector3(0, 0, 1);
            origin.z = 0;
        }

        let u;
        let v;
        if (activeStandardView === 'front' || activeStandardView === 'back') {
            u = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).normalize();
            v = new THREE.Vector3(0, 0, 1);
        } else if (activeStandardView === 'left' || activeStandardView === 'right') {
            u = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).normalize();
            v = new THREE.Vector3(0, 0, 1);
        } else {
            // Top and ISO drafting remains on the world XY plane.
            u = new THREE.Vector3(1, 0, 0);
            v = new THREE.Vector3(0, 1, 0);
        }
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
        return { origin, u, v, normal, plane };
    }

    function toggleMode() {
        // The workspace is permanently 3D; standard views are orthographic camera views.
        return '3D';
    }

    function cancelCorePointerGesture() {
        if (global.CADInteraction && typeof global.CADInteraction.cancelPointerGesture === 'function') {
            global.CADInteraction.cancelPointerGesture();
        }
    }

    function onDown(event) {
        if (event.target && event.target.closest && event.target.closest('#safar-3d-navigation')) return;
        // A deliberate left+right chord is the ISO orbit gesture. The first
        // button may already have started a SELECT window in the CAD core, so
        // cancel that state as soon as the second button joins the chord.
        if (event.buttons === 3 || (navigationGestureActive && event.buttons !== 0)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            navigationGestureActive = true;
            suppressNavigationClick = true;
            cancelCorePointerGesture();
            const el = renderer()?.domElement;
            if (!drag) drag = { x: event.clientX, y: event.clientY, moved: false, previousCursor: el ? el.style.cursor : '' };
            drag.kind = 'orbit';
            drag.x = event.clientX;
            drag.y = event.clientY;
            if (el) el.style.cursor = 'grabbing';
            return;
        }
        if (event.button !== 1 && event.button !== 2) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const el = renderer()?.domElement;
        drag = {
            x: event.clientX, y: event.clientY, button: event.button,
            moved: false, kind: 'pan', previousCursor: el ? el.style.cursor : ''
        };
        if (el) el.style.cursor = 'grabbing';
    }

    function onMove(event) {
        if (!drag || (!navigationGestureActive && event.buttons === 0)) return;
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
        if (!drag && !navigationGestureActive) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        // MouseEvent.buttons reports the other button still held. Keep the
        // orbit session alive until BOTH left and right buttons are released.
        if (navigationGestureActive && event.buttons !== 0) return;
        const el = renderer()?.domElement;
        drag = null;
        if (navigationGestureActive) {
            navigationGestureActive = false;
            suppressNavigationClick = true;
            global.setTimeout(() => { suppressNavigationClick = false; }, 0);
            cancelCorePointerGesture();
            // Cancellation clears selection/grip/pan state. Restore the actual
            // CAD selection cursor last so no cleanup callback leaves a hand.
            if (global.SafarEdgeCadCursor && typeof global.SafarEdgeCadCursor.restore === 'function') {
                global.SafarEdgeCadCursor.restore();
            } else if (el) {
                el.style.cursor = 'crosshair';
            }
        } else if (el) {
            el.style.cursor = drag && drag.previousCursor ? drag.previousCursor : '';
        }
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
        if (!suppressNavigationClick) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressNavigationClick = false;
    }

    function onWheel(event) {

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
        el.addEventListener('click', onClickCapture, true);
        global.addEventListener('mousemove', onMove, true);
        global.addEventListener('mouseup', onUp, true);
        global.addEventListener('blur', () => {
            if (!drag && !navigationGestureActive) return;
            drag = null; navigationGestureActive = false; suppressNavigationClick = true;
            cancelCorePointerGesture();
            if (global.SafarEdgeCadCursor && typeof global.SafarEdgeCadCursor.restore === 'function') {
                global.SafarEdgeCadCursor.restore();
            } else {
                el.style.cursor = 'crosshair';
            }
        });
        el.addEventListener('wheel', onWheel, { capture: true, passive: false });
        el.addEventListener('contextmenu', event => event.preventDefault(), true);
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
            // Keep mesh alive for depth; FILL controls surface colour only.
            material.visible = true;
            material.colorWrite = solidFillEnabled;
            const solid = new THREE.Mesh(geometry, material);
            solid.castShadow = true;
            solid.receiveShadow = true;
            const edgeLines = new THREE.LineSegments(
                new THREE.EdgesGeometry(geometry, 1.5),
                new THREE.LineBasicMaterial({
                    color: (CAD.Dimension.getSettings().layers[
                        String((profile.userData && profile.userData.layer) || '0')
                    ] || {}).color || '#ffffff',
                    depthTest: false,
                    depthWrite: false,
                    transparent: false, toneMapped: false
                })
            );
            edgeLines.name = 'SAFAR_EDGE_SOLID_OUTLINES';
            edgeLines.userData.isCadSolidEdges = true;
            edgeLines.userData.sourceGeometryId = geometry.uuid;
            edgeLines.userData.sourcePositionVersion = geometry.getAttribute('position')?.version || 0;
            edgeLines.renderOrder = 1000;
            edgeLines.frustumCulled = false;
            edgeLines.visible = !solidFillEnabled;
            solid.add(edgeLines);
            const factor = result.area / Math.max(result.length * result.width, 1e-12);
            const profileType = String(
                (profile.userData && profile.userData.type) || 'polyline'
            ).toLowerCase();
            solid.userData = {
                type: 'solid', closed: true, is3D: true,
                layer: (profile.userData && profile.userData.layer) || '0',
                height: height, baseArea: result.area, baseAreaFactor: factor,
                profileType: profileType,
                // Keep the source circle radius for cylinder takeoff.
                // Do not derive it from the solid bounding-box diameter.
                radius: profileType === 'circle'
                    ? Number(profile.userData && profile.userData.radius)
                    : null,
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
        refreshDimensionPanel();
        if (global.SafarEdgeMeasurements) {
            const syncResult = global.SafarEdgeMeasurements.syncFromMenu({ source: 'manual' });
            const audit = global.SafarEdgeMeasurements.auditCurrentDrawing && global.SafarEdgeMeasurements.auditCurrentDrawing();
            if (audit && !audit.ok) console.warn('SAFAR EDGE post-extrusion measurement audit:', audit);
            if (syncResult && !syncResult.ok) console.warn('SAFAR EDGE measurement sync after extrusion failed:', syncResult.message);
        }
        ctx.setPrompt(`EXTRUDE — Created ${created.length} solid(s), ${height} mm. Outlines and measurement check refreshed.`);
        return true;
    }

    function beginExtrude(ctx) {
        const selected = ctx.getSelectedObjects();
        if (!selected.length) {
            ctx.setPrompt('EXTRUDE — Select closed profiles, then run EXTRUDE.');
            return;
        }
        const sharedHeight = getSharedExtrudeHeight();
        if (sharedHeight) {
            const profiles = selected.filter(o => o && ['rect','rectangle','square','polyline','circle'].includes(String((o.userData || {}).type).toLowerCase()));
            if (profiles.length) {
                extrudeSelected(sharedHeight);
                return;
            }
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
        refreshDimensionPanel();
        if (global.SafarEdgeMeasurements) {
            const syncResult = global.SafarEdgeMeasurements.syncFromMenu({ source: 'manual' });
            const audit = global.SafarEdgeMeasurements.auditCurrentDrawing && global.SafarEdgeMeasurements.auditCurrentDrawing();
            if (audit && !audit.ok) console.warn('SAFAR EDGE post-height measurement audit:', audit);
            if (syncResult && !syncResult.ok) console.warn('SAFAR EDGE measurement sync after height edit failed:', syncResult.message);
        }
        ctx.setPrompt(`SOLIDHEIGHT — Updated ${changed} solid(s) to ${height} mm; measurement check refreshed.`);
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
        const sharedHeight = getSharedExtrudeHeight();
        if (sharedHeight) {
            setSelectedSolidHeight(sharedHeight);
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
        // Also stamp the project-scoped preference during every project save.
        persistSolidFillPreference();
        return {
            solidDisplayStateVersion: SOLID_DISPLAY_STATE_VERSION,
            solidFillEnabled: solidFillEnabled,
            benchmarkRL: benchmarkRL,
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
        if (!state || typeof state !== 'object') state = {};
        // Prefer the synchronously persisted per-project value. It survives a
        // hard refresh even if the asynchronous recovery snapshot was interrupted.
        const storedFillPreference = readSolidFillPreference();
        if (storedFillPreference !== null) {
            solidFillEnabled = storedFillPreference;
        } else if (state.solidDisplayStateVersion >= SOLID_DISPLAY_STATE_VERSION &&
            typeof state.solidFillEnabled === 'boolean') {
            solidFillEnabled = state.solidFillEnabled;
        } else {
            solidFillEnabled = true;
        }
        persistSolidFillPreference();
        if (Number.isFinite(Number(state.benchmarkRL))) benchmarkRL = Number(state.benchmarkRL);
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
        mode = '3D';
        updateButton();
        setViewVisible(true);
        addLighting();
        const cam = camera();
        if (cam) cam.up.set(0, 0, 1);
        createEnvironmentControls();
        createQuickLayerSelector();
        rebuildSolidEdgesAfterRestore();
        applySolidDisplay();

        // Restored drawings can finish loading after the viewport is first laid
        // out. Fit only the camera, preserve its direction, and never move CAD entities.
        const fitToken = ++restoreFitToken;
        global.requestAnimationFrame(() => global.requestAnimationFrame(() => {
            global.setTimeout(() => {
                if (fitToken !== restoreFitToken) return;
                const currentRenderer = renderer();
                if (!currentRenderer || !currentRenderer.domElement) return;
                const rect = currentRenderer.domElement.getBoundingClientRect();
                if (rect.width < 40 || rect.height < 40) return;
                const bounds = getVisibleModelBounds();
                if (!bounds || bounds.isEmpty()) return;
                fitModel();
                rebuildSolidEdgesAfterRestore();
                applySolidDisplay();
                refreshDimensionPanel();
            }, 250);
        }));
    }


    // ------------------------------------------------------------
    // Construction material library (client-side procedural textures)
    // ------------------------------------------------------------
    const MATERIAL_PRESETS = {
        'Red brick': { color: '#a94d37', pattern: 'brick', roughness: 0.94 },
        'Concrete': { color: '#aeb2b2', pattern: 'concrete', roughness: 0.92 },
        'TMT / rebar': { color: '#68727b', pattern: 'steel', roughness: 0.48, metalness: 0.72 },
        'Cement plaster': { color: '#d8d4c9', pattern: 'plaster', roughness: 0.9 },
        'Roof sheet': { color: '#647d91', pattern: 'sheet', roughness: 0.55, metalness: 0.62 },
        'Soil': { color: '#79543a', pattern: 'soil', roughness: 1 },
        'Grass': { color: '#64834b', pattern: 'grass', roughness: 1 },
        'Structural steel': { color: '#788795', pattern: 'steel', roughness: 0.42, metalness: 0.78 },
        'Timber': { color: '#98683e', pattern: 'wood', roughness: 0.82 },
        'Glass': { color: '#8fc6d4', pattern: 'plain', roughness: 0.12, metalness: 0.08, transparent: true, opacity: 0.48 },
        'Ceramic tile': { color: '#c8c0b2', pattern: 'tile', roughness: 0.42 },
        'Waterproofing': { color: '#343b45', pattern: 'plain', roughness: 0.78 },
        'Insulation': { color: '#e3c66f', pattern: 'insulation', roughness: 0.95 },
        'Asphalt': { color: '#45494b', pattern: 'concrete', roughness: 0.98 },
        'Sand': { color: '#c8ad78', pattern: 'soil', roughness: 1 },
        'Paint finish': { color: '#e5e2d9', pattern: 'plain', roughness: 0.62 }
    };

    // One lightweight, deterministic texture set per preset. Textures are generated
    // locally in the browser and shared; do not dispose them when changing one object.
    const materialTextureCache = new Map();
    function makeMaterialTextureSet(preset) {
        const key = preset.pattern + ':' + preset.color;
        if (materialTextureCache.has(key)) return materialTextureCache.get(key);
        const size = 512;
        const canvas = global.document.createElement('canvas');
        canvas.width = canvas.height = size;
        const c = canvas.getContext('2d', { willReadFrequently: true });
        const base = preset.color || '#aaa';
        c.fillStyle = base;
        c.fillRect(0, 0, size, size);
        const pattern = preset.pattern;
        let seed = (pattern.length * 7919 + parseInt(base.slice(1), 16)) >>> 0;
        const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
        const rgba = (r,g,b,a) => `rgba(${r},${g},${b},${a})`;
        const line = (x1,y1,x2,y2,color,width=1) => { c.strokeStyle=color; c.lineWidth=width; c.beginPath(); c.moveTo(x1,y1); c.lineTo(x2,y2); c.stroke(); };

        if (pattern === 'brick') {
            const bh=64, bw=128;
            for(let row=0;row<8;row++){
                const y=row*bh, offset=(row%2)*bw/2;
                for(let col=-1;col<5;col++){
                    const x=col*bw+offset;
                    c.fillStyle=rgba(70,35,25,.34); c.fillRect(x+2,y+2,bw-3,bh-3);
                    c.fillStyle=rgba(255,190,150,.10); c.fillRect(x+4,y+4,bw-8,4);
                    c.fillStyle=rgba(40,25,20,.16); c.fillRect(x+4,y+bh-7,bw-8,3);
                    for(let n=0;n<22;n++){const px=x+6+rand()*(bw-12),py=y+8+rand()*(bh-16);c.fillStyle=rand()>.5?'rgba(255,220,190,.13)':'rgba(45,25,20,.12)';c.fillRect(px,py,2+rand()*7,1+rand()*3);}
                    c.strokeStyle='rgba(48,38,32,.55)';c.lineWidth=3;c.strokeRect(x+1,y+1,bw-2,bh-2);
                }
            }
        } else if (pattern === 'concrete' || pattern === 'plaster') {
            for(let i=0;i<(pattern==='concrete'?1800:1100);i++){
                const x=rand()*size,y=rand()*size,r=pattern==='concrete'?1+rand()*4:1+rand()*2;
                c.fillStyle=rand()>.5?rgba(35,42,45,pattern==='concrete'?.12:.07):rgba(255,255,255,.16);
                c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();
            }
            if(pattern==='concrete') for(let i=0;i<95;i++){const x=rand()*size,y=rand()*size,r=2+rand()*8;c.fillStyle='rgba(75,80,78,.12)';c.beginPath();c.ellipse(x,y,r,r*.55,rand()*3,0,Math.PI*2);c.fill();}
            else { for(let i=0;i<90;i++){const x=rand()*size,y=rand()*size;line(x,y,x+(rand()-.5)*35,y+(rand()-.5)*35,'rgba(90,85,75,.07)',1);} }
        } else if (pattern === 'steel') {
            for(let x=-size;x<size*2;x+=28){
                line(x,0,x+size,size,'rgba(255,255,255,.22)',5);
                line(x+5,0,x+size+5,size,'rgba(15,22,28,.22)',3);
            }
            for(let i=0;i<250;i++){const x=rand()*size,y=rand()*size;c.fillStyle='rgba(255,255,255,.10)';c.fillRect(x,y,1+rand()*3,1);}
        } else if (pattern === 'sheet') {
            for(let x=0;x<size;x+=32){
                c.fillStyle='rgba(10,20,30,.20)';c.fillRect(x,0,5,size);
                c.fillStyle='rgba(255,255,255,.22)';c.fillRect(x+6,0,4,size);
                c.fillStyle='rgba(0,0,0,.08)';c.fillRect(x+15,0,3,size);
            }
            for(let y=0;y<size;y+=96) line(0,y,size,y,'rgba(255,255,255,.08)',1);
        } else if (pattern === 'wood') {
            for(let y=-20;y<size+30;y+=12+rand()*12){
                c.beginPath();c.moveTo(0,y);
                c.bezierCurveTo(size*.25,y-12+rand()*24,size*.65,y+12-rand()*24,size,y-8+rand()*16);
                c.strokeStyle=rand()>.5?'rgba(45,24,10,.22)':'rgba(255,220,170,.17)';c.lineWidth=1+rand()*3;c.stroke();
            }
            for(let i=0;i<9;i++){const x=rand()*size,y=rand()*size;c.strokeStyle='rgba(45,25,12,.25)';c.beginPath();c.ellipse(x,y,8+rand()*20,3+rand()*7,0,0,Math.PI*2);c.stroke();}
        } else if (pattern === 'soil' || pattern === 'grass' || pattern === 'sand') {
            for(let i=0;i<4200;i++){
                const x=rand()*size,y=rand()*size,r=pattern==='sand'?1+rand()*2:1+rand()*4;
                c.fillStyle=pattern==='grass'?(rand()>.5?'rgba(25,65,20,.55)':'rgba(175,190,90,.32)'):(rand()>.5?'rgba(35,24,14,.24)':'rgba(235,205,150,.25)');
                if(pattern==='grass'){c.save();c.translate(x,y);c.rotate((rand()-.5)*.7);c.fillRect(0,0,1+rand()*2,4+rand()*11);c.restore();}
                else {c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();}
            }
        } else if (pattern === 'tile') {
            for(let y=0;y<size;y+=128)for(let x=0;x<size;x+=128){
                c.fillStyle='rgba(255,255,255,.12)';c.fillRect(x+4,y+4,120,120);
                c.strokeStyle='rgba(65,60,55,.55)';c.lineWidth=5;c.strokeRect(x+2,y+2,124,124);
                c.strokeStyle='rgba(255,255,255,.28)';c.lineWidth=2;c.strokeRect(x+8,y+8,112,112);
            }
        } else if (pattern === 'insulation') {
            for(let x=-size;x<size*2;x+=18)line(x,0,x+size,size,'rgba(255,255,255,.35)',5);
            for(let x=-size;x<size*2;x+=18)line(x+7,0,x+size+7,size,'rgba(120,90,35,.25)',2);
        } else {
            // Subtle fine-grain finish for paint and waterproofing.
            for(let i=0;i<1800;i++){const x=rand()*size,y=rand()*size;c.fillStyle=rand()>.5?'rgba(255,255,255,.07)':'rgba(0,0,0,.045)';c.fillRect(x,y,1+rand()*2,1+rand()*2);}
        }

        const colorTexture = new THREE.CanvasTexture(canvas);
        colorTexture.wrapS = colorTexture.wrapT = THREE.RepeatWrapping;
        colorTexture.colorSpace = THREE.SRGBColorSpace || colorTexture.colorSpace;
        colorTexture.anisotropy = 4;
        colorTexture.repeat.set(pattern==='brick'?2:3, pattern==='sheet'?2:3);
        colorTexture.needsUpdate = true;

        // Derive a grayscale bump map from the diffuse image. This gives concrete,
        // brick, soil and timber visible surface relief under directional lighting.
        const pixels = c.getImageData(0,0,size,size);
        const bumpCanvas = global.document.createElement('canvas');
        bumpCanvas.width = bumpCanvas.height = size;
        const bc = bumpCanvas.getContext('2d');
        const bumpPixels = bc.createImageData(size,size);
        for(let i=0;i<pixels.data.length;i+=4){
            const lum=Math.round(pixels.data[i]*.299+pixels.data[i+1]*.587+pixels.data[i+2]*.114);
            bumpPixels.data[i]=bumpPixels.data[i+1]=bumpPixels.data[i+2]=lum;
            bumpPixels.data[i+3]=255;
        }
        bc.putImageData(bumpPixels,0,0);
        const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
        bumpTexture.wrapS = bumpTexture.wrapT = THREE.RepeatWrapping;
        bumpTexture.repeat.copy(colorTexture.repeat);
        bumpTexture.anisotropy = 4;
        bumpTexture.needsUpdate = true;
        // Generate tangent-space normal and roughness maps from the procedural
        // height/luminance field. These add real lighting response rather than
        // relying on colour alone. All maps are created on-device and cached.
        const normalCanvas = global.document.createElement('canvas');
        normalCanvas.width = normalCanvas.height = size;
        const nc = normalCanvas.getContext('2d');
        const normalPixels = nc.createImageData(size, size);
        const sample = (x, y) => {
            x = (x + size) % size; y = (y + size) % size;
            const i = (y * size + x) * 4;
            return (pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114) / 255;
        };
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            const dx = (sample(x + 1, y) - sample(x - 1, y)) * 2.2;
            const dy = (sample(x, y + 1) - sample(x, y - 1)) * 2.2;
            const nx = -dx, ny = -dy, nz = 1;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            const i = (y * size + x) * 4;
            normalPixels.data[i] = Math.round((nx / len * 0.5 + 0.5) * 255);
            normalPixels.data[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
            normalPixels.data[i + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
            normalPixels.data[i + 3] = 255;
        }
        nc.putImageData(normalPixels, 0, 0);
        const normalMap = new THREE.CanvasTexture(normalCanvas);
        normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
        normalMap.repeat.copy(colorTexture.repeat);
        normalMap.anisotropy = 4;

        const roughCanvas = global.document.createElement('canvas');
        roughCanvas.width = roughCanvas.height = size;
        const rc = roughCanvas.getContext('2d');
        const roughPixels = rc.createImageData(size, size);
        for (let i = 0; i < pixels.data.length; i += 4) {
            const lum = Math.round(pixels.data[i] * .299 + pixels.data[i + 1] * .587 + pixels.data[i + 2] * .114);
            const v = Math.max(90, Math.min(245, 210 - Math.abs(lum - 128) * .45));
            roughPixels.data[i] = roughPixels.data[i + 1] = roughPixels.data[i + 2] = v;
            roughPixels.data[i + 3] = 255;
        }
        rc.putImageData(roughPixels, 0, 0);
        const roughnessMap = new THREE.CanvasTexture(roughCanvas);
        roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
        roughnessMap.repeat.copy(colorTexture.repeat);
        roughnessMap.anisotropy = 4;

        const result={map:colorTexture,bumpMap:bumpTexture,normalMap,roughnessMap};
        materialTextureCache.set(key,result);
        return result;
    }

    function applyPresetToObject(object, name) {
        const preset = MATERIAL_PRESETS[name];
        if (!object || !preset || !object.isMesh) return false;
        if (object.geometry && !object.geometry.boundingBox && object.geometry.computeBoundingBox) object.geometry.computeBoundingBox();
        const textures = makeMaterialTextureSet(preset);
        object.material = new THREE.MeshStandardMaterial({
            color: preset.color, map: textures.map, bumpMap: textures.bumpMap,
            normalMap: textures.normalMap, roughnessMap: textures.roughnessMap,
            bumpScale: preset.bumpScale !== undefined ? preset.bumpScale : 0.075,
            normalScale: new THREE.Vector2(0.65, 0.65),
            roughness: preset.roughness, metalness: preset.metalness || 0,
            transparent: !!preset.transparent, opacity: preset.opacity || 1,
            side: THREE.DoubleSide
        });
        object.material.visible = solidFillEnabled;
        object.userData = object.userData || {};
        object.userData.materialPreset = name;
        object.userData.originalColor = new THREE.Color(preset.color).getHex();
        return true;
    }

    function applySavedMaterialPresets() {
        context().getObjects().forEach(object => {
            const name = object && object.userData && object.userData.materialPreset;
            if (name && MATERIAL_PRESETS[name] && object.isMesh) applyPresetToObject(object, name);
        });
    }

    // Explicit 3D transform commands. They operate on selected solids in XYZ,
    // record the normal CAD undo snapshot, and leave 2D tools untouched.
    function register3DEditCommands() {
        const register = (name, aliases, desc, prompt, parser, apply) => {
            if (CAD.getCommand(name)) return;
            CAD.registerCommand({name,aliases,desc,category:'3d',execute:ctx=>{
                const selected=ctx.getSelectedObjects().filter(o=>o && o.userData && o.userData.type==='solid');
                if(!selected.length){ctx.setPrompt(`${name} — Select one or more 3D solids first.`);return;}
                ctx.setPrompt(prompt);
                ctx.setPendingCommand({name,prompt,onText:(upper,raw)=>{
                    const values=parser(raw);
                    if(!values){ctx.setPrompt(`${name} — Invalid input. ${prompt}`);return true;}
                    const before=ctx.captureObjects(selected);
                    apply(selected,values);
                    selected.forEach(o=>{if(o.updateMatrix)o.updateMatrix();if(o.updateMatrixWorld)o.updateMatrixWorld(true);});
                    ctx.recordModify(selected,before);
                    applySolidDisplay();
                    if(global.SafarEdgeMeasurements)global.SafarEdgeMeasurements.syncFromMenu({source:'manual'});
                    ctx.setPendingCommand(null);ctx.setPrompt(`${name} — Updated ${selected.length} solid(s).`);
                    if(global.SafarEdgeProjectFiles)global.SafarEdgeProjectFiles.markDirty();
                    return true;
                },onEnter:()=>{ctx.setPendingCommand(null);ctx.setPrompt(`${name} cancelled.`);}});
            }});
        };
        register('3DMOVE',['3MV'],'Move selected 3D solids by X,Y,Z offsets (mm).','3DMOVE — Enter X,Y,Z offsets in mm (e.g. 100,0,50):',
            raw=>{const a=raw.split(/[,\s]+/).filter(Boolean).map(Number);return a.length===3&&a.every(Number.isFinite)?a:null;},
            (items,v)=>items.forEach(o=>o.position.add(new THREE.Vector3(v[0],v[1],v[2]))));
        register('3DROTATE',['3RO'],'Rotate selected 3D solids around X,Y,Z axes (degrees).','3DROTATE — Enter X,Y,Z angles in degrees (e.g. 0,0,90):',
            raw=>{const a=raw.split(/[,\s]+/).filter(Boolean).map(Number);return a.length===3&&a.every(Number.isFinite)?a:null;},
            (items,v)=>items.forEach(o=>{o.rotation.x+=THREE.MathUtils.degToRad(v[0]);o.rotation.y+=THREE.MathUtils.degToRad(v[1]);o.rotation.z+=THREE.MathUtils.degToRad(v[2]);}));
        register('3DSCALE',['3SC'],'Scale selected 3D solids uniformly.','3DSCALE — Enter a positive scale factor (e.g. 1.25):',
            raw=>{const n=Number(raw);return Number.isFinite(n)&&n>0?[n]:null;},
            (items,v)=>items.forEach(o=>o.scale.multiplyScalar(v[0])));
    }

    function initialize() {
        bindNavigation();
        createFillButton();
        createEnvironmentControls();
        createQuickLayerSelector();
        if (!environmentReady) { environmentReady = true; loadEnvironment('Studio softbox'); }
        setViewVisible(true);
        register3DEditCommands();
        applySavedMaterialPresets();
        rebuildSolidEdgesAfterRestore();
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
        getDrawingFrame,
        extrudeSelected,
        setSelectedSolidHeight,
        setSolidFillEnabled: enabled => { solidFillEnabled = !!enabled; persistSolidFillPreference(); applySolidDisplay(); },
        isSolidFillEnabled: () => solidFillEnabled,
        isNavigationGestureActive: () => navigationGestureActive,
        getMaterialPresets: () => Object.keys(MATERIAL_PRESETS).map(name => ({ name, color: MATERIAL_PRESETS[name].color })),
        applyLayerMaterial: (object, name) => !!(MATERIAL_PRESETS[name] && object && object.isMesh && applyPresetToObject(object, name))
    };

    // CAD canvas is initialized by the workspace after this script loads.
    global.addEventListener('load', initialize, { once: true });
})(window);
