/**
 * SAFAR EDGE — CAD CLOSED-SHAPE MEASUREMENT TAKEOFF
 *
 * Closed native POLYLINE, RECTANGLE/SQUARE, and CIRCLE entities are grouped by layer and overall
 * length/width. The measurement table occupies columns A:J:
 * Sl No, Description, Nos, Nos (Factor), Length, Width, Height, Quantity, Unit, Remarks.
 *
 * Length and width are overall plan extents converted from the CAD base unit (mm)
 * to the selected output unit. Height is reserved for future 3D takeoff.
 * Quantity = Nos × Nos (Factor) × Length × Width.
 */
(function (global) {
    'use strict';

    const HEADERS = [
        'Sl No', 'Description', 'Nos', 'Nos (Factor)', 'Length', 'Width',
        'Height', 'Quantity', 'Unit', 'Remarks'
    ];
    const LEGACY_HEADERS = [
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
    const AUTO_UPDATE_STORAGE_KEY = 'safaredge.cad.measurements.autoUpdate';
    const OUTPUT_UNIT_STORAGE_KEY = 'safaredge.cad.measurements.outputUnit';
    const MEASUREMENT_MROUND_KEY = 'safaredge.cad.measurements.measurementMroundMultiple';
    const QUANTITY_MROUND_KEY = 'safaredge.cad.measurements.quantityMroundMultiple';
    const LEGACY_MEASUREMENT_DECIMALS_KEY = 'safaredge.cad.measurements.measurementDecimals';
    const LEGACY_QUANTITY_DECIMALS_KEY = 'safaredge.cad.measurements.quantityDecimals';
    let autoUpdateEnabled = false;
    let settingsMenuEl = null;
    let outsideMenuHandler = null;

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

    function matchesHeaders(sheet, headers) {
        return headers.every((heading, col) =>
            String(getCell(sheet, 0, col)).trim().toLowerCase() === heading.toLowerCase()
        );
    }

    function headerMatches(sheet) { return matchesHeaders(sheet, HEADERS); }
    function legacyHeaderMatches(sheet) { return matchesHeaders(sheet, LEGACY_HEADERS); }

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
        const legacy = sheets.find(legacyHeaderMatches);
        if (legacy) return legacy;

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
        if (legacyHeaderMatches(sheet)) {
            HEADERS.forEach((heading, col) => writeCell(order, 0, col, heading));
            return true;
        }
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

    function getCurrentDrawingUnit(context) {
        const state = context && context.getState ? context.getState() : {};
        const unit = state && state.units ? String(state.units).toLowerCase() : 'mm';
        return UNIT_FACTORS[unit] ? unit : 'mm';
    }

    function defaultOutputUnit(currentUnit) {
        if (currentUnit === 'mm' || currentUnit === 'cm' || currentUnit === 'm') return 'm';
        if (currentUnit === 'inch' || currentUnit === 'ft') return 'ft';
        return 'm';
    }

    function getOutputUnit(currentUnit) {
        try {
            const stored = String(global.localStorage.getItem(OUTPUT_UNIT_STORAGE_KEY) || '').toLowerCase();
            if (UNIT_FACTORS[stored]) return stored;
        } catch (_) {}
        return defaultOutputUnit(currentUnit || 'mm');
    }

    function setOutputUnit(unit) {
        const normalized = String(unit || '').toLowerCase();
        if (!UNIT_FACTORS[normalized]) return false;
        try { global.localStorage.setItem(OUTPUT_UNIT_STORAGE_KEY, normalized); } catch (_) {}
        return true;
    }

    function getMroundMultiple(key, defaultValue, legacyKey, legacyDefaultDecimals) {
        try {
            const stored = global.localStorage.getItem(key);
            if (stored !== null && stored !== '') {
                const value = Number(stored);
                if (Number.isFinite(value) && value > 0) return value;
            }

            // Migrate the previous whole-number decimal-place setting once.
            const legacy = legacyKey ? global.localStorage.getItem(legacyKey) : null;
            if (legacy !== null && legacy !== '') {
                const decimals = Number(legacy);
                if (Number.isInteger(decimals) && decimals >= 0 && decimals <= 12) {
                    const migrated = Math.pow(10, -decimals);
                    global.localStorage.setItem(key, String(migrated));
                    return migrated;
                }
            }
        } catch (_) {}
        return defaultValue;
    }

    function setMroundMultiple(key, value) {
        const multiple = Number(value);
        if (!Number.isFinite(multiple) || multiple <= 0) return false;
        try {
            global.localStorage.setItem(key, String(multiple));
        } catch (_) {}
        return true;
    }

    function decimalPlacesForMultiple(multiple) {
        const text = Number(multiple).toString().toLowerCase();
        if (text.includes('e-')) {
            const parts = text.split('e-');
            return Math.min(12, Number(parts[1]) || 0);
        }
        const fraction = text.split('.')[1] || '';
        return Math.min(12, fraction.length);
    }

    function mround(value, multiple) {
        if (!Number.isFinite(value) || !Number.isFinite(multiple) || multiple <= 0) {
            return value;
        }
        const units = Math.round(Math.abs(value) / multiple + Number.EPSILON * 4);
        const decimals = decimalPlacesForMultiple(multiple);
        const rounded = units * multiple;
        return Number((Math.sign(value) * rounded).toFixed(decimals));
    }

    function conversionDescription(currentUnit, outputUnit) {
        const outputFactor = UNIT_FACTORS[outputUnit] || 1000;
        // CAD model coordinates are stored in millimetres by cad-core.js.
        const linear = 1 / outputFactor;
        const area = linear * linear;
        const sourceLabel = 'mm';
        const lengthLabel = outputUnit;
        const areaLabel = AREA_UNITS[outputUnit] || 'm²';
        return {
            linear: `1 ${sourceLabel} = ${Number(linear.toPrecision(8))} ${lengthLabel}`,
            area: `1 mm² = ${Number(area.toPrecision(8))} ${areaLabel}`,
            note: `Drawing unit setting: ${currentUnit}. CAD geometry is stored in mm; measurements are converted from mm to ${outputUnit}.`
        };
    }

    function buildMeasurementRows(
        objects,
        measurementMultiple,
        quantityMultiple,
        currentUnit,
        outputUnit
    ) {
        const measurementStep = Number(measurementMultiple);
        const quantityStep = Number(quantityMultiple);
        if (!Number.isFinite(measurementStep) || measurementStep <= 0 ||
            !Number.isFinite(quantityStep) || quantityStep <= 0) {
            throw new Error('MROUND multiples must be positive numbers.');
        }
        const targetUnit = UNIT_FACTORS[outputUnit] ? outputUnit : defaultOutputUnit(currentUnit || 'mm');
        const mmPerOutputUnit = UNIT_FACTORS[targetUnit] || 1000;
        const mmToOutput = 1 / mmPerOutputUnit;
        const groups = new Map();

        (objects || []).forEach(object => {
            try {
                const kind = getEntityKind(object);
                if (!kind) return;

                let length;
                let width;
                if (kind === 'circle') {
                    const radiusMm = getCircleRadius(object);
                    if (!Number.isFinite(radiusMm) || radiusMm <= 1e-9) return;
                    // Circle radius is recorded in both Length and Width.
                    length = mround(radiusMm * mmToOutput, measurementStep);
                    width = length;
                } else {
                    const bounds = getBounds(object);
                    if (!bounds || bounds.length <= 1e-9 || bounds.width <= 1e-9) return;
                    length = mround(bounds.length * mmToOutput, measurementStep);
                    width = mround(bounds.width * mmToOutput, measurementStep);
                }

                const layer = String(
                    object.userData && object.userData.layer
                        ? object.userData.layer
                        : '0'
                );
                const nosFactor = kind === 'circle' ? 3.142 : 1;
                const key = [kind, layer, nosFactor, length, width].join('|');

                if (!groups.has(key)) {
                    groups.set(key, {
                        kind: kind,
                        description: layer,
                        nos: 0,
                        nosFactor: nosFactor,
                        length: length,
                        width: width
                    });
                }
                groups.get(key).nos += 1;
            } catch (error) {
                // Ignore unsupported or malformed entities; they are not takeoff shapes.
                console.debug('SAFAR EDGE measurement skipped an unsupported entity.', error);
            }
        });

        const unit = AREA_UNITS[targetUnit] || 'm²';
        return Array.from(groups.values()).map((group, index) => ({
            slNo: index + 1,
            description: group.description,
            nos: group.nos,
            nosFactor: group.nosFactor,
            length: group.length,
            width: group.width,
            height: '',
            quantity: mround(
                group.nos * group.nosFactor * group.length * group.width,
                quantityStep
            ),
            unit: unit,
            remarks: ''
        }));
    }

    function readExistingRows(sheet) {
        const isLegacy = legacyHeaderMatches(sheet);
        const sparse = Array.isArray(sheet.celldata) ? sheet.celldata : [];
        const sparseMax = sparse.reduce((max, cell) => {
            if (!cell || Number(cell.c) > 9) return max;
            return Math.max(max, Number(cell.r) || 0);
        }, 0);
        const dense = Array.isArray(sheet.data) ? sheet.data : [];
        let denseMax = 0;
        dense.forEach((row, rowIndex) => {
            if (Array.isArray(row) && row.slice(0, 10).some(value => cellText(value) !== '')) {
                denseMax = Math.max(denseMax, rowIndex);
            }
        });
        const maxRow = Math.max(sparseMax, denseMax);
        const preserved = new Map();
        for (let row = 1; row <= maxRow; row++) {
            const description = String(getCell(sheet, row, 1) || '').trim();
            const length = Number(getCell(sheet, row, isLegacy ? 3 : 4));
            const width = Number(getCell(sheet, row, isLegacy ? 4 : 5));
            if (!description || !Number.isFinite(length) || !Number.isFinite(width)) continue;
            const key = [description, length, width].join('|');
            preserved.set(key, {
                unit: getCell(sheet, row, isLegacy ? 7 : 8) || '',
                remarks: getCell(sheet, row, isLegacy ? 8 : 9) || ''
            });
        }
        return { maxRow, preserved, isLegacy };
    }

    function ensureMeasurementSheetForManualSync() {
        const sheets = getWorkbookSheets();
        if (!sheets.length) {
            return { ok: false, message: 'The spreadsheet is not ready yet. Open the Spreadsheet tab, wait for it to load, and try again.' };
        }

        // Always prefer a worksheet already carrying the exact measurement headings.
        let sheet = sheets.find(headerMatches);
        if (sheet) return { ok: true, sheet: sheet, created: false };
        // Migrate the previous nine-column measurement layout in place.
        sheet = sheets.find(legacyHeaderMatches);
        if (sheet) return { ok: true, sheet: sheet, created: false };

        // If the workbook has a genuinely empty sheet, use it rather than touching user data.
        sheet = sheets.find(item => !hasSheetContent(item));
        if (sheet) return { ok: true, sheet: sheet, created: false };

        // Do not overwrite unrelated worksheet data. Create a dedicated takeoff sheet.
        if (typeof global.luckysheet.setSheetAdd !== 'function') {
            return {
                ok: false,
                message: 'No blank measurement worksheet is available. Please add a blank worksheet, then click UPDATE MEASUREMENTS again.'
            };
        }

        const before = sheets.slice();
        try {
            global.luckysheet.setSheetAdd({ name: 'CAD Measurements' });
        } catch (error) {
            return { ok: false, message: 'Unable to create the measurement worksheet: ' + error.message };
        }

        const refreshedSheets = getWorkbookSheets();
        sheet = refreshedSheets.find(item => item && item.name === 'CAD Measurements' && !hasSheetContent(item)) ||
            refreshedSheets.find(item => !before.includes(item) && !hasSheetContent(item)) ||
            refreshedSheets.find(item => !hasSheetContent(item));

        if (!sheet) {
            return {
                ok: false,
                message: 'Luckysheet did not return the new worksheet. Please add a blank worksheet manually and retry.'
            };
        }

        const order = sheetOrder(sheet, refreshedSheets);
        try {
            if (typeof global.luckysheet.setSheetName === 'function') {
                global.luckysheet.setSheetName('CAD Measurements', { order: order });
            }
        } catch (_) {}

        return { ok: true, sheet: sheet, created: true };
    }

    function writeMeasurementRows(sheet, rows) {
        if (!sheet) throw new Error('Measurement worksheet was not identified.');
        const sheets = getWorkbookSheets();
        const order = sheetOrder(sheet, sheets);
        // This sheet was selected because it has the new/legacy measurement headings
        // or was empty, so it is safe to initialise its A:J header row.
        const existing = readExistingRows(sheet);
        const headerChanged = ensureHeaders(sheet, order);

        // Preserve Unit and Remarks when the same layer and dimensions already exist.
        rows.forEach(row => {
            const key = [row.description, row.length, row.width].join('|');
            const previous = existing.preserved.get(key);
            if (previous) {
                // The selected output unit always controls the Unit column.
                // Preserve only the user's Remarks when the object key still matches.
                row.remarks = previous.remarks;
            }
        });

        // Clear only A:J measurement rows, leaving every other column untouched.
        for (let row = 1; row <= existing.maxRow; row++) {
            for (let col = 0; col < HEADERS.length; col++) {
                writeCell(order, row, col, '');
            }
        }

        rows.forEach((item, index) => {
            const values = [
                index + 1,
                item.description,
                item.nos,
                item.nosFactor,
                item.length,
                item.width,
                '', // Height intentionally reserved for future 3D use.
                item.quantity,
                item.unit,
                item.remarks
            ];
            const sheetRow = index + 1;
            values.forEach((value, col) => writeCell(order, sheetRow, col, value));

            // Keep spreadsheet cells numeric, but display exactly the selected
            // decimal precision. Luckysheet's cell format uses ct.fa + ct.t.
            if (typeof global.luckysheet.setCellFormat === 'function') {
                const measurementMultiple = getMroundMultiple(MEASUREMENT_MROUND_KEY, 0.001, LEGACY_MEASUREMENT_DECIMALS_KEY, 3);
                const quantityMultiple = getMroundMultiple(QUANTITY_MROUND_KEY, 0.01, LEGACY_QUANTITY_DECIMALS_KEY, 2);
                const measurementDecimals = decimalPlacesForMultiple(measurementMultiple);
                const quantityDecimals = decimalPlacesForMultiple(quantityMultiple);
                const measurementFormat = {
                    fa: measurementDecimals === 0 ? '0' : '0.' + '0'.repeat(measurementDecimals),
                    t: 'n'
                };
                const quantityFormat = {
                    fa: quantityDecimals === 0 ? '0' : '0.' + '0'.repeat(quantityDecimals),
                    t: 'n'
                };

                try {
                    global.luckysheet.setCellFormat(sheetRow, 4, 'ct', measurementFormat, { order: order });
                    global.luckysheet.setCellFormat(sheetRow, 5, 'ct', measurementFormat, { order: order });
                    global.luckysheet.setCellFormat(sheetRow, 7, 'ct', quantityFormat, { order: order });
                } catch (formatError) {
                    console.warn('SAFAR EDGE could not apply measurement number formatting.', formatError);
                }
            }
        });

        if (headerChanged || rows.length || existing.maxRow) {
            const manager = global.SafarEdgeProjectFiles;
            if (manager && typeof manager.markDirty === 'function') manager.markDirty();
        }

        // Force the target sheet to become active and refresh the visible grid if supported.
        if (typeof global.luckysheet.setSheetActive === 'function') {
            global.luckysheet.setSheetActive(order);
        }
        if (typeof global.luckysheet.refresh === 'function') {
            try { global.luckysheet.refresh(); } catch (_) {}
        }

        return { order: order, sheetName: sheet.name || 'CAD Measurements' };
    }

    function syncFromMenu(options) {
        options = options || {};
        const isAutomatic = options.source === 'auto';
        if (!global.CAD || typeof global.CAD.createContext !== 'function') {
            return { ok: false, message: 'CAD is not ready. Wait for the drawing workspace to finish loading.' };
        }
        if (!global.luckysheet || typeof global.luckysheet.setCellValue !== 'function' ||
            typeof global.luckysheet.getAllSheets !== 'function') {
            return { ok: false, message: 'Spreadsheet is not ready. Open the Spreadsheet tab, wait for it to load, and retry.' };
        }
        if (isSyncing) return { ok: false, message: 'A measurement update is already running. Please wait.' };

        let objects;
        let rows;
        try {
            const context = global.CAD.createContext();
            objects = context && typeof context.getObjects === 'function' ? context.getObjects() : [];
            const state = context && typeof context.getState === 'function' ? context.getState() : {};
            const currentUnit = getCurrentDrawingUnit(context);
            const outputUnit = getOutputUnit(currentUnit);
            rows = buildMeasurementRows(
                objects,
                getMroundMultiple(MEASUREMENT_MROUND_KEY, 0.001, LEGACY_MEASUREMENT_DECIMALS_KEY, 3),
                getMroundMultiple(QUANTITY_MROUND_KEY, 0.01, LEGACY_QUANTITY_DECIMALS_KEY, 2),
                currentUnit,
                outputUnit
            );
        } catch (error) {
            return { ok: false, message: 'Unable to read CAD objects: ' + error.message };
        }

        // Do not create a blank takeoff worksheet for automatic updates when
        // the edit produced no supported closed-shape measurement rows.
        if (isAutomatic && rows.length === 0 && !findMeasurementSheet()) {
            return { ok: true, objectCount: 0, rowCount: 0, sheetName: '', message: '' };
        }

        const ensured = ensureMeasurementSheetForManualSync();
        if (!ensured.ok) return ensured;

        const supportedCount = objects.reduce((count, object) => {
            try { return count + (getEntityKind(object) ? 1 : 0); }
            catch (_) { return count; }
        }, 0);
        isSyncing = true;
        try {
            const target = writeMeasurementRows(ensured.sheet, rows);
            return {
                ok: true,
                objectCount: supportedCount,
                rowCount: rows.length,
                sheetName: target.sheetName,
                // Unsupported, open or irregular entities are silently skipped.
                message: ''
            };
        } catch (error) {
            console.error('SAFAR EDGE manual measurement update failed:', error);
            return { ok: false, message: 'Measurement writing failed: ' + error.message };
        } finally {
            isSyncing = false;
        }
    }

    function sync() {
        if (isSyncing) return false;
        if (!global.CAD || typeof global.CAD.createContext !== 'function') return false;
        if (!global.luckysheet || typeof global.luckysheet.setCellValue !== 'function') return false;

        const sheet = findMeasurementSheet();
        if (!sheet) return false;

        let rows;
        try {
            const context = global.CAD.createContext();
            const objects = context && typeof context.getObjects === 'function'
                ? context.getObjects()
                : [];
            const currentUnit = getCurrentDrawingUnit(context);
            const outputUnit = getOutputUnit(currentUnit);
            rows = buildMeasurementRows(
                objects,
                getMroundMultiple(MEASUREMENT_MROUND_KEY, 0.001, LEGACY_MEASUREMENT_DECIMALS_KEY, 3),
                getMroundMultiple(QUANTITY_MROUND_KEY, 0.01, LEGACY_QUANTITY_DECIMALS_KEY, 2),
                currentUnit,
                outputUnit
            );
        } catch (error) {
            console.error('SAFAR EDGE measurement calculation failed:', error);
            return false;
        }

        isSyncing = true;
        try {
            writeMeasurementRows(sheet, rows);
        } catch (error) {
            console.error('SAFAR EDGE measurement takeoff update failed:', error);
            return false;
        } finally {
            isSyncing = false;
        }
        return true;
    }

    function readAutoUpdatePreference() {
        try {
            return global.localStorage.getItem(AUTO_UPDATE_STORAGE_KEY) === '1';
        } catch (_) {
            return false;
        }
    }

    function updateMeasureButton() {
        const button = global.document && global.document.getElementById('cad-st-measure');
        if (!button) return;
        button.textContent = 'MEASURE';
        button.style.background = autoUpdateEnabled ? '#0f766e' : '#2a2a2a';
        button.style.borderColor = autoUpdateEnabled ? '#14b8a6' : '#444';
        button.style.color = '#fff';
        button.title = 'Left-click: update measurement sheet | Right-click: Auto Update ' +
            (autoUpdateEnabled ? 'ON' : 'OFF');
        button.setAttribute('aria-pressed', autoUpdateEnabled ? 'true' : 'false');
    }

    function closeSettingsMenu() {
        if (settingsMenuEl) {
            settingsMenuEl.remove();
            settingsMenuEl = null;
        }
        if (outsideMenuHandler) {
            global.document.removeEventListener('pointerdown', outsideMenuHandler, true);
            outsideMenuHandler = null;
        }
    }

    function showSettings(clientX, clientY) {
        closeSettingsMenu();
        const menu = global.document.createElement('div');
        menu.id = 'cad-measurement-settings-menu';
        menu.style.cssText = [
            'position:fixed', 'z-index:100000', 'min-width:220px', 'padding:9px 11px',
            'background:#252526', 'color:#eee', 'border:1px solid #555',
            'border-radius:5px', 'box-shadow:0 6px 18px rgba(0,0,0,.45)',
            'font:12px Segoe UI,Arial,sans-serif'
        ].join(';');

        const title = global.document.createElement('div');
        title.textContent = 'Measurement Settings';
        title.style.cssText = 'font-weight:600;padding:2px 2px 8px;border-bottom:1px solid #444;margin-bottom:8px;';
        menu.appendChild(title);

        const cadContext = global.CAD && typeof global.CAD.createContext === 'function'
            ? global.CAD.createContext() : null;
        const currentUnit = getCurrentDrawingUnit(cadContext);
        const selectedOutputUnit = getOutputUnit(currentUnit);
        const currentLine = global.document.createElement('div');
        currentLine.style.cssText = 'padding:5px 2px;color:#ccc;';
        currentLine.textContent = 'Current drawing unit: ' + currentUnit.toUpperCase();
        menu.appendChild(currentLine);

        const outputLabel = global.document.createElement('label');
        outputLabel.style.cssText = 'display:flex;flex-direction:column;gap:5px;padding:5px 2px;color:#eee;';
        const outputCaption = global.document.createElement('span');
        outputCaption.textContent = 'Measurement output unit';
        const outputSelect = global.document.createElement('select');
        outputSelect.style.cssText = 'width:100%;padding:5px;background:#333;color:#fff;border:1px solid #666;border-radius:3px;';
        [['mm','Millimetre (mm)'],['cm','Centimetre (cm)'],['m','Metre (m)'],['inch','Inch (in)'],['ft','Foot (ft)']].forEach(([value, labelText]) => {
            const option = global.document.createElement('option');
            option.value = value; option.textContent = labelText;
            outputSelect.appendChild(option);
        });
        outputSelect.value = selectedOutputUnit;
        outputLabel.appendChild(outputCaption);
        outputLabel.appendChild(outputSelect);
        menu.appendChild(outputLabel);

        const conversion = global.document.createElement('div');
        conversion.style.cssText = 'color:#9ca3af;font-size:11px;line-height:1.45;padding:5px 2px 7px;border-bottom:1px solid #444;margin-bottom:5px;';
        const updateConversionText = () => {
            const details = conversionDescription(currentUnit, outputSelect.value);
            conversion.textContent = details.note + ' ' + details.linear + '; ' + details.area;
        };
        updateConversionText();
        outputSelect.addEventListener('change', () => {
            setOutputUnit(outputSelect.value);
            updateConversionText();
            if (autoUpdateEnabled) scheduleSync(0);
        });
        menu.appendChild(conversion);

        const roundingMethod = global.document.createElement('div');
        roundingMethod.style.cssText = 'padding:7px 2px 4px;color:#ccc;';
        roundingMethod.textContent = 'Rounding Method: MROUND (fixed)';
        menu.appendChild(roundingMethod);

        // User-defined MROUND multiple for measurements.
        const measurementPrecisionLabel = global.document.createElement('label');
        measurementPrecisionLabel.style.cssText =
            'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 2px;color:#eee;';

        const measurementPrecisionText = global.document.createElement('span');
        measurementPrecisionText.textContent = 'Measurement MROUND Multiple';

        const measurementPrecisionInput = global.document.createElement('input');
        measurementPrecisionInput.type = 'number';
        measurementPrecisionInput.min = '0';
        measurementPrecisionInput.step = 'any';
        measurementPrecisionInput.value = getMroundMultiple(MEASUREMENT_MROUND_KEY, 0.001, LEGACY_MEASUREMENT_DECIMALS_KEY, 3);
        measurementPrecisionInput.style.cssText =
            'width:90px;padding:4px;background:#333;color:#fff;border:1px solid #666;border-radius:3px;';

        measurementPrecisionInput.addEventListener('change', () => {
            const value = Number(measurementPrecisionInput.value);
            if (!setMroundMultiple(MEASUREMENT_MROUND_KEY, value)) {
                measurementPrecisionInput.value = getMroundMultiple(MEASUREMENT_MROUND_KEY, 0.001, LEGACY_MEASUREMENT_DECIMALS_KEY, 3);
                return;
            }
            if (autoUpdateEnabled) scheduleSync(0);
        });

        measurementPrecisionLabel.appendChild(measurementPrecisionText);
        measurementPrecisionLabel.appendChild(measurementPrecisionInput);
        menu.appendChild(measurementPrecisionLabel);

        // User-defined MROUND multiple for quantities.
        const quantityPrecisionLabel = global.document.createElement('label');
        quantityPrecisionLabel.style.cssText =
            'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 2px;color:#eee;';

        const quantityPrecisionText = global.document.createElement('span');
        quantityPrecisionText.textContent = 'Quantity MROUND Multiple';

        const quantityPrecisionInput = global.document.createElement('input');
        quantityPrecisionInput.type = 'number';
        quantityPrecisionInput.min = '0';
        quantityPrecisionInput.step = 'any';
        quantityPrecisionInput.value = getMroundMultiple(QUANTITY_MROUND_KEY, 0.01, LEGACY_QUANTITY_DECIMALS_KEY, 2);
        quantityPrecisionInput.style.cssText =
            'width:90px;padding:4px;background:#333;color:#fff;border:1px solid #666;border-radius:3px;';

        quantityPrecisionInput.addEventListener('change', () => {
            const value = Number(quantityPrecisionInput.value);
            if (!setMroundMultiple(QUANTITY_MROUND_KEY, value)) {
                quantityPrecisionInput.value = getMroundMultiple(QUANTITY_MROUND_KEY, 0.01, LEGACY_QUANTITY_DECIMALS_KEY, 2);
                return;
            }
            if (autoUpdateEnabled) scheduleSync(0);
        });

        quantityPrecisionLabel.appendChild(quantityPrecisionText);
        quantityPrecisionLabel.appendChild(quantityPrecisionInput);
        menu.appendChild(quantityPrecisionLabel);

        const label = global.document.createElement('label');
        label.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 2px;';
        const checkbox = global.document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = autoUpdateEnabled;
        checkbox.style.cssText = 'accent-color:#0d9488;';
        const text = global.document.createElement('span');
        text.textContent = 'Auto Update Measurements';
        label.appendChild(checkbox);
        label.appendChild(text);
        menu.appendChild(label);

        const note = global.document.createElement('div');
        note.textContent = 'Default: OFF. When ON, updates run after CAD edits (not continuously). Manual update remains available by left-clicking MEASURE.';
        note.style.cssText = 'color:#aaa;font-size:11px;line-height:1.4;padding:7px 2px 1px;max-width:245px;';
        menu.appendChild(note);

        checkbox.addEventListener('change', () => {
            setAutoUpdateEnabled(checkbox.checked);
            closeSettingsMenu();
        });

        global.document.body.appendChild(menu);
        settingsMenuEl = menu;
        const rect = menu.getBoundingClientRect();
        menu.style.left = Math.max(6, Math.min(clientX, global.innerWidth - rect.width - 6)) + 'px';
        menu.style.top = Math.max(6, Math.min(clientY, global.innerHeight - rect.height - 6)) + 'px';

        outsideMenuHandler = event => {
            if (settingsMenuEl && !settingsMenuEl.contains(event.target) &&
                event.target.id !== 'cad-st-measure') closeSettingsMenu();
        };
        global.document.addEventListener('pointerdown', outsideMenuHandler, true);
    }

    function setAutoUpdateEnabled(enabled) {
        autoUpdateEnabled = !!enabled;
        try {
            global.localStorage.setItem(AUTO_UPDATE_STORAGE_KEY, autoUpdateEnabled ? '1' : '0');
        } catch (_) {}
        updateMeasureButton();

        if (autoUpdateEnabled) {
            // Perform one reconciliation when enabled. Subsequent updates are
            // triggered only by completed CAD mutation/history events.
            scheduleSync(0);
        } else if (syncTimer !== null) {
            global.clearTimeout(syncTimer);
            syncTimer = null;
        }
        return autoUpdateEnabled;
    }

    function scheduleSync(delay) {
        if (!autoUpdateEnabled || isSyncing) return;
        if (syncTimer !== null) global.clearTimeout(syncTimer);
        const wait = Number.isFinite(Number(delay)) ? Math.max(0, Number(delay)) : 180;
        syncTimer = global.setTimeout(function () {
            syncTimer = null;
            if (!autoUpdateEnabled || isSyncing) return;
            if (!global.luckysheet || typeof global.luckysheet.setCellValue !== 'function') return;

            const result = syncFromMenu({ source: 'auto' });
            if (!result || !result.ok) {
                // Keep automatic updates quiet; manual MEASURE provides
                // actionable feedback if the workbook is not ready.
                console.debug('SAFAR EDGE automatic measurement update was skipped.', result && result.message);
            }
        }, wait);
    }

    function initialize() {
        // Auto Update is OFF unless the user explicitly enabled it earlier.
        // There is deliberately no interval, polling loop or idle drawing scan.
        autoUpdateEnabled = readAutoUpdatePreference();
        updateMeasureButton();
        const button = global.document && global.document.getElementById('cad-st-measure');
        if (button && !button.dataset.measureContextBound) {
            button.dataset.measureContextBound = '1';
            button.addEventListener('contextmenu', event => {
                event.preventDefault();
                event.stopPropagation();
                showSettings(event.clientX, event.clientY);
            });
        }

        // Reconcile once on startup only if Auto Update was previously enabled.
        // Project restoration schedules another sync after its workbook is ready.
        if (autoUpdateEnabled) scheduleSync(300);
    }

    global.SafarEdgeMeasurements = {
        headers: HEADERS.slice(),
        initialize: initialize,
        sync: sync,
        syncFromMenu: syncFromMenu,
        scheduleSync: scheduleSync,
        showSettings: showSettings,
        setAutoUpdateEnabled: setAutoUpdateEnabled,
        isAutoUpdateEnabled: () => autoUpdateEnabled,
        // Exposed for deterministic unit testing and diagnostics.
        buildMeasurementRows: buildMeasurementRows,
        getEntityKind: getEntityKind,
        getCurrentDrawingUnit: getCurrentDrawingUnit,
        getOutputUnit: getOutputUnit,
        setOutputUnit: setOutputUnit,
        conversionDescription: conversionDescription,
        mround: mround,
        getMroundMultiple: getMroundMultiple,
        setMroundMultiple: setMroundMultiple
    };
})(window);
