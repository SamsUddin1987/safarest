// 4E. COMMAND LINE  (AutoCAD commands, aliases and typed coordinates)
// ==========================================
const RE_NUM = /^[-+]?(?:\d+\.?\d*|\.\d+)$/;
const RE_CART = /^([-+]?(?:\d+\.?\d*|\.\d+)),([-+]?(?:\d+\.?\d*|\.\d+))$/;
const RE_POLAR = /^([-+]?(?:\d+\.?\d*|\.\d+))<([-+]?(?:\d+\.?\d*|\.\d+))$/;

// run = implemented here. No run = real AutoCAD command that is recognised but not built yet.
const planned = (name, aliases, desc) => ({ name, aliases, desc, run: null });
const CAD_COMMANDS = [
    { name: 'SELECT', aliases: [], desc: 'Select objects (type ALL to select everything)', run: () => cmdSelect() },
    { name: 'UNDO', aliases: ['U'], desc: 'Undo the last action', run: () => undo() },
    { name: 'REDO', aliases: [], desc: 'Redo the last undone action', run: () => redo() },
    { name: 'ZOOM', aliases: ['Z'], desc: 'Zoom: Extents, All, Window, In, Out, nX', run: () => cmdZoom() },
    { name: 'PAN', aliases: ['P'], desc: 'Pan the view', run: () => setTool('pan') },
    { name: 'REGEN', aliases: ['RE', 'REGENALL', 'REA'], desc: 'Regenerate the drawing', run: () => notify('Regenerating model.') },
    { name: 'DIST', aliases: ['DI'], desc: 'Measure distance between two points', run: () => setTool('dist') },
    { name: 'ID', aliases: [], desc: 'Show the coordinates of a point', run: () => setTool('id') },
    { name: 'GRID', aliases: [], desc: 'Grid display ON/OFF (F7)', run: () => cmdMode('GRID', () => gridHelper && gridHelper.visible, v => { if (gridHelper) gridHelper.visible = v; updateStatusBar(); }) },
    { name: 'ORTHO', aliases: [], desc: 'Ortho mode ON/OFF (F8)', run: () => cmdMode('ORTHO', () => orthoOn, v => { orthoOn = v; updateStatusBar(); }) },
    { name: 'SNAP', aliases: ['SN'], desc: 'Grid snap ON/OFF (F9)', run: () => cmdMode('SNAP', () => gridSnapOn, v => { gridSnapOn = v; updateStatusBar(); }) },
    { name: 'OSNAP', aliases: ['OS'], desc: 'Object snap modes (F3)', run: () => cmdOsnap() },
    { name: 'HELP', aliases: ['?'], desc: 'List the available commands', run: () => cmdHelp() },

    planned('ARC', ['A'], 'Draw an arc'),
    planned('ELLIPSE', ['EL'], 'Draw an ellipse'),
    planned('POLYGON', ['POL'], 'Draw a regular polygon'),
    planned('POINT', ['PO'], 'Draw a point'),
    planned('SPLINE', ['SPL'], 'Draw a spline'),
    planned('DONUT', ['DO'], 'Draw a donut'),
    planned('XLINE', ['XL'], 'Construction line'),
    planned('RAY', [], 'Ray'),
    planned('HATCH', ['H'], 'Hatch / fill an area'),
    planned('OFFSET', ['O'], 'Offset objects'),
    planned('FILLET', ['F'], 'Round a corner'),
    planned('CHAMFER', ['CHA'], 'Bevel a corner'),
    planned('STRETCH', ['S'], 'Stretch objects'),
    planned('ARRAY', ['AR'], 'Array objects'),
    planned('EXPLODE', ['X'], 'Explode objects'),
    planned('JOIN', ['J'], 'Join objects'),
    planned('BREAK', ['BR'], 'Break an object'),
    planned('LENGTHEN', ['LEN'], 'Change object length'),
    planned('ALIGN', ['AL'], 'Align objects'),
    planned('MATCHPROP', ['MA'], 'Match properties'),
    planned('PROPERTIES', ['PR'], 'Properties palette'),
    planned('LAYER', ['LA'], 'Layer manager'),
    planned('BLOCK', ['B'], 'Create a block'),
    planned('INSERT', ['I'], 'Insert a block'),
    planned('DIMLINEAR', ['DLI'], 'Linear dimension'),
    planned('DIMALIGNED', ['DAL'], 'Aligned dimension'),
    planned('DIMRADIUS', ['DRA'], 'Radius dimension'),
    planned('DIMDIAMETER', ['DDI'], 'Diameter dimension'),
    planned('DIMANGULAR', ['DAN'], 'Angular dimension'),
    planned('LEADER', ['LE'], 'Leader'),
    planned('TABLE', ['TB'], 'Table'),
    planned('AREA', ['AA'], 'Measure area'),
    planned('LIST', ['LI', 'LS'], 'List object data'),
    planned('MEASURE', ['ME'], 'Measure along an object'),
    planned('DIVIDE', ['DIV'], 'Divide an object'),
    planned('UNITS', ['UN'], 'Drawing units'),
    planned('PURGE', ['PU'], 'Purge unused items'),
    planned('SAVE', ['QSAVE'], 'Save the drawing'),
    planned('OPEN', [], 'Open a drawing'),
    planned('PLOT', ['PRINT'], 'Plot / print')
];

