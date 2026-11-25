/* Drawing-limits view helpers. */
(function (global) {
    'use strict';

    global.cadZoomToLimits = function () {

        if (typeof sysLimits === 'undefined' || !sysLimits) {
            return false;
        }

        if (global.cadZoomAll) {
            global.cadZoomAll();
            return true;
        }

        return false;
    };

})(window);