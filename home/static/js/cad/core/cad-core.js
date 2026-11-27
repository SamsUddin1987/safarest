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

// Drawing limits — AutoCAD-style drawing boundary.
// Default boundary is inactive until the user enables it.
let sysLimits = {
    active: false,
    minX: 0,
    minY: 0,
    maxX: 420,
    maxY: 297
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
let selectionGripGroup = null; // AutoCAD-style grips for selected entities
let selectionGripMeshes = [];
let selectionGripDrag = null;
let cadClipboard = [];
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

// Clipboard insertion reference point
let cadClipboardBasePoint = null;

// Pan (hold middle mouse button / scroll wheel and drag)
let isPanning = false;
let panLastX = 0, panLastY = 0;
let lastMiddleDown = 0;        // for middle double-click = Zoom Extents

// Drafting aids (AutoCAD status bar: OSNAP F3, GRID F7, ORTHO F8, SNAP F9)
let osnapOn = true, orthoOn = false, gridSnapOn = false, otrackOn = false;
let otrackPoints = [], otrackTool = null, otrackGuideEl = null;
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
    rotate: 'ROTATE',
    scale: 'SCALE',
    mirror: 'MIRROR',
    trim: 'TRIM',
    extend: 'EXTEND',
    join: 'JOIN',
    extrude: 'EXTRUDE',
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
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    // Keep GPU cost predictable on laptops and integrated graphics.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    else if ('outputEncoding' in renderer && THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
    if ('toneMapping' in renderer && THREE.ACESFilmicToneMapping !== undefined) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
    }
    if (renderer.shadowMap) {
        renderer.shadowMap.enabled = true;
        if (THREE.PCFSoftShadowMap !== undefined) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
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
    domEl.addEventListener('mouseleave', () => {
        clearHover();
        hideSnapMarker();
    });
    window.addEventListener('mouseup', onMouseUp);
    domEl.addEventListener('click', onCanvasClick);
    domEl.addEventListener('wheel', onMouseWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);

    animate();
    setCommandPrompt('Command: Ready. Select objects or pick a tool.');
}

function animate() {
    requestAnimationFrame(animate);
    // Keep grip markers a constant screen size while zooming/panning.
    updateSelectionGrips();
    renderer.render(scene, camera);
}

// ==========================================
// AUTOCAD-STYLE SELECTION GRIPS
// ==========================================
// Grips are rendered in a separate overlay group. They are deliberately NOT
// added to drawnObjects, so they never participate in entity picking,
// selection windows, snapping, saving, or CAD history.
function ensureSelectionGripGroup() {
    if (!scene || !THREE) return null;
    if (!selectionGripGroup) {
        selectionGripGroup = new THREE.Group();
        selectionGripGroup.name = 'CAD_SELECTION_GRIPS';
        selectionGripGroup.renderOrder = 10000;
        scene.add(selectionGripGroup);
    }
    return selectionGripGroup;
}

function getSelectionGripDescriptors(object) {
    if (!object) return [];
    object.updateMatrixWorld(true);
    const data = object.userData || {};
    const descriptors = [];
    // Dimensions are edited through DIMEDIT/DIMSTYLE. 3D solids receive a
    // camera-facing centre grip so they can be repositioned in ISO as well.
    if (data.type === 'dimension') return descriptors;
    if (data.type === 'solid') {
        const box = new THREE.Box3().setFromObject(object);
        if (!box.isEmpty()) {
            descriptors.push({
                object,
                kind: 'solid-move',
                index: 0,
                point: box.getCenter(new THREE.Vector3())
            });
        }
        return descriptors;
    }

    // Circle grips follow conventional CAD behaviour:
    // - centre grip moves the complete circle;
    // - four quadrant grips change the radius while keeping the entity circular.
    if (data.type === 'circle' && data.center) {
        const center = data.center.isVector3
            ? data.center.clone()
            : new THREE.Vector3(data.center.x, data.center.y, data.center.z || 0);
        const radius = Math.max(Number(data.radius) || 0, 0);
        const z = center.z || 0;

        const grips = [
            { object, kind: 'circle-center', index: 0, point: center.clone() }
        ];

        if (radius > 1e-10) {
            grips.push(
                { object, kind: 'circle-radius', index: 1, direction: 'east', point: new THREE.Vector3(center.x + radius, center.y, z) },
                { object, kind: 'circle-radius', index: 2, direction: 'north', point: new THREE.Vector3(center.x, center.y + radius, z) },
                { object, kind: 'circle-radius', index: 3, direction: 'west', point: new THREE.Vector3(center.x - radius, center.y, z) },
                { object, kind: 'circle-radius', index: 4, direction: 'south', point: new THREE.Vector3(center.x, center.y - radius, z) }
            );
        }

        return grips;
    }

    // Every stored polyline/rectangle vertex gets an editable grip.
    if (Array.isArray(data.points) && data.points.length) {
        const source = data.points;
        let count = source.length;
        // Closed paths store the first vertex twice. Show only one grip there.
        if (count > 2) {
            const first = source[0], last = source[count - 1];
            if (first && last && Math.hypot(first.x-last.x, first.y-last.y, (first.z||0)-(last.z||0)) < 1e-7) count -= 1;
        }
        for (let index = 0; index < count; index++) {
            const value = source[index];
            if (!value) continue;
            const point = value.isVector3
                ? value.clone()
                : new THREE.Vector3(value.x, value.y, value.z || 0);
            descriptors.push({ object, kind: 'vertex', index, point });
        }
        return descriptors;
    }

    // LINE and other simple vertex entities: first and last geometry vertices.
    const attribute = object.geometry && object.geometry.getAttribute
        ? object.geometry.getAttribute('position') : null;
    if (attribute && attribute.count) {
        const indices = attribute.count === 1 ? [0] : [0, attribute.count - 1];
        indices.forEach(index => {
            const local = new THREE.Vector3().fromBufferAttribute(attribute, index);
            descriptors.push({ object, kind: 'vertex', index, point: object.localToWorld(local) });
        });
    }
    return descriptors;
}

