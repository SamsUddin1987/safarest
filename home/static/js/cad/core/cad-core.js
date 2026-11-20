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


/**
 * SAFAR EDGE CAD
 * Command Context Provider
 *
 * Provides a controlled interface between
 * the CAD engine and independent commands.
 */


function createCADCommandContext() {

    return Object.freeze({

        // ---------------------------------
        // CAD STATE
        // ---------------------------------

        getState() {

            return Object.freeze({

                currentTool: currentTool,
                isDrawing: isDrawing,

                basePoint: basePoint ? basePoint.clone() : null,

                currentPoints: currentPoints.map(
                    point => point.clone()
                ),

                lineChainStart: lineChainStart
                    ? lineChainStart.clone()
                    : null,

                lineSegCount: lineSegCount,
                toolStep: toolStep,

                units: sysUnits,
                precision: sysPrecision,

                drawnObjects: [...drawnObjects],
                selectedObjects: [...selectedObjects]

            });

        },


        // ---------------------------------
        // CONTROLLED STATE UPDATE
        // ---------------------------------

        updateState(patch) {

            if (!patch || typeof patch !== 'object') return;

            if ('isDrawing' in patch) {
                isDrawing = Boolean(patch.isDrawing);
            }

            if ('basePoint' in patch) {
                basePoint = patch.basePoint
                    ? patch.basePoint.clone()
                    : null;
            }

            if ('currentPoints' in patch) {
                currentPoints = Array.isArray(patch.currentPoints)
                    ? patch.currentPoints.map(point => point.clone())
                    : [];
            }

            if ('lineChainStart' in patch) {
                lineChainStart = patch.lineChainStart
                    ? patch.lineChainStart.clone()
                    : null;
            }

            if ('lineSegCount' in patch) {
                lineSegCount = Math.max(
                    0,
                    Number(patch.lineSegCount) || 0
                );
            }

            if ('toolStep' in patch) {
                toolStep = Number(patch.toolStep) || 0;
            }

        },


        // ---------------------------------
        // THREE.JS ENGINE
        // ---------------------------------

        getScene() {
            return scene;
        },

        getCamera() {
            return camera;
        },

        getRenderer() {
            return renderer;
        },


        // ---------------------------------
        // TOOL OPERATIONS
        // ---------------------------------

        setTool(toolName, copySources) {
            return setTool(toolName, copySources);
        },

        finishCurrentTool() {
            return finishTool();
        },


        // ---------------------------------
        // ENTITY OPERATIONS
        // ---------------------------------

        addEntity(object, record) {
            return addEntity(object, record);
        },

        removeEntity(object) {
            return removeEntity(object);
        },


        // ---------------------------------
        // PREVIEW OPERATIONS
        // ---------------------------------

        setPreview(object) {

            clearActiveBuffer();

            activeBufferObj = object;

            if (scene && object) {
                scene.add(object);
            }

            return object;

        },

        clearPreview() {
            return clearActiveBuffer();
        },


        // ---------------------------------
        // HISTORY
        // ---------------------------------

        undo() {
            return undo();
        },

        redo() {
            return redo();
        },


        // ---------------------------------
        // VIEW
        // ---------------------------------

        zoomExtents() {
            return zoomExtents();
        },


        // ---------------------------------
        // SELECTION
        // ---------------------------------

        deleteSelectedObjects() {
            return deleteSelectedObjects();
        },


        // ---------------------------------
        // USER INTERFACE
        // ---------------------------------

        setPrompt(message) {
            return setCommandPrompt(message);
        },

        writeHistory(message) {
            return logHistory(message);
        },

        notify(message) {
            return notify(message);
        },

        formatValue(value) {
            return formatVal(value);
        }

    });

}

// Connect context provider with the registry
if (
    window.CAD &&
    typeof window.CAD.setContextProvider === 'function'
) {
    window.CAD.setContextProvider(createCADCommandContext);
}

// ==========================================
