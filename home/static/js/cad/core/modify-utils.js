/**
 * SAFAR EDGE CAD - MODIFY UTILITIES
 * Shared geometry helpers for independent MODIFY command modules.
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;
    if (!CAD) throw new Error('CAD registry must load before modify utilities.');

    function selected(context, commandName) {
        const objects = context.getSelectedObjects();
        if (objects.length === 0) {
            context.notify(`${commandName}: Select objects first.`);
            return null;
        }
        return objects;
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
                material.opacity = 0.4;
                material.depthWrite = false;
                if (material.color) material.color.setHex(0x00ffff);
            });

            scene.add(copy);
            return copy;
        });
    }

    function disposePreview(context, objects) {
        const scene = context.getScene();

        (objects || []).forEach(object => {
            scene.remove(object);

            if (object.geometry) object.geometry.dispose();

            if (object.material) {
                if (Array.isArray(object.material)) {
                    object.material.forEach(material => material.dispose());
                } else {
                    object.material.dispose();
                }
            }
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

    function extendAt(context, target, clickPoint, boundaries) {
        const points = pointFromGeometry(target);
        if (points.length < 2) return false;

        const boundarySegments = segments(boundaries);
        const ends = [
            { index: 0, fixed: points[1], end: points[0] },
            {
                index: points.length - 1,
                fixed: points[points.length - 2],
                end: points[points.length - 1]
            }
        ];

        ends.sort((a, b) => (
            a.end.distanceTo(clickPoint) - b.end.distanceTo(clickPoint)
        ));

        const chosen = ends[0];
        const dx = chosen.end.x - chosen.fixed.x;
        const dy = chosen.end.y - chosen.fixed.y;
        const length = Math.hypot(dx, dy);
        if (length < 1e-10) return false;

        const direction = new THREE.Vector3(dx / length, dy / length, 0);
        const farPoint = chosen.end.clone().add(
            direction.clone().multiplyScalar(1e9)
        );
        const currentDistance = chosen.end.clone()
            .sub(chosen.fixed)
            .dot(direction);
        let nearestHit = null;

        boundarySegments.forEach(segment => {
            const hit = intersect(chosen.fixed, farPoint, segment.a, segment.b);
            if (!hit) return;

            const distance = hit.point.clone()
                .sub(chosen.fixed)
                .dot(direction);

            if (
                distance > currentDistance + 1e-8 &&
                (!nearestHit || distance < nearestHit.distance)
            ) {
                nearestHit = { point: hit.point, distance };
            }
        });

        if (!nearestHit) return false;

        if (chosen.index === 0) points[0] = nearestHit.point;
        else points[points.length - 1] = nearestHit.point;

        return setGeometryPoints(target, points);
    }

    global.CADModifyUtils = {
        selected,
        cloneForPreview,
        disposePreview,
        applyAndRecord,
        pointFromGeometry,
        setGeometryPoints,
        segments,
        trimAt,
        extendAt
    };
})(window);
