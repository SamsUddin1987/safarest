// 6. GENERIC TOOL STATE MACHINE & COMMAND EXECUTION
// Command-specific behaviour lives in commands/<category>/*.js.
// This file only manages shared CAD tool state and dispatch.
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