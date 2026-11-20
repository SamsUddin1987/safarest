// 4D. UNDO / REDO  &  ZOOM EXTENTS
// ==========================================
function addEntity(obj, record = true) {
    scene.add(obj);
    drawnObjects.push(obj);
    if (record) {
        undoStack.push({ type: 'add', objs: [obj] });
        redoStack = [];
    }
}

function removeEntity(obj) {
    scene.remove(obj);
    drawnObjects = drawnObjects.filter(o => o !== obj);
    selectedObjects = selectedObjects.filter(o => o !== obj);
    if (hoverObject === obj) hoverObject = null;
}

function undo() {
    if (undoStack.length === 0) { setCommandPrompt('Nothing to undo.'); return; }
    const a = undoStack.pop();
    clearSelection();
    clearHover();
    hoverObject = null;
    if (a.type === 'add') {
        a.objs.forEach(o => removeEntity(o));

        const activeTool = window.CAD
            ? window.CAD.getTool(currentTool)
            : null;

        if (
            activeTool &&
            typeof activeTool.afterUndo === 'function'
        ) {

            activeTool.afterUndo(
                a,
                window.CAD.createContext()
            );

        }

    } else if (a.type === 'move') {
        translateCadObjects(a.objs, -a.dx, -a.dy);

    } else {
        a.objs.forEach(o => addEntity(o, false));
    }
    redoStack.push(a);
    notify('Undo.');
}

function redo() {
    if (redoStack.length === 0) { setCommandPrompt('Nothing to redo.'); return; }
    const a = redoStack.pop();
    clearSelection();
    clearHover();
    hoverObject = null;
    if (a.type === 'add') {
        a.objs.forEach(o => addEntity(o, false));

    } else if (a.type === 'move') {
        translateCadObjects(a.objs, a.dx, a.dy);

    } else {
        a.objs.forEach(o => removeEntity(o));
    }
    undoStack.push(a);
    notify('Redo.');
}

function getWorldBounds(obj) {
    const ud = obj.userData || {};
    if (obj.isSprite) {
        return { minX: obj.position.x - obj.scale.x / 2, maxX: obj.position.x + obj.scale.x / 2,
                 minY: obj.position.y - obj.scale.y / 2, maxY: obj.position.y + obj.scale.y / 2 };
    }
    if (ud.type === 'circle') {
        return { minX: ud.center.x - ud.radius, maxX: ud.center.x + ud.radius,
                 minY: ud.center.y - ud.radius, maxY: ud.center.y + ud.radius };
    }
    const pos = obj.geometry.attributes.position;
    const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (let i = 0; i < pos.count; i++) {
        b.minX = Math.min(b.minX, pos.getX(i)); b.maxX = Math.max(b.maxX, pos.getX(i));
        b.minY = Math.min(b.minY, pos.getY(i)); b.maxY = Math.max(b.maxY, pos.getY(i));
    }
    return b;
}

function zoomExtents() {
    if (drawnObjects.length === 0) {
        camera.position.set(0, 0, 500);
        camera.zoom = 1;
    } else {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        drawnObjects.forEach(o => {
            const b = getWorldBounds(o);
            minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
            minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
        });
        const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
        const fitZoom = Math.min((camera.right - camera.left) / (w * 1.1), (camera.top - camera.bottom) / (h * 1.1));
        camera.zoom = Math.max(0.05, Math.min(fitZoom, 100));
        camera.position.x = (minX + maxX) / 2;
        camera.position.y = (minY + maxY) / 2;
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    notify('Zoom Extents.');
}

// ==========================================
