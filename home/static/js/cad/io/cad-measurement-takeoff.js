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
    const AUTO_UPDATE_STORAGE_KEY = 'safaredge.cad.measurements.autoUpdate';
    let autoUpdateEnabled = false;
    let autoUpdateTimer = null;
    let lastAutoSignature = null;
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
            try {
    
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
            } catch (error) {
                // Ignore unsupported or malformed entities; they are not takeoff shapes.
                console.debug('SAFAR EDGE measurement skipped an unsupported entity.', error);
            }
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

    function ensureMeasurementSheetForManualSync() {
        const sheets = getWorkbookSheets();
        if (!sheets.length) {
            return { ok: false, message: 'The spreadsheet is not ready yet. Open the Spreadsheet tab, wait for it to load, and try again.' };
        }

        // Always prefer a worksheet already carrying the exact measurement headings.
        let sheet = sheets.find(headerMatches);
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
        // This sheet was selected only because it already has the exact headings
        // or was empty, so it is safe to initialise its A:I header row.
        const headerChanged = ensureHeaders(sheet, order);
        const existing = readExistingRows(sheet);

        // Preserve Unit and Remarks when the same layer and dimensions already exist.
        rows.forEach(row => {
            const key = [row.description, row.length, row.width].join('|');
            const previous = existing.preserved.get(key);
            if (previous) {
                if (previous.unit !== '') row.unit = previous.unit;
                row.remarks = previous.remarks;
            }
        });

        // Clear only A:I measurement rows, leaving every other column untouched.
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
                item.length,
                item.width,
                '', // Height intentionally reserved for future 3D use.
                item.quantity,
                item.unit,
                item.remarks
            ];
            values.forEach((value, col) => writeCell(order, index + 1, col, value));
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

    function syncFromMenu() {
        if (!global.CAD || typeof global.CAD.createContext !== 'function') {
            return { ok: false, message: 'CAD is not ready. Wait for the drawing workspace to finish loading.' };
        }
        if (!global.luckysheet || typeof global.luckysheet.setCellValue !== 'function' ||
            typeof global.luckysheet.getAllSheets !== 'function') {
            return { ok: false, message: 'Spreadsheet is not ready. Open the Spreadsheet tab, wait for it to load, and retry.' };
        }
        if (isSyncing) return { ok: false, message: 'A measurement update is already running. Please wait.' };

        const ensured = ensureMeasurementSheetForManualSync();
        if (!ensured.ok) return ensured;

        let objects;
        let rows;
        try {
            const context = global.CAD.createContext();
            objects = context && typeof context.getObjects === 'function' ? context.getObjects() : [];
            const state = context && typeof context.getState === 'function' ? context.getState() : {};
            rows = buildMeasurementRows(objects, state.precision, getDisplayUnit(context));
        } catch (error) {
            return { ok: false, message: 'Unable to read CAD objects: ' + error.message };
        }

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
        note.textContent = 'Default: OFF. Manual update remains available by left-clicking MEASURE.';
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

    function getCurrentMeasurementSnapshot() {
        if (!global.CAD || typeof global.CAD.createContext !== 'function') return null;
        const context = global.CAD.createContext();
        const objects = context && typeof context.getObjects === 'function' ? context.getObjects() : [];
        const state = context && typeof context.getState === 'function' ? context.getState() : {};
        const rows = buildMeasurementRows(objects, state.precision, getDisplayUnit(context));
        const supportedCount = objects.reduce((count, object) => {
            try { return count + (getEntityKind(object) ? 1 : 0); }
            catch (_) { return count; }
        }, 0);
        return {
            objects: objects,
            rows: rows,
            supportedCount: supportedCount,
            signature: JSON.stringify({ supportedCount: supportedCount, rows: rows })
        };
    }

    function pollAutoUpdate() {
        if (!autoUpdateEnabled || isSyncing) return;
        if (!global.luckysheet || typeof global.luckysheet.setCellValue !== 'function') return;
        let snapshot;
        try {
            snapshot = getCurrentMeasurementSnapshot();
        } catch (error) {
            // Unsupported or irregular geometry is ignored without user-facing errors.
            console.debug('SAFAR EDGE measurement scan skipped an unsupported entity.', error);
            return;
        }
        if (!snapshot) return;
        if (snapshot.signature === lastAutoSignature) return;

        // Do not create an empty takeoff sheet merely because Auto Update was enabled
        // before the drawing contained any supported closed objects.
        if (snapshot.rows.length === 0 && !findMeasurementSheet()) {
            lastAutoSignature = snapshot.signature;
            return;
        }

        const result = syncFromMenu({ source: 'auto' });
        if (result && result.ok) lastAutoSignature = snapshot.signature;
    }

    function stopAutoUpdate() {
        if (autoUpdateTimer !== null) {
            global.clearInterval(autoUpdateTimer);
            autoUpdateTimer = null;
        }
    }

    function setAutoUpdateEnabled(enabled) {
        autoUpdateEnabled = !!enabled;
        try {
            global.localStorage.setItem(AUTO_UPDATE_STORAGE_KEY, autoUpdateEnabled ? '1' : '0');
        } catch (_) {}
        updateMeasureButton();
        if (autoUpdateEnabled) {
            lastAutoSignature = null;
            pollAutoUpdate();
            if (autoUpdateTimer === null) {
                autoUpdateTimer = global.setInterval(pollAutoUpdate, 900);
            }
        } else {
            stopAutoUpdate();
        }
        return autoUpdateEnabled;
    }

    function scheduleSync(delay) {
        if (!autoUpdateEnabled) return;
        if (syncTimer) global.clearTimeout(syncTimer);
        syncTimer = global.setTimeout(function () {
            syncTimer = null;
            pollAutoUpdate();
        }, Number.isFinite(Number(delay)) ? Number(delay) : 120);
    }

    function initialize() {
        // Automatic measurement updates are intentionally OFF unless the user
        // explicitly enabled them from the MEASURE status-button context menu.
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
        stopAutoUpdate();
        if (autoUpdateEnabled) {
            autoUpdateTimer = global.setInterval(pollAutoUpdate, 900);
            pollAutoUpdate();
        }
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
        getEntityKind: getEntityKind
    };
})(window);
