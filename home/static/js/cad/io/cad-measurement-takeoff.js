/**
 * SAFAR EDGE — CAD CLOSED-SHAPE MEASUREMENT TAKEOFF
 *
 * Closed native POLYLINE, RECTANGLE/SQUARE, and CIRCLE entities are grouped by layer and overall
 * length/width. The measurement table occupies columns A:I:
 * Sl No, Description, Nos, Length, Width, Height, Quantity, Unit, Remarks.
 *
 * Length and width are the overall plan extents. Height is deliberately
 * left blank for future 3D takeoff. Quantity = Nos × Length × Width.
 */
(function (global) {
    'use strict';

    const HEADERS = [
        'Sl No', 'Description', 'Nos', 'Length', 'Width',
        'Height', 'Quantity', 'Unit', 'Remarks'
    ];
    const AREA_UNITS = {
        mm: 'mm²',
        cm: 'cm²',
        m: 'm²',
        inch: 'in²',
        ft: 'ft²'
    };
    const UNIT_FACTORS = {
        mm: 1,
        cm: 10,
        m: 1000,
        inch: 25.4,
        ft: 304.8
    };

    let syncTimer = null;
    let isSyncing = false;
    let hasWarnedAboutSheet = false;

    function cellText(value) {
        if (value && typeof value === 'object') {
            if (value.v !== undefined && value.v !== null) return value.v;
            if (value.m !== undefined && value.m !== null) return value.m;
            return '';
        }
        return value === undefined || value === null ? '' : value;
    }

    function getCell(sheet, row, col) {
        if (!sheet) return '';
        const sparse = Array.isArray(sheet.celldata) ? sheet.celldata : [];
        const found = sparse.find(cell => Number(cell.r) === row && Number(cell.c) === col);
        if (found) return cellText(found.v);

        const data = Array.isArray(sheet.data) ? sheet.data : [];
        return cellText(data[row] && data[row][col]);
    }

    function hasSheetContent(sheet) {
        if (!sheet) return false;
        const sparse = Array.isArray(sheet.celldata) ? sheet.celldata : [];
        if (sparse.some(cell => cell && cell.v !== undefined && cell.v !== null && cellText(cell.v) !== '')) {
            return true;
        }
        const data = Array.isArray(sheet.data) ? sheet.data : [];
        return data.some(row => Array.isArray(row) && row.some(value => cellText(value) !== ''));
    }

    function headerMatches(sheet) {
        return HEADERS.every((heading, col) =>
            String(getCell(sheet, 0, col)).trim().toLowerCase() === heading.toLowerCase()
        );
    }

    function getWorkbookSheets() {
        if (!global.luckysheet || typeof global.luckysheet.getAllSheets !== 'function') {
            return [];
        }
        try {
            return global.luckysheet.getAllSheets() || [];
        } catch (_) {
            return [];
        }
    }

    function findMeasurementSheet() {
        const sheets = getWorkbookSheets();
        if (!sheets.length) return null;

        const matching = sheets.find(headerMatches);
        if (matching) return matching;

        // A blank worksheet can safely become the measurement worksheet.
        const blank = sheets.find(sheet => !hasSheetContent(sheet));
        if (blank) return blank;

        // Do not overwrite an existing worksheet with unrelated user data.
        if (!hasWarnedAboutSheet) {
            hasWarnedAboutSheet = true;
            console.warn(
                'SAFAR EDGE measurement takeoff: no blank worksheet or matching measurement header was found. ' +
                'The existing spreadsheet was left unchanged.'
            );
        }
        return null;
    }

    function sheetOrder(sheet, sheets) {
        if (sheet && sheet.order !== undefined && sheet.order !== null) {
            return Number(sheet.order);
        }
        return Math.max(0, sheets.indexOf(sheet));
    }

    function writeCell(order, row, col, value) {
        if (!global.luckysheet || typeof global.luckysheet.setCellValue !== 'function') {
            throw new Error('Luckysheet setCellValue API is unavailable.');
        }
        global.luckysheet.setCellValue(row, col, value, { order: order });
    }

    function ensureHeaders(sheet, order) {
        if (headerMatches(sheet)) return false;
        if (hasSheetContent(sheet)) return false;
        HEADERS.forEach((heading, col) => writeCell(order, 0, col, heading));
        return true;
    }

    function getEntityKind(object) {
        if (!object) return null;
        const data = object.userData || {};
        const type = String(data.type || '').toLowerCase();

        if (type === 'circle') return 'circle';
        if (['rect', 'rectangle', 'square'].includes(type)) return 'rectangle';

        if (type === 'polyline') {
            if (data.closed === true || data.isClosed === true || hasClosedGeometry(object)) {
                return 'polyline';
            }
        }

        // Support other native closed planar shapes when their entity metadata
        // explicitly identifies them as closed.
        if (data.closed === true || data.isClosed === true) {
            return type || 'closed-shape';
        }
        return null;
    }

    function hasClosedGeometry(object) {
        const data = object && object.userData ? object.userData : {};
        const points = Array.isArray(data.points) ? data.points : [];
        if (points.length > 2 && pointsAreClosed(points)) return true;

        const attribute = object && object.geometry && object.geometry.getAttribute
            ? object.geometry.getAttribute('position')
            : null;
        if (!attribute || attribute.count < 4) return false;

        const first = [attribute.getX(0), attribute.getY(0), attribute.getZ(0)];
        const lastIndex = attribute.count - 1;
        const last = [
            attribute.getX(lastIndex),
            attribute.getY(lastIndex),
            attribute.getZ(lastIndex)
        ];
        return Math.hypot(
            first[0] - last[0],
            first[1] - last[1],
            first[2] - last[2]
        ) <= 1e-7;
    }

    function pointsAreClosed(points) {
        if (!Array.isArray(points) || points.length < 3) return false;
        const first = points[0];
        const last = points[points.length - 1];
        if (!first || !last) return false;

        const coord = (point, key) => {
            if (point[key] !== undefined) return Number(point[key]) || 0;
            if (typeof point.getComponent === 'function') {
                const index = key === 'x' ? 0 : key === 'y' ? 1 : 2;
                return Number(point.getComponent(index)) || 0;
            }
            return 0;
        };

        return Math.hypot(
            coord(first, 'x') - coord(last, 'x'),
            coord(first, 'y') - coord(last, 'y'),
            coord(first, 'z') - coord(last, 'z')
        ) <= 1e-7;
    }

    function getBounds(object) {
        const geometry = object && object.geometry;
        const attribute = geometry && geometry.getAttribute
            ? geometry.getAttribute('position')
            : null;

        const dataPoints = object && object.userData && Array.isArray(object.userData.points)
            ? object.userData.points
            : null;

        if ((!attribute || attribute.count < 2) && (!dataPoints || dataPoints.length < 2)) {
            return null;
        }

        if (typeof object.updateMatrixWorld === 'function') {
            object.updateMatrixWorld(true);
        }

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        const vector = global.THREE && global.THREE.Vector3
            ? new global.THREE.Vector3()
            : null;

        const count = attribute && attribute.count >= 2
            ? attribute.count
            : dataPoints.length;

        for (let index = 0; index < count; index++) {
            let x, y, z;
            if (attribute && attribute.count >= 2) {
                x = attribute.getX(index);
                y = attribute.getY(index);
                z = attribute.getZ(index);
            } else {
                const point = dataPoints[index];
                x = Number(point.x) || 0;
                y = Number(point.y) || 0;
                z = Number(point.z) || 0;
            }

            if (vector && typeof object.localToWorld === 'function') {
                vector.set(x, y, z);
                object.localToWorld(vector);
                x = vector.x;
                y = vector.y;
            }

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }

        if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;

        const dx = Math.max(0, maxX - minX);
        const dy = Math.max(0, maxY - minY);
        return {
            length: Math.max(dx, dy),
            width: Math.min(dx, dy)
        };
    }

    function getCircleRadius(object) {
        const data = object && object.userData ? object.userData : {};
        let radius = Number(data.radius);
        if (Number.isFinite(radius) && radius > 0) return radius;

        const bounds = getBounds(object);
        if (bounds && bounds.length > 0) return bounds.length / 2;
        return 0;
    }

    function getDisplayUnit(context) {
        try {
            const style = global.CAD && global.CAD.Dimension &&
                typeof global.CAD.Dimension.currentStyle === 'function'
                ? global.CAD.Dimension.currentStyle()
                : null;
            const unit = style && style.displayUnit ? String(style.displayUnit) : '';
            if (UNIT_FACTORS[unit]) return unit;
        } catch (_) {}

        const state = context && context.getState ? context.getState() : {};
        const fallback = state && state.units ? String(state.units) : 'mm';
        return UNIT_FACTORS[fallback] ? fallback : 'mm';
    }

    function buildMeasurementRows(objects, precision, displayUnit) {
        const decimals = Math.max(0, Math.min(6, Number(precision) || 0));
        const factor = UNIT_FACTORS[displayUnit] || 1;
        const groups = new Map();

        (objects || []).forEach(object => {
            const kind = getEntityKind(object);
            if (!kind) return;

            let length;
            let width;
            if (kind === 'circle') {
                const radius = getCircleRadius(object);
                if (!Number.isFinite(radius) || radius <= 1e-9) return;
                // As requested: radius is recorded in both Length and Width.
                length = Number((radius / factor).toFixed(decimals));
                width = length;
            } else {
                const bounds = getBounds(object);
                if (!bounds || bounds.length <= 1e-9 || bounds.width <= 1e-9) return;
                length = Number((bounds.length / factor).toFixed(decimals));
                width = Number((bounds.width / factor).toFixed(decimals));
            }

            const layer = String(
                object.userData && object.userData.layer
                    ? object.userData.layer
                    : '0'
            );
            const key = [
                kind,
                layer,
                length.toFixed(decimals),
                width.toFixed(decimals)
            ].join('|');

            if (!groups.has(key)) {
                groups.set(key, {
                    kind: kind,
                    description: layer,
                    nos: 0,
                    length: length,
                    width: width
                });
            }
            groups.get(key).nos += 1;
        });

        const unit = AREA_UNITS[displayUnit] || 'mm²';
        return Array.from(groups.values()).map((group, index) => {
            const unitArea = group.kind === 'circle'
                ? 3.142 * group.length * group.width
                : group.length * group.width;

            return {
                slNo: index + 1,
                description: group.description,
                nos: group.nos,
                length: group.length,
                width: group.width,
                height: '',
                quantity: Number((group.nos * unitArea).toFixed(decimals)),
                unit: unit,
                remarks: ''
            };
        });
    }

    function readExistingRows(sheet) {
        const sparse = Array.isArray(sheet.celldata) ? sheet.celldata : [];
        const sparseMax = sparse.reduce((max, cell) => {
            if (!cell || Number(cell.c) > 8) return max;
            return Math.max(max, Number(cell.r) || 0);
        }, 0);
        const dense = Array.isArray(sheet.data) ? sheet.data : [];
        let denseMax = 0;
        dense.forEach((row, rowIndex) => {
            if (Array.isArray(row) && row.slice(0, 9).some(value => cellText(value) !== '')) {
                denseMax = Math.max(denseMax, rowIndex);
            }
        });
        const maxRow = Math.max(sparseMax, denseMax);

        const preserved = new Map();
        for (let row = 1; row <= maxRow; row++) {
            const description = String(getCell(sheet, row, 1) || '').trim();
            const length = Number(getCell(sheet, row, 3));
            const width = Number(getCell(sheet, row, 4));
            if (!description || !Number.isFinite(length) || !Number.isFinite(width)) continue;

            const key = [description, length, width].join('|');
            preserved.set(key, {
                unit: getCell(sheet, row, 7) || '',
                remarks: getCell(sheet, row, 8) || ''
            });
        }
        return { maxRow, preserved };
    }

    function sync() {
        if (isSyncing) return false;
        if (!global.CAD || typeof global.CAD.createContext !== 'function') return false;
        if (!global.luckysheet || typeof global.luckysheet.setCellValue !== 'function') return false;

        const sheets = getWorkbookSheets();
        const sheet = findMeasurementSheet();
        if (!sheet) return false;

        const order = sheetOrder(sheet, sheets);
        const context = global.CAD.createContext();
        const state = context.getState();
        const displayUnit = getDisplayUnit(context);
        const rows = buildMeasurementRows(
            context.getObjects(),
            state.precision,
            displayUnit
        );

        isSyncing = true;
        try {
            const headerChanged = ensureHeaders(sheet, order);
            const existing = readExistingRows(sheet);

            // Preserve the user's Unit and Remarks values for matching rows.
            rows.forEach(row => {
                const key = [row.description, row.length, row.width].join('|');
                const previous = existing.preserved.get(key);
                if (previous) {
                    if (previous.unit !== '') row.unit = previous.unit;
                    row.remarks = previous.remarks;
                }
            });

            // The measurement worksheet is a CAD-generated schedule below
            // its fixed header. Clear only columns A:I in its existing data rows.
            for (let row = 1; row <= existing.maxRow; row++) {
                for (let col = 0; col < HEADERS.length; col++) {
                    writeCell(order, row, col, '');
                }
            }

            rows.forEach((item, index) => {
                const row = index + 1;
                const values = [
                    item.slNo,
                    item.description,
                    item.nos,
                    item.length,
                    item.width,
                    '', // Height intentionally reserved for future 3D use.
                    item.quantity,
                    item.unit,
                    item.remarks
                ];
                values.forEach((value, col) => writeCell(order, row, col, value));
            });

            if (headerChanged || rows.length || existing.maxRow) {
                const manager = global.SafarEdgeProjectFiles;
                if (manager && typeof manager.markDirty === 'function') {
                    manager.markDirty();
                }
            }
        } catch (error) {
            console.error('SAFAR EDGE measurement takeoff update failed:', error);
            return false;
        } finally {
            isSyncing = false;
        }
        return true;
    }

    function scheduleSync(delay) {
        if (syncTimer) global.clearTimeout(syncTimer);
        syncTimer = global.setTimeout(function () {
            syncTimer = null;
            sync();
        }, Number.isFinite(Number(delay)) ? Number(delay) : 120);
    }

    function initialize() {
        let attempts = 0;
        const tryInitialSync = function () {
            attempts += 1;
            const completed = sync();
            // Luckysheet can finish mounting after its create() call. Retry
            // briefly rather than silently missing the initial measurement sheet.
            if (!completed && attempts < 12) {
                syncTimer = global.setTimeout(tryInitialSync, 300);
            } else {
                syncTimer = null;
            }
        };
        if (syncTimer) global.clearTimeout(syncTimer);
        syncTimer = global.setTimeout(tryInitialSync, 250);
    }

    global.SafarEdgeMeasurements = {
        headers: HEADERS.slice(),
        initialize: initialize,
        sync: sync,
        scheduleSync: scheduleSync,
        // Exposed for deterministic unit testing and diagnostics.
        buildMeasurementRows: buildMeasurementRows,
        getEntityKind: getEntityKind
    };
})(window);
