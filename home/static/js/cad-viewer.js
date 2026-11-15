/**
 * Professional AutoCAD Web Engine - Selection & Multi-Delete Engine
 */

// Core Three.js Engine Variables
let scene, camera, renderer, raycaster, mouse;
let gridHelper, plane;

// CAD World Coordinate System
// All drawing coordinates are stored in millimetres.

const CAD_CONFIG = {
    unit: 'mm',
    precision: 2,
    origin: { x: 0, y: 0, z: 0 }
};

let sysUnits = CAD_CONFIG.unit;
let sysPrecision = CAD_CONFIG.precision;

// Drawing limits disabled.
// CAD drawings can extend beyond any predefined boundary.
let sysLimits = {
    active: false
};

// State Engine & Tool Variables
let currentTool = 'select'; 
let toolStep = 0;              
let isDrawing = false;
let basePoint = null;
let currentPoints = [];
let activeBufferObj = null;

// Drawing & Selection Memory
let drawnObjects = [];         // Holds all active scene entities
let selectedObjects = [];      // Currently selected items
let cadClipboard = [];
let copySourceObjects = [];
let hoverObject = null;        // Currently hovered item

// UI Dynamic Input Elements
let dynamicInputHUD, dynamicInputBox;

// AutoCAD-style Box Selection (Window / Crossing)
let boxSel = { down: false, active: false, startX: 0, startY: 0, curX: 0, curY: 0, shift: false };
let boxEl = null;
let suppressNextClick = false;
const BOX_DRAG_THRESHOLD = 5;  // px of movement before a click becomes a box drag

// Direct object dragging (AutoCAD-style)
let objectDrag = null;
const OBJECT_DRAG_THRESHOLD = 3;

// COPY command live preview
let copyPreview = null;

// MOVE command live preview
let movePreview = null;

// Clipboard insertion reference point
let cadClipboardBasePoint = null;

// Pan (hold middle mouse button / scroll wheel and drag)
let isPanning = false;
let panLastX = 0, panLastY = 0;
let lastMiddleDown = 0;        // for middle double-click = Zoom Extents

// Drafting aids (AutoCAD status bar: OSNAP F3, GRID F7, ORTHO F8, SNAP F9)
let osnapOn = true, orthoOn = false, gridSnapOn = false;
const GRID_SPACING = 10;       // matches GridHelper(1000, 100)
const OSNAP_APERTURE_PX = 14;  // pick radius around the cursor, in screen pixels
const osnapModes = { endpoint: true, midpoint: true, center: true, node: true, quadrant: true,
                     intersection: true, perpendicular: true, nearest: false };
const SNAP_LABELS = { endpoint: 'Endpoint', midpoint: 'Midpoint', center: 'Center', node: 'Node',
                      quadrant: 'Quadrant', intersection: 'Intersection', perpendicular: 'Perpendicular', nearest: 'Nearest' };
// Lower penalty wins when two snaps are about equally close to the cursor
const SNAP_PENALTY = { endpoint: 0, intersection: 0, center: 0, node: 0, quadrant: 0.05, midpoint: 0.05, perpendicular: 0.3, nearest: 0.6 };
const SNAP_ICONS = {
    endpoint: '<rect x="3" y="3" width="14" height="14"/>',
    midpoint: '<polygon points="10,3 17,16 3,16"/>',
    center: '<circle cx="10" cy="10" r="7"/>',
    node: '<circle cx="10" cy="10" r="6"/><path d="M5 5L15 15M15 5L5 15"/>',
    quadrant: '<polygon points="10,2 18,10 10,18 2,10"/>',
    intersection: '<path d="M3 3L17 17M17 3L3 17"/>',
    perpendicular: '<path d="M3 3V17H17M3 11H9V17"/>',
    nearest: '<path d="M4 3H16L4 17H16Z"/>'
};
let snapMarkerEl = null, snapIconEl = null, snapLabelEl = null, lastMarkerType = null;
let osnapMenuEl = null;
let currentSnap = null;

// Undo / Redo history
let undoStack = [], redoStack = [];

// Command line
let cmdInputEl = null, cmdOverlayEl = null;
let pendingCommand = null;     // option prompt in progress: {name, prompt, onText(up, raw) -> bool, onEnter()}
let lastCommandName = null;    // Enter / Space on an idle drawing repeats this
let lastPoint = null;          // AutoCAD LASTPOINT: reference for @x,y
let lineChainStart = null, lineSegCount = 0;
const cmdLog = [];
let cmdTyped = [], cmdTypedIdx = 0;
let suggestions = [], suggestIdx = -1;
let cmdOverlayMax = 3, cmdOverlayTimer = null;
const osnapCheckboxes = {};
const TOOL_TO_CMD = {
    line: 'LINE',
    polyline: 'PLINE',
    rect: 'RECTANG',
    circle: 'CIRCLE',
    text: 'TEXT',
    erase: 'ERASE',
    move: 'MOVE',
    copy: 'COPY',
    pan: 'PAN',
    dist: 'DIST',
    id: 'ID'
};

// ==========================================
// 1. INITIALIZATION & ENGINE SETUP
// ==========================================
function initCADViewer() {
    const container = document.getElementById('cad-canvas-container');
    if (!container) return;
    container.innerHTML = '';

    // 1.1 Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x181818);

    // 1.2 Camera (Orthographic 2D Drafting Setup)
    const aspect = container.clientWidth / container.clientHeight;
    const frustumSize = 200;
    camera = new THREE.OrthographicCamera(
        (frustumSize * aspect) / -2, (frustumSize * aspect) / 2,
        frustumSize / 2, frustumSize / -2,
        1, 2000
    );
    camera.position.set(0, 0, 500);
    camera.lookAt(0, 0, 0);

    // 1.3 WebGL Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // 1.4 Raycaster & Interaction Plane
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    
    // Infinite mathematical drawing plane at Z = 0.
    // No fixed drawing boundary.
    plane = new THREE.Plane(
        new THREE.Vector3(0, 0, 1),
        0
    );

    // 1.5 Grid
    gridHelper = new THREE.GridHelper(1000, 100, 0x444444, 0x2a2a2a);
    gridHelper.rotation.x = Math.PI / 2;
    scene.add(gridHelper);

    // Setup Dynamic Overlay (Hidden by default)
    setupDynamicInputUI(container);
    setupSelectionBox(container);
    setupSnapUI(container);
    setupStatusBar(container);
    setupCommandLine(container);

    // Event Listeners
    window.addEventListener('resize', onWindowResize);
    const domEl = renderer.domElement;
    domEl.addEventListener('mousedown', onMouseDown);
    domEl.addEventListener('mousemove', onMouseMove);
    domEl.addEventListener('mouseleave', hideSnapMarker);
    window.addEventListener('mouseup', onMouseUp);
    domEl.addEventListener('click', onCanvasClick);
    domEl.addEventListener('wheel', onMouseWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);

    animate();
    setCommandPrompt('Command: Ready. Select objects or pick a tool.');
}

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

// ==========================================
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

    // Convert mouse position into a camera ray.
    raycaster.setFromCamera(mouse, camera);

    // Find intersection with the infinite XY drawing plane.
    const intersection = raycaster.ray.intersectPlane(
        plane,
        new THREE.Vector3()
    );

    // Return world coordinates.
    if (intersection) {
        return intersection;
    }

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
// 4. MULTI-SELECTION & MOUSE INTERACTION
// ==========================================

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

        if (currentTool === 'copy' && copyPreview) {
            updateCopyPreview(panPt);
        }
        else if (currentTool === 'move' && movePreview) {
            updateMovePreview(panPt);
        }
        else if (isDrawing && basePoint) {
            updateActiveBufferPreview(panPt);
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

    // HOVER EFFECT
    if (currentTool === 'select' || currentTool === 'erase') {

        raycaster.setFromCamera(mouse, camera);

        const intersects =
            raycaster.intersectObjects(drawnObjects, true);

        if (intersects.length > 0) {

            if (hoverObject !== intersects[0].object) {

                clearHover();

                hoverObject = intersects[0].object;

                if (!selectedObjects.includes(hoverObject)) {
                    hoverObject.material.color.setHex(0x00ffff);
                }
            }

        } else {
            clearHover();
        }
    }

    // MOVE LIVE PREVIEW
    if (currentTool === 'move' && isDrawing && movePreview) {
        updateMovePreview(pt);
        return;
    }

    // COPY LIVE PREVIEW
    if (currentTool === 'copy' && isDrawing && copyPreview) {
        updateCopyPreview(pt);
        return;
    }

    // NORMAL DRAWING PREVIEW
    if (isDrawing && basePoint) {
        updateActiveBufferPreview(pt);
    }
}

