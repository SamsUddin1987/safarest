// 2. DYNAMIC INPUT (Hidden Until Typing)
// ==========================================
function setupDynamicInputUI(container) {
    if (document.getElementById('cad-hud-container')) return;

    dynamicInputHUD = document.createElement('div');
    dynamicInputHUD.id = 'cad-hud-container';
    dynamicInputHUD.style.cssText = `
        position: absolute; display: none; z-index: 1000; pointer-events: none;
        font-family: 'Consolas', 'Courier New', monospace; font-size: 11px;
        background: rgba(30, 30, 30, 0.95); border: 1px solid #007acc;
        padding: 3px 6px; border-radius: 3px; color: #00ffcc;
        box-shadow: 0px 2px 6px rgba(0,0,0,0.5);
    `;

    dynamicInputBox = document.createElement('input');
    dynamicInputBox.type = 'text';
    dynamicInputBox.id = 'cad-hud-input';
    dynamicInputBox.autocomplete = 'off';
    dynamicInputBox.spellcheck = false;
    dynamicInputBox.placeholder = 'Command / Value';

    dynamicInputBox.style.cssText = `
        background: #202020;
        border: none;
        outline: none;
        color: #ffffff;
        font-family: inherit;
        font-size: 12px;
        width: 10px;
        min-width: 10px;
        box-sizing: content-box;
        padding: 3px 5px;
        pointer-events: auto;
        caret-color: #00ffcc;
    `;

    dynamicInputHUD.appendChild(dynamicInputBox);

    // Automatically expand the input box according to typed content
    dynamicInputBox.addEventListener('input', function () {

        const textLength = this.value.length;

        // Consolas monospace font: approximately 7.2px per character
        const requiredWidth = Math.ceil(textLength * 7.2 + 14);

        // Minimum width remains 60px
        this.style.width = Math.max(60, requiredWidth) + 'px';

    });

    container.appendChild(dynamicInputHUD);

    dynamicInputBox.addEventListener('keydown', function (e) {

        // ENTER or SPACE = execute command / accept typed value
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();

            const value = this.value.trim();

            hideDynamicInput();

            if (value) {
                processCommandText(value);
            } else {
                commandEnter();
            }
        }

        // ESC = cancel current command
        else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();

            cancelCommand();
        }
    });
}

function showDynamicInput() {
    if (dynamicInputHUD) dynamicInputHUD.style.display = 'block';
}

function hideDynamicInput() {

    if (dynamicInputHUD) {
        dynamicInputHUD.style.display = 'none';
    }

    if (dynamicInputBox) {
        dynamicInputBox.value = '';
        dynamicInputBox.style.width = '60px';
    }
}

function processDynamicInputValue(val) {
    if (!val) return;
    // First point = absolute, later points = relative (like AutoCAD dynamic input)
    const pt = parsePointInput(val, isDrawing);
    if (pt) handleToolClick(pt);
}

// ==========================================
// 3. UTILITIES & COORDINATE CONVERSION
// ==========================================
function getCursorWorldCoordinates() {

    // Use the drafting plane belonging to the active standard view.
    // This prevents Front/Back/Left/Right/ISO cursor rays from being
    // intersected against the obsolete fixed Z=0 plane.
    raycaster.setFromCamera(mouse, camera);

    const frame = window.SafarEdge3D &&
        typeof window.SafarEdge3D.getDrawingFrame === 'function'
        ? window.SafarEdge3D.getDrawingFrame()
        : null;
    const activePlane = frame && frame.plane ? frame.plane : plane;

    const intersection = raycaster.ray.intersectPlane(
        activePlane,
        new THREE.Vector3()
    );

    if (intersection) return intersection;

    // Do not silently return the world origin when a ray is parallel to
    // the active plane; use the camera target as a safe visible fallback.
    if (frame && frame.origin) return frame.origin.clone();
    return new THREE.Vector3(0, 0, 0);
}

function formatVal(val) {
    return val.toFixed(sysPrecision) + ' ' + sysUnits;
}

function setCommandPrompt(msg) {
    const el = document.getElementById('cad-command-text');
    if (el) el.innerText = msg;
}

// ==========================================
