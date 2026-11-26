/**
 * SAFAR EDGE — CAD / SPREADSHEET SIDE-BY-SIDE VIEW
 * The divider can be dragged to change the space shared by both workspaces.
 */
(function (global) {
    'use strict';

    const MIN_PANE_PX = 280;
    let enabled = false;
    let previousTab = 'cad';
    let divider = null;
    let content = null;
    let cadPane = null;
    let sheetPane = null;
    let cadCanvasContainer = null;
    let splitButton = null;
    let ratio = 0.5;
    let dragState = null;
    let resizeFrame = 0;

    const FILE_SETTINGS_PREFIX = 'safaredge.workspace.settings.file:';

    function fileSettingsKeys(fileName, projectId) {
        const keys = [];
        if (projectId) keys.push(FILE_SETTINGS_PREFIX + 'id:' + encodeURIComponent(String(projectId)));
        const name = String(fileName || '').trim().toLowerCase();
        if (name) keys.push(FILE_SETTINGS_PREFIX + 'name:' + encodeURIComponent(name));
        return keys;
    }

    function persistBrowserSettingForCurrentFile() {
        const manager = global.SafarEdgeProjectFiles;
        const fileName = manager && typeof manager.getCurrentFileName === 'function'
            ? manager.getCurrentFileName()
            : '';
        const projectId = manager && typeof manager.getCurrentProjectId === 'function'
            ? manager.getCurrentProjectId()
            : '';
        const keys = fileSettingsKeys(fileName, projectId);
        if (!keys.length) return;
        const payload = JSON.stringify({ splitViewEnabled: enabled, splitRatio: ratio });
        try {
            keys.forEach(key => global.localStorage.setItem(key, payload));
        } catch (error) {
            console.warn('Unable to persist workspace layout in browser storage:', error);
        }
    }

    function saveProjectSettingChange() {
        persistBrowserSettingForCurrentFile();
        const manager = global.SafarEdgeProjectFiles;
        if (manager && typeof manager.markDirty === 'function') {
            manager.markDirty();
        }
    }

    function setTabsDisabled(disabled) {
        ['tab-cad', 'tab-spreadsheet'].forEach(id => {
            const tab = document.getElementById(id);
            if (!tab) return;
            tab.disabled = !!disabled;
            tab.setAttribute('aria-disabled', disabled ? 'true' : 'false');
            if (disabled) tab.title = 'Both workspaces are visible in Split mode';
            else tab.removeAttribute('title');
        });
    }

    function resizeWorkspaces() {
        if (resizeFrame) global.cancelAnimationFrame(resizeFrame);
        resizeFrame = global.requestAnimationFrame(function () {
            resizeFrame = 0;
            if (global.luckysheet && typeof global.luckysheet.resize === 'function') {
                try { global.luckysheet.resize(); } catch (_) {}
            }
        });
    }

    function applyRatio() {
        if (!content || !cadPane || !sheetPane) return;
        const available = content.clientWidth;
        if (available > 0) {
            const minRatio = Math.min(0.45, MIN_PANE_PX / available);
            ratio = Math.max(minRatio, Math.min(1 - minRatio, ratio));
        }
        cadPane.style.flexBasis = `calc((100% - 7px) * ${ratio})`;
        sheetPane.style.flexBasis = `calc((100% - 7px) * ${1 - ratio})`;

        // Keep the CAD canvas at the same full workspace width it had before
        // Split mode. Center-crop the hidden left/right portions evenly inside
        // the narrower CAD pane. This preserves the camera, zoom, origin, pointer mapping and drawing
        // appearance; changing divider position must not resize the CAD renderer.
        if (cadCanvasContainer) {
            if (enabled) {
                const fullCanvasWidth = content.clientWidth;
                const centeredCropOffset = Math.max(
                    0,
                    (fullCanvasWidth - cadPane.clientWidth) / 2
                );
                cadCanvasContainer.style.width = `${fullCanvasWidth}px`;
                cadCanvasContainer.style.left = `-${centeredCropOffset}px`;
            } else {
                cadCanvasContainer.style.width = '';
                cadCanvasContainer.style.left = '';
            }
        }

        if (divider) divider.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    }

    function setActiveTab(tab) {
        document.querySelectorAll('.app-tab').forEach(el => el.classList.remove('active'));
        const target = document.getElementById(tab === 'spreadsheet' ? 'tab-spreadsheet' : 'tab-cad');
        if (target) target.classList.add('active');
    }

    function createDivider() {
        if (divider) return divider;
        divider = document.createElement('div');
        divider.id = 'cad-spreadsheet-split-divider';
        divider.className = 'workspace-split-divider';
        divider.setAttribute('role', 'separator');
        divider.setAttribute('aria-orientation', 'vertical');
        divider.setAttribute('aria-label', 'Resize CAD and spreadsheet panels');
        divider.setAttribute('aria-valuemin', '25');
        divider.setAttribute('aria-valuemax', '75');
        divider.setAttribute('tabindex', '0');

        divider.addEventListener('pointerdown', event => {
            if (!enabled || event.button !== 0) return;
            event.preventDefault();
            dragState = { pointerId: event.pointerId };
            divider.setPointerCapture(event.pointerId);
            divider.classList.add('dragging');
            document.body.classList.add('workspace-split-resizing');
        });

        divider.addEventListener('pointermove', event => {
            if (!dragState || dragState.pointerId !== event.pointerId) return;
            const rect = content.getBoundingClientRect();
            const x = Math.max(MIN_PANE_PX, Math.min(rect.width - MIN_PANE_PX, event.clientX - rect.left));
            ratio = x / rect.width;
            applyRatio();
            resizeWorkspaces();
        });

        const stopDrag = event => {
            if (!dragState || (event && event.pointerId !== undefined && dragState.pointerId !== event.pointerId)) return;
            dragState = null;
            divider.classList.remove('dragging');
            document.body.classList.remove('workspace-split-resizing');
            saveProjectSettingChange();
            resizeWorkspaces();
        };
        divider.addEventListener('pointerup', stopDrag);
        divider.addEventListener('pointercancel', stopDrag);
        divider.addEventListener('lostpointercapture', stopDrag);

        divider.addEventListener('keydown', event => {
            if (!enabled || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            ratio = Math.max(0.25, Math.min(0.75, ratio + (event.key === 'ArrowRight' ? 0.02 : -0.02)));
            applyRatio();
            saveProjectSettingChange();
            resizeWorkspaces();
        });
        return divider;
    }

    function ensureElements() {
        content = document.querySelector('.app-content-area');
        cadPane = document.getElementById('cad-pane');
        sheetPane = document.getElementById('spreadsheet-pane');
        cadCanvasContainer = document.getElementById('cad-canvas-container');
        splitButton = document.getElementById('cad-st-split-view');
        if (!content || !cadPane || !sheetPane) return false;
        if (!divider) {
            divider = createDivider();
            content.insertBefore(divider, sheetPane);
        }
        return true;
    }

    function setEnabled(value) {
        if (!ensureElements()) return false;
        const next = !!value;
        splitButton = document.getElementById('cad-st-split-view');
        if (next === enabled) return enabled;

        if (next) {
            const active = document.querySelector('.app-tab.active');
            previousTab = active && active.id === 'tab-spreadsheet' ? 'spreadsheet' : 'cad';
            enabled = true;
            content.classList.add('split-view-active');
            cadPane.classList.add('split-view-pane');
            sheetPane.classList.add('split-view-pane');
            cadPane.style.overflow = 'hidden';
            cadPane.classList.add('active');
            sheetPane.classList.add('active');
            divider.hidden = false;
            setActiveTab('cad');
            setTabsDisabled(true);
            if (splitButton) {
                splitButton.classList.add('active');
                splitButton.setAttribute('aria-pressed', 'true');
            }
            applyRatio();
            const status = document.getElementById('cad-status-bar');
            if (status) status.style.display = 'flex';
            resizeWorkspaces();
        } else {
            enabled = false;
            content.classList.remove('split-view-active');
            cadPane.classList.remove('split-view-pane');
            sheetPane.classList.remove('split-view-pane');
            cadPane.style.overflow = '';
            if (cadCanvasContainer) cadCanvasContainer.style.width = '';
            divider.hidden = true;
            if (splitButton) {
                splitButton.classList.remove('active');
                splitButton.setAttribute('aria-pressed', 'false');
            }
            setTabsDisabled(false);
            if (typeof global.switchAppTab === 'function') global.switchAppTab(previousTab);
            resizeWorkspaces();
        }
        return enabled;
    }

    function toggle() {
        const result = setEnabled(!enabled);
        saveProjectSettingChange();
        return result;
    }

    function getProjectSettings() {
        return {
            splitViewEnabled: enabled,
            splitRatio: ratio
        };
    }

    function restoreProjectSettings(settings) {
        const value = settings && typeof settings === 'object' ? settings : {};
        const restoredRatio = Number(value.splitRatio);
        ratio = Number.isFinite(restoredRatio)
            ? Math.max(0.25, Math.min(0.75, restoredRatio))
            : 0.5;
        setEnabled(value.splitViewEnabled === true);
        applyRatio();
        resizeWorkspaces();
    }

    function restoreForProject(fileName, embeddedSettings, projectId) {
        let settings = embeddedSettings;
        const keys = fileSettingsKeys(fileName, projectId);
        try {
            // Prefer the stable project ID; filename is the fallback for older
            // .est files that have not yet been saved with an ID.
            for (const key of keys) {
                const saved = global.localStorage.getItem(key);
                if (saved) {
                    settings = JSON.parse(saved);
                    break;
                }
            }
        } catch (error) {
            console.warn('Unable to read saved workspace layout:', error);
        }
        restoreProjectSettings(settings);
        const payload = JSON.stringify(getProjectSettings());
        try {
            keys.forEach(key => {
                if (!global.localStorage.getItem(key)) global.localStorage.setItem(key, payload);
            });
        } catch (_) {}
    }

    global.addEventListener('resize', function () {
        if (!enabled) return;
        applyRatio();
        if (global.luckysheet && typeof global.luckysheet.resize === 'function') {
            try { global.luckysheet.resize(); } catch (_) {}
        }
    });

    global.SafarEdgeSplitView = {
        initialize: function () {
            ensureElements();
            if (divider) divider.hidden = true;
        },
        toggle: toggle,
        setEnabled: setEnabled,
        isEnabled: function () { return enabled; },
        getRatio: function () { return ratio; },
        getProjectSettings: getProjectSettings,
        restoreProjectSettings: restoreProjectSettings,
        restoreForProject: restoreForProject
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', global.SafarEdgeSplitView.initialize, { once: true });
    } else {
        global.SafarEdgeSplitView.initialize();
    }
})(window);