function clearHover() {
    if (hoverObject && !selectedObjects.includes(hoverObject)) {
        hoverObject.material.color.setHex(hoverObject.userData.originalColor || 0xffffff);
        hoverObject = null;
    }
}

function clearSelection() {
    selectedObjects.forEach(obj => {
        obj.material.color.setHex(obj.userData.originalColor || 0xffffff);
    });
    selectedObjects = [];
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

    // Obtain the exact drawing coordinate, including OSNAP
    const pt = getDrawPoint();

    // Multi-Selection Logic in Select Mode
    if (currentTool === 'select') {
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(drawnObjects, true);

        if (intersects.length > 0) {
            const clickedObj = intersects[0].object;

            if (event.shiftKey) {
                // Shift + Click to toggle individual items
                if (selectedObjects.includes(clickedObj)) {
                    selectedObjects = selectedObjects.filter(o => o !== clickedObj);
                    clickedObj.material.color.setHex(clickedObj.userData.originalColor || 0xffffff);
                } else {
                    selectedObjects.push(clickedObj);
                    clickedObj.material.color.setHex(0x00ffff);
                }
            } else {
                // Regular Click selects multiple or replaces selection
                if (!selectedObjects.includes(clickedObj)) {
                    clearSelection();
                    selectedObjects.push(clickedObj);
                    clickedObj.material.color.setHex(0x00ffff);
                }
            }
            setCommandPrompt(`Selected ${selectedObjects.length} object(s). Press DELETE to erase.`);
            return;
        } else if (!event.shiftKey) {
            clearSelection();
            setCommandPrompt('Command: Ready. Select objects or pick a tool.');
        }
    }

    if (currentTool === 'select' || currentTool === 'pan') return;  // empty click in SELECT must not start a draw

    handleToolClick(pt);
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
        if (now - lastMiddleDown < 350) {   // double-click wheel = Zoom Extents
            lastMiddleDown = 0;
            zoomExtents();
            return;
        }
        lastMiddleDown = now;
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
    // Finish PAN drag; remain in PAN mode for another drag
    if (event.button === 0 && currentTool === 'pan' && isPanning) {
        isPanning = false;
        renderer.domElement.style.cursor = 'grab';

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

        renderer.domElement.style.cursor = '';

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
        renderer.domElement.style.cursor =
            currentTool === 'pan' ? 'grab' : '';
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

function applyBoxSelection(r, crossing, additive) {
    if (!additive) clearSelection();

    drawnObjects.forEach(obj => {
        if (selectedObjects.includes(obj)) return;
        const g = getScreenGeometry(obj);
        const hit = crossing ? crossesRect(g, r) : insideRect(g, r);
        if (hit) {
            selectedObjects.push(obj);
            obj.material.color.setHex(0x00ffff);
        }
    });

    setCommandPrompt(`${crossing ? 'Crossing' : 'Window'}: ${selectedObjects.length} object(s) selected. Press DELETE to erase.`);
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
// 4C. OSNAP (OBJECT SNAP), ORTHO, GRID SNAP
// ==========================================

// --- pure geometry helpers (world units) ---
function closestOnSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return { x: a.x, y: a.y, t: 0 };
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return { x: a.x + t * dx, y: a.y + t * dy, t };
}

function segSegIntersect(a, b, c, d) {
    const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return null;   // parallel
    const qx = c.x - a.x, qy = c.y - a.y;
    const t = (qx * sy - qy * sx) / den;
    const u = (qx * ry - qy * rx) / den;
    const e = 1e-9;
    if (t < -e || t > 1 + e || u < -e || u > 1 + e) return null;
    return { x: a.x + t * rx, y: a.y + t * ry };
}

function segCircleIntersect(a, b, c) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const fx = a.x - c.cx, fy = a.y - c.cy;
    const A = dx * dx + dy * dy;
    if (A === 0) return [];
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - c.r * c.r;
    let disc = B * B - 4 * A * C;
    if (disc < 0) return [];
    disc = Math.sqrt(disc);
    const out = [];
    [(-B - disc) / (2 * A), (-B + disc) / (2 * A)].forEach(t => {
        if (t >= -1e-9 && t <= 1 + 1e-9) out.push({ x: a.x + t * dx, y: a.y + t * dy });
    });
    return out;
}

function circleCircleIntersect(c1, c2) {
    const dx = c2.cx - c1.cx, dy = c2.cy - c1.cy;
    const d = Math.hypot(dx, dy);
    if (d === 0 || d > c1.r + c2.r || d < Math.abs(c1.r - c2.r)) return [];
    const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, c1.r * c1.r - a * a));
    const mx = c1.cx + (a * dx) / d, my = c1.cy + (a * dy) / d;
    return [{ x: mx + (h * dy) / d, y: my - (h * dx) / d },
            { x: mx - (h * dy) / d, y: my + (h * dx) / d }];
}

// Break an entity into snap-able pieces (all in world coordinates)
function getSnapData(obj) {
    const d = { segs: [], endpoints: [], mids: [], nodes: [], circle: null };
    const ud = obj.userData || {};

    if (obj.isSprite) {                       // TEXT: insertion point = NODE
        d.nodes.push({ x: obj.position.x, y: obj.position.y });
        return d;
    }
    if (ud.type === 'circle') {
        d.circle = { cx: ud.center.x, cy: ud.center.y, r: ud.radius };
        return d;
    }

    const pos = obj.geometry.attributes.position;   // line / polyline / rectangle
    const pts = [];
    for (let i = 0; i < pos.count; i++) pts.push({ x: pos.getX(i), y: pos.getY(i) });
    return snapDataFromPoints(pts);
}

// Snap pieces for a plain list of points (also used for the polyline being drawn)
function snapDataFromPoints(pts) {
    const d = { segs: [], endpoints: [], mids: [], nodes: [], circle: null };
    pts.forEach((p, i) => {
        const prev = pts[i - 1];
        if (!prev || prev.x !== p.x || prev.y !== p.y) d.endpoints.push({ x: p.x, y: p.y });
    });
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (a.x === b.x && a.y === b.y) continue;   // zero-length
        d.segs.push([{ x: a.x, y: a.y }, { x: b.x, y: b.y }]);
        d.mids.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    return d;
}