function createSelectionGripMesh() {
    const group = new THREE.Group();
    const fill = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
            color: 0x36a9e8,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide
        })
    );
    const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
        new THREE.LineBasicMaterial({ color: 0x102b3b, depthTest: false, depthWrite: false })
    );
    fill.renderOrder = 10000;
    outline.renderOrder = 10001;
    group.add(fill, outline);
    group.userData.isCadSelectionGrip = true;
    return group;
}

function updateSelectionGrips() {
    if (!scene || !camera || !renderer || !THREE) return;
    const group = ensureSelectionGripGroup();
    if (!group) return;

    // Selection grips are shown only in idle SELECT mode. During commands
    // such as EXTEND they are hidden, while entity rollover/selection colour
    // remains visible. This avoids confusing blue vertex nodes in command mode.
    group.visible = currentTool === 'select';

    const desired = [];
    selectedObjects.forEach(object => {
        getSelectionGripDescriptors(object).forEach(descriptor => desired.push(descriptor));
    });

    while (selectionGripMeshes.length < desired.length) {
        const grip = createSelectionGripMesh();
        selectionGripMeshes.push(grip);
        group.add(grip);
    }
    while (selectionGripMeshes.length > desired.length) {
        const grip = selectionGripMeshes.pop();
        group.remove(grip);
        grip.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                (Array.isArray(child.material) ? child.material : [child.material])
                    .forEach(material => material.dispose());
            }
        });
    }

    const canvasWidth = renderer.domElement.clientWidth || 1;
    const worldPerPixel = (camera.right - camera.left) /
        ((camera.zoom || 1) * canvasWidth);
    const gripSize = Math.max(worldPerPixel * 7, 1e-5);

    desired.forEach((descriptor, index) => {
        const grip = selectionGripMeshes[index];
        const point = descriptor.point;
        grip.userData.cadGrip = descriptor;
        // Face each grip toward the active camera. A fixed XY quad becomes
        // edge-on/foreshortened in ISO, making nodes difficult to see and pick.
        grip.position.copy(point);
        grip.quaternion.copy(camera.quaternion);
        grip.scale.set(gripSize, gripSize, 1);
        grip.visible = true;
    });
}

function clearSelectionGrips() {
    selectedObjects = [];
    updateSelectionGrips();
}

