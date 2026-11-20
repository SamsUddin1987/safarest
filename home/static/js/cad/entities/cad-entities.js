// 7. DRAWING ENTITIES & PREVIEW
// ==========================================

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

    // =====================================
    // INDEPENDENT DRAW COMMAND PREVIEWS
    // =====================================

    const activeDrawTool = CAD.getTool(currentTool);

    if (
        activeDrawTool &&
        typeof activeDrawTool.onPreview === 'function'
    ) {

        activeDrawTool.onPreview(
            pt,
            CAD.createContext()
        );

        return;
    }

    // Remove old preview before creating another.
    clearActiveBuffer();

    const mat = new THREE.LineBasicMaterial({
        color: 0x00ffff,
        linewidth: 1.5
    });


    // =====================================
    // DISTANCE PREVIEW
    // =====================================

    if (currentTool === 'dist') {

        const geom =
            new THREE.BufferGeometry().setFromPoints([
                basePoint,
                pt
            ]);

        activeBufferObj = new THREE.Line(geom, mat);

        setCommandPrompt(
            `DIST — Dist: ${formatVal(basePoint.distanceTo(pt))}`
        );
    }


    // =====================================
    // ZOOM WINDOW PREVIEW
    // =====================================

    else if (currentTool === 'zoomw') {

        const geom =
            new THREE.BufferGeometry().setFromPoints(
                rectPoints(basePoint, pt)
            );

        activeBufferObj = new THREE.Line(geom, mat);

        setCommandPrompt(
            `ZOOM — W: ${formatVal(Math.abs(pt.x - basePoint.x))} H: ${formatVal(Math.abs(pt.y - basePoint.y))}`
        );
    }


    if (activeBufferObj) {
        scene.add(activeBufferObj);
    }

}

function clearActiveBuffer() {

    if (!activeBufferObj) return;

    scene.remove(activeBufferObj);

    if (activeBufferObj.geometry) {
        activeBufferObj.geometry.dispose();
    }

    if (activeBufferObj.material) {

        if (Array.isArray(activeBufferObj.material)) {

            activeBufferObj.material.forEach(material => {
                if (material) material.dispose();
            });

        } else {

            activeBufferObj.material.dispose();

        }
    }

    activeBufferObj = null;
}

// ==========================================