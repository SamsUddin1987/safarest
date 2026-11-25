// 4. MULTI-SELECTION & MOUSE INTERACTION
// ==========================================

// AutoCAD-style rollover highlighting. Hover is deliberately different from
// persistent selection: orange = rollover, cyan = selected. Store each
// material's original colour so grouped entities and material arrays restore
// correctly after the pointer leaves.
const cadOriginalMaterialColors = new WeakMap();
const cadPersistentBoundaryHighlights = new WeakSet();

function forEachCadMaterial(object, callback) {
    if (!object || typeof callback !== 'function') return;
    const visit = node => {
        const materials = Array.isArray(node.material)
            ? node.material
            : (node.material ? [node.material] : []);
        materials.forEach(material => {
            if (material && material.color &&
                typeof material.color.setHex === 'function') {
                callback(material);
            }
        });
    };
    if (typeof object.traverse === 'function') object.traverse(visit);
    else visit(object);
}

function applyCadObjectVisualState(object, state) {
    if (!object) return;
    if (state === 'boundary') cadPersistentBoundaryHighlights.add(object);
    forEachCadMaterial(object, material => {
        if (!cadOriginalMaterialColors.has(material)) {
            cadOriginalMaterialColors.set(material, material.color.clone());
        }
        if (state === 'selected') {
            material.color.setHex(0x00ffff); // persistent selection: cyan
        } else if (state === 'hover') {
            material.color.setHex(0xffa500); // rollover: amber/orange
        } else if (state === 'boundary') {
            material.color.setHex(0xff00ff); // persistent EXTEND boundary: magenta
        } else {
            material.color.copy(cadOriginalMaterialColors.get(material));
        }
    });
}

// Public visual-state bridge for command modules that need a persistent
// temporary highlight (for example, EXTEND's accepted boundary set).
window.CADVisualState = window.CADVisualState || {};
window.CADVisualState.apply = function (object, state) {
    applyCadObjectVisualState(object, state);
};
window.CADVisualState.clearBoundary = function (object) {
    if (!object) return;
    cadPersistentBoundaryHighlights.delete(object);
    applyCadObjectVisualState(object, 'normal');
};

function resolveTopLevelCadEntity(object) {
    while (object && !drawnObjects.includes(object)) {
        object = object.parent;
    }
    return object || null;
}

// CAD pick aperture: a hit anywhere inside the visible 12px pickbox counts,
// not only a hit at the exact centre of the cursor. The centre ray is tested
// first, followed by the eight points around the pickbox perimeter. A small
// screen-space line threshold also makes thin CAD lines easier to select.
function getCadIntersectionsAtPointer(objects = null) {
    if (!raycaster || !camera || !mouse || !renderer) return [];

    const canvas = renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const candidates = objects || drawnObjects.filter(object =>
        !(object.userData && object.userData.layerLocked)
    );

    const worldPerPixel = Math.max(
        1e-7,
        ((camera.right - camera.left) / (camera.zoom || 1)) / width
    );
    // Three.js line/point thresholds are world units; convert a small
    // tolerance from screen pixels so selection remains consistent at zoom.
    raycaster.params = raycaster.params || {};
    raycaster.params.Line = raycaster.params.Line || {};
    raycaster.params.Points = raycaster.params.Points || {};
    raycaster.params.Line.threshold = worldPerPixel * 1.25;
    raycaster.params.Points.threshold = worldPerPixel * 3;

    const aperture = 6; // half of the 12px CAD pickbox
    const offsets = [
        [0, 0],
        [-aperture, -aperture], [0, -aperture], [aperture, -aperture],
        [-aperture, 0],                         [aperture, 0],
        [-aperture, aperture],  [0, aperture],  [aperture, aperture]
    ];
    const baseMouseX = mouse.x;
    const baseMouseY = mouse.y;

    // First honour an exact centre hit. This keeps ordinary picking fast and
    // gives the centre of the pickbox priority when objects overlap.
    raycaster.setFromCamera(new THREE.Vector2(baseMouseX, baseMouseY), camera);
    const centreHits = raycaster.intersectObjects(candidates, true);
    if (centreHits.length) return centreHits;

    // If the centre misses, accept an object touched by any edge/corner of the
    // pickbox. This is the forgiving CAD selection aperture users expect.
    const hits = [];
    offsets.slice(1).forEach(([dx, dy], sampleIndex) => {
        const samplePointer = new THREE.Vector2(
            baseMouseX + (dx * 2 / width),
            baseMouseY - (dy * 2 / height)
        );
        raycaster.setFromCamera(samplePointer, camera);
        raycaster.intersectObjects(candidates, true).forEach(hit => {
            hits.push({ ...hit, _cadPickSample: sampleIndex + 1 });
        });
    });

    // Prefer the nearest depth; when distances are effectively equal, prefer
    // the closest pickbox sample.
    hits.sort((a, b) => {
        const delta = a.distance - b.distance;
        return Math.abs(delta) > 1e-5 ? delta : a._cadPickSample - b._cadPickSample;
    });
    return hits;
}

