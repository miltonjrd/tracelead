// Exists so the panel can be installed as an app. No offline cache: the data must be live.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