// Apply a live grip edit from the original mouse-down snapshot. Rebuilding from
// the snapshot prevents accumulated floating-point drift while dragging.
function applySelectionGripPoint(drag, worldPoint) {
    if (!drag || !drag.object || !drag.originalGeometry) return;
    const object = drag.object;
    if (object.geometry) object.geometry.dispose();
    object.geometry = drag.originalGeometry.clone();
    object.userData = JSON.parse(JSON.stringify(drag.originalUserData || {}));

    if (drag.descriptor.kind === 'solid-move') {
        const delta = worldPoint.clone().sub(drag.startPoint);
        object.position.copy(drag.originalPosition || new THREE.Vector3()).add(delta);
        object.updateMatrixWorld(true);
        updateSelectionGrips();
        return;
    }

    object.updateMatrixWorld(true);
    const inverse = object.matrixWorld.clone().invert();
    const localPoint = worldPoint.clone().applyMatrix4(inverse);

    if (drag.descriptor.kind === 'circle-center') {
        const startLocal = drag.startPoint.clone().applyMatrix4(inverse);
        const deltaLocal = localPoint.clone().sub(startLocal);
        object.geometry.translate(deltaLocal.x, deltaLocal.y, deltaLocal.z);
        const center = object.userData.center;
        if (center) {
            center.x += worldPoint.x - drag.startPoint.x;
            center.y += worldPoint.y - drag.startPoint.y;
            center.z = (center.z || 0) + worldPoint.z - drag.startPoint.z;
        }
    } else if (drag.descriptor.kind === 'circle-radius') {
        // Resize the circle uniformly from its centre. Never distort it into
        // an ellipse, and always rebuild from the original mouse-down geometry.
        const centerData = object.userData.center;
        const originalRadius = Number(drag.originalUserData && drag.originalUserData.radius);
        const attribute = object.geometry && object.geometry.getAttribute('position');

        if (!centerData || !attribute || !Number.isFinite(originalRadius) || originalRadius <= 1e-10) {
            return;
        }

        const centerWorld = centerData.isVector3
            ? centerData.clone()
            : new THREE.Vector3(centerData.x, centerData.y, centerData.z || 0);
        const centerLocal = centerWorld.applyMatrix4(inverse);
        const newRadius = Math.hypot(
            localPoint.x - centerLocal.x,
            localPoint.y - centerLocal.y
        );

        // Prevent a zero-radius entity, which would be invisible and difficult
        // to select. The lower bound is intentionally tiny relative to drawing units.
        if (!Number.isFinite(newRadius) || newRadius <= 1e-8) return;

        const scale = newRadius / originalRadius;
        const sourceAttribute = drag.originalGeometry.getAttribute('position');

        for (let i = 0; i < attribute.count; i++) {
            const x = sourceAttribute.getX(i);
            const y = sourceAttribute.getY(i);
            const z = sourceAttribute.getZ(i);
            attribute.setXYZ(
                i,
                centerLocal.x + (x - centerLocal.x) * scale,
                centerLocal.y + (y - centerLocal.y) * scale,
                z
            );
        }

        attribute.needsUpdate = true;
        object.userData.radius = newRadius;
    } else {
        const attribute = object.geometry.getAttribute('position');
        const index = drag.descriptor.index;
        if (!attribute || index < 0 || index >= attribute.count) return;
        attribute.setXYZ(index, localPoint.x, localPoint.y, localPoint.z);
        attribute.needsUpdate = true;

        const points = object.userData.points;
        if (Array.isArray(points) && points[index]) {
            points[index].x = worldPoint.x;
            points[index].y = worldPoint.y;
            points[index].z = worldPoint.z;
            // Keep a closed polyline closed when its first node is moved.
            if (index === 0 && points.length > 2) {
                const last = points[points.length - 1];
                if (Math.hypot(last.x - drag.originalUserData.points[0].x,
                    last.y - drag.originalUserData.points[0].y) < 1e-7) {
                    last.x = worldPoint.x; last.y = worldPoint.y; last.z = worldPoint.z;
                    const lastIndex = attribute.count - 1;
                    const lastLocal = new THREE.Vector3().copy(localPoint);
                    attribute.setXYZ(lastIndex, lastLocal.x, lastLocal.y, lastLocal.z);
                }
            }
        }
        if (object.userData.type === 'rect') object.userData.type = 'polyline';
    }
    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();
    updateSelectionGrips();
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
                limits: { ...sysLimits },

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
        // LOCAL PROJECT FILE SUPPORT
        // ---------------------------------

        // Reset history when opening or creating a project.
        resetHistory() {
            undoStack.length = 0;
            redoStack.length = 0;
        },

        // Restore drawing measurement settings.
        setDrawingSettings(units, precision) {
            if (typeof units === 'string' && units) {
                sysUnits = units;
            }

            if (precision !== undefined && Number.isFinite(Number(precision))) {
                sysPrecision = Number(precision);
            }
        },

        // Drawing limits support
        getDrawingLimits() {
            return { ...sysLimits };
        },

        setDrawingLimits(limits) {
            if (!limits || typeof limits !== 'object') {
                throw new Error('Invalid drawing limits.');
            }

            const minX = Number(limits.minX);
            const minY = Number(limits.minY);
            const maxX = Number(limits.maxX);
            const maxY = Number(limits.maxY);

            if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
                throw new Error('Drawing limits must contain valid coordinates.');
            }

            if (maxX <= minX || maxY <= minY) {
                throw new Error('Upper-right corner must be greater than lower-left corner.');
            }

            sysLimits = {
                active: Boolean(limits.active),
                minX,
                minY,
                maxX,
                maxY
            };

            if (window.SafarEdgeProjectFiles) {
                window.SafarEdgeProjectFiles.markDirty();
            }

            return { ...sysLimits };
        },

        isPointWithinLimits(point) {
            if (!sysLimits.active) return true;

            return (
                point.x >= sysLimits.minX &&
                point.x <= sysLimits.maxX &&
                point.y >= sysLimits.minY &&
                point.y <= sysLimits.maxY
            );
        },

        // ---------------------------------
        // TOOL OPERATIONS
        // ---------------------------------

        setTool(toolName, options) {
            return setTool(toolName, options);
        },

        finishCurrentTool() {
            return finishTool();
        },


        // ---------------------------------
        // ENTITY OPERATIONS
        // ---------------------------------

        addEntity(object, record) {
            const result = addEntity(object, record);
            if (window.SafarEdgeProjectFiles) {
                window.SafarEdgeProjectFiles.markDirty();
            }
            return result;
        },

        removeEntity(object) {
            const result = removeEntity(object);
            if (window.SafarEdgeProjectFiles) {
                window.SafarEdgeProjectFiles.markDirty();
            }
            return result;
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
        },


        // ---------------------------------
        // MODIFY COMMAND SUPPORT
        // ---------------------------------

        getObjects() { return [...drawnObjects]; },
        getSelectedObjects() { return [...selectedObjects]; },
        // Return all top-level CAD entities hit by the current pointer, in
        // nearest-first order. Nested meshes are resolved to their owning entity.
        // This is useful for commands such as EXPLODE where the nearest raw hit
        // may be an unsupported overlay/entity while a supported entity is also
        // under the pick aperture.
        getObjectsAtPointer() {
            if (!raycaster || !camera || !mouse) return [];
            const pickable = drawnObjects.filter(o => !(o.userData && o.userData.layerLocked));
            const hits = window.CADPicking && typeof window.CADPicking.getIntersections === 'function'
                ? window.CADPicking.getIntersections(pickable)
                : (raycaster.setFromCamera(mouse, camera), raycaster.intersectObjects(pickable, true));
            const objects = [];
            hits.forEach(hit => {
                let object = hit.object;
                while (object && !drawnObjects.includes(object)) object = object.parent;
                if (object && !objects.includes(object)) objects.push(object);
            });
            return objects;
        },
        // Backward-compatible single-object picker.
        getObjectAtPointer() {
            return this.getObjectsAtPointer()[0] || null;
        },
        // World-space tolerance corresponding to a small screen pick aperture.
        getPickTolerance(pixels = 14) {
            if (!camera || !renderer) return 1;
            const width = renderer.domElement.clientWidth || 1;
            const worldWidth = (camera.right - camera.left) / (camera.zoom || 1);
            return Math.max(1e-6, worldWidth / width * pixels);
        },
        getWorldBounds(object) { return getWorldBounds(object); },
        cloneObject(object) { return cloneCadObject(object); },
        translateObjects(objects, dx, dy, dz = 0) { return translateCadObjects(objects, dx, dy, dz); },
        applyMatrix(objects, matrix) {
            (objects || []).forEach(object => {
                const applyChild = child => {
                    if (child !== object && child.geometry) {
                        child.geometry.applyMatrix4(matrix);
                        child.geometry.computeBoundingSphere();
                    }
                    if (child !== object && child.isSprite) child.position.applyMatrix4(matrix);
                };
                if (object.geometry) {
                    object.geometry.applyMatrix4(matrix);
                    object.geometry.computeBoundingSphere();
                }
                if (object.isSprite) object.position.applyMatrix4(matrix);
                if (object.traverse) object.traverse(applyChild);
                const data = object.userData || {};
                const transformPoint = point => {
                    const v = new THREE.Vector3(point.x, point.y, point.z || 0).applyMatrix4(matrix);
                    point.x = v.x; point.y = v.y; if ('z' in point) point.z = v.z;
                };
                const transformArray = arr => {
                    if (!Array.isArray(arr) || arr.length < 2) return;
                    const v = new THREE.Vector3(arr[0], arr[1], arr[2] || 0).applyMatrix4(matrix);
                    arr[0] = v.x; arr[1] = v.y; if (arr.length > 2) arr[2] = v.z;
                };
                if (data.center) transformPoint(data.center);
                if (Array.isArray(data.points)) data.points.forEach(transformPoint);
                if (data.dimensionData) {
                    ['p1','p2','location','vertex','ray1','ray2','arcPoint','center','point'].forEach(k => transformArray(data.dimensionData[k]));
                    const sx = new THREE.Vector3(1, 0, 0).applyMatrix4(matrix).length();
                    const sy = new THREE.Vector3(0, 1, 0).applyMatrix4(matrix).length();
                    if (data.dimensionData.radius !== undefined) data.dimensionData.radius *= (sx + sy) / 2;
                }
                if ((data.type === 'circle' || data.type === 'dimension') && data.radius !== undefined) {
                    const sx = new THREE.Vector3(1, 0, 0).applyMatrix4(matrix).length();
                    const sy = new THREE.Vector3(0, 1, 0).applyMatrix4(matrix).length();
                    data.radius *= (sx + sy) / 2;
                }
            });
        },
        captureObjects(objects) {
            return (objects || []).map(object => {
                const children = [];
                if (object.traverse) object.traverse(child => {
                    if (child === object) return;
                    children.push({
                        child,
                        geometry: child.geometry ? child.geometry.clone() : null,
                        position: child.position.clone(),
                        quaternion: child.quaternion.clone(),
                        scale: child.scale.clone()
                    });
                });
                return {
                    object,
                    geometry: object.geometry ? object.geometry.clone() : null,
                    position: object.position.clone(),
                    quaternion: object.quaternion.clone(),
                    scale: object.scale.clone(),
                    userData: JSON.parse(JSON.stringify(object.userData || {})),
                    children
                };
            });
        },
        restoreObjects(snapshots) {
            (snapshots || []).forEach(snapshot => {
                const object = snapshot.object;
                if (object.geometry) object.geometry.dispose();
                object.geometry = snapshot.geometry ? snapshot.geometry.clone() : object.geometry;
                object.position.copy(snapshot.position);
                object.quaternion.copy(snapshot.quaternion);
                object.scale.copy(snapshot.scale);
                object.userData = JSON.parse(JSON.stringify(snapshot.userData || {}));
                (snapshot.children || []).forEach(childSnapshot => {
                    const child = childSnapshot.child;
                    if (child.geometry) child.geometry.dispose();
                    child.geometry = childSnapshot.geometry ? childSnapshot.geometry.clone() : child.geometry;
                    child.position.copy(childSnapshot.position);
                    child.quaternion.copy(childSnapshot.quaternion);
                    child.scale.copy(childSnapshot.scale);
                });
            });
        },
        recordModify(objects, before) {
            undoStack.push({ type: 'modify', before, after: this.captureObjects(objects) });
            redoStack = [];
            if (window.SafarEdgeProjectFiles) window.SafarEdgeProjectFiles.markDirty();
            if (window.SafarEdgeMeasurements) window.SafarEdgeMeasurements.scheduleSync();
        },
        recordReplace(beforeObjects, afterObjects) {
            undoStack.push({
                type: 'replace',
                beforeObjects: [...(beforeObjects || [])],
                afterObjects: [...(afterObjects || [])]
            });
            redoStack = [];
            if (window.SafarEdgeProjectFiles) window.SafarEdgeProjectFiles.markDirty();
            if (window.SafarEdgeMeasurements) window.SafarEdgeMeasurements.scheduleSync();
        },
        setSelection(objects) {
            clearSelection();
            (objects || []).forEach(object => {
                if (drawnObjects.includes(object) && !selectedObjects.includes(object)) {
                    selectedObjects.push(object);
                    // Use the same recursive visual-state handling as ordinary
                    // canvas selection so Mesh solids and their edge children
                    // retain their original colours when deselected.
                    if (typeof setCadObjectSelectedState === 'function') {
                        setCadObjectSelectedState(object, true);
                    } else if (object.material && object.material.color) {
                        object.material.color.setHex(0x00ffff);
                    }
                }
            });
            updateSelectionGrips();
            if (window.SafarEdgeRefreshSidePanel) window.SafarEdgeRefreshSidePanel();
        },
        clearSelection() {
            const result = clearSelection();
            if (window.SafarEdgeRefreshSidePanel) window.SafarEdgeRefreshSidePanel();
            return result;
        },
        getThree() { return THREE; },
        getPendingCommand() { return pendingCommand; },
        setPendingCommand(value) { pendingCommand = value; },
        getToolName() { return currentTool; },
        setToolName(name, options) { return setTool(name, options); },
        getLastPoint() { return lastPoint ? lastPoint.clone() : null; }

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