// Find the best snap near the cursor. items = getSnapData() results.
function computeOsnap(items, cur, base, ap, modes) {
    const cands = [];
    const add = (type, x, y) => {
        const dist = Math.hypot(x - cur.x, y - cur.y);
        if (dist <= ap) cands.push({ type, x, y, score: dist + (SNAP_PENALTY[type] || 0) * ap });
    };
    const nearSegs = [], nearCircles = [];

    items.forEach(it => {
        if (modes.endpoint) it.endpoints.forEach(p => add('endpoint', p.x, p.y));
        if (modes.midpoint) it.mids.forEach(p => add('midpoint', p.x, p.y));
        if (modes.node) it.nodes.forEach(p => add('node', p.x, p.y));

        if (it.circle) {
            const c = it.circle;
            if (modes.center) add('center', c.cx, c.cy);
            if (modes.quadrant) {
                add('quadrant', c.cx + c.r, c.cy); add('quadrant', c.cx - c.r, c.cy);
                add('quadrant', c.cx, c.cy + c.r); add('quadrant', c.cx, c.cy - c.r);
            }
            if (modes.perpendicular && base) {
                const d = Math.hypot(base.x - c.cx, base.y - c.cy);
                if (d > 1e-9) {
                    const ux = (base.x - c.cx) / d, uy = (base.y - c.cy) / d;
                    add('perpendicular', c.cx + ux * c.r, c.cy + uy * c.r);
                    add('perpendicular', c.cx - ux * c.r, c.cy - uy * c.r);
                }
            }
            const dc = Math.hypot(cur.x - c.cx, cur.y - c.cy);
            if (modes.nearest && dc > 1e-9) add('nearest', c.cx + ((cur.x - c.cx) / dc) * c.r, c.cy + ((cur.y - c.cy) / dc) * c.r);
            if (Math.abs(dc - c.r) <= ap) nearCircles.push(c);
        }

        it.segs.forEach(([a, b]) => {
            const cp = closestOnSeg(cur, a, b);
            if (Math.hypot(cp.x - cur.x, cp.y - cur.y) <= ap) {
                nearSegs.push([a, b]);
                if (modes.nearest) add('nearest', cp.x, cp.y);
            }
            if (modes.perpendicular && base) {
                const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
                if (l2 > 0) {
                    const t = ((base.x - a.x) * dx + (base.y - a.y) * dy) / l2;
                    if (t >= 0 && t <= 1) add('perpendicular', a.x + t * dx, a.y + t * dy);
                }
            }
        });
    });

    // Intersections: both objects must pass within the aperture, so only test those
    if (modes.intersection) {
        const S = nearSegs.slice(0, 40), C = nearCircles.slice(0, 20);
        for (let i = 0; i < S.length; i++) {
            for (let j = i + 1; j < S.length; j++) {
                const p = segSegIntersect(S[i][0], S[i][1], S[j][0], S[j][1]);
                if (p) add('intersection', p.x, p.y);
            }
            C.forEach(c => segCircleIntersect(S[i][0], S[i][1], c).forEach(p => add('intersection', p.x, p.y)));
        }
        for (let i = 0; i < C.length; i++) {
            for (let j = i + 1; j < C.length; j++) {
                circleCircleIntersect(C[i], C[j]).forEach(p => add('intersection', p.x, p.y));
            }
        }
    }

    let best = null;
    cands.forEach(c => { if (!best || c.score < best.score) best = c; });
    return best;
}

function worldPerPixel() {
    return (camera.right - camera.left) / camera.zoom / renderer.domElement.clientWidth;
}

function worldToScreen(x, y) {
    camera.updateMatrixWorld(true);
    const v = new THREE.Vector3(x, y, 0).project(camera);
    return { x: ((v.x + 1) / 2) * renderer.domElement.clientWidth,
             y: ((1 - v.y) / 2) * renderer.domElement.clientHeight };
}

// The point a drawing command should use: OSNAP > (GRID SNAP, ORTHO) > raw cursor
function getDrawPoint() {
    const pt = getCursorWorldCoordinates().clone();
    currentSnap = null;

    if (currentTool === 'select') { hideSnapMarker(); return pt; }   // no snapping while selecting

    if (osnapOn) {
        const items = drawnObjects.map(getSnapData);
        // The polyline being drawn is not an object yet: snap to its own vertices/segments too
        if (currentTool === 'polyline' && isDrawing && currentPoints.length > 0) {
            items.push(snapDataFromPoints(currentPoints));
        }
        const s = computeOsnap(items, pt, isDrawing ? basePoint : null, OSNAP_APERTURE_PX * worldPerPixel(), osnapModes);
        if (s) {
            currentSnap = s;
            showSnapMarker(s);
            pt.set(s.x, s.y, 0);
            return pt;
        }
    }
    hideSnapMarker();

    if (gridSnapOn) {
        pt.x = Math.round(pt.x / GRID_SPACING) * GRID_SPACING;
        pt.y = Math.round(pt.y / GRID_SPACING) * GRID_SPACING;
    }
    if (orthoOn && isDrawing && basePoint && (currentTool === 'line' || currentTool === 'polyline')) {
        if (Math.abs(pt.x - basePoint.x) >= Math.abs(pt.y - basePoint.y)) pt.y = basePoint.y;
        else pt.x = basePoint.x;
    }
    return pt;
}

// --- snap marker (yellow AutoCAD-style glyph + tooltip) ---
function setupSnapUI(container) {
    snapMarkerEl = document.createElement('div');
    snapMarkerEl.id = 'cad-snap-marker';
    snapMarkerEl.style.cssText = 'position:absolute; display:none; pointer-events:none; z-index:950; width:0; height:0;';

    snapIconEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    snapIconEl.setAttribute('width', '20');
    snapIconEl.setAttribute('height', '20');
    snapIconEl.setAttribute('viewBox', '0 0 20 20');
    snapIconEl.setAttribute('fill', 'none');
    snapIconEl.setAttribute('stroke', '#ffeb3b');
    snapIconEl.setAttribute('stroke-width', '2');
    snapIconEl.style.cssText = 'position:absolute; left:-10px; top:-10px; overflow:visible;';

    snapLabelEl = document.createElement('span');
    snapLabelEl.style.cssText = `position:absolute; left:14px; top:10px; white-space:nowrap;
        font: 11px Consolas, 'Courier New', monospace; color:#ffeb3b;
        background: rgba(30,30,30,0.92); border:1px solid #555; padding:1px 5px;`;

    snapMarkerEl.appendChild(snapIconEl);
    snapMarkerEl.appendChild(snapLabelEl);
    container.appendChild(snapMarkerEl);
}

function showSnapMarker(s) {
    if (!snapMarkerEl) return;
    const sp = worldToScreen(s.x, s.y);
    snapMarkerEl.style.left = sp.x + 'px';
    snapMarkerEl.style.top = sp.y + 'px';
    if (lastMarkerType !== s.type) {
        snapIconEl.innerHTML = SNAP_ICONS[s.type] || '';
        snapLabelEl.textContent = SNAP_LABELS[s.type] || s.type;
        lastMarkerType = s.type;
    }
    snapMarkerEl.style.display = 'block';
}

function hideSnapMarker() {
    currentSnap = null;
    if (snapMarkerEl) snapMarkerEl.style.display = 'none';
}

// --- status bar: OSNAP / ORTHO / SNAP / GRID buttons + OSNAP settings menu ---
function setupStatusBar(container) {
    const bar = document.createElement('div');
    bar.id = 'cad-status-bar';
    bar.style.cssText = 'position:absolute; right:15px; bottom:62px; display:flex; gap:4px; z-index:1000;';

    const mk = (id, label, handler) => {
        const b = document.createElement('button');
        b.id = id; b.type = 'button'; b.textContent = label;
        b.style.cssText = `font: 11px Consolas, 'Courier New', monospace; padding:4px 8px; cursor:pointer;
            border:1px solid #444; border-radius:3px; background:#2a2a2a; color:#ccc;`;
        b.addEventListener('mousedown', e => e.preventDefault());   // keep keyboard focus off the button
        b.addEventListener('click', e => { e.stopPropagation(); handler(); });
        return b;
    };
    bar.appendChild(mk('cad-st-osnap', 'OSNAP', toggleOsnap));
    bar.appendChild(mk('cad-st-osnap-cfg', '▾', () => {
        osnapMenuEl.style.display = osnapMenuEl.style.display === 'block' ? 'none' : 'block';
    }));
    bar.appendChild(mk('cad-st-ortho', 'ORTHO', toggleOrtho));
    bar.appendChild(mk('cad-st-gsnap', 'SNAP', toggleGridSnap));
    bar.appendChild(mk('cad-st-grid', 'GRID', toggleGrid));
    container.appendChild(bar);

    osnapMenuEl = document.createElement('div');
    osnapMenuEl.style.cssText = `position:absolute; right:15px; bottom:92px; display:none; z-index:1001;
        background:rgba(30,30,30,0.97); border:1px solid #444; border-radius:4px; padding:8px 12px;
        color:#ddd; font: 12px Consolas, 'Courier New', monospace;`;
    const title = document.createElement('div');
    title.textContent = 'Object Snap Modes';
    title.style.cssText = 'color:#00ffcc; margin-bottom:6px;';
    osnapMenuEl.appendChild(title);
    Object.keys(SNAP_LABELS).forEach(key => {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex; align-items:center; gap:6px; padding:2px 0; cursor:pointer;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!osnapModes[key];
        cb.addEventListener('change', () => { osnapModes[key] = cb.checked; });
        osnapCheckboxes[key] = cb;
        row.appendChild(cb);
        row.appendChild(document.createTextNode(SNAP_LABELS[key]));
        osnapMenuEl.appendChild(row);
    });
    container.appendChild(osnapMenuEl);
    updateStatusBar();
}