// Register existing commands in the central CAD registry.

const CAD_COMMAND_CATEGORIES = {

    PLINE: 'draw',
    RECTANG: 'draw',
    CIRCLE: 'draw',
    TEXT: 'draw',
    MTEXT: 'draw',
    ARC: 'draw',
    ELLIPSE: 'draw',

    ERASE: 'modify',
    MOVE: 'modify',
    COPY: 'modify',
    ROTATE: 'modify',
    SCALE: 'modify',
    MIRROR: 'modify',
    TRIM: 'modify',
    EXTEND: 'modify',

    ZOOM: 'view',
    PAN: 'view',
    GRID: 'view',
    ORTHO: 'view',
    SNAP: 'view',
    OSNAP: 'view',

    DIST: 'measure',
    ID: 'measure',
    AREA: 'measure'
};

CAD_COMMANDS.forEach((legacyCommand, index) => {

    const registeredCommand = CAD.registerCommand({

        name: legacyCommand.name,

        aliases: legacyCommand.aliases,

        desc: legacyCommand.desc,

        category:
            CAD_COMMAND_CATEGORIES[legacyCommand.name] || 'general',

        execute: legacyCommand.run

    });

    // Preserve compatibility with existing command-line code.
    CAD_COMMANDS[index] = registeredCommand;

});

// --- messages / history ---
function notify(msg) { setCommandPrompt(msg); logHistory(msg); }

function logHistory(msg) {
    cmdLog.push(String(msg));
    if (cmdLog.length > 300) cmdLog.shift();
    renderCmdOverlay();
}

function setupCommandLine(container) {
    const textEl = document.getElementById('cad-command-text');
    if (!textEl) return;
    const bar = textEl.parentElement;
    const old = document.getElementById('cad-cmd-input');
    if (old) old.remove();

    textEl.style.cssText += 'white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:55%; flex-shrink:1;';

    cmdInputEl = document.createElement('input');
    cmdInputEl.id = 'cad-cmd-input';
    cmdInputEl.type = 'text';
    cmdInputEl.autocomplete = 'off';
    cmdInputEl.spellcheck = false;
    cmdInputEl.placeholder = 'Type a command (L, PL, REC, C, Z, HELP)';
    cmdInputEl.style.cssText = `flex:1; min-width:120px; margin:0 14px; background:transparent; border:none;
        outline:none; color:#fff; font:inherit; caret-color:#00ffcc;`;
    bar.insertBefore(cmdInputEl, document.getElementById('cad-coords'));

    cmdOverlayEl = document.createElement('div');
    cmdOverlayEl.id = 'cad-cmd-overlay';
    cmdOverlayEl.style.cssText = `position:absolute; left:15px; bottom:56px; max-width:60%; display:none; z-index:1000;
        background:rgba(24,24,24,0.82); border:1px solid #333; border-radius:3px; padding:4px 8px;
        font: 12px Consolas, 'Courier New', monospace; line-height:1.5;`;
    container.appendChild(cmdOverlayEl);

    cmdInputEl.addEventListener('keydown', onCmdKeyDown);
    cmdInputEl.addEventListener('input', updateSuggestions);
    cmdInputEl.addEventListener('blur', () => { suggestions = []; suggestIdx = -1; renderCmdOverlay(); });
}

