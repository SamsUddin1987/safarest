
/*
 * SAFAR EDGE Service Worker
 *
 * Initial foundation:
 * - Supports PWA installation.
 * - Activates the service worker.
 * - Does not cache CAD or spreadsheet files yet.
 * - Does not interfere with normal Django requests.
 *
 * Caching and offline support will be considered separately.
 */

const SAFAR_EDGE_SW_VERSION = 'safaredge-v1';

self.addEventListener('install', function (event) {
    self.skipWaiting();
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        self.clients.claim()
    );
});
