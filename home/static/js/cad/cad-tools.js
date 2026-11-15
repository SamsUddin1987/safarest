// 6. TOOL STATE MACHINE & COMMAND EXECUTION
// ==========================================
function setTool(toolName, copySources = null) {

    // Cancel an unfinished COPY preview when changing tools
    if (copyPreview && toolName !== 'copy') {
        clearCopyPreview();
    }

    // COPY requires source objects
    const sources = copySources || selectedObjects;

    if (toolName === 'copy' && sources.length === 0) {
        notify('COPY: Select objects first.');
        return;
    }

    copySourceObjects = toolName === 'copy'
        ? [...sources]
        : [];

    // Cancel any unfinished MOVE preview before changing tools
    if (movePreview) {
        translateCadObjects(
            movePreview.objects,
            -movePreview.appliedDx,
            -movePreview.appliedDy
        );

        movePreview = null;
    }

    const ae = document.activeElement;   // don't leave a toolbar button focused (Enter/Space would re-click it)
    if (ae && ae.classList && ae.classList.contains('cad-tool-btn')) ae.blur();

    currentTool = toolName;
    if (toolName !== 'select') pendingCommand = null;
    if (TOOL_TO_CMD[toolName]) lastCommandName = TOOL_TO_CMD[toolName];
    lineChainStart = null;
    lineSegCount = 0;
    toolStep = 0;
    isDrawing = false;
    basePoint = null;
    currentPoints = [];
    clearActiveBuffer();
    clearHover();
    hideDynamicInput();
    hideSnapMarker();

    document.querySelectorAll('.cad-tool-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`tool-${toolName}`);
    if (activeBtn) activeBtn.classList.add('active');

    if (toolName === 'erase') {
        deleteSelectedObjects();
        setTool('select');
        return;
    }

    switch (toolName) {
        case 'line': setCommandPrompt('Command: LINE — Pick start point:'); break;
        case 'polyline': setCommandPrompt('Command: PLINE — Pick start point:'); break;
        case 'rect': setCommandPrompt('Command: RECTANG — Pick first corner:'); break;
        case 'circle': setCommandPrompt('Command: CIRCLE — Pick center point:'); break;
        case 'arc': setCommandPrompt('Command: ARC — Pick start point:'); break;
        case 'text': setCommandPrompt('Command: TEXT — Pick insertion point:'); break;
        case 'dist': setCommandPrompt('Command: DIST — Specify first point:'); break;
        case 'id': setCommandPrompt('Command: ID — Specify point:'); break;
        case 'zoomw': setCommandPrompt('Command: ZOOM — Specify first corner:'); break;
        case 'move':
            setCommandPrompt(
                selectedObjects.length
                    ? `MOVE — ${selectedObjects.length} object(s) selected. Pick base point:`
                    : 'MOVE — Select objects first, then start MOVE.'
            );
            break;
        case 'copy':
            setCommandPrompt(
                `COPY — ${copySourceObjects.length} object(s). Pick base point:`
            );
            break;
        
        case 'pan':
            setCommandPrompt('PAN — Hold LEFT mouse button and drag. Press ESC to exit.');
            renderer.domElement.style.cursor = 'grab';
            break;
        default: setCommandPrompt('Command: ');
    }
}

// ==========================================
// COPY / PASTE OBJECT UTILITIES
// ==========================================

function cloneCadObject(source) {
    const copy = source.clone();

    // Independent geometry
    if (source.geometry) {
        copy.geometry = source.geometry.clone();
    }

    // Independent material, while retaining shared textures
    if (source.material) {
        copy.material = Array.isArray(source.material)
            ? source.material.map(m => m.clone())
            : source.material.clone();
    }

    // Copy CAD metadata
    copy.userData = JSON.parse(JSON.stringify(source.userData || {}));

    // Restore the original drawing colour
    if (copy.material && copy.material.color) {
        copy.material.color.setHex(
            copy.userData.originalColor || 0xffffff
        );
    }

    return copy;
}

// ==========================================
// COPY LIVE PREVIEW
// ==========================================

function createCopyPreview() {

    clearCopyPreview();

    const previewObjects = copySourceObjects.map(source => {

        const obj = cloneCadObject(source);

        // Ghost preview appearance
        const materials = Array.isArray(obj.material)
            ? obj.material
            : [obj.material];

        materials.forEach(mat => {
            if (!mat) return;

            mat.transparent = true;
            mat.opacity = 0.45;
            mat.depthWrite = false;
            mat.color.setHex(0x00ffff);
        });

        scene.add(obj);

        return obj;
    });

    copyPreview = {
        objects: previewObjects,
        appliedDx: 0,
        appliedDy: 0
    };
}


function clearCopyPreview() {

    if (!copyPreview) return;

    copyPreview.objects.forEach(obj => {

        scene.remove(obj);

        if (obj.geometry) {
            obj.geometry.dispose();
        }

        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach(mat => mat.dispose());
            } else {
                obj.material.dispose();
            }
        }
    });

    copyPreview = null;
}

