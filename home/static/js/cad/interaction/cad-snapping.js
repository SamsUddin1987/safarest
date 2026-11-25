// 4C. OSNAP (OBJECT SNAP), ORTHO, GRID SNAP
// ==========================================

// OTRACK acquires an object-snap reference only after a deliberate hover.
// This avoids collecting every snap point crossed by a moving cursor.
let otrackAcquireTimer = null;
let otrackAcquireCandidate = null;
const OTRACK_ACQUIRE_DELAY_MS = 350;
const OTRACK_ACQUIRE_APERTURE_PX = 5;

function cancelOtrackAcquisition() {
    if (otrackAcquireTimer !== null) {
        clearTimeout(otrackAcquireTimer);
        otrackAcquireTimer = null;
    }
    otrackAcquireCandidate = null;
}

function updateOtrackAcquisition(snap, items = []) {
    if (!otrackOn || !osnapOn || !snap) {
        cancelOtrackAcquisition();
        return;
    }

    const allowedTypes = new Set([
        'endpoint', 'midpoint', 'intersection', 'node',
        'center', 'quadrant'
    ]);
    if (!allowedTypes.has(snap.type)) {
        cancelOtrackAcquisition();
        return;
    }

    const tolerance = OTRACK_ACQUIRE_APERTURE_PX * worldPerPixel();
    const sameCandidate = otrackAcquireCandidate &&
        otrackAcquireCandidate.type === snap.type &&
        Math.hypot(otrackAcquireCandidate.x - snap.x, otrackAcquireCandidate.y - snap.y) <= tolerance;

    if (sameCandidate) return;

    cancelOtrackAcquisition();
    otrackAcquireCandidate = {
        x: snap.x, y: snap.y, type: snap.type,
        snap: { ...snap },
        items
    };

    const candidate = otrackAcquireCandidate;
    otrackAcquireTimer = setTimeout(() => {
        if (otrackAcquireCandidate !== candidate || !otrackOn) return;
        rememberOtrackPoint(candidate.snap, candidate.items);
        otrackAcquireTimer = null;
    }, OTRACK_ACQUIRE_DELAY_MS);
}

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

    const d = {
        segs: [],
        endpoints: [],
        mids: [],
        nodes: [],
        circle: null
    };

    const ud = obj.userData || {};

    // Ensure the object's world transformation is current
    obj.updateWorldMatrix(true, false);

    // TEXT: insertion point
    if (obj.isSprite) {

        const p = new THREE.Vector3();
        obj.getWorldPosition(p);

        d.nodes.push({
            x: p.x,
            y: p.y
        });

        return d;
    }

    // CIRCLE
    if (ud.type === 'circle') {

        d.circle = {
            cx: ud.center.x,
            cy: ud.center.y,
            r: ud.radius
        };

        return d;
    }

    // LINE / POLYLINE / RECTANGLE
    const pos = obj.geometry?.attributes?.position;

    if (!pos) return d;

    const pts = [];
    const v = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {

        v.fromBufferAttribute(pos, i)
         .applyMatrix4(obj.matrixWorld);

        pts.push({
            x: v.x,
            y: v.y
        });
    }

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
    const rect = renderer.domElement.getBoundingClientRect();

    if (!rect.width) return 0;

    return (camera.right - camera.left) /
           camera.zoom /
           rect.width;
}

function worldToScreen(x, y) {
    camera.updateMatrixWorld(true);

    const rect = renderer.domElement.getBoundingClientRect();

    const v = new THREE.Vector3(x, y, 0).project(camera);

    return {
        x: ((v.x + 1) / 2) * rect.width,
        y: ((1 - v.y) / 2) * rect.height
    };
}

// Apply AutoCAD-style ORTHO from a fixed base point. Used by drawing,
// MOVE and COPY/COPY-PASTE previews after OSNAP/OTRACK has resolved.
function constrainPointToOrtho(point, origin) {
    if (!orthoOn || !point || !origin) return point;

    const dx = point.x - origin.x;
    const dy = point.y - origin.y;

    if (Math.abs(dx) >= Math.abs(dy)) {
        point.y = origin.y;
    } else {
        point.x = origin.x;
    }
    return point;
}

