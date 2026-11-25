SAFAR EDGE — CLOSED POLYLINE MEASUREMENT TAKEOFF
================================================

BASELINE
--------
Built from the uploaded project: mysite(20261125-135219).zip

INSTALLATION
------------
1. Back up your current project folder and any important .est drawing.
2. Extract this ZIP into the project root.
3. Preserve the folder structure and overwrite the listed files.
4. Deploy/reload the project. Hard-refresh once so the new script version loads.

CHANGED FILES
-------------
home/static/js/cad/io/cad-measurement-takeoff.js       (new)
home/static/js/cad/commands/draw/polyline.js
home/static/js/cad/history/cad-history-view.js
home/static/js/cad/core/cad-core.js
home/static/js/cad/core/cad-dimension-engine.js
home/static/js/cad/io/cad-project-files.js
home/templates/cad_workspace.html

BEHAVIOUR
---------
- Row 1 is initialized with:
  Sl No | Description | Nos | Length | Width | Height | Quantity | Unit | Remarks
- Only closed native POLYLINE entities are included. Open polylines are ignored.
- Description is the entity's CAD layer.
- Identical objects are grouped by layer and overall dimensions; Nos is their count.
- Length and Width are the overall plan extents, with the longer dimension in Length.
- Height remains blank for future 3D takeoff.
- Quantity = Nos × Length × Width.
- Unit follows the active dimension style's display unit (for example, mm²).
- Remarks and Unit are retained for a matching row when the schedule is refreshed.
- The schedule is refreshed after creating, deleting, undoing, redoing, modifying,
  replacing, or changing the layer state of CAD entities, and after opening/restoring
  a project.

IMPORTANT MEASUREMENT NOTE
--------------------------
For an irregular closed polyline, Length and Width are its overall bounding-box
dimensions. Quantity is the requested Length × Width × Nos product; it is not
the exact polygon area. Height is intentionally left empty.

SHEET SAFETY
------------
The module uses a worksheet whose first row already matches the requested headers,
or a blank worksheet. It does not overwrite a non-empty worksheet with unrelated
headers. If no suitable worksheet exists, it logs a warning and leaves existing
spreadsheet data untouched.

VALIDATION
----------
All modified JavaScript files passed `node --check`.
A local Luckysheet API stub test confirmed headers, grouping, quantity calculation,
height blanking, and repeat-sync stability.
ZIP integrity check passed.
A live browser test against the hosted application has not been performed.
