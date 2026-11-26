
/* =========================================================
   SAFAR EDGE — LOCAL PROJECT FILE SYSTEM
   Native file extension: .est
   Storage: User's local computer (no server upload)
   ========================================================= */

(function (global) {
    'use strict';

    const FORMAT_ID = 'safaredge.est';
    const FORMAT_MAGIC = 'SAFAREDGE_EST';
    const FORMAT_VERSION = 1;

    let currentFileHandle = null;
    let currentFileName = '';
    let currentProjectId = null;

    function createProjectId() {
        if (global.crypto && typeof global.crypto.randomUUID === 'function') {
            return global.crypto.randomUUID();
        }
        return 'safar-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }
    let isDirty = false;
    let openInput = null;

    // AutoSave writes directly to the active .est file when the browser
    // grants write access. Otherwise it keeps a local IndexedDB recovery copy.
    const RECOVERY_DB_NAME = 'SAFAREDGE_PROJECT_RECOVERY';
    const RECOVERY_STORE_NAME = 'snapshots';
    const RECOVERY_KEY = 'active-project';
    const PERSISTED_FILE_HANDLE_KEY = 'active-file-handle';
    const ACTIVE_PROJECT_META_KEY = 'active-project-meta';
    const AUTOSAVE_INTERVAL_KEY = 'safaredge.autosave.intervalSeconds';
    const DEFAULT_AUTOSAVE_SECONDS = 60;
    let autoSaveTimer = null;
    let autoSaveDebounceTimer = null;
    let autoSaveInProgress = false;
    let isRestoringProject = false;
    let dirtyVersion = 0;
    let lastAutoSavedVersion = 0;
    let recoveryNoticeShown = false;
    let recoveryDbPromise = null;

    function getContext() {
        if (!global.CAD || typeof global.CAD.createContext !== 'function') {
            throw new Error('CAD engine is not initialized.');
        }
        return global.CAD.createContext();
    }

    function cloneJSON(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function getSpreadsheetSheets() {
        if (
            !global.luckysheet ||
            typeof global.luckysheet.getAllSheets !== 'function'
        ) {
            return [];
        }

        // getAllSheets() returns worksheet configurations suitable
        // for reinitializing Luckysheet.
        return cloneJSON(global.luckysheet.getAllSheets());
    }

    function getCameraData() {
        const camera = getContext().getCamera();

        if (!camera) return null;

        return {
            position: camera.position.toArray(),
            rotation: camera.rotation.toArray(),
            zoom: camera.zoom
        };
    }

    function buildProjectData() {
        if (!currentProjectId) currentProjectId = createProjectId();
        const context = getContext();
        const state = context.getState();
        const objects = context.getObjects();

        const entities = objects.map((object, index) => {
            if (!object || typeof object.toJSON !== 'function') {
                throw new Error(
                    `Drawing entity ${index + 1} cannot be serialized.`
                );
            }

            return object.toJSON();
        });

        return {
            magic: FORMAT_MAGIC,
            format: 'SAFAR EDGE Project',
            formatId: FORMAT_ID,
            formatVersion: FORMAT_VERSION,

            project: {
                id: currentProjectId,
                name: currentFileName.replace(/\.est$/i, '') || 'Untitled',
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString(),
                workspace: global.SafarEdgeSplitView &&
                    typeof global.SafarEdgeSplitView.getProjectSettings === 'function'
                    ? global.SafarEdgeSplitView.getProjectSettings()
                    : { splitViewEnabled: false, splitRatio: 0.5 }
            },

            drawing: {
                units: state.units,
                precision: state.precision,
                limits: state.limits,
                dimensionSettings: global.CAD.Dimension.getSettings(),
                camera: getCameraData(),
                viewMode: global.SafarEdge3D && typeof global.SafarEdge3D.getMode === 'function'
                    ? global.SafarEdge3D.getMode() : '2D',
                navigation3D: global.SafarEdge3D && typeof global.SafarEdge3D.getNavigationState === 'function'
                    ? global.SafarEdge3D.getNavigationState() : null,
                entities: entities
            },

            spreadsheet: {
                sheets: getSpreadsheetSheets()
            }
        };
    }

    function validateProject(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('The selected file is not a valid project.');
        }

        if (
            data.magic !== FORMAT_MAGIC ||
            data.formatId !== FORMAT_ID
        ) {
            throw new Error(
                'This is not a SAFAR EDGE .est project file.'
            );
        }

        if (Number(data.formatVersion) > FORMAT_VERSION) {
            throw new Error(
                'This project was created by a newer SAFAR EDGE version.'
            );
        }

        if (!data.drawing || !Array.isArray(data.drawing.entities)) {
            throw new Error('The project drawing data is incomplete.');
        }

        if (
            !data.spreadsheet ||
            !Array.isArray(data.spreadsheet.sheets)
        ) {
            throw new Error('The project Spreadsheet data is incomplete.');
        }
    }

    function disposeObject(object) {
        if (!object) return;

        object.traverse(function (child) {
            if (child.geometry) {
                child.geometry.dispose();
            }

            if (child.material) {
                const materials = Array.isArray(child.material)
                    ? child.material
                    : [child.material];

                materials.forEach(function (material) {
                    if (material) material.dispose();
                });
            }
        });
    }

    function restoreCamera(cameraData) {
        const camera = getContext().getCamera();

        if (!camera || !cameraData) {
            getContext().zoomExtents();
            return;
        }

        if (Array.isArray(cameraData.position)) {
            camera.position.fromArray(cameraData.position);
        }

        if (Array.isArray(cameraData.rotation)) {
            camera.rotation.fromArray(cameraData.rotation);
        }

        if (Number.isFinite(Number(cameraData.zoom))) {
            camera.zoom = Number(cameraData.zoom);
        }

        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
    }

    function restoreSpreadsheet(sheets) {
        if (
            !global.luckysheet ||
            typeof global.luckysheet.create !== 'function'
        ) {
            throw new Error('Spreadsheet engine is not available.');
        }

        if (typeof global.luckysheet.destroy === 'function') {
            global.luckysheet.destroy();
        }

        global.luckysheet.create({
            container: 'luckysheet',
            lang: 'en',
            showinfobar: false,
            showsheetbar: true,
            showstatisticBar: false,
            enableAddRow: true,
            allowCopy: true,
            showtoolbar: true,
            data: sheets,
            hook: createSpreadsheetHooks()
        });

        // Rebuild the CAD measurement schedule only after the restored
        // workbook has been created, so the existing project sheet is retained.
        global.setTimeout(function () {
            if (global.SafarEdgeMeasurements &&
                typeof global.SafarEdgeMeasurements.scheduleSync === 'function') {
                global.SafarEdgeMeasurements.scheduleSync(250);
            }
        }, 300);
    }

    function restoreCadCrosshairCursor() {
        // Reapply the same crosshair + centre-pickbox cursor used by the
        // normal selection state, including after loading an existing .est.
        if (global.SafarEdgeCadCursor && typeof global.SafarEdgeCadCursor.restore === 'function') {
            global.SafarEdgeCadCursor.restore();
            return;
        }
        const container = document.getElementById('cad-canvas-container');
        const canvas = container && container.querySelector('canvas');
        if (container) container.style.cursor = 'crosshair';
        if (canvas) canvas.style.cursor = 'crosshair';
    }

    function loadProjectData(data) {
        validateProject(data);
        currentProjectId = data.project && data.project.id
            ? String(data.project.id)
            : createProjectId();
        isRestoringProject = true;

        try {
        const context = getContext();

        if (
            !global.CAD.Dimension ||
            typeof global.CAD.Dimension.setSettings !== 'function'
        ) {
            throw new Error(
                'Dimension settings restore method is missing. ' +
                'Please complete Step 2 first.'
            );
        }

        if (
            typeof context.resetHistory !== 'function' ||
            typeof context.setDrawingSettings !== 'function'
        ) {
            throw new Error(
                'CAD project support methods are missing. ' +
                'Please check Step 1 in cad-core.js.'
            );
        }

        // Parse all entities before removing the current drawing.
        const loader = new global.THREE.ObjectLoader();

        const restoredObjects = data.drawing.entities.map(function (json) {
            return loader.parse(json);
        });

        // Restore project-specific settings.
        global.CAD.Dimension.setSettings(
            data.drawing.dimensionSettings
        );

        context.setDrawingSettings(
            data.drawing.units,
            data.drawing.precision
        );

        // Restore drawing limits.
        // Older .est projects without this property retain the default settings.
        if (data.drawing.limits) {
            context.setDrawingLimits(data.drawing.limits);
        } else {
            context.setDrawingLimits({
                active: false,
                minX: 0,
                minY: 0,
                maxX: 420,
                maxY: 297
            });
        }
        
        // Remove the current drawing and release its resources.
        context.clearSelection();

        context.getObjects().forEach(function (object) {
            context.removeEntity(object);
            disposeObject(object);
        });

        // Add restored entities without creating Undo history entries.
        restoredObjects.forEach(function (object) {
            context.addEntity(object, false);
        });

        global.CAD.Dimension.applyLayerStates();

        // Restore the saved viewport and its 2D / 3D navigation mode.
        restoreCamera(data.drawing.camera);
        if (global.SafarEdge3D && typeof global.SafarEdge3D.restoreNavigationState === 'function') {
            global.SafarEdge3D.restoreNavigationState(data.drawing.navigation3D || null);
        }
        if (global.SafarEdge3D && typeof global.SafarEdge3D.restoreMode === 'function') {
            global.SafarEdge3D.restoreMode(data.drawing.viewMode || '2D');
        }

        // Opening a project starts with a clean Undo/Redo history.
        context.resetHistory();
        context.setToolName('select');
        restoreCadCrosshairCursor();

        // Restore the complete Spreadsheet workbook.
        restoreSpreadsheet(data.spreadsheet.sheets);

        // Restore the CAD / Spreadsheet split layout saved in this .est file.
        if (global.SafarEdgeSplitView &&
            typeof global.SafarEdgeSplitView.restoreProjectSettings === 'function') {
            global.SafarEdgeSplitView.restoreProjectSettings(data.project.workspace);
        }

        isDirty = false;
        lastAutoSavedVersion = dirtyVersion;
        } finally {
            isRestoringProject = false;
        }
    }

    function downloadProject(data, filename) {
        const finalName = filename.toLowerCase().endsWith('.est')
            ? filename
            : filename + '.est';

        const blob = new Blob(
            [JSON.stringify(data, null, 2)],
            { type: 'application/json' }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = finalName;

        document.body.appendChild(link);
        link.click();
        link.remove();

        // Give the browser time to start the download.
        setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 1000);
    }

    async function writeToHandle(handle, data) {
        const writable = await handle.createWritable();

        try {
            await writable.write(
                new Blob(
                    [JSON.stringify(data, null, 2)],
                    { type: 'application/json' }
                )
            );

            await writable.close();
        } catch (error) {
            await writable.abort();
            throw error;
        }
    }

    async function saveProject() {
        // Chrome / Edge: overwrite the currently selected project file.
        if (currentFileHandle) {
            if (typeof currentFileHandle.queryPermission === 'function') {
                let permission = await currentFileHandle.queryPermission({ mode: 'readwrite' });
                if (permission !== 'granted' && typeof currentFileHandle.requestPermission === 'function') {
                    permission = await currentFileHandle.requestPermission({ mode: 'readwrite' });
                }
                if (permission !== 'granted') {
                    throw new Error('Write permission was not granted for ' + currentFileName + '. Use Save As to choose a writable project file.');
                }
            }
            const data = buildProjectData();
            await writeToHandle(currentFileHandle, data);
            await persistFileHandle(currentFileHandle);
            if (global.SafarEdgeSplitView &&
                typeof global.SafarEdgeSplitView.restoreForProject === 'function') {
                global.SafarEdgeSplitView.restoreForProject(
                    currentFileName,
                    snapshot.data.project && snapshot.data.project.workspace,
                    currentProjectId
                );
            }
            await persistActiveProjectMetadata(currentFileName);
            isDirty = false;
            lastAutoSavedVersion = dirtyVersion;
            // Keep a browser-local recovery image as well as the .est file.
            // This lets the same drawing return immediately after a hard refresh.
            await saveRecoverySnapshot(data);

            getContext().notify(
                'Project saved: ' + currentFileName
            );
            return;
        }

        // First save in any browser must go through Save As.
        if (!currentFileName) {
            return saveProjectAs();
        }

        // Firefox does not support the File System Access write API.
        // Save therefore downloads an updated copy using the same filename.
        if (typeof global.showSaveFilePicker !== 'function') {
            const data = buildProjectData();
            downloadProject(data, currentFileName);
            isDirty = false;
            lastAutoSavedVersion = dirtyVersion;
            currentFileHandle = null;
            await deletePersistedFileHandle();
            await persistActiveProjectMetadata(currentFileName);
            // Firefox downloads a new copy instead of overwriting the opened
            // file. Retain the exact current state locally for refresh recovery.
            await saveRecoverySnapshot(data);

            getContext().notify(
                'Updated project download started: ' + currentFileName
            );
            return;
        }

        // If a previously opened/saved handle is unavailable, ask the user
        // to select a file again rather than silently saving somewhere else.
        return saveProjectAs();
    }

    async function saveProjectAs() {
        // Chrome / Edge: use the native file picker and retain its handle.
        if (typeof global.showSaveFilePicker === 'function') {
            const handle = await global.showSaveFilePicker({
                suggestedName: currentFileName || 'Untitled.est',
                types: [{
                    description: 'SAFAR EDGE Project',
                    accept: {
                        'application/json': ['.est']
                    }
                }]
            });

            const previousHandle = currentFileHandle;
            const previousName = currentFileName;

            try {
                // Set the candidate name before building project metadata.
                currentFileName = handle.name;
                const data = buildProjectData();

                await writeToHandle(handle, data);

                currentFileHandle = handle;
                currentFileName = handle.name;
                await persistFileHandle(handle);
                await persistActiveProjectMetadata(currentFileName);
                isDirty = false;
                lastAutoSavedVersion = dirtyVersion;
                await saveRecoverySnapshot(data);

                getContext().notify(
                    'Project saved: ' + currentFileName
                );
            } catch (error) {
                currentFileHandle = previousHandle;
                currentFileName = previousName;
                throw error;
            }

            return;
        }

        // Firefox fallback: initiate a download without a JavaScript prompt.
        // The browser controls the download folder and any save confirmation.
        const filename = currentFileName || 'Untitled.est';
        const data = buildProjectData();

        downloadProject(data, filename);
        currentFileName = filename;
        currentFileHandle = null;
        isDirty = false;
        lastAutoSavedVersion = dirtyVersion;
        await deletePersistedFileHandle();
        await persistActiveProjectMetadata(currentFileName);
        await saveRecoverySnapshot(data);

        getContext().notify(
            'Project download started: ' + currentFileName
        );
    }

    async function openProjectFile(file, handle = null) {
        const text = await file.text();
        const data = JSON.parse(text);

        loadProjectData(data);

        currentFileHandle = handle;
        currentFileName = file.name || handle?.name || 'Untitled.est';
        if (global.SafarEdgeSplitView &&
            typeof global.SafarEdgeSplitView.restoreForProject === 'function') {
            global.SafarEdgeSplitView.restoreForProject(
                currentFileName,
                data.project && data.project.workspace,
                currentProjectId
            );
        }
        // Keep the actual FileSystemFileHandle in IndexedDB so Save and
        // AutoSave can continue targeting this same .est file after refresh.
        if (handle) await persistFileHandle(handle);
        else await deletePersistedFileHandle();
        await persistActiveProjectMetadata(currentFileName);
        restoreCadCrosshairCursor();

        isDirty = false;
        lastAutoSavedVersion = dirtyVersion;
        // Seed recovery as soon as an existing project is opened. This is
        // essential in Firefox, where a file handle cannot be retained.
        await saveRecoverySnapshot(buildProjectData());

        global.CAD.createContext().notify(
            `Opened project: ${currentFileName}`
        );
    }

    // Receive .est files opened from Windows through an installed
    // Chromium-based SAFAR EDGE PWA (Chrome / Edge desktop).
    function registerOperatingSystemFileHandler() {
        if (
            !('launchQueue' in global) ||
            typeof global.launchQueue.setConsumer !== 'function'
        ) {
            return;
        }

        global.launchQueue.setConsumer(async function (launchParams) {
            const handles = launchParams && launchParams.files;
            if (!handles || !handles.length) return;

            try {
                // Wait until the CAD and Spreadsheet workspace has completed
                // its DOMContentLoaded initialization before restoring data.
                if (document.readyState === 'loading') {
                    await new Promise(function (resolve) {
                        document.addEventListener(
                            'DOMContentLoaded', resolve, { once: true }
                        );
                    });
                }

                if (handles.length !== 1) {
                    throw new Error(
                        'Please open one SAFAR EDGE .est project at a time.'
                    );
                }

                if (isDirty && !global.confirm(
                    'Discard unsaved project changes and open the selected file?'
                )) {
                    return;
                }

                const handle = handles[0];
                if (!handle || handle.kind !== 'file') {
                    throw new Error('The launched item is not a file.');
                }

                const file = await handle.getFile();
                if (!file.name || !file.name.toLowerCase().endsWith('.est')) {
                    throw new Error('Only SAFAR EDGE .est project files can be opened here.');
                }

                await openProjectFile(file, handle);
            } catch (error) {
                global.alert('Unable to open launched project:\n' + error.message);
            }
        });
    }

    function getOpenInput() {
        if (openInput) return openInput;

        openInput = document.createElement('input');
        openInput.type = 'file';
        openInput.accept = '.est,application/json';
        openInput.style.display = 'none';

        document.body.appendChild(openInput);

        openInput.addEventListener('change', async function () {
            const file = openInput.files && openInput.files[0];

            if (!file) return;

            try {
                await openProjectFile(file);
            } catch (error) {
                global.alert('Unable to open project:\n' + error.message);
            }

            openInput.value = '';
        });

        return openInput;
    }

    async function openProject() {
        if (
            isDirty &&
            !global.confirm('Discard unsaved project changes?')
        ) {
            return;
        }

        if (typeof global.showOpenFilePicker === 'function') {
            const handles = await global.showOpenFilePicker({
                multiple: false,
                types: [{
                    description: 'SAFAR EDGE Project',
                    accept: {
                        'application/json': ['.est']
                    }
                }]
            });

            const handle = handles[0];
            const file = await handle.getFile();

            await openProjectFile(file, handle);
            return;
        }

        // Firefox fallback.
        getOpenInput().click();
    }

    function createBlankSpreadsheet() {
        restoreSpreadsheet([{
            name: 'Sheet1',
            color: '',
            index: '0',
            status: 1,
            order: '0',
            row: 36,
            column: 18,
            celldata: [],
            config: {}
        }]);
    }

    function newProject() {
        if (
            isDirty &&
            !global.confirm('Discard unsaved project changes and create a new project?')
        ) {
            return;
        }

        const context = getContext();

        context.clearSelection();

        context.getObjects().forEach(function (object) {
            context.removeEntity(object);
            disposeObject(object);
        });

        global.CAD.Dimension.setSettings(
            cloneJSON(global.SAFAR_EDGE_DEFAULT_DIMENSION_SETTINGS)
        );

        context.setDrawingSettings('mm', 2);
        context.resetHistory();
        context.setToolName('select');

        createBlankSpreadsheet();
        context.zoomExtents();

        currentFileHandle = null;
        currentFileName = '';
        currentProjectId = null;
        if (global.SafarEdgeSplitView &&
            typeof global.SafarEdgeSplitView.restoreProjectSettings === 'function') {
            global.SafarEdgeSplitView.restoreProjectSettings({ splitViewEnabled: false, splitRatio: 0.5 });
        }
        isDirty = false;
        lastAutoSavedVersion = dirtyVersion;
        deletePersistedFileHandle();
        deleteActiveProjectMetadata();
        deleteRecoverySnapshot();

        context.notify('New project created.');
    }

    function scheduleRecoveryAutoSave(delay = 350) {
        if (autoSaveDebounceTimer) global.clearTimeout(autoSaveDebounceTimer);
        autoSaveDebounceTimer = global.setTimeout(function () {
            autoSaveDebounceTimer = null;
            autoSaveProject();
        }, delay);
    }

    function markDirty() {
        if (isRestoringProject) return;
        isDirty = true;
        dirtyVersion += 1;
        // Save a local recovery snapshot shortly after each completed edit.
        // This avoids losing recent work when the user refreshes before the
        // normal periodic AutoSave interval has elapsed.
        scheduleRecoveryAutoSave();
    }

    function createSpreadsheetHooks() {
        // These are Luckysheet hooks (not Handsontable hooks).
        // `updated` runs after workbook operations recorded in Luckysheet
        // history, including edits, formatting, paste, row/column changes,
        // sheet operations, and undo/redo.
        const changed = function () {
            markDirty();
        };

        return {
            cellUpdated: changed,
            updated: changed,
            sheetCreateAfter: changed,
            sheetDeleteAfter: changed,
            sheetMoveAfter: changed,
            sheetEditNameAfter: changed,
            sheetEditColorAfter: changed
        };
    }

    function getAutoSaveIntervalSeconds() {
        try {
            const value = Number(global.localStorage.getItem(AUTOSAVE_INTERVAL_KEY));
            if (Number.isFinite(value) && value >= 15 && value <= 600) return Math.round(value);
        } catch (_) {}
        return DEFAULT_AUTOSAVE_SECONDS;
    }

    function setAutoSaveIntervalSeconds(seconds) {
        const value = Math.round(Number(seconds));
        if (!Number.isFinite(value) || value < 15 || value > 600) {
            throw new Error('AutoSave interval must be between 15 and 600 seconds.');
        }
        global.localStorage.setItem(AUTOSAVE_INTERVAL_KEY, String(value));
        startAutoSaveTimer();
        getContext().notify('AutoSave interval set to ' + value + ' seconds.');
        return value;
    }

    function openRecoveryDatabase() {
        if (!global.indexedDB) return Promise.resolve(null);
        if (recoveryDbPromise) return recoveryDbPromise;
        recoveryDbPromise = new Promise(function (resolve, reject) {
            const request = global.indexedDB.open(RECOVERY_DB_NAME, 1);
            request.onupgradeneeded = function () {
                const db = request.result;
                if (!db.objectStoreNames.contains(RECOVERY_STORE_NAME)) {
                    db.createObjectStore(RECOVERY_STORE_NAME, { keyPath: 'id' });
                }
            };
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error || new Error('Could not open local recovery storage.')); };
        });
        return recoveryDbPromise;
    }

    // A writable file handle is retained in IndexedDB where the browser
    // supports the File System Access API. The active filename is stored
    // separately for browsers that can only save by downloading a copy.
    async function deletePersistedFileHandle() {
        try {
            const db = await openRecoveryDatabase();
            if (!db) return;
            await new Promise(function (resolve, reject) {
                const tx = db.transaction(RECOVERY_STORE_NAME, 'readwrite');
                tx.objectStore(RECOVERY_STORE_NAME).delete('active-file-handle');
                tx.oncomplete = resolve;
                tx.onerror = function () { reject(tx.error); };
                tx.onabort = function () { reject(tx.error); };
            });
        } catch (error) {
            console.warn('SAFAR EDGE saved file handle cleanup failed:', error);
        }
    }

    async function persistActiveProjectMetadata(fileName) {
        try {
            const db = await openRecoveryDatabase();
            if (!db) return false;
            await new Promise(function (resolve, reject) {
                const tx = db.transaction(RECOVERY_STORE_NAME, 'readwrite');
                tx.objectStore(RECOVERY_STORE_NAME).put({
                    id: ACTIVE_PROJECT_META_KEY,
                    fileName: fileName || '',
                    savedAt: new Date().toISOString()
                });
                tx.oncomplete = resolve;
                tx.onerror = function () { reject(tx.error || new Error('Could not remember the active project name.')); };
                tx.onabort = function () { reject(tx.error || new Error('Remembering the active project name was cancelled.')); };
            });
            return true;
        } catch (error) {
            console.warn('SAFAR EDGE could not persist the active project name:', error);
            return false;
        }
    }

    async function deleteActiveProjectMetadata() {
        try {
            const db = await openRecoveryDatabase();
            if (!db) return;
            await new Promise(function (resolve, reject) {
                const tx = db.transaction(RECOVERY_STORE_NAME, 'readwrite');
                tx.objectStore(RECOVERY_STORE_NAME).delete(ACTIVE_PROJECT_META_KEY);
                tx.oncomplete = resolve;
                tx.onerror = function () { reject(tx.error); };
                tx.onabort = function () { reject(tx.error); };
            });
        } catch (error) {
            console.warn('SAFAR EDGE active project metadata cleanup failed:', error);
        }
    }

    async function restorePersistedProjectMetadata() {
        try {
            const db = await openRecoveryDatabase();
            if (!db) return;
            const record = await new Promise(function (resolve, reject) {
                const tx = db.transaction(RECOVERY_STORE_NAME, 'readonly');
                const request = tx.objectStore(RECOVERY_STORE_NAME).get(ACTIVE_PROJECT_META_KEY);
                request.onsuccess = function () { resolve(request.result || null); };
                request.onerror = function () { reject(request.error || new Error('Could not read the active project name.')); };
            });
            if (record && typeof record.fileName === 'string') {
                currentFileName = record.fileName;
            }
        } catch (error) {
            console.warn('SAFAR EDGE could not restore the active project name:', error);
        }
    }

    async function persistFileHandle(handle) {
        if (!handle || typeof handle.getFile !== 'function') return false;
        try {
            const db = await openRecoveryDatabase();
            if (!db) return false;
            await new Promise(function (resolve, reject) {
                const tx = db.transaction(RECOVERY_STORE_NAME, 'readwrite');
                tx.objectStore(RECOVERY_STORE_NAME).put({
                    id: PERSISTED_FILE_HANDLE_KEY,
                    handle: handle,
                    fileName: handle.name || currentFileName,
                    savedAt: new Date().toISOString()
                });
                tx.oncomplete = resolve;
                tx.onerror = function () { reject(tx.error || new Error('Could not remember the active project file.')); };
                tx.onabort = function () { reject(tx.error || new Error('Remembering the active project file was cancelled.')); };
            });
            return true;
        } catch (error) {
            // Saving the drawing must continue even if the browser disallows
            // persisting a FileSystemFileHandle in IndexedDB.
            console.warn('SAFAR EDGE could not persist the active file handle:', error);
            return false;
        }
    }

    async function restorePersistedFileHandle() {
        try {
            const db = await openRecoveryDatabase();
            if (!db) return false;
            const record = await new Promise(function (resolve, reject) {
                const tx = db.transaction(RECOVERY_STORE_NAME, 'readonly');
                const request = tx.objectStore(RECOVERY_STORE_NAME).get(PERSISTED_FILE_HANDLE_KEY);
                request.onsuccess = function () { resolve(request.result || null); };
                request.onerror = function () { reject(request.error || new Error('Could not read the active project file handle.')); };
            });
            const handle = record && record.handle;
            if (!handle || handle.kind !== 'file' || typeof handle.getFile !== 'function') {
                if (record) await deletePersistedFileHandle();
                return false;
            }
            currentFileHandle = handle;
            currentFileName = handle.name || record.fileName || 'Untitled.est';
            // Do not request permission during page load. Save (a user action)
            // can request it if the browser reports "prompt".
            return true;
        } catch (error) {
            console.warn('SAFAR EDGE could not restore the active project file:', error);
            currentFileHandle = null;
            return false;
        }
    }

    async function restorePersistedProjectState() {
        await restorePersistedProjectMetadata();
        await restorePersistedFileHandle();
    }

    async function saveRecoverySnapshot(data) {
        const db = await openRecoveryDatabase();
        if (!db) return false;
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(RECOVERY_STORE_NAME, 'readwrite');
            tx.objectStore(RECOVERY_STORE_NAME).put({
                id: RECOVERY_KEY,
                savedAt: new Date().toISOString(),
                fileName: currentFileName || 'Unsaved project',
                data: data
            });
            tx.oncomplete = function () { resolve(true); };
            tx.onerror = function () { reject(tx.error || new Error('Could not write the local recovery copy.')); };
            tx.onabort = function () { reject(tx.error || new Error('Local recovery write was cancelled.')); };
        });
    }

    async function readRecoverySnapshot() {
        const db = await openRecoveryDatabase();
        if (!db) return null;
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(RECOVERY_STORE_NAME, 'readonly');
            const request = tx.objectStore(RECOVERY_STORE_NAME).get(RECOVERY_KEY);
            request.onsuccess = function () { resolve(request.result || null); };
            request.onerror = function () { reject(request.error || new Error('Could not read the local recovery copy.')); };
        });
    }

    async function deleteRecoverySnapshot() {
        try {
            const db = await openRecoveryDatabase();
            if (!db) return;
            await new Promise(function (resolve, reject) {
                const tx = db.transaction(RECOVERY_STORE_NAME, 'readwrite');
                tx.objectStore(RECOVERY_STORE_NAME).delete(RECOVERY_KEY);
                tx.oncomplete = resolve;
                tx.onerror = function () { reject(tx.error); };
                tx.onabort = function () { reject(tx.error); };
            });
            recoveryNoticeShown = false;
        } catch (error) {
            console.warn('SAFAR EDGE recovery cleanup failed:', error);
        }
    }

    async function autoSaveProject() {
        if (!isDirty || autoSaveInProgress || dirtyVersion <= lastAutoSavedVersion) return;
        autoSaveInProgress = true;
        const versionBeingSaved = dirtyVersion;

        try {
            const data = buildProjectData();

            // If a project file is open and write permission is already granted,
            // update that exact .est file. Do not trigger permission prompts in a timer.
            if (currentFileHandle && typeof currentFileHandle.createWritable === 'function') {
                let permission = 'granted';
                if (typeof currentFileHandle.queryPermission === 'function') {
                    permission = await currentFileHandle.queryPermission({ mode: 'readwrite' });
                }
                if (permission === 'granted') {
                    await writeToHandle(currentFileHandle, data);
                    // Persist the browser recovery copy before marking this
                    // version clean. If IndexedDB fails, the retry path below
                    // remains active instead of silently losing refresh recovery.
                    await saveRecoverySnapshot(data);
                    lastAutoSavedVersion = versionBeingSaved;
                    if (dirtyVersion === versionBeingSaved) isDirty = false;
                    getContext().notify('AutoSaved: ' + currentFileName);
                    return;
                }
            }

            // No file handle / no silent write permission: keep a recovery copy
            // in this browser's IndexedDB. This is local to this browser profile.
            const stored = await saveRecoverySnapshot(data);
            if (stored) {
                lastAutoSavedVersion = versionBeingSaved;
                if (!recoveryNoticeShown) {
                    recoveryNoticeShown = true;
                    getContext().notify(currentFileHandle
                        ? 'AutoSave recovery copy stored locally. Use Save to retry writing ' + currentFileName + '.'
                        : 'AutoSave recovery copy stored locally. Use Save to download an updated .est copy of ' + (currentFileName || 'this project') + '.');
                }
            }
        } catch (error) {
            console.error('SAFAR EDGE AutoSave failed:', error);
            // If writing the selected .est file fails (for example, the
            // browser revoked file permission), fall back to a local snapshot
            // so a refresh still cannot discard the current drawing.
            try {
                const fallbackData = buildProjectData();
                const stored = await saveRecoverySnapshot(fallbackData);
                if (stored) {
                    lastAutoSavedVersion = versionBeingSaved;
                    recoveryNoticeShown = true;
                    getContext().notify('File AutoSave was unavailable; your working copy was saved in browser recovery storage.');
                } else {
                    getContext().notify('AutoSave failed: ' + error.message);
                }
            } catch (recoveryError) {
                console.error('SAFAR EDGE recovery fallback failed:', recoveryError);
                try { getContext().notify('AutoSave failed: ' + recoveryError.message); } catch (_) {}
            }
        } finally {
            autoSaveInProgress = false;
            if (isDirty && dirtyVersion > lastAutoSavedVersion) {
                scheduleRecoveryAutoSave(500);
            }
        }
    }

    function startAutoSaveTimer() {
        if (autoSaveTimer) global.clearInterval(autoSaveTimer);
        autoSaveTimer = global.setInterval(autoSaveProject, getAutoSaveIntervalSeconds() * 1000);
    }

    async function offerRecoveryOnStartup() {
        try {
            const snapshot = await readRecoverySnapshot();
            if (!snapshot || !snapshot.data) return;

            const snapshotName = snapshot.fileName || 'Untitled project';
            const activeName = currentFileName || '';
            const sameActiveProject = !activeName || activeName === snapshotName;

            // When the recovery belongs to the active project, restore it
            // automatically. A hard refresh should not require the user to
            // remember to reopen the same .est file or accept a recovery prompt.
            if (!sameActiveProject && !global.confirm(
                'A local AutoSave recovery copy was found for "' + snapshotName + '".\n\n' +
                'The currently remembered project is "' + activeName + '". Restore the recovery copy?'
            )) {
                // Never delete a recovery copy merely because the user chooses
                // not to restore it on this page load.
                getContext().notify('Recovery copy for ' + snapshotName + ' was kept locally.');
                return;
            }

            isRestoringProject = true;
            try { loadProjectData(snapshot.data); }
            finally { isRestoringProject = false; }

            // Keep an unsaved drawing unnamed so its first Save still opens
            // Save As; named existing projects retain their original filename.
            if (snapshotName !== 'Unsaved project' && (!currentFileName || currentFileName !== snapshotName)) {
                currentFileName = snapshotName;
            }
            await persistActiveProjectMetadata(currentFileName);
            isDirty = false;
            lastAutoSavedVersion = dirtyVersion;
            recoveryNoticeShown = true;
            restoreCadCrosshairCursor();
            getContext().notify('Restored your latest local working copy: ' + currentFileName + '.');
        } catch (error) {
            console.error('SAFAR EDGE recovery restore failed:', error);
            global.alert('Unable to restore AutoSave recovery copy: ' + error.message);
        }
    }

    function registerProjectShortcuts() {
        global.addEventListener('keydown', function (event) {
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
            const key = String(event.key || '').toLowerCase();
            if (key !== 's' && key !== 'o') return;
            if (!document.getElementById('cad-canvas-container')) return;

            event.preventDefault();
            event.stopImmediatePropagation();

            const run = key === 'o'
                ? openProject()
                : (event.shiftKey ? saveProjectAs() : saveProject());
            Promise.resolve(run).catch(function (error) {
                if (error && error.name !== 'AbortError') {
                    global.alert((key === 'o' ? 'Unable to open project: ' : 'Unable to save project: ') + error.message);
                }
            });
        }, true);
    }

    global.SAFAR_EDGE_DEFAULT_DIMENSION_SETTINGS =
        cloneJSON(global.CAD.Dimension.getSettings());

    global.SafarEdgeProjectFiles = {
        newProject,
        openProject,
        saveProject,
        saveProjectAs,
        markDirty,
        createSpreadsheetHooks,
        getAutoSaveIntervalSeconds,
        setAutoSaveIntervalSeconds,
        autoSaveNow: autoSaveProject,

        getCurrentFileName: function () {
            return currentFileName;
        },

        getCurrentProjectId: function () {
            return currentProjectId;
        },

        isDirty: function () {
            return isDirty;
        }
    };

    // Register project shortcuts before the CAD engine's bubbling key handler.
    registerProjectShortcuts();

    // Start AutoSave after CAD and Luckysheet have completed initialization.
    global.addEventListener('load', async function () {
        // Restore the previously opened .est handle so Save and AutoSave keep
        // writing to the same file after a hard refresh.
        await restorePersistedProjectState();
        startAutoSaveTimer();
        await offerRecoveryOnStartup();
    }, { once: true });

    // Flush pending edits when the user switches tabs or refreshes/closes.
    // The debounced save above is the primary protection; these lifecycle
    // hooks provide an additional best-effort final snapshot.
    global.addEventListener('pagehide', function () {
        if (autoSaveDebounceTimer) {
            global.clearTimeout(autoSaveDebounceTimer);
            autoSaveDebounceTimer = null;
        }
        autoSaveProject();
    });

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') autoSaveProject();
    });

    // Register the .est operating-system launch receiver when supported.
    registerOperatingSystemFileHandler();

})(window);
