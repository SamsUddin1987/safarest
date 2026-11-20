SAFAR EDGE CAD - MODIFY COMMAND MODULARIZATION

FILES
- home/static/js/cad/core/modify-utils.js: shared geometry/preview utilities for modify commands.
- home/static/js/cad/commands/modify/erase.js: ERASE command and delete implementation.
- home/static/js/cad/commands/modify/move.js: MOVE tool.
- home/static/js/cad/commands/modify/copy.js: COPY tool, Ctrl+C and Ctrl+V clipboard helpers.
- home/static/js/cad/commands/modify/rotate.js: ROTATE tool.
- home/static/js/cad/commands/modify/scale.js: SCALE tool.
- home/static/js/cad/commands/modify/mirror.js: MIRROR tool.
- home/static/js/cad/commands/modify/trim.js: TRIM tool.
- home/static/js/cad/commands/modify/extend.js: EXTEND tool.

CONTROLLER
cad-tools.js now owns generic tool state, dispatch and shared translation only. Command-specific behaviour belongs in the individual command files.

COMMAND USAGE
Select objects first for MOVE, COPY, ROTATE, SCALE, MIRROR, TRIM and EXTEND.
- MOVE: pick base point, then destination point.
- COPY: pick base point, then one or more destination points; press ENTER to finish. Ctrl+C and Ctrl+V use the clipboard.
- ROTATE: pick base point, then pick a point to set the angle; alternatively type an angle in degrees at the prompt.
- SCALE: pick base point, then type a positive scale factor at the prompt, or pick a point whose distance from the base is used as the factor.
- MIRROR: pick two points defining the mirror axis, then answer Delete source objects? [Yes/No] (Enter/Space defaults to No).
- TRIM: selected entities are targets; unselected linework is used as cutting boundaries. Click near the part to remove. Press ENTER/SPACE twice consecutively to finish; the cursor changes to a crosshair.
- EXTEND: selected entities are targets; unselected linework is used as boundaries. Click near any selected line/polyline vertex (grip) to extend that node to the nearest valid boundary. Press ENTER/SPACE twice consecutively to finish; the cursor changes to a crosshair.
- ERASE: run ERASE/E, select entities (or type ALL), then press ENTER.

TRIM/EXTEND LIMITATIONS
TRIM and EXTEND currently operate on line and polyline-style BufferGeometry entities. Curves, blocks, dimensions and advanced AutoCAD trim modes are not included. Modified circle/rectangle approximations become polylines.

LOAD ORDER
The workspace template loads core registry and CAD core first, then draw commands, modify-utils and modify commands, followed by interaction/history/command-line/controller files. Preserve this order.

VALIDATION
All JavaScript files in the CAD source tree passed Node.js syntax checks. The eight modify commands and seven interactive modify tools were verified to register without duplicate command/alias errors. A full browser interaction test is still required in the user's local Django environment.

POLYLINE AND MOVE BEHAVIOUR
- ESC or switching commands while a PLINE has at least two vertices commits the completed polyline instead of discarding it.
- MOVE displays a cyan translucent moving preview while leaving the original entity visible and unchanged until the destination click commits the move.