function focusCmd() { if (cmdInputEl) cmdInputEl.focus(); }

function renderCmdOverlay() {
    if (!cmdOverlayEl) return;
    cmdOverlayEl.innerHTML = '';
    clearTimeout(cmdOverlayTimer);

    if (suggestions.length) {
        suggestions.forEach((c, i) => {
            const row = document.createElement('div');
            row.textContent = `${c.name}${c.aliases.length ? '  (' + c.aliases.join(', ') + ')' : ''}  —  ${c.desc}${c.run ? '' : '  [not available yet]'}`;
            row.style.cssText = `padding:1px 6px; cursor:pointer; color:${c.run ? '#00ffcc' : '#777'};` +
                (i === suggestIdx ? 'background:#094771;' : '');
            row.addEventListener('mousedown', e => { e.preventDefault(); chooseSuggestion(c); });
            cmdOverlayEl.appendChild(row);
        });
        cmdOverlayEl.style.pointerEvents = 'auto';
    } else {
        cmdLog.slice(-cmdOverlayMax).forEach(t => {
            const row = document.createElement('div');
            row.textContent = t;
            row.style.color = '#bbb';
            cmdOverlayEl.appendChild(row);
        });
        cmdOverlayEl.style.pointerEvents = 'none';
        // history fades away after a few seconds, like AutoCAD
        cmdOverlayTimer = setTimeout(() => { if (!suggestions.length) cmdOverlayEl.style.display = 'none'; },
                                     cmdOverlayMax > 3 ? 20000 : 7000);
    }
    cmdOverlayEl.style.display = cmdOverlayEl.childNodes.length ? 'block' : 'none';
}

function updateSuggestions() {
    const v = cmdInputEl.value.trim().toUpperCase();
    suggestions = [];
    suggestIdx = -1;
    if (v && !/^[-+@#.\d]/.test(v)) {
        suggestions = CAD.getCommands()
            .filter(c => c.name.startsWith(v) || c.aliases.some(a => a.startsWith(v)))
            .sort((a, b) => {
                const ea = (a.name === v || a.aliases.includes(v)) ? 0 : 1;
                const eb = (b.name === v || b.aliases.includes(v)) ? 0 : 1;
                if (ea !== eb) return ea - eb;
                if (!!a.run !== !!b.run) return a.run ? -1 : 1;
                return a.name.localeCompare(b.name);
            })
            .slice(0, 8);
    }
    renderCmdOverlay();
}

function chooseSuggestion(c) {
    cmdInputEl.value = '';
    suggestions = [];
    suggestIdx = -1;
    processCommandText(c.name);
}

function onCmdKeyDown(e) {
    const k = e.key;
    if (k === 'Enter' || k === ' ') {            // Space = Enter, as in AutoCAD
        e.preventDefault();
        let text = cmdInputEl.value.trim();
        if (suggestIdx >= 0 && suggestions[suggestIdx]) text = suggestions[suggestIdx].name;
        cmdInputEl.value = '';
        suggestions = [];
        suggestIdx = -1;
        processCommandText(text);
    } else if (k === 'Escape') {
        e.preventDefault();
        if (cmdInputEl.value) { cmdInputEl.value = ''; updateSuggestions(); }
        else cancelCommand();
    } else if (k === 'Tab') {
        e.preventDefault();
        if (suggestions.length) {
            suggestIdx = (suggestIdx + 1) % suggestions.length;
            cmdInputEl.value = suggestions[suggestIdx].name;
            renderCmdOverlay();
        }
    } else if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        const dir = k === 'ArrowDown' ? 1 : -1;
        if (suggestions.length) {
            suggestIdx = (suggestIdx + dir + suggestions.length) % suggestions.length;
            renderCmdOverlay();
        } else if (cmdTyped.length) {               // recall previously typed commands
            cmdTypedIdx = Math.max(0, Math.min(cmdTyped.length, cmdTypedIdx + dir));
            cmdInputEl.value = cmdTyped[cmdTypedIdx] || '';
        }
    } else if (k === 'Delete' && !cmdInputEl.value) {   // Delete with an empty command line erases the selection
        e.preventDefault();
        deleteSelectedObjects();
    }
}

