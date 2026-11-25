// 6. GENERIC TOOL STATE MACHINE & COMMAND EXECUTION
// Command-specific behaviour lives in commands/<category>/*.js.
// This file only manages shared CAD tool state and dispatch.

// One cursor controller is used by the workspace, normal selection, and
// modification commands. The normal cursor is the AutoCAD-style crosshair
// with a centre pickbox; EXTEND/TRIM use a compact pickbox only.
const CAD_CURSOR_CROSSHAIR = (() => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M16 0v12M16 20v12M0 16h12M20 16h12" stroke="#00ffcc" stroke-width="1"/><rect x="12" y="12" width="8" height="8" fill="none" stroke="#ffffff" stroke-width="1"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, crosshair`;
})();
const CAD_CURSOR_PICKBOX = (() => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="none" stroke="#ffffff" stroke-width="1.2"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 6 6, crosshair`;
})();

function setCadCursorMode(mode = currentTool) {
    const cursor = mode === 'pan'
        ? 'grab'
        : mode === 'panning'
            ? 'grabbing'
            : (mode === 'extend' || mode === 'trim')
                ? CAD_CURSOR_PICKBOX
                : CAD_CURSOR_CROSSHAIR;

    const container = document.getElementById('cad-canvas-container');
    const canvas = (typeof renderer !== 'undefined' && renderer && renderer.domElement)
        ? renderer.domElement
        : (container && container.querySelector('canvas'));

    if (container) container.style.cursor = cursor;
    if (canvas) canvas.style.cursor = cursor;
    return cursor;
}

// Expose the same state setter to the project loader and command modules.
window.SafarEdgeCadCursor = {
    setMode: setCadCursorMode,
    restore: function () { return setCadCursorMode('select'); }
};
function setTool(toolName, toolOptions = null) {
    const previousTool = CAD.getTool(currentTool);
    if (currentTool !== 'select' && previousTool && typeof previousTool.onFinish === 'function') {
        previousTool.onFinish(CAD.createContext());
    }

    const ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains('cad-tool-btn')) ae.blur();

    currentTool = toolName;

    // AutoCAD-style grips are hidden while a command is active (EXTEND,
    // MOVE, TRIM, etc.) and restored when returning to idle selection.
    if (typeof selectionGripGroup !== 'undefined' && selectionGripGroup) {
        selectionGripGroup.visible = toolName === 'select';
    }
    if (toolName === 'select' && typeof updateSelectionGrips === 'function') {
        updateSelectionGrips();
    }

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

    const tool = CAD.getTool(toolName);
    if (tool && typeof tool.onStart === 'function') tool.onStart(CAD.createContext(), toolOptions);

    // Reassert the canonical cursor after every command start. This prevents
    // an opened drawing or a previous command from leaving an arrow cursor.
    setCadCursorMode(toolName);

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
        case 'pan':

            if (window.CADView) {
                window.CADView.capture('pan-command', false);
            }

            setCommandPrompt(
                'PAN — Hold LEFT mouse button and drag. Press ESC to exit.'
            );

            if (renderer) {
                renderer.domElement.style.cursor = 'grab';
            }

            break;
        case 'select': setCommandPrompt('Command:'); break;
        default: break;
    }
}

// Shared geometry translation remains here for selection dragging and history.
function translateCadObjects(objects, dx, dy) {
    (objects || []).forEach(obj => {
        if (obj.geometry) {
            obj.geometry.translate(dx, dy, 0);
            obj.geometry.computeBoundingSphere();
        }
        if (obj.traverse) {
            obj.traverse(child => {
                if (child !== obj && child.geometry) {
                    child.geometry.translate(dx, dy, 0);
                    child.geometry.computeBoundingSphere();
                }
                if (child !== obj && child.isSprite) {
                    child.position.x += dx; child.position.y += dy;
                }
            });
        }
        if (obj.userData && obj.userData.center) {
            obj.userData.center.x += dx; obj.userData.center.y += dy;
        }
        if (obj.userData && Array.isArray(obj.userData.points)) {
            obj.userData.points.forEach(point => { point.x += dx; point.y += dy; });
        }
        if (obj.userData && obj.userData.dimensionData) {
            const d = obj.userData.dimensionData;
            ['p1','p2','location','vertex','ray1','ray2','arcPoint','center','point'].forEach(key => {
                const value = d[key];
                if (Array.isArray(value) && value.length >= 2) { value[0] += dx; value[1] += dy; }
            });
        }
        if (obj.isSprite) { obj.position.x += dx; obj.position.y += dy; }
    });
}

function handleToolClick(pt, event = null) {

    // =========================================
    // INDEPENDENT DRAW COMMAND DISPATCHER
    // =========================================

    const activeDrawTool = CAD.getTool(currentTool);

    // Enforce drawing limits for drawing tools only.
    if (
        activeDrawTool &&
        typeof activeDrawTool.onClick === 'function' &&
        !CAD.createContext().isPointWithinLimits(pt)
    ) {
        setCommandPrompt(
            `LIMITS — Point outside drawing boundary. ` +
            `X: ${formatVal(pt.x)}, Y: ${formatVal(pt.y)}`
        );
        return;
    }

    lastPoint = pt.clone();

    if (
        activeDrawTool &&
        typeof activeDrawTool.onClick === 'function'
    ) {
        try {
            activeDrawTool.onClick(pt, CAD.createContext(), event);
        } catch (error) {
            console.error(`[SAFAR EDGE CAD] ${currentTool} click failed:`, error);
            setCommandPrompt(`${String(currentTool).toUpperCase()} error: ${error.message}`);
        }
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

        if (currentTool === 'rect') setCommandPrompt('RECTANG — Pick opposite corner:');
        if (currentTool === 'dist') setCommandPrompt('DIST — Specify second point:');
        if (currentTool === 'zoomw') setCommandPrompt('ZOOM — Specify opposite corner:');

    } else {

        if (currentTool === 'dist') {
            reportDistance(basePoint, pt);
            finishTool();

        } else if (currentTool === 'zoomw') {
            zoomToWindow(basePoint, pt);
            finishTool();
        }
    }
}

function finishTool() {
    // setTool() invokes the active tool's onFinish handler BEFORE clearing
    // its state. This is important for commands such as PLINE, which must
    // commit completed vertices when ESC or another command ends the tool.
    hideDynamicInput();
    setTool('select');
}

// ==========================================