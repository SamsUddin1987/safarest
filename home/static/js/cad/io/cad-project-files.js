
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
            data: sheets
        });
    }

    function loadProjectData(data) {
        validateProject(data);

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
    }

    function downloadProject(data, filename) {
        const blob = new Blob(
            [JSON.stringify(data, null, 2)],
            { type: 'application/json' }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = filename.endsWith('.est')
            ? filename
            : filename + '.est';

        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);
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
        const data = buildProjectData();

        if (currentFileHandle) {
            await writeToHandle(currentFileHandle, data);
            isDirty = false;
            return;
        }

        return saveProjectAs();
    }

    async function saveProjectAs() {
        const data = buildProjectData();

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

            await writeToHandle(handle, data);

            currentFileHandle = handle;
            currentFileName = handle.name;
            isDirty = false;

            return;
        }

        // Firefox and unsupported-browser fallback.
        const filename = global.prompt(
            'Enter project filename:',
            currentFileName || 'Untitled.est'
        );

        if (!filename) return;

        const finalName = filename.toLowerCase().endsWith('.est')
            ? filename
            : filename + '.est';

        downloadProject(data, finalName);
        currentFileName = finalName;
        isDirty = false;
    }

    async function openProjectFile(file, handle = null) {
        const text = await file.text();
        const data = JSON.parse(text);

        loadProjectData(data);

        currentFileHandle = handle;
        currentFileName = file.name || handle?.name || 'Untitled.est';

        isDirty = false;

        global.CAD.createContext().notify(
            `Opened project: ${currentFileName}`
        );
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

        context.notify('New project created.');
    }

    function markDirty() {
        isDirty = true;
    }

    global.SAFAR_EDGE_DEFAULT_DIMENSION_SETTINGS =
        cloneJSON(global.CAD.Dimension.getSettings());

    global.SafarEdgeProjectFiles = {
        newProject,
        openProject,
        saveProject,
        saveProjectAs,
        markDirty,

        getCurrentFileName: function () {
            return currentFileName;
        },

        isDirty: function () {
            return isDirty;
        }
    };

})(window);
