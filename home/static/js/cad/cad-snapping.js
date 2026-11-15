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