function updateCopyPreview(pt) {

    if (!copyPreview || !basePoint) return;

    const targetDx = pt.x - basePoint.x;
    const targetDy = pt.y - basePoint.y;

    const dx = targetDx - copyPreview.appliedDx;
    const dy = targetDy - copyPreview.appliedDy;

    if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {

        translateCadObjects(
            copyPreview.objects,
            dx,
            dy
        );

        copyPreview.appliedDx = targetDx;
        copyPreview.appliedDy = targetDy;
    }

    setCommandPrompt(
        `COPY — X: ${formatVal(targetDx)} | Y: ${formatVal(targetDy)} | Click to place`
    );
}

function placeCopyAt(pt) {

    if (!copyPreview || !basePoint) return;

    const dx = pt.x - basePoint.x;
    const dy = pt.y - basePoint.y;

    if (
        Math.abs(dx) < 0.000001 &&
        Math.abs(dy) < 0.000001
    ) {
        setCommandPrompt(
            'COPY — Zero displacement. Pick another destination.'
        );
        return;
    }

    // Remove the temporary ghost preview
    clearCopyPreview();

    // Create permanent independent copies
    const copiedObjects = copySourceObjects.map(source => {

        const copy = cloneCadObject(source);

        translateCadObjects([copy], dx, dy);

        addEntity(copy, false);

        return copy;
    });

    // One undo operation for this placement
    undoStack.push({
        type: 'add',
        objs: copiedObjects
    });

    redoStack = [];

    notify(
        `COPY — ${copiedObjects.length} object(s) placed. Pick next destination or press ENTER.`
    );

    // Prepare the next copy without ending the command
    createCopyPreview();

    // Keep preview at the current cursor location
    updateCopyPreview(pt);
}