function shouldApplyPointOrtho() {
    return orthoOn && isDrawing && basePoint &&
        ['line', 'polyline', 'move', 'copy'].includes(currentTool);
}

// The point a drawing command should use: OSNAP > OTRACK > GRID/ORTHO > raw cursor.
function getDrawPoint() {
    const pt = getCursorWorldCoordinates().clone();
    currentSnap = null;

    if (currentTool === 'select') {
        hideOtrackGuide();

        // In SELECT mode, hovering an enabled object-snap point may acquire
        // an OTRACK reference for subsequent grip editing. Acquisition is
        // deliberate (350 ms dwell), not triggered by simply crossing it.
        if (otrackOn && osnapOn) {
            const selectItems = drawnObjects.map(getSnapData);
            const snap = computeOsnap(
                selectItems,
                pt,
                null,
                OSNAP_APERTURE_PX * worldPerPixel(),
                osnapModes
            );
            if (snap) {
                currentSnap = snap;
                showSnapMarker(snap);
                updateOtrackAcquisition(snap, selectItems);
            } else {
                hideSnapMarker();
                cancelOtrackAcquisition();
            }
        } else {
            hideSnapMarker();
            cancelOtrackAcquisition();
        }
        return pt;
    }

    // OTRACK construction guides are intentionally disabled in EXTEND and
    // TRIM. These commands use boundary geometry rather than tracking guides.
    const suppressOtrackGuides = currentTool === 'extend' || currentTool === 'trim';
    if (suppressOtrackGuides) {
        cancelOtrackAcquisition();
        hideOtrackGuide();
    }

    if (otrackTool !== currentTool) {
        cancelOtrackAcquisition();
        otrackPoints = [];
        otrackTool = currentTool;
    }

    let snapItems = [];
    if (osnapOn) {
        snapItems = drawnObjects.map(getSnapData);
        if (currentTool === 'polyline' && isDrawing && currentPoints.length > 0) {
            snapItems.push(snapDataFromPoints(currentPoints));
        }

        const snap = computeOsnap(
            snapItems,
            pt,
            isDrawing ? basePoint : null,
            OSNAP_APERTURE_PX * worldPerPixel(),
            osnapModes
        );

        if (snap) {
            currentSnap = snap;
            showSnapMarker(snap);
            if (otrackOn && !suppressOtrackGuides) updateOtrackAcquisition(snap, snapItems);
            hideOtrackGuide();
            pt.set(snap.x, snap.y, 0);
            if (shouldApplyPointOrtho()) constrainPointToOrtho(pt, basePoint);
            return pt;
        }
    }

    hideSnapMarker();
    cancelOtrackAcquisition();

    if (otrackOn && !suppressOtrackGuides) {
        const tracked = computeOtrackPoint(pt);
        if (tracked) {
            pt.set(tracked.x, tracked.y, 0);
            showOtrackGuide(tracked.anchor, pt, tracked.axis, tracked.direction, tracked);
            if (shouldApplyPointOrtho()) constrainPointToOrtho(pt, basePoint);
            return pt;
        }
    }

    hideOtrackGuide();

    if (gridSnapOn) {
        pt.x = Math.round(pt.x / GRID_SPACING) * GRID_SPACING;
        pt.y = Math.round(pt.y / GRID_SPACING) * GRID_SPACING;
    }

    if (shouldApplyPointOrtho()) {
        constrainPointToOrtho(pt, basePoint);
    }

    return pt;
}

