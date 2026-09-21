// Service worker — permet à Android/Chrome et aux ordinateurs de proposer
// "Installer l'application", ET reçoit les vraies notifications push
// (fonctionne même si l'app est fermée ou le téléphone verrouillé).
const CACHE_NAME = "taxiwal-v2";

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

// Réception d'une vraie notification push envoyée par le serveur (nouvelle course assignée,
// ou rappel 30 minutes avant une course).
self.addEventListener("push", (event) => {
  let donnees = { titre: "Taxi Wal", corps: "Nouvelle notification" };
  try { donnees = event.data.json(); } catch (e) {}

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(donnees.titre || "Taxi Wal", {
        body: donnees.corps || "",
        icon: "icon-192.png",
        badge: "icon-192.png",
        requireInteraction: true,
        tag: "rappel-taxiwal-" + Date.now()
      });
      // Prévient toutes les pages Taxi Wal déjà ouvertes (même en arrière-plan) qu'il faut
      // recharger les courses tout de suite, sans attendre le prochain cycle automatique.
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        client.postMessage({ type: donnees.type || "nouvelle-course" });
      }
    })()
  );
});

// Au clic sur la notification, ramène au premier plan un onglet déjà ouvert, sinon en ouvre un nouveau.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});