function copySelectedObjects() {

    if (selectedObjects.length === 0) {
        notify('COPY: Select at least one object first.');
        return;
    }

    cadClipboard = selectedObjects.map(obj =>
        cloneCadObject(obj)
    );

    // Calculate the centre of the copied objects
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    selectedObjects.forEach(obj => {

        const b = getWorldBounds(obj);

        minX = Math.min(minX, b.minX);
        minY = Math.min(minY, b.minY);
        maxX = Math.max(maxX, b.maxX);
        maxY = Math.max(maxY, b.maxY);

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

    // Start COPY using the clipboard objects
    setTool(
        'copy',
        cadClipboard.map(obj => cloneCadObject(obj))
    );

    if (currentTool !== 'copy') return;

    // Clipboard already has a reference point.
    // Ask the user for the insertion point.
    basePoint = cadClipboardBasePoint.clone();
    isDrawing = true;

    createCopyPreview();

    setCommandPrompt(
        'PASTECLIP — Move cursor to insertion point and click:'
    );
}

function translateCadObjects(objects, dx, dy) {
    objects.forEach(obj => {
        // Lines, polylines, rectangles and circles
        if (obj.geometry) {
            obj.geometry.translate(dx, dy, 0);
            obj.geometry.computeBoundingSphere();
        }

        // Keep circle centre information updated
        if (obj.userData && obj.userData.center) {
            obj.userData.center.x += dx;
            obj.userData.center.y += dy;
        }

        // Keep polyline point information updated
        if (obj.userData && Array.isArray(obj.userData.points)) {
            obj.userData.points.forEach(point => {
                point.x += dx;
                point.y += dy;
            });
        }

        // Text sprites
        if (obj.isSprite) {
            obj.position.x += dx;
            obj.position.y += dy;
        }
    });
}

function updateMovePreview(pt) {
    if (!movePreview) return;

    // Desired movement from the original base point
    const targetDx = pt.x - movePreview.basePoint.x;
    const targetDy = pt.y - movePreview.basePoint.y;

    // Apply only the difference from the previous preview
    const dx = targetDx - movePreview.appliedDx;
    const dy = targetDy - movePreview.appliedDy;

    if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
        translateCadObjects(movePreview.objects, dx, dy);

        movePreview.appliedDx = targetDx;
        movePreview.appliedDy = targetDy;
    }

    setCommandPrompt(
        `MOVE — Displacement X: ${formatVal(targetDx)} | Y: ${formatVal(targetDy)}`
    );
}

function handleToolClick(pt) {
    lastPoint = pt.clone();

    // COPY command (CO / CP)
    if (currentTool === 'copy') {

        if (copySourceObjects.length === 0) {
            notify('COPY: No source objects.');
            return;
        }

        // First click: specify the source base point
        if (!isDrawing) {

            basePoint = pt.clone();
            isDrawing = true;

            createCopyPreview();

            setCommandPrompt(
                'COPY — Move cursor to destination and click to place:'
            );

            return;
        }

        // Subsequent clicks: place copies at exact cursor coordinates
        placeCopyAt(pt);

        return;
    }

    // MOVE command
    if (currentTool === 'move') {
        if (selectedObjects.length === 0) {
            setCommandPrompt('MOVE — No objects selected. Press ESC and select objects first.');
            return;
        }

        // First click: choose base point
        if (!isDrawing) {
            basePoint = pt.clone();
            isDrawing = true;

            movePreview = {
                objects: [...selectedObjects],
                basePoint: pt.clone(),
                appliedDx: 0,
                appliedDy: 0
            };

            setCommandPrompt('MOVE — Move cursor to preview, click to place:');
            return;
        }

        // Second click: choose destination point
        const dx = pt.x - basePoint.x;
        const dy = pt.y - basePoint.y;

        if (Math.abs(dx) < 0.000001 && Math.abs(dy) < 0.000001) {
            setCommandPrompt('MOVE — Zero displacement. Choose another destination.');
            return;
        }

        const movedObjects = movePreview
            ? [...movePreview.objects]
            : [...selectedObjects];

        // Apply only the remaining movement not already shown
        const appliedDx = movePreview ? movePreview.appliedDx : 0;
        const appliedDy = movePreview ? movePreview.appliedDy : 0;

        translateCadObjects(
            movedObjects,
            dx - appliedDx,
            dy - appliedDy
        );

        movePreview = null;

        undoStack.push({
            type: 'move',
            objs: movedObjects,
            dx: dx,
            dy: dy
        });

        redoStack = [];

        notify(`Moved ${movedObjects.length} object(s).`);

        finishTool();
        return;
    }

    if (currentTool === 'text') {
        const inputStr = prompt("Enter CAD Text Value:", "SafarEdge CAD");
        if (inputStr) createTextEntity(pt, inputStr);
        setTool(currentTool);   // stay in the command until ESC
        return;
    }

    if (currentTool === 'id') {
        notify(`ID — X = ${pt.x.toFixed(sysPrecision)}  Y = ${pt.y.toFixed(sysPrecision)}`);
        finishTool();
        return;
    }

    if (!isDrawing) {
        basePoint = pt.clone();
        currentPoints = [basePoint];
        isDrawing = true;
        toolStep = 1;
        if (currentTool === 'line') { lineChainStart = pt.clone(); lineSegCount = 0; }
        if (currentTool === 'rect') setCommandPrompt('RECTANG — Pick opposite corner:');
        if (currentTool === 'dist') setCommandPrompt('DIST — Specify second point:');
        if (currentTool === 'zoomw') setCommandPrompt('ZOOM — Specify opposite corner:');
    } else {
        if (currentTool === 'line') {
            commitLine(basePoint, pt);
            lineSegCount++;
            basePoint = pt.clone();
        } else if (currentTool === 'polyline') {
            currentPoints.push(pt.clone());
            basePoint = pt.clone();   // next segment starts from the last vertex
            setCommandPrompt('PLINE — Next point (type C = Close, U = Undo, ENTER = finish):');
        } else if (currentTool === 'rect') {
            commitRectangle(basePoint, pt);
            setTool(currentTool);   // stay in the command until ESC
        } else if (currentTool === 'circle') {
            commitCircle(basePoint, basePoint.distanceTo(pt));
            setTool(currentTool);   // stay in the command until ESC
        } else if (currentTool === 'dist') {
            reportDistance(basePoint, pt);
            finishTool();
        } else if (currentTool === 'zoomw') {
            zoomToWindow(basePoint, pt);
            finishTool();
        }
    }
}

function finishTool() {
    isDrawing = false;
    basePoint = null;
    currentPoints = [];
    toolStep = 0;
    clearActiveBuffer();
    hideDynamicInput();
    setTool('select');
}

// ==========================================
