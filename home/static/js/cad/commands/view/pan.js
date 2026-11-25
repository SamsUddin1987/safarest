/* PAN command support.
 * Drag mechanics remain in cad-interaction.js.
 */
(function (global) {
    'use strict';

    global.cadBeginPanView = function () {
        if (global.CADView) {
            global.CADView.capture('pan', false);
        }
    };

})(window);