function updateStatusBar() {
    const set = (id, on, extra) => {
        const b = document.getElementById(id);
        if (!b) return;
        b.style.background = on ? '#007acc' : '#2a2a2a';
        b.style.color = on ? '#fff' : '#ccc';
        if (extra) b.title = extra;
    };
    set('cad-st-osnap', osnapOn, 'Object Snap (F3)');
    set('cad-st-ortho', orthoOn, 'Ortho Mode (F8)');
    set('cad-st-gsnap', gridSnapOn, 'Grid Snap (F9)');
    set('cad-st-grid', gridHelper ? gridHelper.visible : true, 'Grid Display (F7)');
}

function toggleOsnap() {
    osnapOn = !osnapOn;
    if (!osnapOn) hideSnapMarker();
    updateStatusBar();
    notify(`<Object Snap ${osnapOn ? 'on' : 'off'}>`);
}
function toggleOrtho() {
    orthoOn = !orthoOn;
    updateStatusBar();
    notify(`<Ortho ${orthoOn ? 'on' : 'off'}>`);
}
function toggleGridSnap() {
    gridSnapOn = !gridSnapOn;
    updateStatusBar();
    notify(`<Snap mode ${gridSnapOn ? 'on' : 'off'}>`);
}

// ==========================================
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

        const o = a.objs[0];
        if (currentTool === 'line' && isDrawing && o.userData.type === 'line') {
            const pos = o.geometry.attributes.position;
            basePoint = new THREE.Vector3(pos.getX(0), pos.getY(0), 0);
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
// 4E. COMMAND LINE  (AutoCAD commands, aliases and typed coordinates)
// ==========================================
const RE_NUM = /^[-+]?(?:\d+\.?\d*|\.\d+)$/;
const RE_CART = /^([-+]?(?:\d+\.?\d*|\.\d+)),([-+]?(?:\d+\.?\d*|\.\d+))$/;
const RE_POLAR = /^([-+]?(?:\d+\.?\d*|\.\d+))<([-+]?(?:\d+\.?\d*|\.\d+))$/;

// run = implemented here. No run = real AutoCAD command that is recognised but not built yet.
const planned = (name, aliases, desc) => ({ name, aliases, desc, run: null });
const CAD_COMMANDS = [
    { name: 'LINE', aliases: ['L'], desc: 'Draw straight line segments', run: () => setTool('line') },
    { name: 'PLINE', aliases: ['PL'], desc: 'Draw a 2D polyline', run: () => setTool('polyline') },
    { name: 'RECTANG', aliases: ['REC', 'RECTANGLE'], desc: 'Draw a rectangle', run: () => setTool('rect') },
    { name: 'CIRCLE', aliases: ['C'], desc: 'Draw a circle (centre, radius)', run: () => setTool('circle') },
    { name: 'TEXT', aliases: ['DT', 'DTEXT'], desc: 'Place single-line text', run: () => setTool('text') },
    { name: 'MTEXT', aliases: ['T', 'MT'], desc: 'Text (placed as single-line text here)', run: () => setTool('text') },
    { name: 'ERASE', aliases: ['E'], desc: 'Delete objects', run: () => cmdErase() },
    { name: 'SELECT', aliases: [], desc: 'Select objects (type ALL to select everything)', run: () => cmdSelect() },
    { name: 'UNDO', aliases: ['U'], desc: 'Undo the last action', run: () => undo() },
    { name: 'REDO', aliases: [], desc: 'Redo the last undone action', run: () => redo() },
    { name: 'ZOOM', aliases: ['Z'], desc: 'Zoom: Extents, All, Window, In, Out, nX', run: () => cmdZoom() },
    { name: 'PAN', aliases: ['P'], desc: 'Pan the view', run: () => setTool('pan') },
    { name: 'REGEN', aliases: ['RE', 'REGENALL', 'REA'], desc: 'Regenerate the drawing', run: () => notify('Regenerating model.') },
    { name: 'DIST', aliases: ['DI'], desc: 'Measure distance between two points', run: () => setTool('dist') },
    { name: 'ID', aliases: [], desc: 'Show the coordinates of a point', run: () => setTool('id') },
    { name: 'GRID', aliases: [], desc: 'Grid display ON/OFF (F7)', run: () => cmdMode('GRID', () => gridHelper && gridHelper.visible, v => { if (gridHelper) gridHelper.visible = v; updateStatusBar(); }) },
    { name: 'ORTHO', aliases: [], desc: 'Ortho mode ON/OFF (F8)', run: () => cmdMode('ORTHO', () => orthoOn, v => { orthoOn = v; updateStatusBar(); }) },
    { name: 'SNAP', aliases: ['SN'], desc: 'Grid snap ON/OFF (F9)', run: () => cmdMode('SNAP', () => gridSnapOn, v => { gridSnapOn = v; updateStatusBar(); }) },
    { name: 'OSNAP', aliases: ['OS'], desc: 'Object snap modes (F3)', run: () => cmdOsnap() },
    { name: 'HELP', aliases: ['?'], desc: 'List the available commands', run: () => cmdHelp() },

    planned('ARC', ['A'], 'Draw an arc'),
    planned('ELLIPSE', ['EL'], 'Draw an ellipse'),
    planned('POLYGON', ['POL'], 'Draw a regular polygon'),
    planned('POINT', ['PO'], 'Draw a point'),
    planned('SPLINE', ['SPL'], 'Draw a spline'),
    planned('DONUT', ['DO'], 'Draw a donut'),
    planned('XLINE', ['XL'], 'Construction line'),
    planned('RAY', [], 'Ray'),
    planned('HATCH', ['H'], 'Hatch / fill an area'),
    { name: 'MOVE', aliases: ['M'], desc: 'Move selected objects', run: () => setTool('move') },
    { name: 'COPY', aliases: ['CO', 'CP'], desc: 'Copy selected objects', run: () => setTool('copy') },
    planned('ROTATE', ['RO'], 'Rotate objects'),
    planned('SCALE', ['SC'], 'Scale objects'),
    planned('MIRROR', ['MI'], 'Mirror objects'),
    planned('OFFSET', ['O'], 'Offset objects'),
    planned('TRIM', ['TR'], 'Trim objects to edges'),
    planned('EXTEND', ['EX'], 'Extend objects to edges'),
    planned('FILLET', ['F'], 'Round a corner'),
    planned('CHAMFER', ['CHA'], 'Bevel a corner'),
    planned('STRETCH', ['S'], 'Stretch objects'),
    planned('ARRAY', ['AR'], 'Array objects'),
    planned('EXPLODE', ['X'], 'Explode objects'),
    planned('JOIN', ['J'], 'Join objects'),
    planned('BREAK', ['BR'], 'Break an object'),
    planned('LENGTHEN', ['LEN'], 'Change object length'),
    planned('ALIGN', ['AL'], 'Align objects'),
    planned('MATCHPROP', ['MA'], 'Match properties'),
    planned('PROPERTIES', ['PR'], 'Properties palette'),
    planned('LAYER', ['LA'], 'Layer manager'),
    planned('BLOCK', ['B'], 'Create a block'),
    planned('INSERT', ['I'], 'Insert a block'),
    planned('DIMLINEAR', ['DLI'], 'Linear dimension'),
    planned('DIMALIGNED', ['DAL'], 'Aligned dimension'),
    planned('DIMRADIUS', ['DRA'], 'Radius dimension'),
    planned('DIMDIAMETER', ['DDI'], 'Diameter dimension'),
    planned('DIMANGULAR', ['DAN'], 'Angular dimension'),
    planned('LEADER', ['LE'], 'Leader'),
    planned('TABLE', ['TB'], 'Table'),
    planned('AREA', ['AA'], 'Measure area'),
    planned('LIST', ['LI', 'LS'], 'List object data'),
    planned('MEASURE', ['ME'], 'Measure along an object'),
    planned('DIVIDE', ['DIV'], 'Divide an object'),
    planned('UNITS', ['UN'], 'Drawing units'),
    planned('PURGE', ['PU'], 'Purge unused items'),
    planned('SAVE', ['QSAVE'], 'Save the drawing'),
    planned('OPEN', [], 'Open a drawing'),
    planned('PLOT', ['PRINT'], 'Plot / print')
];
const CMD_LOOKUP = {}, CMD_BY_NAME = {};
CAD_COMMANDS.forEach(c => {
    CMD_BY_NAME[c.name] = c;
    CMD_LOOKUP[c.name] = c;
    c.aliases.forEach(a => { CMD_LOOKUP[a] = c; });
});

// --- messages / history ---
function notify(msg) { setCommandPrompt(msg); logHistory(msg); }

function logHistory(msg) {
    cmdLog.push(String(msg));
    if (cmdLog.length > 300) cmdLog.shift();
    renderCmdOverlay();
}

function setupCommandLine(container) {
    const textEl = document.getElementById('cad-command-text');
    if (!textEl) return;
    const bar = textEl.parentElement;
    const old = document.getElementById('cad-cmd-input');
    if (old) old.remove();

    textEl.style.cssText += 'white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:55%; flex-shrink:1;';

    cmdInputEl = document.createElement('input');
    cmdInputEl.id = 'cad-cmd-input';
    cmdInputEl.type = 'text';
    cmdInputEl.autocomplete = 'off';
    cmdInputEl.spellcheck = false;
    cmdInputEl.placeholder = 'Type a command (L, PL, REC, C, Z, HELP)';
    cmdInputEl.style.cssText = `flex:1; min-width:120px; margin:0 14px; background:transparent; border:none;
        outline:none; color:#fff; font:inherit; caret-color:#00ffcc;`;
    bar.insertBefore(cmdInputEl, document.getElementById('cad-coords'));

    cmdOverlayEl = document.createElement('div');
    cmdOverlayEl.id = 'cad-cmd-overlay';
    cmdOverlayEl.style.cssText = `position:absolute; left:15px; bottom:56px; max-width:60%; display:none; z-index:1000;
        background:rgba(24,24,24,0.82); border:1px solid #333; border-radius:3px; padding:4px 8px;
        font: 12px Consolas, 'Courier New', monospace; line-height:1.5;`;
    container.appendChild(cmdOverlayEl);

    cmdInputEl.addEventListener('keydown', onCmdKeyDown);
    cmdInputEl.addEventListener('input', updateSuggestions);
    cmdInputEl.addEventListener('blur', () => { suggestions = []; suggestIdx = -1; renderCmdOverlay(); });
}

function focusCmd() { if (cmdInputEl) cmdInputEl.focus(); }

function renderCmdOverlay() {
    if (!cmdOverlayEl) return;
    cmdOverlayEl.innerHTML = '';
    clearTimeout(cmdOverlayTimer);

    if (suggestions.length) {
        suggestions.forEach((c, i) => {
            const row = document.createElement('div');
            row.textContent = `${c.name}${c.aliases.length ? '  (' + c.aliases.join(', ') + ')' : ''}  —  ${c.desc}${c.run ? '' : '  [not available yet]'}`;
            row.style.cssText = `padding:1px 6px; cursor:pointer; color:${c.run ? '#00ffcc' : '#777'};` +
                (i === suggestIdx ? 'background:#094771;' : '');
            row.addEventListener('mousedown', e => { e.preventDefault(); chooseSuggestion(c); });
            cmdOverlayEl.appendChild(row);
        });
        cmdOverlayEl.style.pointerEvents = 'auto';
    } else {
        cmdLog.slice(-cmdOverlayMax).forEach(t => {
            const row = document.createElement('div');
            row.textContent = t;
            row.style.color = '#bbb';
            cmdOverlayEl.appendChild(row);
        });
        cmdOverlayEl.style.pointerEvents = 'none';
        // history fades away after a few seconds, like AutoCAD
        cmdOverlayTimer = setTimeout(() => { if (!suggestions.length) cmdOverlayEl.style.display = 'none'; },
                                     cmdOverlayMax > 3 ? 20000 : 7000);
    }
    cmdOverlayEl.style.display = cmdOverlayEl.childNodes.length ? 'block' : 'none';
}

function updateSuggestions() {
    const v = cmdInputEl.value.trim().toUpperCase();
    suggestions = [];
    suggestIdx = -1;
    if (v && !/^[-+@#.\d]/.test(v)) {
        suggestions = CAD_COMMANDS
            .filter(c => c.name.startsWith(v) || c.aliases.some(a => a.startsWith(v)))
            .sort((a, b) => {
                const ea = (a.name === v || a.aliases.includes(v)) ? 0 : 1;
                const eb = (b.name === v || b.aliases.includes(v)) ? 0 : 1;
                if (ea !== eb) return ea - eb;
                if (!!a.run !== !!b.run) return a.run ? -1 : 1;
                return a.name.localeCompare(b.name);
            })
            .slice(0, 8);
    }
    renderCmdOverlay();
}

function chooseSuggestion(c) {
    cmdInputEl.value = '';
    suggestions = [];
    suggestIdx = -1;
    processCommandText(c.name);
}

function onCmdKeyDown(e) {
    const k = e.key;
    if (k === 'Enter' || k === ' ') {            // Space = Enter, as in AutoCAD
        e.preventDefault();
        let text = cmdInputEl.value.trim();
        if (suggestIdx >= 0 && suggestions[suggestIdx]) text = suggestions[suggestIdx].name;
        cmdInputEl.value = '';
        suggestions = [];
        suggestIdx = -1;
        processCommandText(text);
    } else if (k === 'Escape') {
        e.preventDefault();
        if (cmdInputEl.value) { cmdInputEl.value = ''; updateSuggestions(); }
        else cancelCommand();
    } else if (k === 'Tab') {
        e.preventDefault();
        if (suggestions.length) {
            suggestIdx = (suggestIdx + 1) % suggestions.length;
            cmdInputEl.value = suggestions[suggestIdx].name;
            renderCmdOverlay();
        }
    } else if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        const dir = k === 'ArrowDown' ? 1 : -1;
        if (suggestions.length) {
            suggestIdx = (suggestIdx + dir + suggestions.length) % suggestions.length;
            renderCmdOverlay();
        } else if (cmdTyped.length) {               // recall previously typed commands
            cmdTypedIdx = Math.max(0, Math.min(cmdTyped.length, cmdTypedIdx + dir));
            cmdInputEl.value = cmdTyped[cmdTypedIdx] || '';
        }
    } else if (k === 'Delete' && !cmdInputEl.value) {   // Delete with an empty command line erases the selection
        e.preventDefault();
        deleteSelectedObjects();
    }
}

// --- coordinate entry: x,y   @x,y   @dist<angle   dist<angle   #x,y   distance ---
function parsePointInput(raw, relativeDefault) {
    let s = String(raw).replace(/\s+/g, '');
    if (!s) return null;
    let relative = !!relativeDefault;
    if (s[0] === '#') { relative = false; s = s.slice(1); }
    if (s[0] === '@') { relative = true; s = s.slice(1); }
    const ref = (isDrawing && basePoint) ? basePoint : (lastPoint || new THREE.Vector3(0, 0, 0));
    let m;

    if (s === '') return lastPoint ? lastPoint.clone() : null;      // "@" alone = last point
    if ((m = s.match(RE_CART))) {
        const x = parseFloat(m[1]), y = parseFloat(m[2]);
        return relative ? new THREE.Vector3(ref.x + x, ref.y + y, 0) : new THREE.Vector3(x, y, 0);
    }
    if ((m = s.match(RE_POLAR))) {
        const d = parseFloat(m[1]), a = (parseFloat(m[2]) * Math.PI) / 180;
        const ox = relative ? ref.x : 0, oy = relative ? ref.y : 0;
        return new THREE.Vector3(ox + d * Math.cos(a), oy + d * Math.sin(a), 0);
    }
    if (RE_NUM.test(s)) {                                           // direct distance toward the cursor
        if (!(isDrawing && basePoint)) return null;
        const dist = parseFloat(s);
        const cur = getDrawPoint();
        const dx = cur.x - basePoint.x, dy = cur.y - basePoint.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) return null;
        return new THREE.Vector3(basePoint.x + (dx / len) * dist, basePoint.y + (dy / len) * dist, 0);
    }
    return null;
}

