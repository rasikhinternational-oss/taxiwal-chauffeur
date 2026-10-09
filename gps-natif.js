/*
 * gps-natif.js — Taxi Wal Driver
 * ------------------------------------------------------------------
 * Suivi GPS en arrière-plan (téléphone verrouillé / app en fond) via le
 * plugin natif @capacitor-community/background-geolocation.
 *
 * - Ne fait RIEN dans un navigateur normal (le site web garde son
 *   comportement actuel).
 * - Dans l'app native : met window.TAXIWAL_GPS_NATIF = true tout de suite,
 *   pour que chauffeur.html n'écrive plus lui-même dans trajets_gps.
 * - Réutilise le client Supabase de la page (variable globale `supabase`
 *   déclarée par `let supabase` dans chauffeur.html — ce n'est PAS
 *   window.supabase, qui est la librairie).
 *
 * Inclus par chauffeur.html, APRÈS le script principal.
 * JavaScript simple (ES2017), sans module ni compilation.
 */
(function () {
  "use strict";

  // ---------- 1. Sommes-nous dans l'app native avec le plugin ? ----------
  var Cap = window.Capacitor;
  var estNatif = false;
  try { estNatif = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform()); } catch (e) { estNatif = false; }
  var BG = estNatif && Cap.Plugins ? Cap.Plugins.BackgroundGeolocation : null;
  if (!estNatif || !BG || typeof BG.addWatcher !== "function") {
    return; // navigateur web ou plugin absent → on ne touche à rien
  }

  // Dit à chauffeur.html de ne plus enregistrer ses propres points trajets_gps
  window.TAXIWAL_GPS_NATIF = true;

  // ---------- 2. Réglages ----------
  var CLE_FILE = "taxiwal_gps_file_attente"; // file d'attente hors-ligne (localStorage)
  var MAX_FILE = 2000;                       // nombre max de points gardés hors-ligne
  var MIN_SECONDES = 10;                     // on ignore un point si < 10 s ...
  var MIN_METRES = 25;                       // ... ET < 25 m depuis le dernier point enregistré

  // ---------- 3. État ----------
  var idObservateur = null;   // id du "watcher" natif
  var demarrageEnCours = false;
  var utilisateur = null;     // utilisateur Supabase connecté
  var dernierPoint = null;    // { lat, lng, t } du dernier point enregistré
  var vidageEnCours = false;
  var alerteReglagesMontree = false;

  // ---------- 4. Petit badge en bas à gauche ----------
  var badge = null;
  function majBadge() {
    try {
      if (!document.body) return;
      if (!badge) {
        badge = document.createElement("div");
        badge.id = "badge-gps-natif";
        badge.style.cssText = "position:fixed; left:10px; bottom:calc(10px + env(safe-area-inset-bottom, 0px)); z-index:3000;" +
          "padding:6px 10px; border-radius:999px; color:#fff; font:600 12px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
          "box-shadow:0 2px 8px rgba(0,0,0,.2); pointer-events:none;"; // informatif seulement : aucun clic
        document.body.appendChild(badge);
      }
      var actif = idObservateur !== null;
      badge.textContent = actif ? "📍 Suivi GPS actif" : "📍 GPS coupé";
      badge.style.background = actif ? "#1f8a4c" : "#c81e2c";
    } catch (e) { /* le badge n'est pas essentiel */ }
  }

  // ---------- 5. Outils ----------
  // Retourne le client Supabase de la page (et non la librairie window.supabase)
  function clientSupabase() {
    try {
      // eslint-disable-next-line no-undef
      if (typeof supabase !== "undefined" && supabase && supabase.auth && typeof supabase.from === "function") return supabase;
    } catch (e) { /* pas encore déclaré */ }
    return null;
  }

  // Distance en mètres entre deux points (formule de haversine)
  function distanceMetres(lat1, lng1, lat2, lng2) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function lireFile() {
    try { var v = JSON.parse(localStorage.getItem(CLE_FILE) || "[]"); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function ecrireFile(liste) {
    try {
      if (liste.length > MAX_FILE) liste = liste.slice(liste.length - MAX_FILE); // on garde les plus récents
      if (liste.length) localStorage.setItem(CLE_FILE, JSON.stringify(liste));
      else localStorage.removeItem(CLE_FILE);
    } catch (e) { /* stockage plein ou indisponible : tant pis */ }
  }
  function mettreEnFile(ligne) {
    var liste = lireFile();
    liste.push(ligne);
    ecrireFile(liste);
  }

  // Envoie les points en attente (par paquets de 200), après un envoi réussi
  async function viderFile(sb) {
    if (vidageEnCours) return;
    vidageEnCours = true;
    try {
      var liste = lireFile();
      while (liste.length) {
        var paquet = liste.slice(0, 200);
        var res = await sb.from("trajets_gps").insert(paquet);
        if (res.error) break; // on réessaiera au prochain point réussi
        liste = liste.slice(paquet.length);
        ecrireFile(liste);
      }
    } catch (e) { /* toujours hors-ligne */ }
    finally { vidageEnCours = false; }
  }

  // ---------- 6. Traitement d'une position ----------
  async function traiterPosition(location) {
    if (!location || !utilisateur) return;
    var lat = location.latitude, lng = location.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") return;
    var t = location.time ? Number(location.time) : Date.now();

    // Filtre : trop proche dans le temps ET dans l'espace → ignoré
    if (dernierPoint) {
      var secondes = (t - dernierPoint.t) / 1000;
      var metres = distanceMetres(dernierPoint.lat, dernierPoint.lng, lat, lng);
      if (secondes < MIN_SECONDES && metres < MIN_METRES) return;
    }
    dernierPoint = { lat: lat, lng: lng, t: t };

    var ligne = {
      chauffeur_id: utilisateur.id,
      latitude: lat,
      longitude: lng,
      precision_m: location.accuracy != null ? Math.round(location.accuracy) : null,
      vitesse_kmh: location.speed != null ? Math.round(location.speed * 3.6) : null,
      cap: location.bearing != null ? location.bearing : null,
      source: "app_driver",
      enregistre_le: new Date(t).toISOString()
    };

    var sb = clientSupabase();
    if (!sb) { mettreEnFile(ligne); return; }
    try {
      var res = await sb.from("trajets_gps").insert(ligne);
      if (res.error) {
        console.warn("GPS natif : envoi impossible, point gardé en attente :", res.error.message);
        mettreEnFile(ligne);
      } else {
        viderFile(sb); // connexion OK → on envoie aussi les points en attente
      }
    } catch (e) {
      mettreEnFile(ligne); // hors-ligne
    }
  }

  // ---------- 7. Démarrer / arrêter ----------
  async function start() {
    if (idObservateur !== null || demarrageEnCours) return;
    if (!utilisateur) { console.warn("GPS natif : pas d'utilisateur connecté."); return; }
    demarrageEnCours = true;
    try {
      idObservateur = await BG.addWatcher(
        {
          backgroundMessage: "Taxi Wal Driver enregistre votre trajet pendant le service.",
          backgroundTitle: "Suivi du trajet actif",
          requestPermissions: true,
          stale: false,
          distanceFilter: 25
        },
        function (location, error) {
          if (error) {
            if (error.code === "NOT_AUTHORIZED" && !alerteReglagesMontree) {
              alerteReglagesMontree = true;
              var ok = window.confirm(
                "Taxi Wal Driver a besoin de votre position pour enregistrer vos trajets pendant le service.\n\n" +
                "Ouvrir les réglages pour autoriser la localisation (choisir « Toujours ») ?"
              );
              if (ok) { try { BG.openSettings(); } catch (e) { /* ignoré */ } }
            }
            console.warn("GPS natif :", error.code || "", error.message || error);
            return;
          }
          traiterPosition(location);
        }
      );
      // Certaines versions renvoient l'id directement, d'autres un objet
      if (idObservateur && typeof idObservateur === "object" && idObservateur.id) idObservateur = idObservateur.id;
      if (idObservateur === undefined) idObservateur = null;
    } catch (e) {
      console.error("GPS natif : démarrage impossible :", e);
      idObservateur = null;
    } finally {
      demarrageEnCours = false;
      majBadge();
    }
  }

  async function stop() {
    var id = idObservateur;
    idObservateur = null;
    dernierPoint = null;
    majBadge();
    if (id === null) return;
    try { await BG.removeWatcher({ id: id }); } catch (e) { console.warn("GPS natif : arrêt :", e); }
  }

  window.TaxiWalGPS = {
    start: start,
    stop: stop,
    get actif() { return idObservateur !== null; }
  };

  // ---------- 8. Démarrage automatique selon le compte connecté ----------
  async function verifierCompte(sb, user) {
    if (!user) { utilisateur = null; await stop(); return; }
    utilisateur = user;
    try {
      var res = await sb.from("profils").select("role").eq("id", user.id).maybeSingle();
      var role = res.data && res.data.role;
      if (role === "chauffeur" || role === "partenaire") {
        start();
        var s = clientSupabase();
        if (s) viderFile(s); // points restés en attente d'une session précédente
      } else {
        await stop(); // admin (ou autre) : pas de suivi
      }
    } catch (e) {
      console.warn("GPS natif : rôle illisible, nouvel essai dans 15 s", e);
      setTimeout(function () { verifierCompte(sb, user); }, 15000);
    }
  }

  var ecouteInstallee = false;
  function brancher(sb) {
    if (ecouteInstallee) return;
    ecouteInstallee = true;
    try {
      sb.auth.onAuthStateChange(function (event, session) {
        // On sort du callback avant d'appeler Supabase (évite un blocage connu de supabase-js)
        setTimeout(function () {
          if (event === "SIGNED_OUT") { utilisateur = null; stop(); return; }
          if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
            var u = session && session.user;
            if (u && (!utilisateur || utilisateur.id !== u.id || idObservateur === null)) verifierCompte(sb, u);
          }
        }, 0);
      });
    } catch (e) { console.warn("GPS natif : onAuthStateChange :", e); }

    // Session déjà présente au chargement ?
    sb.auth.getSession().then(function (r) {
      var u = r && r.data && r.data.session && r.data.session.user;
      if (u) verifierCompte(sb, u);
    }).catch(function () { /* ignoré */ });
  }

  // Attendre que le client Supabase de la page existe (vérifie toutes les 500 ms, 2 min max)
  var essais = 0;
  (function attendreClient() {
    var sb = clientSupabase();
    if (sb) { brancher(sb); return; }
    if (++essais < 240) setTimeout(attendreClient, 500);
    else console.warn("GPS natif : client Supabase introuvable sur cette page.");
  })();

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", majBadge);
  else majBadge();
})();