window.CADPicking = window.CADPicking || {};
window.CADPicking.getIntersections = getCadIntersectionsAtPointer;

function updateCadRolloverHighlight() {
    // PAN and active drags should not produce object rollover. All other
    // commands (including EXTEND/TRIM/MOVE/COPY and drawing tools) do.
    if (currentTool === 'pan' || isPanning || selectionGripDrag || objectDrag) {
        clearHover();
        return;
    }

    const pickable = drawnObjects.filter(object =>
        !(object.userData && object.userData.layerLocked)
    );
    const hits = getCadIntersectionsAtPointer(pickable);
    let nextHover = null;

    for (const hit of hits) {
        const candidate = resolveTopLevelCadEntity(hit.object);
        if (candidate && !(candidate.userData && candidate.userData.layerLocked)) {
            nextHover = candidate;
            break;
        }
    }

    if (nextHover === hoverObject) return;
    clearHover();
    hoverObject = nextHover;

    if (hoverObject && !selectedObjects.includes(hoverObject) &&
        !cadPersistentBoundaryHighlights.has(hoverObject)) {
        applyCadObjectVisualState(hoverObject, 'hover');
    }
}

function onMouseMove(event) {
    const rect = renderer.domElement.getBoundingClientRect();

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const pt = getDrawPoint();

    // Update coordinate display
    const coordEl = document.getElementById('cad-coords');
    if (coordEl) {
        coordEl.innerText =
            `X: ${formatVal(pt.x)} | Y: ${formatVal(pt.y)}`;
    }

    // Dynamic input position
    if (dynamicInputHUD) {
        dynamicInputHUD.style.left =
            `${event.clientX - rect.left + 18}px`;
        dynamicInputHUD.style.top =
            `${event.clientY - rect.top + 18}px`;
    }

    // MIDDLE MOUSE PAN
    if (isPanning) {
        const worldPerPixel =
            (camera.right - camera.left) /
            camera.zoom / rect.width;

        camera.position.x -=
            (event.clientX - panLastX) * worldPerPixel;

        camera.position.y +=
            (event.clientY - panLastY) * worldPerPixel;

        panLastX = event.clientX;
        panLastY = event.clientY;

        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);

        const panPt = getDrawPoint();

        const activeTool = CAD.getTool(currentTool);
        if (activeTool && typeof activeTool.onPreview === 'function') activeTool.onPreview(panPt, CAD.createContext());
        else if (isDrawing && basePoint) updateActiveBufferPreview(panPt);

        return;
    }

    // AUTOCAD-STYLE GRIP DRAGGING. Grip edits take priority over ordinary
    // selection dragging and update the selected vertex/centre in real time.
    if (selectionGripDrag) {
        const drag = selectionGripDrag;
        const gripPoint = getCursorWorldCoordinates().clone();

        // Snap to other entities, but never to the entity whose grip is moving.
        if (osnapOn && typeof computeOsnap === 'function' && typeof getSnapData === 'function') {
            const snapItems = drawnObjects
                .filter(object => object !== drag.object)
                .map(getSnapData);
            const snap = computeOsnap(
                snapItems,
                gripPoint,
                drag.startPoint,
                OSNAP_APERTURE_PX * worldPerPixel(),
                osnapModes
            );
            if (snap) {
                gripPoint.set(snap.x, snap.y, 0);
                currentSnap = snap;
                showSnapMarker(snap);
                if (otrackOn) updateOtrackAcquisition(snap, snapItems);
                hideOtrackGuide();
            } else {
                currentSnap = null;
                hideSnapMarker();
                cancelOtrackAcquisition();
            }
        }

        // Object tracking is the next priority after an exact OSNAP solution.
        // It is available while dragging a selected vertex/centre grip.
        let gripOtrackActive = false;
        if (!currentSnap && otrackOn) {
            const tracked = computeOtrackPoint(gripPoint);
            if (tracked) {
                gripPoint.set(tracked.x, tracked.y, 0);
                showOtrackGuide(
                    tracked.anchor,
                    gripPoint,
                    tracked.axis,
                    tracked.direction,
                    tracked
                );
                gripOtrackActive = true;
            } else {
                hideOtrackGuide();
            }
        }

        if (gridSnapOn && !gripOtrackActive && !currentSnap) {
            gripPoint.x = Math.round(gripPoint.x / GRID_SPACING) * GRID_SPACING;
            gripPoint.y = Math.round(gripPoint.y / GRID_SPACING) * GRID_SPACING;
        }

        if (gripPoint.distanceTo(drag.startPoint) > 1e-7) {
            drag.moved = true;
            renderer.domElement.style.cursor = 'grabbing';
            applySelectionGripPoint(drag, gripPoint);
        }
        return;
    }

    // DIRECT OBJECT DRAGGING
    if (objectDrag) {

        const screenDistance = Math.hypot(
            event.clientX - objectDrag.startClientX,
            event.clientY - objectDrag.startClientY
        );

        // Ignore small accidental mouse movements
        if (!objectDrag.moved) {
            if (screenDistance < OBJECT_DRAG_THRESHOLD) {
                return;
            }

            objectDrag.moved = true;
            renderer.domElement.style.cursor = 'grabbing';
        }

        // Calculate movement in drawing coordinates
        const dx = pt.x - objectDrag.lastPoint.x;
        const dy = pt.y - objectDrag.lastPoint.y;

        if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {

            translateCadObjects(
                objectDrag.objects,
                dx,
                dy
            );

            objectDrag.dx += dx;
            objectDrag.dy += dy;

            objectDrag.lastPoint.copy(pt);
        }

        return;
    }

    // WINDOW / CROSSING SELECTION
    if (updateBoxSelect(event)) {
        return;
    }

    // AutoCAD-style rollover highlight is available during idle selection
    // and while commands request an entity pick. It resolves child meshes to
    // their owning CAD entity and uses a distinct colour from selection.
    updateCadRolloverHighlight();

    const activeTool = CAD.getTool(currentTool);
    if (activeTool && typeof activeTool.onPreview === 'function') {
        try {
            activeTool.onPreview(pt, CAD.createContext());
        } catch (error) {
            console.error(`[SAFAR EDGE CAD] ${currentTool} live preview failed:`, error);
            setCommandPrompt(`${String(currentTool).toUpperCase()} preview error: ${error.message}`);
        }
        return;
    }

    // NORMAL DRAWING PREVIEW
    if (isDrawing && basePoint) {
        updateActiveBufferPreview(pt);
    }
}