// --- what happens when something is typed + Enter ---
function processCommandText(raw) {
    const text = String(raw).trim();
    if (!text) { commandEnter(); return; }

    cmdOverlayMax = 3;
    if (cmdTyped[cmdTyped.length - 1] !== text) cmdTyped.push(text);
    cmdTypedIdx = cmdTyped.length;
    const up = text.toUpperCase();

    // 1. an option prompt is waiting (ZOOM, GRID, ERASE ...)
    if (pendingCommand && pendingCommand.onText && pendingCommand.onText(up, text)) return;

    // 2. options of the running command: C = Close, U = Undo
    if (handleToolOption(up)) return;

    // 3. coordinates for the running command
    if (currentTool !== 'select') {
        const pt = parsePointInput(text, false);
        if (pt) { logHistory(text); handleToolClick(pt); return; }
    }

    // 4. a command name or alias
    const cmd = CMD_LOOKUP[up];
    if (cmd) { runCommand(cmd); return; }

    logHistory(`Unknown command "${text}". Type HELP or ? for the command list.`);
    setCommandPrompt(`Unknown command "${text}".`);
}

function runCommand(cmd) {
    // typing a new command ends the one in progress (a polyline in progress is kept)
    if (currentTool !== 'select') {
        if (currentTool === 'polyline' && currentPoints.length > 1) commitPolyline(currentPoints);
        finishTool();
    }
    pendingCommand = null;
    lastCommandName = cmd.name;
    logHistory(`Command: ${cmd.name}`);
    if (!cmd.run) {
        const msg = `${cmd.name} (${cmd.desc}) is a real AutoCAD command, but it is not available in this viewer yet.`;
        logHistory(msg);
        setCommandPrompt(`${cmd.name}: not available yet.`);
        return;
    }
    cmd.run();
}