// Acquire an OSNAP point and, where it lies on a straight entity segment,
// remember that segment's direction for arbitrary-angle object tracking.
function rememberOtrackPoint(s, items = []) {
    if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) return;

    // Stable geometric reference points can seed OTRACK. Perpendicular and
    // nearest are cursor-dependent solutions, so they are not persistent
    // tracking references. Midpoints are valid deliberate acquisition points.
    const trackableSnapTypes = new Set([
        'endpoint', 'midpoint', 'intersection', 'node', 'center', 'quadrant'
    ]);
    if (!trackableSnapTypes.has(s.type)) return;

    let anchor = otrackPoints.find(p => Math.hypot(p.x - s.x, p.y - s.y) < 0.25);
    if (!anchor) {
        anchor = { x: s.x, y: s.y, type: s.type, directions: [] };
        otrackPoints.push(anchor);
    }
    if (!Array.isArray(anchor.directions)) anchor.directions = [];

    const tolerance = Math.max(1e-7, 3 * worldPerPixel());
    (items || []).forEach(item => {
        (item.segs || []).forEach(segment => {
            const a = segment[0], b = segment[1];
            if (!a || !b) return;

            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const length = Math.hypot(dx, dy);
            if (length < 1e-10) return;

            const ux = dx / length;
            const uy = dy / length;
            const along = (s.x - a.x) * ux + (s.y - a.y) * uy;
            if (along < -tolerance || along > length + tolerance) return;

            const projectedX = a.x + ux * along;
            const projectedY = a.y + uy * along;
            if (Math.hypot(s.x - projectedX, s.y - projectedY) > tolerance) return;

            // Direction is undirected; either end of the segment can be followed.
            const duplicate = anchor.directions.some(d =>
                Math.abs(Math.abs(d.x * ux + d.y * uy) - 1) < 1e-5
            );
            if (!duplicate) anchor.directions.push({ x: ux, y: uy });
        });

        // For a circle/arc intersection or perimeter snap, acquire the local
        // tangent as another useful OTRACK reference direction.
        if (item.circle) {
            const circle = item.circle;
            const rx = s.x - circle.cx;
            const ry = s.y - circle.cy;
            const radius = Math.hypot(rx, ry);
            const tolerance = Math.max(1e-7, 3 * worldPerPixel());
            if (radius > 1e-10 && Math.abs(radius - circle.r) <= tolerance) {
                const tx = -ry / radius;
                const ty = rx / radius;
                const duplicate = anchor.directions.some(d =>
                    Math.abs(Math.abs(d.x * tx + d.y * ty) - 1) < 1e-5
                );
                if (!duplicate) anchor.directions.push({ x: tx, y: ty });
            }
        }
    });

    // Keep a compact recent reference set. Each anchor can produce X/Y and
    // an entity-direction guide, so a large history quickly congests the view.
    while (otrackPoints.length > 4) otrackPoints.shift();
}

function buildOtrackReferenceLines() {
    const lines = [];
    const anchors = (Array.isArray(otrackPoints) ? otrackPoints : []).slice(-4);

    anchors.forEach(anchor => {
        lines.push({ x: anchor.x, y: anchor.y, dx: 1, dy: 0, anchor, kind: 'x' });
        lines.push({ x: anchor.x, y: anchor.y, dx: 0, dy: 1, anchor, kind: 'y' });

        (anchor.directions || []).forEach(direction => {
            const length = Math.hypot(direction.x, direction.y);
            if (length < 1e-10) return;
            lines.push({
                x: anchor.x, y: anchor.y,
                dx: direction.x / length,
                dy: direction.y / length,
                anchor,
                kind: 'direction'
            });
        });
    });
    return lines;
}

