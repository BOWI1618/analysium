/**
 * Service worker for installing Analysium on a phone or desktop.
 *
 * It caches nothing on purpose: the app is useless offline — every screen is
 * live team data — and a cache is exactly what would keep an old bundle alive
 * after a deploy. Browsers want a worker with a fetch handler before they offer
 * «Установить приложение»; this one lets every request go to the network as usual.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