function handleToolOption(up) {
    const isClose = (up === 'C' || up === 'CLOSE');
    const isUndo = (up === 'U' || up === 'UNDO');

    if (currentTool === 'polyline' && isDrawing) {
        if (isClose) {
            if (currentPoints.length > 2) {
                currentPoints.push(currentPoints[0].clone());
                commitPolyline(currentPoints);
                setTool(currentTool);
            } else logHistory('PLINE — need at least 3 points to close.');
            return true;
        }
        if (isUndo) {
            currentPoints.pop();
            if (currentPoints.length === 0) setTool('polyline');
            else {
                basePoint = currentPoints[currentPoints.length - 1].clone();
                clearActiveBuffer();
                setCommandPrompt('PLINE — Last vertex removed. Next point:');
            }
            return true;
        }
    }
    if (currentTool === 'line' && isDrawing) {
        if (isClose) {
            if (lineChainStart && lineSegCount > 1) commitLine(basePoint, lineChainStart);
            else logHistory('LINE — need at least 2 segments to close.');
            setTool('line');
            return true;
        }
        if (isUndo) {
            if (lineSegCount > 0) { lineSegCount--; undo(); }
            else setTool('line');   // only the first point was placed: just drop it
            return true;
        }
    }
    return false;
}

function commandEnter() {
    if (pendingCommand) {
        const p = pendingCommand;
        if (p.onEnter) p.onEnter();
        else { pendingCommand = null; setCommandPrompt('Command:'); }
        return;
    }
    if (currentTool === 'copy') {
        finishTool();
        return;
    }
    if (currentTool !== 'select') {
        if (currentTool === 'polyline' && currentPoints.length > 1) { commitPolyline(currentPoints); setTool(currentTool); }
        else if (isDrawing) setTool(currentTool);      // abandon the unfinished object, stay in the command
        else finishTool();                             // nothing started: Enter ends the command
        return;
    }
    if (lastCommandName && CMD_BY_NAME[lastCommandName]) runCommand(CMD_BY_NAME[lastCommandName]);   // repeat last
}

function cancelCommand() {
    const wasActive = currentTool !== 'select' || isDrawing || !!pendingCommand;
    if (currentTool === 'polyline' && currentPoints.length > 1) commitPolyline(currentPoints);   // keep what was drawn
    pendingCommand = null;
    cancelBoxSelect();
    clearSelection();
    finishTool();
    if (wasActive) logHistory('*Cancel*');
}

// --- individual commands ---
function startPending(p) {
    pendingCommand = p;
    setCommandPrompt(p.prompt);
    logHistory(p.prompt);
    focusCmd();
}

function selectAll() {
    clearSelection();
    drawnObjects.forEach(o => { selectedObjects.push(o); o.material.color.setHex(0x00ffff); });
    notify(`${selectedObjects.length} found.`);
}

function cmdSelect() {
    startPending({
        name: 'SELECT',
        prompt: 'SELECT — Select objects (click, drag a window, or type ALL), then press ENTER:',
        onText: up => { if (up === 'ALL') { selectAll(); return true; } return false; },
        onEnter: () => { pendingCommand = null; setCommandPrompt(`Command: ${selectedObjects.length} object(s) selected.`); }
    });
}

function cmdErase() {
    if (selectedObjects.length > 0) { deleteSelectedObjects(); return; }   // objects already selected: erase now
    startPending({
        name: 'ERASE',
        prompt: 'ERASE — Select objects (click, drag a window, or type ALL), then press ENTER:',
        onText: up => { if (up === 'ALL') { selectAll(); return true; } return false; },
        onEnter: () => { pendingCommand = null; deleteSelectedObjects(); }
    });
}

function cmdMode(name, get, set) {
    startPending({
        name,
        prompt: `${name} — Enter mode [ON/OFF] <${get() ? 'ON' : 'OFF'}>:`,
        onText: up => {
            if (up !== 'ON' && up !== 'OFF') return false;
            set(up === 'ON');
            pendingCommand = null;
            notify(`<${name} ${up}>`);
            return true;
        },
        onEnter: () => { pendingCommand = null; setCommandPrompt('Command:'); }
    });
}

function syncOsnapMenu() {
    Object.keys(osnapCheckboxes).forEach(k => { osnapCheckboxes[k].checked = !!osnapModes[k]; });
}

function cmdOsnap() {
    const map = { END: 'endpoint', MID: 'midpoint', CEN: 'center', NOD: 'node', QUA: 'quadrant',
                  INT: 'intersection', PER: 'perpendicular', NEA: 'nearest' };
    startPending({
        name: 'OSNAP',
        prompt: 'OSNAP — Enter modes [END,MID,CEN,NOD,QUA,INT,PER,NEA] or ALL / NONE / ON / OFF:',
        onText: up => {
            if (up === 'ON' || up === 'OFF') { osnapOn = (up === 'ON'); if (!osnapOn) hideSnapMarker(); }
            else if (up === 'ALL' || up === 'NONE') { Object.keys(osnapModes).forEach(k => { osnapModes[k] = (up === 'ALL'); }); }
            else {
                const tokens = up.split(',').map(t => t.trim()).filter(Boolean);
                const bad = tokens.filter(t => !map[t.slice(0, 3)]);
                if (bad.length || tokens.length === 0) { logHistory(`Invalid mode "${bad.join(',') || up}".`); return true; }
                Object.keys(osnapModes).forEach(k => { osnapModes[k] = false; });
                tokens.forEach(t => { osnapModes[map[t.slice(0, 3)]] = true; });
                osnapOn = true;
            }
            pendingCommand = null;
            syncOsnapMenu();
            updateStatusBar();
            const active = Object.keys(osnapModes).filter(k => osnapModes[k]).map(k => SNAP_LABELS[k]);
            notify(`Object snap ${osnapOn ? 'ON' : 'OFF'}: ${active.length ? active.join(', ') : 'none'}`);
            return true;
        },
        onEnter: () => { pendingCommand = null; setCommandPrompt('Command:'); }
    });
}

