// Service worker Taxi Wal — 3 rôles :
// 1) permet à Android/Chrome et aux ordinateurs de proposer "Installer l'application" ;
// 2) reçoit les vraies notifications push (même app fermée / téléphone verrouillé) ;
// 3) garde une copie de l'application sur le téléphone pour qu'elle s'ouvre SANS RÉSEAU.
//
// Mises à jour : les pages (.html) sont toujours demandées d'abord au serveur (GitHub) ; la copie
// n'est utilisée que s'il n'y a pas de réseau. Une mise à jour sur GitHub arrive donc tout de suite.
// Les données (Supabase) ne passent JAMAIS par ce cache : c'est la page qui les gère.
// Changer VERSION à chaque modification de ce fichier (les anciennes copies sont effacées).
const VERSION = "taxiwal-v5";
const ATTENTE_RESEAU_PAGE_MS = 4000; // page : au-delà, la copie du téléphone est affichée (si elle existe)
const CACHE_PAGES = VERSION + "-pages";
const CACHE_FICHIERS = VERSION + "-fichiers";
const SUPABASE_JS = "https://unpkg.com/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";

const PAGES_A_GARDER = ["./chauffeur.html", "./feuille-de-route.html"];
const FICHIERS_A_GARDER = ["./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    // Chaque fichier séparément : un fichier manquant ne doit pas empêcher l'installation
    const pages = await caches.open(CACHE_PAGES);
    await Promise.all(PAGES_A_GARDER.map(async (u) => {
      try {
        const rep = await fetch(u, { cache: "no-store", credentials: "same-origin" });
        if (rep.ok) await pages.put(cleSansParametres(new URL(u, self.location.href).href), rep);
      } catch (e) {}
    }));
    const fichiers = await caches.open(CACHE_FICHIERS);
    await Promise.all(FICHIERS_A_GARDER.map(async (u) => {
      try { const rep = await fetch(u); if (rep.ok) await fichiers.put(u, rep); } catch (e) {}
    }));
    try {
      const rep = await fetch(SUPABASE_JS, { mode: "cors", credentials: "omit" });
      if (rep.ok) await fichiers.put(SUPABASE_JS, rep);
    } catch (e) {}
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const noms = await caches.keys();
    // Efface les copies des anciennes versions (garde les données hors ligne gérées par les pages)
    await Promise.all(noms.filter((n) => n !== CACHE_PAGES && n !== CACHE_FICHIERS && !n.startsWith("taxiwal-donnees"))
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

function cleSansParametres(url) { const u = new URL(url); u.search = ""; u.hash = ""; return u.href; }

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Supabase (données, connexion, temps réel) : jamais touché par le service worker
  if (url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".supabase.in")) return;

  const memeSite = url.origin === self.location.origin;
  const estPage = memeSite && (req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/"));
  // Scripts et manifest du site : comme les pages (réseau d'abord) pour que les mises à jour arrivent tout de suite
  const estCode = memeSite && (url.pathname.endsWith(".js") || url.pathname.endsWith(".json"));

  if (estPage || estCode) {
    // Réseau d'abord (mises à jour immédiates), copie du téléphone si pas de réseau
    event.respondWith((async () => {
      const cle = cleSansParametres(req.url);
      // La demande au serveur part tout de suite ; quand elle répond, la copie du téléphone est mise à jour
      const reseau = fetch(req.url, { cache: "no-store", credentials: "same-origin" }).then((rep) => {
        if (rep && rep.ok) {
          const copie = rep.clone();
          event.waitUntil(caches.open(CACHE_PAGES).then((c) => c.put(cle, copie)).catch(() => {}));
        }
        return rep;
      });
      event.waitUntil(reseau.catch(() => {}));
      // Pages (.html) : réseau très lent (pas de réponse en 4 s) et copie déjà sur le téléphone →
      // on affiche la copie sans attendre (la nouvelle version sera là à la prochaine ouverture)
      if (estPage) {
        const enCache = await caches.match(cle) || await caches.match(req, { ignoreSearch: true });
        if (enCache) {
          let minuterie;
          const delai = new Promise((r) => { minuterie = setTimeout(() => r(null), ATTENTE_RESEAU_PAGE_MS); });
          try {
            const rep = await Promise.race([reseau, delai]);
            clearTimeout(minuterie);
            return rep || enCache;
          } catch (e) { clearTimeout(minuterie); return enCache; }
        }
      }
      try {
        return await reseau;
      } catch (e) {
        const enCache = await caches.match(cle) || await caches.match(req, { ignoreSearch: true });
        if (enCache) return enCache;
        if (estCode) return Response.error();
        return new Response("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><body style='font:17px Arial;padding:24px'>📴 Pas de réseau.<br><br>Cette page n'a encore jamais été ouverte avec du réseau sur ce téléphone. Réessaie quand le réseau revient.</body>",
          { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    })());
    return;
  }

  // Bibliothèques externes avec numéro de version exact (supabase-js) et polices : copie d'abord
  const versionne = (url.hostname === "unpkg.com" || url.hostname === "cdn.jsdelivr.net" || url.hostname === "cdnjs.cloudflare.com")
    && /@\d+\.\d+\.\d+/.test(url.pathname);
  const police = url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com";
  if (versionne || police) {
    event.respondWith((async () => {
      const enCache = await caches.match(req.url);
      if (enCache) return enCache;
      const rep = await fetch(req);
      if (rep && (rep.ok || rep.type === "opaque")) {
        const copie = rep.clone();
        event.waitUntil(caches.open(CACHE_FICHIERS).then((c) => c.put(req.url, copie)).catch(() => {}));
      }
      return rep;
    })());
    return;
  }

  // Fichiers du site (images, icônes) : copie tout de suite, mise à jour en arrière-plan
  if (memeSite) {
    event.respondWith((async () => {
      const enCache = await caches.match(req, { ignoreSearch: true });
      const reseau = fetch(req).then((rep) => {
        if (rep && rep.ok) {
          const copie = rep.clone();
          caches.open(CACHE_FICHIERS).then((c) => c.put(req, copie)).catch(() => {});
        }
        return rep;
      });
      if (enCache) { event.waitUntil(reseau.catch(() => {})); return enCache; }
      return reseau;
    })());
  }
  // Autres sites (cartes, adresses, QR…) : laissés tels quels (nécessitent du réseau)
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
