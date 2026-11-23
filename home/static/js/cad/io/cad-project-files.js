
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
    let isDirty = false;
    let openInput = null;

    // AutoSave writes directly to the active .est file when the browser
    // grants write access. Otherwise it keeps a local IndexedDB recovery copy.
    const RECOVERY_DB_NAME = 'SAFAREDGE_PROJECT_RECOVERY';
    const RECOVERY_STORE_NAME = 'snapshots';
    const RECOVERY_KEY = 'active-project';
    const AUTOSAVE_INTERVAL_KEY = 'safaredge.autosave.intervalSeconds';
    const DEFAULT_AUTOSAVE_SECONDS = 60;
    let autoSaveTimer = null;
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
                name: currentFileName.replace(/\.est$/i, '') || 'Untitled',
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString()
            },

            drawing: {
                units: state.units,
                precision: state.precision,
                limits: state.limits,
                dimensionSettings: global.CAD.Dimension.getSettings(),
                camera: getCameraData(),
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
    }

    function loadProjectData(data) {
        validateProject(data);
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

        // Restore the saved viewport.
        restoreCamera(data.drawing.camera);

        // Opening a project starts with a clean Undo/Redo history.
        context.resetHistory();
        context.setToolName('select');

        // Restore the complete Spreadsheet workbook.
        restoreSpreadsheet(data.spreadsheet.sheets);

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
            isDirty = false;
            lastAutoSavedVersion = dirtyVersion;
            await deleteRecoverySnapshot();

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
            await deleteRecoverySnapshot();

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
                isDirty = false;
                lastAutoSavedVersion = dirtyVersion;
                await deleteRecoverySnapshot();

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
        isDirty = false;
        lastAutoSavedVersion = dirtyVersion;
        await deleteRecoverySnapshot();

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
        // Keep the selected file handle only in this browser session.
        // Never carry a previously opened file into a fresh workspace.
        if (!handle) await deletePersistedFileHandle();

        isDirty = false;
        lastAutoSavedVersion = dirtyVersion;
        await deleteRecoverySnapshot();

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
        isDirty = false;
        lastAutoSavedVersion = dirtyVersion;
        deletePersistedFileHandle();
        deleteRecoverySnapshot();

        context.notify('New project created.');
    }

    function markDirty() {
        if (isRestoringProject) return;
        isDirty = true;
        dirtyVersion += 1;
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

    // File handles are intentionally not restored across page sessions.
    // A project becomes the active AutoSave target only after the user
    // explicitly opens it or chooses Save As in the current session.
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
                    lastAutoSavedVersion = versionBeingSaved;
                    if (dirtyVersion === versionBeingSaved) isDirty = false;
                    await deleteRecoverySnapshot();
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
                    getContext().notify('AutoSave recovery copy stored in this browser. Use Save As to create your .est file.');
                }
            }
        } catch (error) {
            console.error('SAFAR EDGE AutoSave failed:', error);
            try { getContext().notify('AutoSave failed: ' + error.message); } catch (_) {}
        } finally {
            autoSaveInProgress = false;
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
            const when = snapshot.savedAt ? new Date(snapshot.savedAt).toLocaleString() : 'an earlier session';
            const name = snapshot.fileName || 'Untitled project';
            if (!global.confirm('A local AutoSave recovery copy was found for "' + name + '" (' + when + ').\n\nRestore it now?')) {
                await deleteRecoverySnapshot();
                return;
            }
            isRestoringProject = true;
            try { loadProjectData(snapshot.data); }
            finally { isRestoringProject = false; }
            if (!currentFileHandle || currentFileName !== snapshot.fileName) {
                currentFileHandle = null;
                currentFileName = '';
            }
            isDirty = true;
            dirtyVersion += 1;
            lastAutoSavedVersion = dirtyVersion;
            recoveryNoticeShown = true;
            getContext().notify('Recovered local AutoSave copy. Use Save As to save it as an .est file.');
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

        isDirty: function () {
            return isDirty;
        }
    };

    // Register project shortcuts before the CAD engine's bubbling key handler.
    registerProjectShortcuts();

    // Start AutoSave after CAD and Luckysheet have completed initialization.
    global.addEventListener('load', async function () {
        // Do not reconnect this blank workspace to a file used in an earlier
        // session. AutoSave may target only a file explicitly opened/saved now.
        await deletePersistedFileHandle();
        startAutoSaveTimer();
        await offerRecoveryOnStartup();
    }, { once: true });

    // Register the .est operating-system launch receiver when supported.
    registerOperatingSystemFileHandler();

})(window);
