// 8. KEYBOARD & INTERACTION LISTENERS
// ==========================================
function isTextEntryElement(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function isCadVisible() {
    const c = document.getElementById('cad-canvas-container');
    return !!c && c.offsetParent !== null;
}

function onKeyDown(event) {
    if (!isCadVisible()) return;   // the Estimation tab is showing: leave the keyboard alone

    const typingInCmd = (event.target === cmdInputEl);
    const typingElsewhere = !typingInCmd && isTextEntryElement(event.target);
    const isFKey = /^F\d+$/.test(event.key);
    const hasCtrl = event.ctrlKey || event.metaKey;

    // The command line handles its own keys (Enter, Space, Esc, arrows, Tab ...)
    if (typingInCmd && !isFKey && !hasCtrl) return;

    // Status-bar function keys (same as AutoCAD)
    if (event.key === 'F3') { event.preventDefault(); toggleOsnap(); return; }
    if (event.key === 'F7') { event.preventDefault(); toggleGrid(); return; }
    if (event.key === 'F8') { event.preventDefault(); toggleOrtho(); return; }
    if (event.key === 'F9') { event.preventDefault(); toggleGridSnap(); return; }
    if (event.key === 'F11') { event.preventDefault(); toggleOtrack(); return; }

    // Ctrl+Z = UNDO, Ctrl+Y / Ctrl+Shift+Z = REDO, Ctrl+A = select all
    if (hasCtrl) {
        if (typingElsewhere) return;
        if (typingInCmd && cmdInputEl.value) return;   // normal text editing in the command line
        const k = event.key.toLowerCase();
        if (k === 'c') {
            copySelectedObjects();
            event.preventDefault();
        }
        else if (k === 'v') {
            pasteCadObjects();
            event.preventDefault();
        }
        else if (k === 'z' && !event.shiftKey) {
            undo();
            event.preventDefault();
        }
        else if (k === 'y' || (k === 'z' && event.shiftKey)) {
            redo();
            event.preventDefault();
        }
        else if (k === 'a') {
            selectAll();
            event.preventDefault();
        }

        return;
    }

    // Other text fields (the dynamic-input box, page inputs): only ESC still cancels the command
    if (typingElsewhere) {
        if (event.key === 'Escape') cancelCommand();
        return;
    }

    // ENTER / SPACE = finish the command, or repeat the last one
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        commandEnter();
        return;
    }

    // Delete / Backspace erase the selection
    if (event.key === 'Delete' || event.key === 'Backspace') {
        deleteSelectedObjects();
        event.preventDefault();
        return;
    }

    if (event.key === 'Escape') {
        cancelCommand();
        return;
    }

    // ALL printable keyboard input from the drawing area
    // goes to the small input box beside the cursor.
    if (
        dynamicInputBox &&
        !event.altKey &&
        event.key.length === 1 &&
        event.key !== ' '
    ) {
        showDynamicInput();

        if (document.activeElement !== dynamicInputBox) {
            dynamicInputBox.focus();
        }

        return;
    }
}

function onMouseWheel(event) {

    event.preventDefault();

    if (window.CADView && window.CADView.zoomAt) {

        window.CADView.zoomAt(
            event.clientX,
            event.clientY,
            event.deltaY < 0 ? 1.1 : (1 / 1.1),
            true
        );

    } else {

        const rect = renderer.domElement.getBoundingClientRect();

        const ndcX =
            ((event.clientX - rect.left) / rect.width) * 2 - 1;

        const ndcY =
            -((event.clientY - rect.top) / rect.height) * 2 + 1;

        mouse.x = ndcX;
        mouse.y = ndcY;

        const halfW = (camera.right - camera.left) / 2;
        const halfH = (camera.top - camera.bottom) / 2;

        const oldZoom = camera.zoom;

        const wx =
            camera.position.x + (ndcX * halfW) / oldZoom;

        const wy =
            camera.position.y + (ndcY * halfH) / oldZoom;

        const minZoom = window.CADView ? window.CADView.MIN_ZOOM : 0.000001;
        const maxZoom = window.CADView ? window.CADView.MAX_ZOOM : 100;
        const newZoom = Math.max(
            minZoom,
            Math.min(
                oldZoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1),
                maxZoom
            )
        );

        if (newZoom !== oldZoom) {

            camera.zoom = newZoom;

            camera.position.x =
                wx - (ndcX * halfW) / newZoom;

            camera.position.y =
                wy - (ndcY * halfH) / newZoom;

            camera.updateProjectionMatrix();
            camera.updateMatrixWorld(true);

        }

    }

    const pt = getDrawPoint();

    const activeTool = CAD.getTool(currentTool);

    if (activeTool && typeof activeTool.onPreview === 'function') {

        activeTool.onPreview(pt, CAD.createContext());

    }

    else if (isDrawing && basePoint) {

        updateActiveBufferPreview(pt);

    }

}

function onWindowResize() {
    const container = document.getElementById('cad-canvas-container');
    if (!container || !renderer) return;
    const aspect = container.clientWidth / container.clientHeight;
    const frustumSize = 200;
    camera.left = (-frustumSize * aspect) / 2;
    camera.right = (frustumSize * aspect) / 2;
    camera.top = frustumSize / 2;
    camera.bottom = -frustumSize / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function resetZoom() {

    if (window.cadZoomExtents) {
        window.cadZoomExtents();
    } else {
        zoomExtents();
    }

}

function toggleGrid() {
    if (gridHelper) {
        gridHelper.visible = !gridHelper.visible;
        notify(`<Grid ${gridHelper.visible ? 'on' : 'off'}>`);
        updateStatusBar();
    }
}

// Global Export Bindings
window.initCADViewer = initCADViewer;
window.setTool = setTool;
window.toggleGrid = toggleGrid;
window.resetZoom = resetZoom;
window.deleteSelectedObjects = deleteSelectedObjects;
window.runCADCommand = processCommandText;
window.undo = undo;
window.redo = redo;
window.zoomExtents = zoomExtents;
window.toggleOsnap = toggleOsnap;
window.toggleOrtho = toggleOrtho;
window.toggleGridSnap = toggleGridSnap;