// --- coordinate entry: x,y   @x,y   @dist<angle   dist<angle   #x,y   distance ---
function parsePointInput(raw, relativeDefault) {
    let s = String(raw).replace(/\s+/g, '');
    if (!s) return null;
    let relative = !!relativeDefault;
    if (s[0] === '#') { relative = false; s = s.slice(1); }
    if (s[0] === '@') { relative = true; s = s.slice(1); }
    const ref = (isDrawing && basePoint) ? basePoint : (lastPoint || new THREE.Vector3(0, 0, 0));
    let m;

    if (s === '') return lastPoint ? lastPoint.clone() : null;      // "@" alone = last point
    if ((m = s.match(RE_CART))) {
        const x = parseFloat(m[1]), y = parseFloat(m[2]);
        return relative ? new THREE.Vector3(ref.x + x, ref.y + y, 0) : new THREE.Vector3(x, y, 0);
    }
    if ((m = s.match(RE_POLAR))) {
        const d = parseFloat(m[1]), a = (parseFloat(m[2]) * Math.PI) / 180;
        const ox = relative ? ref.x : 0, oy = relative ? ref.y : 0;
        return new THREE.Vector3(ox + d * Math.cos(a), oy + d * Math.sin(a), 0);
    }
    if (RE_NUM.test(s)) {                                           // direct distance toward the cursor
        if (!(isDrawing && basePoint)) return null;
        const dist = parseFloat(s);
        const cur = getDrawPoint();
        const dx = cur.x - basePoint.x, dy = cur.y - basePoint.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) return null;
        return new THREE.Vector3(basePoint.x + (dx / len) * dist, basePoint.y + (dy / len) * dist, 0);
    }
    return null;
}

// --- what happens when something is typed + Enter ---
function processCommandText(raw) {
    const text = String(raw).trim();
    if (!text) { commandEnter(); return; }

    cmdOverlayMax = 3;
    if (cmdTyped[cmdTyped.length - 1] !== text) cmdTyped.push(text);
    cmdTypedIdx = cmdTyped.length;
    const up = text.toUpperCase();

    // 1. an option prompt is waiting (ZOOM, GRID, ERASE ...)
    if (pendingCommand && pendingCommand.onText && pendingCommand.onText(up, text)) return;

    // 2. options of the running command: C = Close, U = Undo
    if (handleToolOption(up)) return;

    // 3. coordinates for the running command
    if (currentTool !== 'select') {
        const pt = parsePointInput(text, false);
        if (pt) { logHistory(text); handleToolClick(pt); return; }
    }

    // 4. a command name or alias
    const cmd = CAD.getCommand(up);
    if (cmd) {
        runCommand(cmd);
        return;
    }

    logHistory(`Unknown command "${text}". Type HELP or ? for the command list.`);
    setCommandPrompt(`Unknown command "${text}".`);
}

function runCommand(cmd) {
    // typing a new command ends the one in progress (a polyline in progress is kept)
    if (currentTool !== 'select') {

        finishTool();
    }
    pendingCommand = null;
    lastCommandName = cmd.name;
    logHistory(`Command: ${cmd.name}`);
    if (!cmd.execute) {

        const msg =
            `${cmd.name} (${cmd.desc}) is a real AutoCAD command, but it is not available in this viewer yet.`;

        logHistory(msg);
        setCommandPrompt(`${cmd.name}: not available yet.`);

        return;
    }

    // Execute through the central registry.
    CAD.executeCommand(cmd.name);
    }

function handleToolOption(up) {

    if (!isDrawing) return false;

    const activeTool = CAD.getTool(currentTool);

    if (
        activeTool &&
        typeof activeTool.onOption === 'function'
    ) {

        return activeTool.onOption(
            up,
            CAD.createContext()
        );

    }

    return false;
}

