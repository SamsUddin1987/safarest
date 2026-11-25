/**
 * SAFAR EDGE CAD - MODIFY UTILITIES
 * Shared geometry helpers for independent MODIFY command modules.
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;
    if (!CAD) throw new Error('CAD registry must load before modify utilities.');

    function selected(context, commandName) {
        return context.getSelectedObjects();
    }

    function distanceToSegment(point, a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSq = dx * dx + dy * dy;
        if (lengthSq < 1e-12) return point.distanceTo(a);
        const t = Math.max(0, Math.min(1,
            ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq
        ));
        const nearest = new THREE.Vector3(a.x + t * dx, a.y + t * dy, 0);
        return nearest.distanceTo(point);
    }

    function findObjectAtPoint(context, point, excluded = []) {
        const tolerance = context.getPickTolerance ? context.getPickTolerance(18) : 1;
        let bestObject = null;
        let bestDistance = Infinity;
        context.getObjects().forEach(object => {
            if (excluded.includes(object)) return;
            const points = pointFromGeometry(object);
            for (let i = 1; i < points.length; i++) {
                const distance = distanceToSegment(point, points[i - 1], points[i]);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestObject = object;
                }
            }
        });
        return bestDistance <= tolerance ? bestObject : null;
    }

    function cloneForPreview(context, sourceObjects) {
        const scene = context.getScene();

        return sourceObjects.map(source => {
            const copy = context.cloneObject(source);
            const materials = Array.isArray(copy.material)
                ? copy.material
                : [copy.material];

            materials.forEach(material => {
                if (!material) return;
                material.transparent = true;
                material.opacity = 0.68;
                material.depthWrite = false;
                material.depthTest = true;
                if (material.color) material.color.setHex(0x00e5ff);
            });

            scene.add(copy);
            return copy;
        });
    }

    function disposePreview(context, objects) {
        const scene = context.getScene();

        (objects || []).forEach(object => {
            scene.remove(object);
            object.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) child.material.forEach(material => { if (material.map) material.map.dispose(); material.dispose(); });
                    else { if (child.material.map) child.material.map.dispose(); child.material.dispose(); }
                }
            });
        });
    }

    function applyAndRecord(context, objects, matrix) {
        const before = context.captureObjects(objects);
        context.applyMatrix(objects, matrix);
        context.recordModify(objects, before);
    }

    function pointFromGeometry(object) {
        const position = object.geometry && object.geometry.attributes
            ? object.geometry.attributes.position
            : null;
        if (!position) return [];

        const points = [];
        for (let i = 0; i < position.count; i++) {
            points.push(new THREE.Vector3(
                position.getX(i),
                position.getY(i),
                position.getZ(i)
            ));
        }
        return points;
    }

    function setGeometryPoints(object, points) {
        if (!object.geometry || !points || points.length < 2) return false;

        object.geometry.dispose();
        object.geometry = new THREE.BufferGeometry().setFromPoints(points);
        object.geometry.computeBoundingSphere();

        if (object.userData) {
            object.userData.points = points.map(point => ({
                x: point.x,
                y: point.y,
                z: point.z
            }));
            // Trim/extend turns a circle or rectangle approximation into a polyline.
            object.userData.type = 'polyline';
            delete object.userData.center;
            delete object.userData.radius;
        }

        return true;
    }

    // Returns the intersection of two finite 2D line segments.
    function intersect(a, b, c, d) {
        const rx = b.x - a.x;
        const ry = b.y - a.y;
        const sx = d.x - c.x;
        const sy = d.y - c.y;
        const denominator = rx * sy - ry * sx;

        if (Math.abs(denominator) < 1e-10) return null;

        const qx = c.x - a.x;
        const qy = c.y - a.y;
        const t = (qx * sy - qy * sx) / denominator;
        const u = (qx * ry - qy * rx) / denominator;

        if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) {
            return null;
        }

        return {
            point: new THREE.Vector3(a.x + t * rx, a.y + t * ry, 0),
            t,
            u
        };
    }

    function segments(objects) {
        const result = [];

        objects.forEach(object => {
            const points = pointFromGeometry(object);
            for (let i = 1; i < points.length; i++) {
                result.push({
                    object,
                    a: points[i - 1],
                    b: points[i]
                });
            }
        });

        return result;
    }

    function trimAt(context, target, clickPoint, boundaries) {
        const points = pointFromGeometry(target);
        if (points.length < 2) return false;

        const boundarySegments = segments(boundaries);
        let targetIndex = 0;
        let closestMidpointDistance = Infinity;

        // Find the target segment nearest to the click.
        for (let i = 1; i < points.length; i++) {
            const midpoint = points[i - 1].clone()
                .add(points[i])
                .multiplyScalar(0.5);
            const distance = midpoint.distanceTo(clickPoint);

            if (distance < closestMidpointDistance) {
                closestMidpointDistance = distance;
                targetIndex = i - 1;
            }
        }

        const a = points[targetIndex];
        const b = points[targetIndex + 1];
        let nearestHit = null;

        boundarySegments.forEach(segment => {
            const hit = intersect(a, b, segment.a, segment.b);
            if (!hit) return;

            const distance = hit.point.distanceTo(clickPoint);
            if (!nearestHit || distance < nearestHit.distance) {
                nearestHit = { ...hit, distance };
            }
        });

        if (!nearestHit) return false;

        // Remove the side of the segment nearest to the click point.
        const distanceToA = a.distanceTo(clickPoint);
        const distanceToB = b.distanceTo(clickPoint);
        const remainingPoints = distanceToA < distanceToB
            ? [nearestHit.point, ...points.slice(targetIndex + 1)]
            : [...points.slice(0, targetIndex + 1), nearestHit.point];

        return setGeometryPoints(target, remainingPoints);
    }

    function setExtendedGeometry(target, points) {
        if (!target || !target.geometry || !Array.isArray(points) || points.length < 2) {
            return false;
        }

        const originalType = target.userData && target.userData.type;
        const nextGeometry = new THREE.BufferGeometry().setFromPoints(points);
        nextGeometry.computeBoundingSphere();

        target.geometry.dispose();
        target.geometry = nextGeometry;

        if (!target.userData) target.userData = {};

        // A LINE remains a LINE. A POLYLINE remains a POLYLINE. A rectangle
        // whose vertex is extended is no longer a closed rectangle entity;
        // retain its edited vertices as a regular polyline.
        if (originalType === 'rect') {
            target.userData.type = 'polyline';
        } else if (originalType === 'line') {
            target.userData.type = 'line';
        } else {
            target.userData.type = 'polyline';
        }

        target.userData.points = points.map(point => ({
            x: point.x,
            y: point.y,
            z: point.z || 0
        }));

        return true;
    }

    function extendAt(context, target, clickPoint, boundaries, pickTolerance) {
        const points = pointFromGeometry(target);
        if (points.length < 2) return false;

        // Ignore the target itself and stale/deleted boundary references.
        const liveObjects = context.getObjects();
        const validBoundaries = (boundaries || []).filter(object =>
            object && object !== target && liveObjects.includes(object)
        );
        if (!validBoundaries.length) return false;

        const boundarySegments = segments(validBoundaries);
        if (!boundarySegments.length) return false;

        let nodeIndex = 0;
        let nodeDistance = Infinity;

        // Select the closest editable vertex to the double-click location.
        points.forEach((vertex, index) => {
            const distance = vertex.distanceTo(clickPoint);
            if (distance < nodeDistance) {
                nodeDistance = distance;
                nodeIndex = index;
            }
        });

        if (pickTolerance !== undefined && nodeDistance > pickTolerance) {
            return false;
        }

        const candidates = [];
        if (nodeIndex > 0) {
            candidates.push({ fixed: points[nodeIndex - 1], end: points[nodeIndex] });
        }
        if (nodeIndex < points.length - 1) {
            candidates.push({ fixed: points[nodeIndex + 1], end: points[nodeIndex] });
        }

        let bestHit = null;

        candidates.forEach(candidate => {
            const dx = candidate.end.x - candidate.fixed.x;
            const dy = candidate.end.y - candidate.fixed.y;
            const length = Math.hypot(dx, dy);
            if (length < 1e-10) return;

            const direction = new THREE.Vector3(dx / length, dy / length, 0);
            const rayEnd = candidate.end.clone().add(
                direction.clone().multiplyScalar(1e9)
            );
            const currentLength = candidate.end.clone()
                .sub(candidate.fixed)
                .dot(direction);

            boundarySegments.forEach(segment => {
                const hit = intersect(
                    candidate.fixed,
                    rayEnd,
                    segment.a,
                    segment.b
                );
                if (!hit) return;

                const along = hit.point.clone()
                    .sub(candidate.fixed)
                    .dot(direction);

                // The boundary must be strictly beyond the current endpoint.
                if (along <= currentLength + 1e-8) return;

                const extensionDistance = along - currentLength;

                // EXTEND must reach the farthest valid selected boundary.
                // This deliberately ignores nearer intermediate barriers and
                // chooses the greatest forward intersection on the same ray.
                if (!bestHit || extensionDistance > bestHit.extensionDistance) {
                    bestHit = {
                        point: hit.point.clone(),
                        extensionDistance
                    };
                }
            });
        });

        if (!bestHit) return false;

        points[nodeIndex] = bestHit.point;
        return setExtendedGeometry(target, points);
    }

    global.CADModifyUtils = {
        selected,
        cloneForPreview,
        disposePreview,
        applyAndRecord,
        pointFromGeometry,
        setGeometryPoints,
        segments,
        distanceToSegment,
        findObjectAtPoint,
        trimAt,
        extendAt
    };
})(window);