function zoomBy(f) {
    camera.zoom = Math.max(0.05, Math.min(camera.zoom * f, 100));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
}

function zoomToWindow(p1, p2) {
    const w = Math.max(Math.abs(p2.x - p1.x), 1e-6), h = Math.max(Math.abs(p2.y - p1.y), 1e-6);
    const fit = Math.min((camera.right - camera.left) / w, (camera.top - camera.bottom) / h);
    camera.zoom = Math.max(0.05, Math.min(fit, 100));
    camera.position.x = (p1.x + p2.x) / 2;
    camera.position.y = (p1.y + p2.y) / 2;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    notify('Zoom Window.');
}

function cmdZoom() {
    startPending({
        name: 'ZOOM',
        prompt: 'ZOOM — [All / Extents / Window / In / Out / nX scale] <real time>:',
        onText: up => {
            let m;
            if (up === 'E' || up === 'EXT' || up === 'EXTENTS') { pendingCommand = null; zoomExtents(); }
            else if (up === 'A' || up === 'ALL') {
                pendingCommand = null;
                camera.position.x = 0; camera.position.y = 0; camera.zoom = 1;
                camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
                notify('Zoom All.');
            }
            else if (up === 'W' || up === 'WINDOW') { setTool('zoomw'); }
            else if (up === 'I' || up === 'IN') { pendingCommand = null; zoomBy(2); notify('Zoom In.'); }
            else if (up === 'O' || up === 'OUT') { pendingCommand = null; zoomBy(0.5); notify('Zoom Out.'); }
            else if ((m = up.match(/^(\d*\.?\d+)(X)?$/))) {
                pendingCommand = null;
                const n = parseFloat(m[1]);
                if (n <= 0) { logHistory('Invalid scale.'); return true; }
                if (m[2]) zoomBy(n); else { camera.zoom = Math.max(0.05, Math.min(n, 100)); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); }
                notify(`Zoom ${m[2] ? 'x' : 'scale '}${n}.`);
            }
            else { logHistory('ZOOM — Invalid option. Use A, E, W, I, O or a scale such as 2X.'); }
            return true;
        },
        onEnter: () => { pendingCommand = null; notify('ZOOM — Use the mouse wheel for real-time zoom.'); }
    });
}

function reportDistance(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, p = sysPrecision;
    let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (ang < 0) ang += 360;
    notify(`DIST — Distance = ${Math.hypot(dx, dy).toFixed(p)} ${sysUnits}, Angle = ${ang.toFixed(p)}°, ΔX = ${dx.toFixed(p)}, ΔY = ${dy.toFixed(p)}`);
}

function cmdHelp() {
    cmdOverlayMax = 14;
    const notReady = CAD_COMMANDS.filter(c => !c.run).map(c => c.aliases.length ? `${c.name} (${c.aliases[0]})` : c.name);
    [
        'DRAW:    LINE (L)  PLINE (PL)  RECTANG (REC)  CIRCLE (C)  TEXT (DT)  MTEXT (T)',
        'MODIFY:  ERASE (E)  UNDO (U)  REDO  SELECT   —  or select objects and press Delete',
        'VIEW:    ZOOM (Z) [E / A / W / I / O / 2X]   PAN (P)   REGEN (RE)',
        'INQUIRY: DIST (DI)  ID',
        'SETTINGS: GRID (F7)  ORTHO (F8)  SNAP (SN, F9)  OSNAP (OS, F3)',
        'POINTS:  100,50 absolute  |  @40,30 relative  |  @50<45 polar  |  #x,y absolute  |  20 = distance toward cursor',
        'OPTIONS: C = Close, U = Undo (LINE / PLINE)   ENTER or SPACE = finish / repeat last command   ESC = cancel',
        'Not available yet: ' + notReady.join(', ')
    ].forEach(l => cmdLog.push(l));
    setCommandPrompt('HELP — command list shown above.');
    renderCmdOverlay();
}

// ==========================================
// 5. BULK ERASE / DELETE OPERATIONS
// ==========================================
function deleteSelectedObjects() {
    if (selectedObjects.length === 0) {
        setCommandPrompt('No objects selected to delete.');
        return;
    }

    const removed = [...selectedObjects];
    removed.forEach(obj => {
        obj.material.color.setHex(obj.userData.originalColor || 0xffffff);
        removeEntity(obj);   // geometry is kept so UNDO can bring it back
    });

    selectedObjects = [];
    hoverObject = null;
    undoStack.push({ type: 'delete', objs: removed });
    redoStack = [];
    notify(`Erased ${removed.length} object(s). (Ctrl+Z to undo)`);
}

// ==========================================
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
// 7. DRAWING ENTITIES & PREVIEW
// ==========================================
function commitLine(p1, p2) {
    const geom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
    const line = new THREE.Line(geom, mat);
    line.userData = { type: 'line', originalColor: 0xffffff };
    addEntity(line);
}

function commitPolyline(pts) {
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
    const pline = new THREE.Line(geom, mat);
    pline.userData = { type: 'polyline', points: pts, originalColor: 0x00ff00 };
    addEntity(pline);
}

function rectPoints(p1, p2) {
    return [
        new THREE.Vector3(p1.x, p1.y, 0),
        new THREE.Vector3(p2.x, p1.y, 0),
        new THREE.Vector3(p2.x, p2.y, 0),
        new THREE.Vector3(p1.x, p2.y, 0),
        new THREE.Vector3(p1.x, p1.y, 0)   // close the loop
    ];
}

function commitRectangle(p1, p2) {
    if (p1.x === p2.x || p1.y === p2.y) {
        setCommandPrompt('RECTANG — Zero width or height, rectangle not created.');
        return;
    }
    const pts = rectPoints(p1, p2);
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0xff9900, linewidth: 2 });
    const rect = new THREE.Line(geom, mat);
    rect.userData = { type: 'rect', points: pts, originalColor: 0xff9900 };
    addEntity(rect);
}

function commitCircle(center, radius) {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
        const theta = (i / 64) * Math.PI * 2;
        pts.push(new THREE.Vector3(center.x + Math.cos(theta) * radius, center.y + Math.sin(theta) * radius, 0));
    }
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2 });
    const circle = new THREE.Line(geom, mat);
    circle.userData = { type: 'circle', center: center, radius: radius, originalColor: 0xffff00 };
    addEntity(circle);
}

function createTextEntity(pt, textStr) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 256; canvas.height = 64;
    ctx.fillStyle = '#00ffcc';
    ctx.font = 'bold 24px Consolas, monospace';
    ctx.fillText(textStr, 10, 42);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(pt.x, pt.y, 0);
    sprite.scale.set(20, 5, 1);
    addEntity(sprite);
}

function updateActiveBufferPreview(pt) {
    clearActiveBuffer();
    const mat = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 1.5 });

    if (currentTool === 'line' || currentTool === 'dist') {
        const geom = new THREE.BufferGeometry().setFromPoints([basePoint, pt]);
        activeBufferObj = new THREE.Line(geom, mat);
        setCommandPrompt(`${currentTool === 'dist' ? 'DIST' : 'LINE'} — Dist: ${formatVal(basePoint.distanceTo(pt))}`);
    } else if (currentTool === 'polyline') {
        const pts = [...currentPoints, pt];
        const geom = new THREE.BufferGeometry().setFromPoints(pts);
        activeBufferObj = new THREE.Line(geom, mat);
    } else if (currentTool === 'rect' || currentTool === 'zoomw') {
        const geom = new THREE.BufferGeometry().setFromPoints(rectPoints(basePoint, pt));
        activeBufferObj = new THREE.Line(geom, mat);
        setCommandPrompt(`${currentTool === 'zoomw' ? 'ZOOM' : 'RECTANG'} — W: ${formatVal(Math.abs(pt.x - basePoint.x))}  H: ${formatVal(Math.abs(pt.y - basePoint.y))}`);
    } else if (currentTool === 'circle') {
        const rad = basePoint.distanceTo(pt);
        const pts = [];
        for (let i = 0; i <= 64; i++) {
            const theta = (i / 64) * Math.PI * 2;
            pts.push(new THREE.Vector3(basePoint.x + Math.cos(theta) * rad, basePoint.y + Math.sin(theta) * rad, 0));
        }
        const geom = new THREE.BufferGeometry().setFromPoints(pts);
        activeBufferObj = new THREE.Line(geom, mat);
        setCommandPrompt(`CIRCLE — Radius: ${formatVal(rad)}`);
    }

    if (activeBufferObj) scene.add(activeBufferObj);
}