function commandEnter() {
    if (pendingCommand) {
        const p = pendingCommand;
        if (p.onEnter) p.onEnter();
        else { pendingCommand = null; setCommandPrompt('Command:'); }
        return;
    }
    if (currentTool === 'copy') {
        finishTool();
        return;
    }
    if (currentTool !== 'select') {

        const activeTool = CAD.getTool(currentTool);

        if (
            activeTool &&
            typeof activeTool.onEnter === 'function'
        ) {

            activeTool.onEnter(CAD.createContext());

            return;
        }

        if (isDrawing) {
            setTool(currentTool);
        } else {
            finishTool();
        }

        return;
    }
    const lastCommand = lastCommandName
        ? CAD.getCommand(lastCommandName)
        : null;

    if (lastCommand) {
        runCommand(lastCommand);
    }
}

function cancelCommand() {
    const wasActive = currentTool !== 'select' || isDrawing || !!pendingCommand;
    pendingCommand = null;
    cancelBoxSelect();
    clearSelection();
    finishTool();
    if (wasActive) logHistory('*Cancel*');
}

// --- individual commands ---
function startPending(p) {
    pendingCommand = p;
    setCommandPrompt(p.prompt);
    logHistory(p.prompt);
    focusCmd();
}

function selectAll() {
    clearSelection();
    drawnObjects.forEach(o => { selectedObjects.push(o); o.material.color.setHex(0x00ffff); });
    notify(`${selectedObjects.length} found.`);
}

function cmdSelect() {
    startPending({
        name: 'SELECT',
        prompt: 'SELECT — Select objects (click, drag a window, or type ALL), then press ENTER:',
        onText: up => { if (up === 'ALL') { selectAll(); return true; } return false; },
        onEnter: () => { pendingCommand = null; setCommandPrompt(`Command: ${selectedObjects.length} object(s) selected.`); }
    });
}

function cmdMode(name, get, set) {
    startPending({
        name,
        prompt: `${name} — Enter mode [ON/OFF] <${get() ? 'ON' : 'OFF'}>:`,
        onText: up => {
            if (up !== 'ON' && up !== 'OFF') return false;
            set(up === 'ON');
            pendingCommand = null;
            notify(`<${name} ${up}>`);
            return true;
        },
        onEnter: () => { pendingCommand = null; setCommandPrompt('Command:'); }
    });
}

function syncOsnapMenu() {
    Object.keys(osnapCheckboxes).forEach(k => { osnapCheckboxes[k].checked = !!osnapModes[k]; });
}

function cmdOsnap() {
    const map = { END: 'endpoint', MID: 'midpoint', CEN: 'center', NOD: 'node', QUA: 'quadrant',
                  INT: 'intersection', PER: 'perpendicular', NEA: 'nearest' };
    startPending({
        name: 'OSNAP',
        prompt: 'OSNAP — Enter modes [END,MID,CEN,NOD,QUA,INT,PER,NEA] or ALL / NONE / ON / OFF:',
        onText: up => {
            if (up === 'ON' || up === 'OFF') { osnapOn = (up === 'ON'); if (!osnapOn) hideSnapMarker(); }
            else if (up === 'ALL' || up === 'NONE') { Object.keys(osnapModes).forEach(k => { osnapModes[k] = (up === 'ALL'); }); }
            else {
                const tokens = up.split(',').map(t => t.trim()).filter(Boolean);
                const bad = tokens.filter(t => !map[t.slice(0, 3)]);
                if (bad.length || tokens.length === 0) { logHistory(`Invalid mode "${bad.join(',') || up}".`); return true; }
                Object.keys(osnapModes).forEach(k => { osnapModes[k] = false; });
                tokens.forEach(t => { osnapModes[map[t.slice(0, 3)]] = true; });
                osnapOn = true;
            }
            pendingCommand = null;
            syncOsnapMenu();
            updateStatusBar();
            const active = Object.keys(osnapModes).filter(k => osnapModes[k]).map(k => SNAP_LABELS[k]);
            notify(`Object snap ${osnapOn ? 'ON' : 'OFF'}: ${active.length ? active.join(', ') : 'none'}`);
            return true;
        },
        onEnter: () => { pendingCommand = null; setCommandPrompt('Command:'); }
    });
}