function clearHover() {
    if (!hoverObject) return;
    const previous = hoverObject;
    hoverObject = null;
    applyCadObjectVisualState(
        previous,
        cadPersistentBoundaryHighlights.has(previous)
            ? 'boundary'
            : (selectedObjects.includes(previous) ? 'selected' : 'normal')
    );
}

// Keep selection highlighting consistent for simple clicks, window/crossing
// selection, and grouped entities containing child meshes.
function setCadObjectSelectedState(obj, selected) {
    if (!obj) return;
    applyCadObjectVisualState(
        obj,
        cadPersistentBoundaryHighlights.has(obj)
            ? 'boundary'
            : (selected ? 'selected' : (hoverObject === obj ? 'hover' : 'normal'))
    );
}

function clearSelection() {
    selectedObjects.forEach(obj => setCadObjectSelectedState(obj, false));
    selectedObjects = [];
    if (typeof updateSelectionGrips === 'function') updateSelectionGrips();
}

function removeSelectedObject(obj) {
    if (!obj || !selectedObjects.includes(obj)) return false;
    selectedObjects = selectedObjects.filter(item => item !== obj);
    setCadObjectSelectedState(obj, false);
    return true;
}

function addSelectedObject(obj) {
    if (!obj || selectedObjects.includes(obj)) return false;
    selectedObjects.push(obj);
    setCadObjectSelectedState(obj, true);
    return true;
}

