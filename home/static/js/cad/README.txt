SAFAR EDGE CAD — FIRST MODULAR SPLIT
=====================================

This is a behavior-preserving first-stage split of the uploaded cad-viewer.js.

Files:
  cad-core.js          Shared state, Three.js initialization, animation loop
  cad-input.js         Cursor input and coordinate helpers
  cad-interaction.js   Mouse handling, selection, hover, selection geometry
  cad-snapping.js      OSNAP, ORTHO, GRID SNAP and snap UI
  cad-history-view.js  Undo/redo, entity collection, zoom/view helpers
  cad-command-line.js  Command prompt, parser, aliases and built-in command routing
  cad-tools.js         Tool state, MOVE, COPY and drawing command execution
  cad-entities.js      Entity creation and drawing previews
  cad-keyboard.js      Keyboard, wheel, resize and window exports
  cad-import.js        DXF/DWG import and file input handling

INSTALLATION
------------
1. Copy all ten .js files into:
   home/static/js/cad/

2. In home/templates/cad_workspace.html, find:
   <script src="{% static 'js/cad-viewer.js' %}"></script>

3. Replace that one script tag with the ten script tags from SCRIPT_TAGS.txt.
   Keep the DXF parser script above these tags.
   Keep the existing inline CAD menu script below these tags.

4. Do not load cad-viewer.js at the same time as these modules. That would
   declare the same global variables/functions twice.

5. Keep the old cad-viewer.js as a backup until the modular version is tested.

IMPORTANT ARCHITECTURE NOTE
---------------------------
This first stage intentionally preserves the current classic-script/global
architecture so existing functionality and Django template integration are
not disrupted. All modules share the existing CAD state and functions.

This is a safe organization step, NOT yet a fully isolated plug-in API.
For true independent command files (e.g. a developer adds only line.js),
the next stage should introduce CAD.registerCommand(), a command context/API,
and isolated command modules. That requires gradually moving command behavior
away from shared globals. Do not let new modules directly redeclare global
variables from cad-core.js.