function intersectOtrackGuides(a, b) {
    // Two guides from the same acquired point always intersect at that point;
    // that is not a new destination node, so ignore that pair.
    if (a.anchor === b.anchor) return null;

    const denominator = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(denominator) < 1e-9) return null;

    const qx = b.x - a.x;
    const qy = b.y - a.y;
    const t = (qx * b.dy - qy * b.dx) / denominator;
    const x = a.x + t * a.dx;
    const y = a.y + t * a.dy;

    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function computeOtrackPoint(cursor) {
    const aperture = 12 * worldPerPixel();
    let best = null;

    const consider = candidate => {
        if (!best || candidate.score < best.score) best = candidate;
    };

    otrackPoints.forEach(anchor => {
        const dx = Math.abs(cursor.x - anchor.x);
        const dy = Math.abs(cursor.y - anchor.y);

        // Standard horizontal and vertical tracking paths.
        if (dx <= aperture) {
            consider({
                x: anchor.x, y: cursor.y,
                anchor, axis: 'x', score: dx
            });
        }
        if (dy <= aperture) {
            consider({
                x: cursor.x, y: anchor.y,
                anchor, axis: 'y', score: dy
            });
        }

        // Arbitrary-angle tracking along any segment through the acquired snap.
        (anchor.directions || []).forEach(direction => {
            const vx = cursor.x - anchor.x;
            const vy = cursor.y - anchor.y;
            const along = vx * direction.x + vy * direction.y;
            const projectedX = anchor.x + along * direction.x;
            const projectedY = anchor.y + along * direction.y;
            const perpendicular = Math.hypot(cursor.x - projectedX, cursor.y - projectedY);

            if (perpendicular <= aperture) {
                consider({
                    x: projectedX,
                    y: projectedY,
                    anchor,
                    axis: 'direction',
                    direction,
                    score: perpendicular
                });
            }
        });
    });

    // AutoCAD-style OTRACK intersection destination: find crossings between
    // the acquired horizontal, vertical and inclined reference guides. When
    // the cursor approaches a crossing, return its exact coordinate so the
    // next drawing click places the endpoint at that node.
    const guides = buildOtrackReferenceLines();
    const intersections = [];
    for (let i = 0; i < guides.length; i++) {
        for (let j = i + 1; j < guides.length; j++) {
            const point = intersectOtrackGuides(guides[i], guides[j]);
            if (!point) continue;

            const distance = Math.hypot(cursor.x - point.x, cursor.y - point.y);
            if (distance > aperture) continue;

            const duplicate = intersections.some(existing =>
                Math.hypot(existing.x - point.x, existing.y - point.y) < Math.max(aperture * 0.2, 1e-8)
            );
            if (duplicate) continue;

            intersections.push(point);
            consider({
                x: point.x,
                y: point.y,
                anchor: guides[i].anchor,
                axis: 'intersection',
                intersection: true,
                score: distance - aperture * 0.2
            });
        }
    }

    return best;
}

function setupOtrackGuide(container) {
    if (otrackGuideEl) otrackGuideEl.remove();
    otrackGuideEl = document.createElement('div');
    otrackGuideEl.id = 'cad-otrack-guide';
    otrackGuideEl.style.cssText =
        'position:absolute;inset:0;pointer-events:none;z-index:940;display:none;';
    container.append(otrackGuideEl);
}

function makeOtrackGuideLine(cssText) {
    const line = document.createElement('div');
    line.className = 'cad-otrack-guide-line';
    line.style.cssText =
        'position:absolute;pointer-events:none;border-color:#43d6a2;' +
        'border-style:dashed;border-width:0;' +
        'filter:drop-shadow(0 0 2px rgba(67,214,162,.35));' + cssText;
    otrackGuideEl.appendChild(line);
    return line;
}

function showOtrackGuide(anchor, point, axis, direction, trackingResult) {
    if (!otrackGuideEl || !anchor || !point) return;

    // Show only the guide currently controlling the cursor. Do not draw all
    // X/Y/directional references from every acquired point simultaneously.
    otrackGuideEl.replaceChildren();

    const rect = renderer.domElement.getBoundingClientRect();
    const addVertical = x => makeOtrackGuideLine(
        `left:${x}px;top:0;width:0;height:${rect.height}px;` +
        'border-left:1px dashed #43d6a2;'
    );
    const addHorizontal = y => makeOtrackGuideLine(
        `left:0;top:${y}px;width:${rect.width}px;height:0;` +
        'border-top:1px dashed #43d6a2;'
    );
    const addDirection = (origin, dir) => {
        if (!dir) return;
        const magnitude = Math.hypot(dir.x, dir.y);
        if (magnitude < 1e-10) return;
        const ux = dir.x / magnitude;
        const uy = dir.y / magnitude;
        const a = worldToScreen(origin.x, origin.y);
        const b = worldToScreen(origin.x + ux, origin.y + uy);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const length = Math.hypot(rect.width, rect.height) * 2.5;
        makeOtrackGuideLine(
            `left:${a.x - length / 2}px;top:${a.y}px;width:${length}px;height:0;` +
            'border-top:1px dashed #43d6a2;' +
            `transform:rotate(${angle}rad);transform-origin:50% 50%;`
        );
    };

    if (axis === 'x') {
        addVertical(worldToScreen(anchor.x, anchor.y).x);
    } else if (axis === 'y') {
        addHorizontal(worldToScreen(anchor.x, anchor.y).y);
    } else if (axis === 'direction') {
        addDirection(anchor, direction);
    } else if (axis === 'intersection' || (trackingResult && trackingResult.intersection)) {
        // An acquired-guide intersection is the active solution. Display a
        // compact crosshair at that solution, not every reference guide.
        const screen = worldToScreen(point.x, point.y);
        addVertical(screen.x);
        addHorizontal(screen.y);
    }

    otrackGuideEl.style.display = otrackGuideEl.childElementCount ? 'block' : 'none';
}