function onCanvasClick(event) {

    // Ignore the click following a completed box selection or drag
    if (suppressNextClick) {
        suppressNextClick = false;
        return;
    }

    // Hide cursor input when the user clicks the drawing area
    hideDynamicInput();

    // Refresh mouse coordinates from the actual click location
    const rect = renderer.domElement.getBoundingClientRect();
    
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Obtain raw cursor position
    const rawPt = getCursorWorldCoordinates().clone();

    // Obtain final drawing coordinate, including OSNAP
    const pt = getDrawPoint();

    if (window.CAD_DEBUG_SNAP) {

        console.log('CAD SNAP CLICK:', {

            tool: currentTool,

            rawPoint: {
                x: rawPt.x,
                y: rawPt.y
            },

            selectedSnap: currentSnap,

            finalPoint: {
                x: pt.x,
                y: pt.y
            }

        });

    }

    // AutoCAD-style persistent selection:
    // - Normal click adds an entity to the current selection.
    // - Shift + click removes an already-selected entity.
    // - Clicking empty space never clears the current selection.
    if (currentTool === 'select') {
        const intersects = getCadIntersectionsAtPointer();

        if (intersects.length > 0) {
            let clickedObj = intersects[0].object;
            // Resolve child meshes (dimension labels/extension lines) to the
            // owning top-level CAD entity before changing the selection.
            while (clickedObj && !drawnObjects.includes(clickedObj)) {
                clickedObj = clickedObj.parent;
            }
            if (!clickedObj) return;

            if (event.shiftKey) {
                // Shift-click is a deselection gesture, not a toggle-add.
                removeSelectedObject(clickedObj);
            } else {
                // Ordinary clicks accumulate a multi-selection. Clicking an
                // already-selected entity leaves the current selection intact.
                addSelectedObject(clickedObj);
            }

            if (typeof updateSelectionGrips === 'function') updateSelectionGrips();
            setCommandPrompt(`Selected ${selectedObjects.length} object(s). Shift+click to remove; DELETE to erase.`);
            return;
        }

        // Empty-space clicks preserve the current selection. This allows
        // users to keep a multi-selection while clicking elsewhere in the
        // viewport. Use Shift+click on a selected entity to remove it, or
        // an explicit selection-clear command when that feature is invoked.
        if (selectedObjects.length) {
            setCommandPrompt(`Selected ${selectedObjects.length} object(s). Shift+click an object to remove it.`);
        } else {
            setCommandPrompt('Command: Ready. Select objects or pick a tool.');
        }
    }

    if (currentTool === 'select' || currentTool === 'pan') return;  // empty click in SELECT must not start a draw

    handleToolClick(pt, event);
}

// ==========================================
// 4B. AUTOCAD WINDOW / CROSSING BOX SELECTION
//     Left -> Right drag = WINDOW   (blue, solid)  : object must be fully inside
//     Right -> Left drag = CROSSING (green, dashed): object only needs to touch
// ==========================================
function setupSelectionBox(container) {
    if (document.getElementById('cad-select-box')) return;
    boxEl = document.createElement('div');
    boxEl.id = 'cad-select-box';
    boxEl.style.cssText = 'position:absolute; display:none; pointer-events:none; z-index:900; box-sizing:border-box;';
    container.appendChild(boxEl);
}

function onMouseDown(event) {
    if (osnapMenuEl) osnapMenuEl.style.display = 'none';

    // Middle button (wheel press) = PAN, works in every tool
    if (event.button === 1) {
        event.preventDefault();  // stops the browser's auto-scroll circle
        const now = performance.now();
        if (now - lastMiddleDown < 350) {

        // Double-click middle mouse button = Zoom Extents

        lastMiddleDown = 0;

        if (window.cadZoomExtents) {
            window.cadZoomExtents();
        } else {
            zoomExtents();
        }

        return;
    }

    lastMiddleDown = now;

    // Save the current view before starting PAN.
    if (window.CADView) {
        window.CADView.capture('middle-pan', false);
    }
        isPanning = true;
        panLastX = event.clientX;
        panLastY = event.clientY;
        renderer.domElement.style.cursor = 'grabbing';
        return;
    }

    // PAN command: left mouse button starts dragging the drawing
    if (event.button === 0 && currentTool === 'pan') {
        event.preventDefault();

        isPanning = true;
        panLastX = event.clientX;
        panLastY = event.clientY;

        renderer.domElement.style.cursor = 'grabbing';
        return;
    }

    if (event.button !== 0 || currentTool !== 'select') return;

    const rect = renderer.domElement.getBoundingClientRect();

    // Update mouse coordinates before checking the clicked object
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // If the pointer is on a visible grip, begin editing that node instead
    // of starting a window-selection gesture.
    if (selectedObjects.length && selectionGripMeshes.length) {
        raycaster.setFromCamera(mouse, camera);
        const gripHits = raycaster.intersectObjects(selectionGripMeshes, true);
        if (gripHits.length) {
            let grip = gripHits[0].object;
            while (grip && !(grip.userData && grip.userData.isCadSelectionGrip)) grip = grip.parent;
            const descriptor = grip && grip.userData ? grip.userData.cadGrip : null;
            if (descriptor && descriptor.object && selectedObjects.includes(descriptor.object)) {
                const context = CAD.createContext();
                const cursorPoint = getCursorWorldCoordinates().clone();
                selectionGripDrag = {
                    object: descriptor.object,
                    descriptor,
                    before: context.captureObjects([descriptor.object]),
                    originalGeometry: descriptor.object.geometry.clone(),
                    originalUserData: JSON.parse(JSON.stringify(descriptor.object.userData || {})),
                    startPoint: cursorPoint,
                    moved: false
                };
                renderer.domElement.style.cursor = 'grabbing';
                event.preventDefault();
                return;
            }
        }
    }

    boxSel.down = true;
    boxSel.active = false;
    boxSel.startX = boxSel.curX = event.clientX - rect.left;
    boxSel.startY = boxSel.curY = event.clientY - rect.top;
    boxSel.shift = event.shiftKey;
}

