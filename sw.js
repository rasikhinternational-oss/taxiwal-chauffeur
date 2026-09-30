// Service worker — permet à Android/Chrome et aux ordinateurs de proposer
// "Installer l'application", ET reçoit les vraies notifications push
// (fonctionne même si l'app est fermée ou le téléphone verrouillé).
const CACHE_NAME = "taxiwal-v3";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});

// Les pages (.html) sont TOUJOURS rechargées depuis le serveur, sans copie en mémoire :
// dès qu'un fichier est mis à jour sur GitHub, tous les téléphones voient la nouvelle version.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const estPage = req.method === "GET" && url.origin === self.location.origin &&
    (req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/"));
  if (estPage) {
    event.respondWith(
      fetch(req.url, { cache: "no-store", credentials: "same-origin" })
        .catch(() => caches.match(req))
    );
    return;
  }
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
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