function hideOtrackGuide() {
    if (otrackGuideEl) otrackGuideEl.style.display = 'none';
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

    // EXTEND and TRIM are precision modification commands. Keep OSNAP
    // calculations active so clicks still acquire exact geometry points,
    // but suppress the visible endpoint/midpoint/node glyphs that obscure
    // the source and boundary objects while editing.
    if (currentTool === 'extend' || currentTool === 'trim') {
        snapMarkerEl.style.display = 'none';
        return;
    }

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

// --- OSNAP status button: left-click toggles; right-click opens Settings... ---
let osnapContextMenuEl = null;
let osnapSettingsDialogEl = null;

function setupStatusBar(container) {
    restoreOsnapModes();

    const bar = document.createElement('div');
    bar.id = 'cad-status-bar';

    // Compact controls inside the EXISTING bottom tab ribbon.
    bar.style.cssText = `
        position:static;
        display:flex;
        align-items:center;
        gap:3px;
        width:max-content;
        height:28px;
        flex:0 0 auto;
        margin-left:8px;
        padding:0;
        background:transparent;
        border:none;
        box-sizing:border-box;
    `;

    const mk = (id, label, handler) => {
        const button = document.createElement('button');

        button.id = id;
        button.type = 'button';
        button.textContent = label;

        button.style.cssText = `
            height:26px;
            padding:0 7px;
            margin:0;
            font:10px Consolas,'Courier New',monospace;
            line-height:24px;
            white-space:nowrap;
            cursor:pointer;
            border:1px solid #444;
            border-radius:3px;
            background:#2a2a2a;
            color:#ccc;
            box-sizing:border-box;
        `;

        button.addEventListener('mousedown', event => {
            event.preventDefault();
        });

        button.addEventListener('click', event => {
            event.stopPropagation();
            handler();
        });

        return button;
    };

    const osnapButton = mk('cad-st-osnap', 'OSNAP', toggleOsnap);

    osnapButton.title =
        'Left-click: toggle Object Snap | Right-click: Settings';

    osnapButton.addEventListener('contextmenu', event => {
        event.preventDefault();
        event.stopPropagation();

        showOsnapContextMenu(event.clientX, event.clientY);
    });

    bar.appendChild(osnapButton);

    bar.appendChild(mk('cad-st-otrack', 'OTRACK', toggleOtrack));
    bar.appendChild(mk('cad-st-ortho', 'ORTHO', toggleOrtho));
    bar.appendChild(mk('cad-st-gsnap', 'SNAP', toggleGridSnap));
    bar.appendChild(mk('cad-st-grid', 'GRID', toggleGrid));

    // IMPORTANT: Append to the existing tab ribbon, after Spreadsheet.
    const tabBar = document.querySelector('.app-tab-bar');

    if (tabBar) {
        tabBar.appendChild(bar);
    } else {
        console.error('Existing .app-tab-bar was not found.');
        return;
    }

    setupOsnapContextMenu(container);
    setupOsnapSettingsDialog(container);
    setupOtrackGuide(container);

    updateStatusBar();
}

function setupOsnapContextMenu(container) {
    if (osnapContextMenuEl) osnapContextMenuEl.remove();

    osnapContextMenuEl = document.createElement('div');
    osnapContextMenuEl.id = 'cad-osnap-context-menu';
    osnapContextMenuEl.style.cssText =
        'position:fixed;display:none;min-width:150px;z-index:5000;padding:4px;' +
        'background:#252526;border:1px solid #555;border-radius:5px;' +
        'box-shadow:0 6px 18px rgba(0,0,0,.45);';

    const settingsItem = document.createElement('button');
    settingsItem.type = 'button';
    settingsItem.textContent = 'Settings...';
    settingsItem.style.cssText =
        'display:block;width:100%;padding:8px 12px;text-align:left;color:#eee;' +
        'background:transparent;border:0;border-radius:3px;cursor:pointer;font:13px Arial,sans-serif;';
    settingsItem.addEventListener('mouseenter', () => {
        settingsItem.style.background = '#094771';
    });
    settingsItem.addEventListener('mouseleave', () => {
        settingsItem.style.background = 'transparent';
    });
    settingsItem.addEventListener('click', event => {
        event.stopPropagation();
        hideOsnapContextMenu();
        openOsnapSettings();
    });

    osnapContextMenuEl.appendChild(settingsItem);
    container.appendChild(osnapContextMenuEl);

    document.addEventListener('pointerdown', event => {
        if (osnapContextMenuEl &&
            !osnapContextMenuEl.contains(event.target) &&
            event.target.id !== 'cad-st-osnap') {
            hideOsnapContextMenu();
        }
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') hideOsnapContextMenu();
    });
}

function showOsnapContextMenu(clientX, clientY) {
    if (!osnapContextMenuEl) return;
    osnapContextMenuEl.style.display = 'block';
    const rect = osnapContextMenuEl.getBoundingClientRect();
    const left = Math.max(6, Math.min(clientX, window.innerWidth - rect.width - 6));
    const top = Math.max(6, Math.min(clientY, window.innerHeight - rect.height - 6));
    osnapContextMenuEl.style.left = `${left}px`;
    osnapContextMenuEl.style.top = `${top}px`;
}

function hideOsnapContextMenu() {
    if (osnapContextMenuEl) osnapContextMenuEl.style.display = 'none';
}

function setupOsnapSettingsDialog(container) {
    if (osnapSettingsDialogEl) osnapSettingsDialogEl.remove();

    const overlay = document.createElement('div');
    overlay.id = 'cad-osnap-settings-overlay';
    overlay.style.cssText =
        'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
        'z-index:5100;background:rgba(0,0,0,.48);padding:16px;box-sizing:border-box;';

    const dialog = document.createElement('section');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'cad-osnap-settings-title');
    dialog.style.cssText =
        'width:min(360px,100%);max-height:min(80vh,520px);overflow:auto;color:#e8e8e8;' +
        'background:#252526;border:1px solid #555;border-radius:8px;' +
        'box-shadow:0 12px 36px rgba(0,0,0,.55);font:13px Arial,sans-serif;';

    const header = document.createElement('div');
    header.style.cssText =
        'display:flex;align-items:center;justify-content:space-between;padding:13px 15px;border-bottom:1px solid #444;';
    const title = document.createElement('strong');
    title.id = 'cad-osnap-settings-title';
    title.textContent = 'Object Snap Settings';
    title.style.cssText = 'font-size:14px;color:#fff;';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', 'Close settings');
    closeButton.style.cssText =
        'border:0;background:transparent;color:#bbb;font-size:22px;cursor:pointer;line-height:1;';
    closeButton.addEventListener('click', closeOsnapSettings);
    header.append(title, closeButton);
    dialog.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText =
        'display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;padding:12px 16px 16px;';

    Object.keys(SNAP_LABELS).forEach(key => {
        const label = document.createElement('label');
        label.style.cssText =
            'display:flex;align-items:center;gap:8px;min-height:30px;cursor:pointer;color:#ddd;';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.osnapMode = key;
        checkbox.checked = !!osnapModes[key];
        checkbox.style.cssText = 'accent-color:#0e8ad6;width:14px;height:14px;';
        checkbox.addEventListener('change', () => {
            osnapModes[key] = checkbox.checked;
            persistOsnapModes();
        });
        label.append(checkbox, document.createTextNode(SNAP_LABELS[key]));
        body.appendChild(label);
    });
    dialog.appendChild(body);

    const footer = document.createElement('div');
    footer.style.cssText =
        'display:flex;justify-content:flex-end;gap:8px;padding:10px 15px;border-top:1px solid #444;';

    const buttonStyle =
        'padding:7px 11px;color:#ddd;background:#333;border:1px solid #555;border-radius:4px;cursor:pointer;';
    const allButton = document.createElement('button');
    allButton.type = 'button';
    allButton.textContent = 'Select All';
    allButton.style.cssText = buttonStyle;
    allButton.addEventListener('click', () => {
        Object.keys(SNAP_LABELS).forEach(key => { osnapModes[key] = true; });
        body.querySelectorAll('input[data-osnap-mode]').forEach(cb => { cb.checked = true; });
        persistOsnapModes();
    });

    const noneButton = document.createElement('button');
    noneButton.type = 'button';
    noneButton.textContent = 'Clear All';
    noneButton.style.cssText = buttonStyle;
    noneButton.addEventListener('click', () => {
        Object.keys(SNAP_LABELS).forEach(key => { osnapModes[key] = false; });
        body.querySelectorAll('input[data-osnap-mode]').forEach(cb => { cb.checked = false; });
        persistOsnapModes();
    });

    const doneButton = document.createElement('button');
    doneButton.type = 'button';
    doneButton.textContent = 'Done';
    doneButton.style.cssText =
        'padding:7px 14px;color:#fff;background:#007acc;border:1px solid #168bd2;border-radius:4px;cursor:pointer;';
    doneButton.addEventListener('click', closeOsnapSettings);
    footer.append(allButton, noneButton, doneButton);
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    overlay.addEventListener('click', event => {
        if (event.target === overlay) closeOsnapSettings();
    });
    container.appendChild(overlay);
    osnapSettingsDialogEl = overlay;
}

