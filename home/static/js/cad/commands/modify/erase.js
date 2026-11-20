/**
 * SAFAR EDGE CAD - ERASE
 * Removes selected entities and records one undo operation.
 */
(function (global) {
    'use strict';

    const CAD = global.CAD;

    function deleteSelectedObjects() {
        const objects = [...selectedObjects];

        if (objects.length === 0) {
            setCommandPrompt('No objects selected to delete.');
            return;
        }

        objects.forEach(object => {
            if (object.material && object.material.color) {
                object.material.color.setHex(
                    object.userData.originalColor || 0xffffff
                );
            }
            removeEntity(object);
        });

        selectedObjects = [];
        hoverObject = null;

        undoStack.push({ type: 'delete', objs: objects });
        redoStack = [];

        notify(`Erased ${objects.length} object(s). (Ctrl+Z to undo)`);
    }

    global.deleteSelectedObjects = deleteSelectedObjects;

    CAD.registerCommand({
        name: 'ERASE',
        aliases: ['E'],
        desc: 'Delete selected objects',
        category: 'modify',
        execute(context) {
            if (context.getSelectedObjects().length > 0) {
                deleteSelectedObjects();
                return;
            }

            startPending({
                name: 'ERASE',
                prompt: 'ERASE — Select objects (click, drag a window, or type ALL), then press ENTER:',
                onText: value => {
                    if (value === 'ALL') {
                        selectAll();
                        return true;
                    }
                    return false;
                },
                onEnter: () => {
                    pendingCommand = null;
                    deleteSelectedObjects();
                }
            });
        }
    });
})(window);