// Returns true while a box drag is in progress (so hover is skipped)
function updateBoxSelect(event) {
    if (!boxSel.down) return false;
    const rect = renderer.domElement.getBoundingClientRect();
    boxSel.curX = event.clientX - rect.left;
    boxSel.curY = event.clientY - rect.top;

    const dx = boxSel.curX - boxSel.startX;
    const dy = boxSel.curY - boxSel.startY;

    if (!boxSel.active) {
        if (Math.hypot(dx, dy) < BOX_DRAG_THRESHOLD) return false;  // still just a click
        boxSel.active = true;
        clearHover();
    }

    const crossing = dx < 0;  // right-to-left
    boxEl.style.display = 'block';
    boxEl.style.left = Math.min(boxSel.startX, boxSel.curX) + 'px';
    boxEl.style.top = Math.min(boxSel.startY, boxSel.curY) + 'px';
    boxEl.style.width = Math.abs(dx) + 'px';
    boxEl.style.height = Math.abs(dy) + 'px';
    if (crossing) {
        boxEl.style.border = '1px dashed #3aff6a';
        boxEl.style.background = 'rgba(58, 255, 106, 0.15)';
    } else {
        boxEl.style.border = '1px solid #3a8bff';
        boxEl.style.background = 'rgba(58, 139, 255, 0.18)';
    }
    setCommandPrompt(crossing ? 'SELECT — CROSSING (right to left): touch objects.'
                              : 'SELECT — WINDOW (left to right): enclose objects.');
    return true;
}

function onMouseUp(event) {
    // Commit one grip edit as a single undoable operation.
    if (event.button === 0 && selectionGripDrag) {
        const drag = selectionGripDrag;
        selectionGripDrag = null;
        setCadCursorMode(currentTool);
        if (drag.moved) {
            CAD.createContext().recordModify([drag.object], drag.before);
            updateSelectionGrips();
            notify('Grip edit applied. (Ctrl+Z to undo)');
        }
        if (drag.originalGeometry) drag.originalGeometry.dispose();
        suppressNextClick = true;
        setTimeout(() => { suppressNextClick = false; }, 0);
        return;
    }

    // Finish PAN drag; remain in PAN mode for another drag
    if (event.button === 0 && currentTool === 'pan' && isPanning) {
        isPanning = false;
        setCadCursorMode(currentTool);

        suppressNextClick = true;
        setTimeout(() => {
            suppressNextClick = false;
        }, 0);

        return;
    }

    // Finish direct object dragging
    if (event.button === 0 && objectDrag) {

        const drag = objectDrag;
        objectDrag = null;

        setCadCursorMode(currentTool);

        if (drag.moved &&
            (Math.abs(drag.dx) > 0.000001 ||
            Math.abs(drag.dy) > 0.000001)) {

            undoStack.push({
                type: 'move',
                objs: drag.objects,
                dx: drag.dx,
                dy: drag.dy
            });

            redoStack = [];
            if (window.SafarEdgeProjectFiles) window.SafarEdgeProjectFiles.markDirty();

            notify(`Moved ${drag.objects.length} object(s).`);

            // Prevent the click event following the drag
            suppressNextClick = true;

            setTimeout(() => {
                suppressNextClick = false;
            }, 0);
        }

        return;
    }

    if (event.button === 1 && isPanning) {
        isPanning = false;
        setCadCursorMode(currentTool);
        return;
    }
    if (!boxSel.down) return;
    const wasActive = boxSel.active;
    boxSel.down = false;
    boxSel.active = false;
    if (boxEl) boxEl.style.display = 'none';
    if (!wasActive) return;  // plain click -> onCanvasClick handles it

    // Swallow the click event that the browser fires right after this mouseup
    suppressNextClick = true;
    setTimeout(() => { suppressNextClick = false; }, 0);

    const crossing = boxSel.curX < boxSel.startX;
    const r = {
        minX: Math.min(boxSel.startX, boxSel.curX), maxX: Math.max(boxSel.startX, boxSel.curX),
        minY: Math.min(boxSel.startY, boxSel.curY), maxY: Math.max(boxSel.startY, boxSel.curY)
    };
    applyBoxSelection(r, crossing, boxSel.shift || event.shiftKey);
}

