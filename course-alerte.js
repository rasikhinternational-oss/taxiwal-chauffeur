// Taxi Wal — alerte plein écran « nouvelle course à accepter » + bandeau « prochaine course ».
// Inclus dans chauffeur.html et feuille-de-route.html. Fichier autonome : toute erreur reste ici
// (jamais d'exception vers la page). Réutilise le client `supabase` et la file TWHL de la page.
// Course en attente d'acceptation = statut "assignee" et accepte_chauffeur = false (comme chauffeur.html).
// Accepter  = mêmes champs que accepterCourse() : accepte_chauffeur=true, accepte_a=maintenant.
// Démarrer  = demarrerCourse() de chauffeur.html (statut "en_cours") ; depuis la feuille de route → redirection.
(function () {
  "use strict";
  try {
    if (window.__courseAlerteChargee) return;
    window.__courseAlerteChargee = true;
  } catch (e) { return; }

  var SUR_FEUILLE = /feuille-de-route/i.test(location.pathname || "");
  var POLL_MS = 20000;
  var CHAMPS = "id, date_heure, adresse_depart, adresse_arrivee, client_nom, passagers, prix, mode_tarification, notes, statut, accepte_chauffeur, chauffeur_id";
  var uid = null, canal = null, enCours = false;
  var enAttente = [];          // courses à accepter
  var acceptees = [];          // courses acceptées pas encore démarrées
  var masqueJusqua = 0;        // « Masquer 2 min »
  var vues = {};               // ids déjà annoncés (son / vibration une seule fois)
  var overlay = null, overlayCourseId = null, overlayMode = null;

  function log(m, e) { try { console.warn("[course-alerte] " + m, e || ""); } catch (_) {} }
  function client() {
    try { if (typeof supabase !== "undefined" && supabase && typeof supabase.from === "function") return supabase; } catch (e) {}
    return null;
  }
  function horsLigne() {
    try { if (navigator.onLine === false) return true; if (window.TWHL && TWHL.horsLigne && TWHL.horsLigne()) return true; } catch (e) {}
    return false;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function heureHM(d) { return d.toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit" }); }
  function jourHM(d) {
    var auj = new Date(), dem = new Date(); dem.setDate(auj.getDate() + 1);
    var j = d.toDateString() === auj.toDateString() ? "aujourd'hui"
      : d.toDateString() === dem.toDateString() ? "demain"
      : d.toLocaleDateString("fr-BE", { weekday: "long", day: "2-digit", month: "2-digit" });
    return j + " " + heureHM(d);
  }
  function minutesAvant(c) {
    var t = new Date(c.date_heure).getTime();
    return isFinite(t) ? Math.round((t - Date.now()) / 60000) : null;
  }
  function quand(c) {
    var m = minutesAvant(c);
    if (m === null) return { gros: "?", mention: "Heure inconnue", bientot: true };
    var d = new Date(c.date_heure);
    if (m <= 5) return { gros: heureHM(d), mention: "MAINTENANT", bientot: true };
    if (m <= 30) return { gros: heureHM(d), mention: "MAINTENANT · dans " + m + " min", bientot: true };
    if (m < 120) return { gros: heureHM(d), mention: "dans " + m + " min · " + jourHM(d), bientot: false };
    return { gros: heureHM(d), mention: "PLUS TARD : " + jourHM(d), bientot: false };
  }

  async function lireUid() {
    var sb = client(); if (!sb) return null;
    try {
      var r = await sb.auth.getSession();
      var s = r && r.data && r.data.session;
      if (s && s.user && s.user.id) return s.user.id;
    } catch (e) {}
    try { var u = window.TWHL && TWHL.utilisateurLocal && TWHL.utilisateurLocal(); if (u && u.id) return u.id; } catch (e) {}
    return null;
  }

  // ---------- Son / vibration (carillon doux, discret) ----------
  // Un seul AudioContext, débloqué au premier toucher sur la page (restrictions autoplay).
  var audioCtx = null, rappelSon = null, RAPPEL_MS = 30000;
  function contexteAudio() {
    try {
      if (!audioCtx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; audioCtx = new AC(); }
      if (audioCtx.state === "suspended" && audioCtx.resume) audioCtx.resume().catch(function () {});
      return audioCtx;
    } catch (e) { return null; }
  }
  function debloquerAudio() {
    try {
      var ctx = contexteAudio(); if (!ctx) return;
      var o = ctx.createOscillator(), g = ctx.createGain();   // son muet : valide le déblocage
      g.gain.value = 0.0001; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.02);
    } catch (e) {}
  }
  ["pointerdown", "touchstart", "keydown"].forEach(function (ev) {
    try { document.addEventListener(ev, debloquerAudio, { capture: true, passive: true }); } catch (e) {}
  });
  function carillon() {
    try {
      var ctx = contexteAudio(); if (!ctx || ctx.state !== "running") return;
      var t0 = ctx.currentTime + 0.02;
      [[659.25, 0], [880, 0.28]].forEach(function (n) {          // mi5 puis la5 : « ding-dong » montant
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine"; o.frequency.value = n[0];
        var t = t0 + n[1];
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.03);      // attaque douce
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);     // extinction lente
        o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 1.15);
      });
    } catch (e) {}
  }
  function vibrer() { try { if (navigator.vibrate) navigator.vibrate([200, 120, 200]); } catch (e) {} }
  function alerter() {
    carillon(); vibrer();
    arreterRappel();
    try {
      rappelSon = setInterval(function () {
        if (overlay && overlayMode === "accepter" && document.visibilityState === "visible") { carillon(); vibrer(); }
        else arreterRappel();
      }, RAPPEL_MS);
    } catch (e) {}
  }
  function arreterRappel() { try { if (rappelSon) clearInterval(rappelSon); } catch (e) {} rappelSon = null; }

  // ---------- Overlay plein écran ----------
  function fermerOverlay() {
    try { if (overlay) overlay.remove(); } catch (e) {}
    arreterRappel();
    overlay = null; overlayCourseId = null; overlayMode = null;
  }
  function bouton(txt, fond, taille) {
    var b = document.createElement("button");
    b.type = "button"; b.textContent = txt;
    b.style.cssText = "display:block; width:100%; padding:22px 14px; border:none; border-radius:18px; background:" + fond +
      "; color:#fff; font-size:" + (taille || "1.6rem") + "; font-weight:900; box-shadow:0 4px 16px rgba(0,0,0,.35); cursor:pointer; margin-top:14px;";
    return b;
  }
  function lien(txt) {
    var a = document.createElement("button");
    a.type = "button"; a.textContent = txt;
    a.style.cssText = "display:block; margin:18px auto 0; background:none; border:none; color:#bbb; font-size:.95rem; text-decoration:underline; cursor:pointer;";
    return a;
  }
  function ouvrirOverlay(c, mode) {
    // mode : "accepter" | "demarrer" | "plus-tard"
    fermerOverlay();
    var q = quand(c);
    var o = document.createElement("div");
    o.id = "course-alerte-overlay";
    o.setAttribute("role", "alertdialog"); o.setAttribute("aria-modal", "true");
    o.style.cssText = "position:fixed; inset:0; z-index:2147483000; background:#0d0d0d; color:#fff; overflow-y:auto; " +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; text-align:center; " +
      "padding:calc(env(safe-area-inset-top,0px) + 18px) 18px calc(env(safe-area-inset-bottom,0px) + 22px); box-sizing:border-box;";
    var titre = mode === "accepter" ? "🚖 NOUVELLE COURSE" : mode === "demarrer" ? "🚖 COURSE ACCEPTÉE" : "✅ COURSE ACCEPTÉE";
    var prix = c.mode_tarification === "taximetre" ? "Taximètre" : (c.prix != null && c.prix !== "" ? esc(c.prix) + " €" : "");
    var reste = enAttente.length > 1 && mode === "accepter" ? "<div style='margin-top:4px; font-size:.95rem; color:#f5c518;'>" + enAttente.length + " courses à accepter (une par une)</div>" : "";
    var lignes =
      "<div style='font-size:1.3rem; font-weight:900; letter-spacing:.5px; color:#f5c518;'>" + titre + "</div>" + reste +
      "<div style='font-size:4.2rem; font-weight:900; line-height:1.05; margin-top:10px;'>" + esc(q.gros) + "</div>" +
      "<div style='font-size:1.45rem; font-weight:900; margin-top:4px; color:" + (q.bientot ? "#ff5a5a" : "#7fd1ff") + ";'>" + esc(q.mention) + "</div>" +
      "<div style='text-align:left; background:#1d1d1d; border-radius:14px; padding:14px 16px; margin-top:16px; font-size:1.15rem; line-height:1.5;'>" +
        "<div>📍 <b>Départ :</b> " + esc(c.adresse_depart || "?") + "</div>" +
        "<div>🏁 <b>Destination :</b> " + esc(c.adresse_arrivee || "?") + "</div>" +
        (c.client_nom ? "<div>👤 <b>Client :</b> " + esc(c.client_nom) + "</div>" : "") +
        (c.passagers ? "<div>👥 <b>Passagers :</b> " + esc(c.passagers) + "</div>" : "") +
        (prix ? "<div>💶 <b>Prix :</b> " + prix + "</div>" : "") +
        (c.notes ? "<div style='margin-top:6px; color:#f5c518;'>⚠️ <b>Remarque :</b> " + esc(c.notes) + "</div>" : "") +
      "</div>";
    var zone = document.createElement("div");
    zone.style.cssText = "max-width:520px; margin:0 auto;";
    zone.innerHTML = lignes;
    var msg = document.createElement("div");
    msg.style.cssText = "margin-top:10px; min-height:1.2em; font-weight:700; color:#ff8a8a;";

    if (mode === "accepter") {
      var bA = bouton("✅ ACCEPTER LA COURSE", "#1f8a4c", "1.75rem");
      bA.style.padding = "28px 14px";
      bA.addEventListener("click", function (e) {
        try { e.stopPropagation(); } catch (_) {}
        bA.disabled = true; bA.textContent = "⏳ …";
        accepter(c).then(function (ok) {
          if (!ok) { bA.disabled = false; bA.textContent = "✅ ACCEPTER LA COURSE"; msg.textContent = "Échec : réessaie (vérifie ta connexion)."; return; }
          enAttente = enAttente.filter(function (x) { return x.id !== c.id; });
          var m = minutesAvant(c);
          ouvrirOverlay(c, m === null || m <= 30 ? "demarrer" : "plus-tard");
        }).catch(function (err) { log("accepter", err); bA.disabled = false; bA.textContent = "✅ ACCEPTER LA COURSE"; });
      });
      zone.appendChild(bA);
      var lm = lien("Masquer 2 minutes");
      lm.addEventListener("click", function () { masqueJusqua = Date.now() + 120000; fermerOverlay(); });
      zone.appendChild(msg); zone.appendChild(lm);
    } else if (mode === "demarrer") {
      var bD = bouton("🚖 DÉMARRER LA COURSE", "#1f8a4c", "1.75rem");
      bD.style.padding = "28px 14px";
      bD.addEventListener("click", function () { fermerOverlay(); demarrer(c); });
      zone.appendChild(bD);
      var lp = lien("Plus tard");
      lp.addEventListener("click", function () { fermerOverlay(); suiteOverlay(); });
      zone.appendChild(lp);
    } else {
      var info = document.createElement("div");
      info.style.cssText = "margin-top:16px; font-size:1.3rem; font-weight:800;";
      var d = new Date(c.date_heure);
      info.textContent = "Course acceptée pour " + (isFinite(d.getTime()) ? jourHM(d) : "?");
      zone.appendChild(info);
      var bOk = bouton("OK", "#1d4f86", "1.6rem");
      bOk.addEventListener("click", function () { fermerOverlay(); suiteOverlay(); });
      zone.appendChild(bOk);
    }
    o.appendChild(zone);
    document.body.appendChild(o);
    overlay = o; overlayCourseId = c.id; overlayMode = mode;
  }
  function suiteOverlay() {
    // Courses suivantes en attente : une par une
    try { rafraichir(); } catch (e) {}
  }

  // ---------- Actions (même logique que chauffeur.html) ----------
  async function accepter(c) {
    try {
      if (!SUR_FEUILLE && typeof window.accepterCourse === "function") {
        await window.accepterCourse(c.id);             // fonction existante de l'app chauffeur
        var sb0 = client();
        try {
          var r0 = await sb0.from("courses").select("id, accepte_chauffeur").eq("id", c.id).maybeSingle();
          if (r0 && r0.data) return !!r0.data.accepte_chauffeur;
        } catch (e) {}
        return true;
      }
      var payload = { accepte_chauffeur: true, accepte_a: new Date().toISOString() };
      var res;
      if (window.TWHL && typeof TWHL.ecrire === "function") {
        res = await TWHL.ecrire({ table: "courses", op: "update", match: { id: c.id }, payload: payload,
          select: "id", verifier: true, optimiste: [{ id: c.id }], label: "Accepter la course" });
      } else {
        var sb = client(); if (!sb) return false;
        res = await sb.from("courses").update(payload).eq("id", c.id).select("id");
      }
      if (res && res.error) { log("acceptation refusée", res.error); return false; }
      if (!res || !res.data || !res.data.length) { try { alert("❌ Course retirée par la centrale : elle n'est plus à toi."); } catch (e) {} return false; }
      return true;
    } catch (e) { log("accepter", e); return false; }
  }
  async function demarrer(c) {
    try {
      if (SUR_FEUILLE) { location.href = "chauffeur.html?ca_demarrer=" + encodeURIComponent(c.id); return; }
      // App chauffeur : on clique le vrai bouton « Démarrer » de la carte (même confirmation, même code)
      var btn = document.querySelector('#liste-courses [data-course-id="' + String(c.id).replace(/"/g, "") + '"] .btn-demarrer-course');
      if (btn) { btn.click(); return; }
      if (typeof window.demarrerCourse === "function") {
        var ok = typeof window.confirmerDansPage === "function"
          ? await window.confirmerDansPage("Avant de démarrer :\n\n1) Taximètre si besoin\n2) Complète ta feuille de route\n\nContinuer et démarrer la course ?", "▶️ Oui, démarrer", "Annuler")
          : confirm("Démarrer la course ?");
        if (ok) await window.demarrerCourse(c.id, false);
      }
    } catch (e) { log("demarrer", e); }
  }

  // ---------- Bandeau « prochaine course » ----------
  function majBandeau() {
    try {
      var b = document.getElementById("course-alerte-bandeau");
      var limite = Date.now() - 6 * 3600 * 1000;
      var proche = acceptees.filter(function (c) { var t = new Date(c.date_heure).getTime(); return isFinite(t) && t >= limite; })[0];
      if (!proche) { if (b) b.remove(); return; }
      if (!b) {
        b = document.createElement("div");
        b.id = "course-alerte-bandeau";
        b.setAttribute("role", "button"); b.tabIndex = 0;
        b.style.cssText = "position:relative; z-index:50; display:block; box-sizing:border-box; width:100%; background:#1f8a4c; color:#fff; " +
          "font:700 .95rem/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; padding:calc(env(safe-area-inset-top,0px) + 8px) 12px 8px; " +
          "white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; text-align:left;";
        b.addEventListener("click", function () {
          try { var c = acceptees.filter(function (x) { return x.id === b.dataset.id; })[0]; if (c) ouvrirOverlay(c, "demarrer"); } catch (e) {}
        });
        document.body.insertBefore(b, document.body.firstChild);
      }
      b.dataset.id = proche.id;
      var d = new Date(proche.date_heure);
      b.textContent = "🚖 Prochaine course : " + heureHM(d) + (d.toDateString() !== new Date().toDateString() ? " (" + jourHM(d) + ")" : "") +
        " – " + (proche.adresse_depart || "?") + " → " + (proche.adresse_arrivee || "?");
    } catch (e) { log("bandeau", e); }
  }

  // ---------- Lecture des courses ----------
  async function rafraichir() {
    if (enCours) return;
    enCours = true;
    try {
      if (horsLigne()) return;                       // hors ligne : on n'affiche rien de nouveau
      var sb = client(); if (!sb) return;
      if (!uid) uid = await lireUid();
      if (!uid) return;
      abonner();
      var r = await sb.from("courses").select(CHAMPS).eq("chauffeur_id", uid).eq("statut", "assignee").order("date_heure", { ascending: true });
      if (!r || r.error || !Array.isArray(r.data)) return;
      enAttente = r.data.filter(function (c) { return !c.accepte_chauffeur; });
      acceptees = r.data.filter(function (c) { return !!c.accepte_chauffeur; });
      majBandeau();

      // Overlay courant devenu obsolète (acceptée ailleurs / retirée) : on le ferme
      if (overlay && overlayMode === "accepter" && !enAttente.some(function (c) { return c.id === overlayCourseId; })) fermerOverlay();
      if (overlay && overlayMode !== "accepter" && !acceptees.some(function (c) { return c.id === overlayCourseId; })) fermerOverlay();

      if (!overlay && enAttente.length && Date.now() >= masqueJusqua) {
        var c = enAttente[0];
        ouvrirOverlay(c, "accepter");
        if (!vues[c.id]) { vues[c.id] = 1; alerter(); }
      }
    } catch (e) { log("rafraichir", e); }
    finally { enCours = false; }
  }

  function abonner() {
    try {
      if (canal || !uid) return;
      var sb = client(); if (!sb || typeof sb.channel !== "function") return;
      canal = sb.channel("course-alerte-" + uid)
        .on("postgres_changes", { event: "*", schema: "public", table: "courses", filter: "chauffeur_id=eq." + uid },
          function () { setTimeout(rafraichir, 400); })
        .subscribe();
    } catch (e) { log("realtime", e); canal = null; }
  }

  // Arrivée depuis la feuille de route avec « Démarrer » : ?ca_demarrer=<id>
  async function demarrerDepuisUrl() {
    try {
      if (SUR_FEUILLE) return;
      var id = new URLSearchParams(location.search).get("ca_demarrer");
      if (!id) return;
      try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) {}
      for (var i = 0; i < 20; i++) {                 // attend la connexion et la liste (max ~20 s)
        await new Promise(function (r) { setTimeout(r, 1000); });
        var sb = client(); if (!sb) continue;
        if (!uid) uid = await lireUid();
        if (!uid) continue;
        var r = await sb.from("courses").select(CHAMPS).eq("id", id).maybeSingle();
        if (r && r.data && r.data.statut === "assignee" && r.data.chauffeur_id === uid) {
          if (!document.querySelector('#liste-courses [data-course-id="' + String(id).replace(/"/g, "") + '"]') && i < 8) continue;
          ouvrirOverlay(r.data, "demarrer");
        }
        return;
      }
    } catch (e) { log("url", e); }
  }

  function demarrer_() {
    try {
      setTimeout(rafraichir, 2500);
      setInterval(rafraichir, POLL_MS);
      document.addEventListener("visibilitychange", function () { try { if (document.visibilityState === "visible") setTimeout(rafraichir, 500); } catch (e) {} });
      window.addEventListener("online", function () { setTimeout(rafraichir, 1500); });
      demarrerDepuisUrl();
    } catch (e) { log("init", e); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer_);
  else demarrer_();
})();