function clearActiveBuffer() {
    if (activeBufferObj) {
        scene.remove(activeBufferObj);
        activeBufferObj.geometry.dispose();
        activeBufferObj = null;
    }
}

// ==========================================
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
    // AutoCAD zooms toward the cursor: keep the world point under the mouse fixed
    const rect = renderer.domElement.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    mouse.x = ndcX; mouse.y = ndcY;

    const halfW = (camera.right - camera.left) / 2;
    const halfH = (camera.top - camera.bottom) / 2;
    const oldZoom = camera.zoom;
    const wx = camera.position.x + (ndcX * halfW) / oldZoom;
    const wy = camera.position.y + (ndcY * halfH) / oldZoom;

    const zoomFactor = 1.1;
    let newZoom = event.deltaY < 0 ? oldZoom * zoomFactor : oldZoom / zoomFactor;
    newZoom = Math.max(0.05, Math.min(newZoom, 100));
    if (newZoom === oldZoom) return;

    camera.zoom = newZoom;
    camera.position.x = wx - (ndcX * halfW) / newZoom;
    camera.position.y = wy - (ndcY * halfH) / newZoom;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const pt = getDrawPoint();

    if (currentTool === 'copy' && copyPreview) {
        updateCopyPreview(pt);
    }
    else if (currentTool === 'move' && movePreview) {
        updateMovePreview(pt);
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

function resetZoom() { zoomExtents(); }

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

// ==========================================
// DXF / DWG FILE IMPORT
// ==========================================

let importedCadObjects = [];

function cadSetFileStatus(message, error = false) {

    const el = document.getElementById("cad-file-status");

    if (el) {
        el.textContent = message;
        el.style.color = error ? "#ff7777" : "#9ee7d8";
    }
}


function cadAddLine(points, color = 0xe6e6e6, closed = false) {

    if (!points || points.length < 2) return;

    const coords = points.map(p =>
        new THREE.Vector3(
            Number(p.x) || 0,
            Number(p.y) || 0,
            0
        )
    );

    if (closed && coords.length > 2) {
        coords.push(coords[0].clone());
    }

    const geometry = new THREE.BufferGeometry()
        .setFromPoints(coords);

    const material = new THREE.LineBasicMaterial({
        color: color
    });

    const line = new THREE.Line(geometry, material);

    line.userData.importedCAD = true;

    scene.add(line);

    drawnObjects.push(line);
    importedCadObjects.push(line);
}


function cadColorForEntity(entity) {

    if (Number.isFinite(entity.trueColor)) {
        return entity.trueColor;
    }

    if (Number.isFinite(entity.color) && entity.color > 0) {

        const aci = [
            0xffffff,
            0xff0000,
            0xffff00,
            0x00ff00,
            0x00ffff,
            0x0000ff,
            0xff00ff
        ];

        return aci[entity.color] || 0xe6e6e6;
    }

    return 0xe6e6e6;
}


// ==========================================
// RENDER DXF ENTITIES
// ==========================================

function cadRenderDxf(dxf) {

    if (!dxf || !Array.isArray(dxf.entities)) {
        throw new Error("Invalid DXF drawing.");
    }

    // Remove previously imported drawing

    importedCadObjects.forEach(obj => {

        scene.remove(obj);

        obj.geometry?.dispose();
        obj.material?.dispose();

    });

    drawnObjects = drawnObjects.filter(
        obj => !obj.userData?.importedCAD
    );

    importedCadObjects = [];


    dxf.entities.forEach(entity => {

        const color = cadColorForEntity(entity);

        switch ((entity.type || "").toUpperCase()) {

            case "LINE":

                cadAddLine(
                    [entity.start, entity.end],
                    color
                );

                break;


            case "LWPOLYLINE":
            case "POLYLINE":

                cadAddLine(
                    entity.vertices || [],
                    color,
                    !!(entity.shape || entity.closed)
                );

                break;


            case "CIRCLE": {

                const c = entity.center;
                const r = Number(entity.radius);

                if (c && r > 0) {

                    const points = [];

                    for (let i = 0; i <= 96; i++) {

                        const angle = (i / 96) * Math.PI * 2;

                        points.push({
                            x: c.x + Math.cos(angle) * r,
                            y: c.y + Math.sin(angle) * r
                        });

                    }

                    cadAddLine(points, color);
                }

                break;
            }


            case "ARC": {

                const c = entity.center;
                const r = Number(entity.radius);

                if (c && r > 0) {

                    let start = Number(entity.startAngle) || 0;
                    let end = Number(entity.endAngle) || 0;

                    while (end < start) {
                        end += Math.PI * 2;
                    }

                    const steps = Math.max(
                        12,
                        Math.ceil((end - start) * 24)
                    );

                    const points = [];

                    for (let i = 0; i <= steps; i++) {

                        const angle =
                            start + (end - start) * i / steps;

                        points.push({
                            x: c.x + Math.cos(angle) * r,
                            y: c.y + Math.sin(angle) * r
                        });

                    }

                    cadAddLine(points, color);
                }

                break;
            }


            case "POINT": {

                const p = entity.position;

                if (p) {

                    cadAddLine([
                        { x: p.x - 1, y: p.y },
                        { x: p.x + 1, y: p.y }
                    ], color);

                    cadAddLine([
                        { x: p.x, y: p.y - 1 },
                        { x: p.x, y: p.y + 1 }
                    ], color);

                }

                break;
            }

        }

    });


    if (!importedCadObjects.length) {
        throw new Error(
            "No supported drawing entities found."
        );
    }

    zoomExtents();

    cadSetFileStatus(
        "Drawing loaded: " + importedCadObjects.length + " elements"
    );
}


// ==========================================
// CSRF COOKIE
// ==========================================

function cadGetCookie(name) {

    const match = document.cookie.match(
        new RegExp("(^| )" + name + "=([^;]+)")
    );

    return match ? decodeURIComponent(match[2]) : "";
}


// ==========================================
// OPEN DXF / DWG FILE
// ==========================================

async function cadOpenFile(file) {

    if (!file) return;

    const extension = file.name
        .split(".")
        .pop()
        .toLowerCase();

    cadSetFileStatus("Opening " + file.name + "...");

    try {

        let drawingText;

        // DXF FILE

        if (extension === "dxf") {

            drawingText = await file.text();

        }

        // DWG FILE

        else if (extension === "dwg") {

            const tools = document.querySelector(
                ".cad-file-tools"
            );

            const endpoint = tools.dataset.convertUrl;

            const formData = new FormData();

            formData.append("file", file);

            const response = await fetch(endpoint, {

                method: "POST",

                headers: {
                    "X-CSRFToken": cadGetCookie("csrftoken")
                },

                body: formData

            });

            if (!response.ok) {

                const data = await response.json();

                throw new Error(
                    data.error || "DWG conversion failed."
                );

            }

            drawingText = await response.text();

        }

        else {

            throw new Error(
                "Please select a DXF or DWG file."
            );

        }


        // CHECK DXF PARSER

        if (typeof DxfParser === "undefined") {

            throw new Error(
                "DXF parser library not loaded."
            );

        }


        // PARSE DRAWING

        const parser = new DxfParser();

        const parsedDrawing = parser.parseSync(
            drawingText
        );

        // DISPLAY DRAWING

        cadRenderDxf(parsedDrawing);

    }

    catch (error) {

        console.error("CAD Import Error:", error);

        cadSetFileStatus(
            error.message || "Unable to open drawing.",
            true
        );

    }

}


// ==========================================
// FILE INPUT EVENT
// ==========================================

document.addEventListener("DOMContentLoaded", function() {

    const input = document.getElementById(
        "cad-file-input"
    );

    if (input) {

        input.addEventListener("change", function(event) {

            cadOpenFile(event.target.files[0]);

        });

    }

});