function cancelBoxSelect() {
    boxSel.down = false;
    boxSel.active = false;
    if (boxEl) boxEl.style.display = 'none';
}

function applyBoxSelection(r, crossing, removeMode) {
    // Ordinary window/crossing selection adds to the current selection.
    // Holding Shift while completing the box removes every hit entity.
    drawnObjects.forEach(obj => {
        if (obj.userData && obj.userData.layerLocked) return;
        const g = getScreenGeometry(obj);
        const hit = crossing ? crossesRect(g, r) : insideRect(g, r);
        if (!hit) return;

        if (removeMode) {
            removeSelectedObject(obj);
        } else {
            addSelectedObject(obj);
        }
    });

    if (typeof updateSelectionGrips === 'function') updateSelectionGrips();
    setCommandPrompt(`${crossing ? 'Crossing' : 'Window'}: ${selectedObjects.length} object(s) selected. ${removeMode ? 'Shift removal' : 'Click to add; Shift+click to remove'}.`);
}

// Convert an entity to screen-pixel points (relative to the canvas)
function getScreenGeometry(obj) {
    const rect = renderer.domElement.getBoundingClientRect();
    const toScreen = v => {
        const p = v.clone().project(camera);
        return { x: ((p.x + 1) / 2) * rect.width, y: ((1 - p.y) / 2) * rect.height };
    };
    obj.updateMatrixWorld();

    if (obj.isSprite) {  // text: use its bounding rectangle
        const hw = obj.scale.x / 2, hh = obj.scale.y / 2;
        const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([dx, dy]) =>
            toScreen(new THREE.Vector3(obj.position.x + dx, obj.position.y + dy, 0)));
        return { pts, filled: true };
    }

    const pos = obj.geometry.attributes.position;
    const pts = [];
    for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
        pts.push(toScreen(v));
    }
    return { pts, filled: false };
}

function pointInRect(p, r) {
    return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
}

// WINDOW: every vertex must be inside the box
function insideRect(g, r) {
    return g.pts.length > 0 && g.pts.every(p => pointInRect(p, r));
}

// CROSSING: any vertex inside, or any segment passes through the box
function crossesRect(g, r) {
    if (g.filled) {  // text bounding box: simple overlap test
        const xs = g.pts.map(p => p.x), ys = g.pts.map(p => p.y);
        return !(Math.max(...xs) < r.minX || Math.min(...xs) > r.maxX ||
                 Math.max(...ys) < r.minY || Math.min(...ys) > r.maxY);
    }
    if (g.pts.some(p => pointInRect(p, r))) return true;
    for (let i = 0; i < g.pts.length - 1; i++) {
        if (segIntersectsRect(g.pts[i], g.pts[i + 1], r)) return true;
    }
    return false;
}

// Liang–Barsky segment vs rectangle
function segIntersectsRect(a, b, r) {
    let t0 = 0, t1 = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    const p = [-dx, dx, -dy, dy];
    const q = [a.x - r.minX, r.maxX - a.x, a.y - r.minY, r.maxY - a.y];
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
            if (q[i] < 0) return false;
        } else {
            const t = q[i] / p[i];
            if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
            else          { if (t < t0) return false; if (t < t1) t1 = t; }
        }
    }
    return true;
}

// ==========================================