function openOsnapSettings() {
    if (!osnapSettingsDialogEl) return;
    // Refresh checkbox states in case settings changed from another control.
    osnapSettingsDialogEl.querySelectorAll('input[data-osnap-mode]').forEach(checkbox => {
        checkbox.checked = !!osnapModes[checkbox.dataset.osnapMode];
    });
    osnapSettingsDialogEl.style.display = 'flex';
}

function closeOsnapSettings() {
    if (osnapSettingsDialogEl) osnapSettingsDialogEl.style.display = 'none';
}

function restoreOsnapModes() {
    try {
        const saved = JSON.parse(localStorage.getItem('safaredge.cad.osnapModes') || 'null');
        if (!saved || typeof saved !== 'object') return;
        Object.keys(SNAP_LABELS).forEach(key => {
            if (typeof saved[key] === 'boolean') osnapModes[key] = saved[key];
        });
    } catch (error) {
        console.warn('[SAFAR EDGE CAD] Could not restore OSNAP settings:', error);
    }
}

function persistOsnapModes() {
    try {
        localStorage.setItem('safaredge.cad.osnapModes', JSON.stringify(osnapModes));
    } catch (error) {
        console.warn('[SAFAR EDGE CAD] Could not save OSNAP settings:', error);
    }
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
    set('cad-st-otrack', otrackOn, 'Object Snap Tracking (F11)');
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
function toggleOtrack(force) {
    otrackOn = typeof force === 'boolean' ? force : !otrackOn;
    cancelOtrackAcquisition();
    otrackPoints = [];
    hideOtrackGuide();
    updateStatusBar();
    notify(`<Object Snap Tracking ${otrackOn ? 'on' : 'off'}>`);
    return otrackOn;
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

// Explicit public toggle for the workspace menu.
window.toggleOtrack = toggleOtrack;
