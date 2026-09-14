// Service worker minimal — permet à Android/Chrome et aux ordinateurs
// de proposer "Installer l'application" (condition technique requise).
const CACHE_NAME = "taxiwal-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});

// Laisse passer toutes les requêtes normalement (pas de mode hors-ligne
// complexe pour l'instant, juste ce qu'il faut pour l'installation).
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