function zoomBy(f) {
    camera.zoom = Math.max(0.05, Math.min(camera.zoom * f, 100));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
}

function zoomToWindow(p1, p2) {
    const w = Math.max(Math.abs(p2.x - p1.x), 1e-6), h = Math.max(Math.abs(p2.y - p1.y), 1e-6);
    const fit = Math.min((camera.right - camera.left) / w, (camera.top - camera.bottom) / h);
    camera.zoom = Math.max(0.05, Math.min(fit, 100));
    camera.position.x = (p1.x + p2.x) / 2;
    camera.position.y = (p1.y + p2.y) / 2;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    notify('Zoom Window.');
}

function cmdZoom() {
    startPending({
        name: 'ZOOM',
        prompt: 'ZOOM — [All / Extents / Window / In / Out / nX scale] <real time>:',
        onText: up => {
            let m;
            if (up === 'E' || up === 'EXT' || up === 'EXTENTS') { pendingCommand = null; zoomExtents(); }
            else if (up === 'A' || up === 'ALL') {
                pendingCommand = null;
                camera.position.x = 0; camera.position.y = 0; camera.zoom = 1;
                camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
                notify('Zoom All.');
            }
            else if (up === 'W' || up === 'WINDOW') { setTool('zoomw'); }
            else if (up === 'I' || up === 'IN') { pendingCommand = null; zoomBy(2); notify('Zoom In.'); }
            else if (up === 'O' || up === 'OUT') { pendingCommand = null; zoomBy(0.5); notify('Zoom Out.'); }
            else if ((m = up.match(/^(\d*\.?\d+)(X)?$/))) {
                pendingCommand = null;
                const n = parseFloat(m[1]);
                if (n <= 0) { logHistory('Invalid scale.'); return true; }
                if (m[2]) zoomBy(n); else { camera.zoom = Math.max(0.05, Math.min(n, 100)); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); }
                notify(`Zoom ${m[2] ? 'x' : 'scale '}${n}.`);
            }
            else { logHistory('ZOOM — Invalid option. Use A, E, W, I, O or a scale such as 2X.'); }
            return true;
        },
        onEnter: () => { pendingCommand = null; notify('ZOOM — Use the mouse wheel for real-time zoom.'); }
    });
}

function reportDistance(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, p = sysPrecision;
    let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (ang < 0) ang += 360;
    notify(`DIST — Distance = ${Math.hypot(dx, dy).toFixed(p)} ${sysUnits}, Angle = ${ang.toFixed(p)}°, ΔX = ${dx.toFixed(p)}, ΔY = ${dy.toFixed(p)}`);
}

function cmdHelp() {
    cmdOverlayMax = 14;
    const notReady = CAD.getCommands()
        .filter(c => !c.execute)
        .map(c =>
            c.aliases.length
                ? `${c.name} (${c.aliases[0]})`
                : c.name
        );
    [
        'DRAW:    LINE (L)  PLINE (PL)  RECTANG (REC)  CIRCLE (C)  TEXT (DT)  MTEXT (T)',
        'MODIFY:  ERASE (E)  MOVE (M)  COPY (CO)  ROTATE (RO)  SCALE (SC)  MIRROR (MI)  TRIM (TR)  EXTEND (EX)',
        'VIEW:    ZOOM (Z) [E / A / W / I / O / 2X]   PAN (P)   REGEN (RE)',
        'INQUIRY: DIST (DI)  ID',
        'SETTINGS: GRID (F7)  ORTHO (F8)  SNAP (SN, F9)  OSNAP (OS, F3)',
        'POINTS:  100,50 absolute  |  @40,30 relative  |  @50<45 polar  |  #x,y absolute  |  20 = distance toward cursor',
        'OPTIONS: C = Close, U = Undo (LINE / PLINE)   ENTER or SPACE = finish / repeat last command   ESC = cancel',
        'Not available yet: ' + notReady.join(', ')
    ].forEach(l => cmdLog.push(l));
    setCommandPrompt('HELP — command list shown above.');
    renderCmdOverlay();
}

