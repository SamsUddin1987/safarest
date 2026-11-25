# SafarEdge CAD — View Navigation Update

## Implemented in this update
- Cursor-centred mouse-wheel zoom, with zoom limits.
- ZOOM command options: All, Extents, Window, Previous, Center, In, Out, and numeric scale / `nX`.
- Zoom Center accepts a point and a requested view height.
- Previous View history (up to 30 saved camera positions).
- Zoom All fits the active drawing limits and any geometry extending beyond them; when limits are inactive it uses Zoom Extents.
- PAN command and middle-button drag preserve the existing interaction model.
- View menu items for Zoom Window, Previous, In, Out and Pan are enabled.
- New view logic is separated into `commands/view/` modules.

## Files added
- `home/static/js/cad/commands/view/view-navigation.js`
- `home/static/js/cad/commands/view/zoom.js`
- `home/static/js/cad/commands/view/pan.js`
- `home/static/js/cad/commands/view/limits.js`

## Main files updated
- `home/static/js/cad/command-line/cad-command-line.js`
- `home/static/js/cad/interaction/cad-keyboard.js`
- `home/static/js/cad/interaction/cad-interaction.js`
- `home/static/js/cad/cad-tools.js`
- `home/templates/cad_workspace.html`
- `home/static/js/cad/SCRIPT_TAGS.txt`

## Validation
- All 48 CAD JavaScript files pass `node --check`.
- All local static-script references in `cad_workspace.html` resolve.
- Django's `manage.py check` could not be run in this environment because Django is not installed here. Run it inside the project's configured virtual environment before deployment.

## Copyright
This update is original code written for SafarEdge using general CAD interaction concepts. It does not copy Autodesk source code, proprietary assets, AutoCAD icons, or AutoCAD interface artwork. Command names and common drafting workflows are used for compatibility and interoperability; no Autodesk affiliation or endorsement is implied.
