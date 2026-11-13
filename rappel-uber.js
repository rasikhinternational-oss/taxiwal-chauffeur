// ================== 📸 FIN DE SERVICE UBER : « Uber éteint » + capture d'écran du jour ==================
// Rangé à part de la feuille de route : lié au chauffeur + date de service (tables fin_service_uber / captures_uber,
// bucket privé « captures-uber »). Le rappel s'ouvre juste après la clôture de la feuille et revient à chaque
// ouverture de l'app tant que les deux étapes ne sont pas faites. Ne bloque jamais la clôture.
// Hors ligne : images gardées sur le téléphone (IndexedDB) et envoyées au retour du réseau.
(function () {
  "use strict";
  var BUCKET = "captures-uber";
  var CLE_RAPPELS = "taxiwal_rappels_uber";       // [{ date, feuille, eteint, capture, pasUber }]
  var CLE_ETATS = "taxiwal_fin_uber_a_envoyer";   // [{ date, feuille, uber_eteint_a?, pas_uber? }]
  var memoireCaptures = [];                        // repli si IndexedDB indisponible
  var envoiEnCours = false;

  function sb() { try { return supabase; } catch (e) { return null; } }
  function lire(cle) { try { return JSON.parse(localStorage.getItem(cle) || "[]") || []; } catch (e) { return []; } }
  function ecrire(cle, v) { try { localStorage.setItem(cle, JSON.stringify(v)); } catch (e) {} }
  function aujourdhui() { var x = new Date(); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); }
  function dateFr(d) { try { return new Date(d + "T12:00:00").toLocaleDateString("fr-BE", { weekday: "long", day: "2-digit", month: "2-digit" }); } catch (e) { return d; } }
  function nouvelId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
  }
  async function uid() {
    var c = sb(); if (!c) return null;
    try { var r = await c.auth.getSession(); return r && r.data && r.data.session ? r.data.session.user.id : null; } catch (e) { return null; }
  }

  // ---- rappels en attente (sur le téléphone) ----
  function rappel(date) { return lire(CLE_RAPPELS).find(function (r) { return r.date === date; }); }
  function majRappel(date, champs) {
    var l = lire(CLE_RAPPELS), r = l.find(function (x) { return x.date === date; });
    if (!r) { r = { date: date }; l.push(r); }
    Object.assign(r, champs);
    ecrire(CLE_RAPPELS, l.slice(-10));
  }

  // ---- file d'attente des images (IndexedDB) ----
  var dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (ok) {
      try {
        var req = indexedDB.open("taxiwal-captures-uber", 1);
        req.onupgradeneeded = function () { req.result.createObjectStore("captures", { keyPath: "id" }); };
        req.onsuccess = function () { ok(req.result); };
        req.onerror = function () { ok(null); };
      } catch (e) { ok(null); }
    });
    return dbP;
  }
  async function fileAjouter(o) {
    var d = await db();
    if (!d) { memoireCaptures.push(o); return; }
    await new Promise(function (ok) { var t = d.transaction("captures", "readwrite"); t.objectStore("captures").put(o); t.oncomplete = ok; t.onerror = ok; });
  }
  async function fileListe() {
    var d = await db();
    if (!d) return memoireCaptures.slice();
    return new Promise(function (ok) { var r = d.transaction("captures").objectStore("captures").getAll(); r.onsuccess = function () { ok(r.result || []); }; r.onerror = function () { ok([]); }; });
  }
  async function fileRetirer(id) {
    var d = await db();
    if (!d) { memoireCaptures = memoireCaptures.filter(function (x) { return x.id !== id; }); return; }
    await new Promise(function (ok) { var t = d.transaction("captures", "readwrite"); t.objectStore("captures").delete(id); t.oncomplete = ok; t.onerror = ok; });
  }

  // ---- compression ~1600 px JPEG ----
  function compresser(fichier) {
    return new Promise(function (ok) {
      var url = URL.createObjectURL(fichier), img = new Image();
      img.onload = function () {
        var max = 1600, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { ok(b || fichier); }, "image/jpeg", 0.8);
      };
      img.onerror = function () { URL.revokeObjectURL(url); ok(fichier); };
      img.src = url;
    });
  }

  // ---- envoi (images + états), relancé au retour du réseau ----
  async function envoyerTout() {
    if (envoiEnCours || !navigator.onLine) return;
    var c = sb(), u = await uid(); if (!c || !u) return;
    envoiEnCours = true;
    try {
      var etats = lire(CLE_ETATS), restants = [];
      for (var i = 0; i < etats.length; i++) {
        var e = etats[i], ligne = { chauffeur_id: u, date_service: e.date };
        if (e.feuille) ligne.feuille_route_id = e.feuille;
        if (e.uber_eteint_a) ligne.uber_eteint_a = e.uber_eteint_a;
        if (e.pas_uber) ligne.pas_uber = true;
        var r = await c.from("fin_service_uber").upsert(ligne, { onConflict: "chauffeur_id,date_service" });
        if (r.error && r.error.code === "23503") { delete ligne.feuille_route_id; r = await c.from("fin_service_uber").upsert(ligne, { onConflict: "chauffeur_id,date_service" }); }
        if (r.error && !/row-level|violates/i.test(r.error.message)) restants.push(e);
      }
      ecrire(CLE_ETATS, restants);
      var liste = await fileListe();
      for (var j = 0; j < liste.length; j++) {
        var o = liste[j], chemin = u + "/" + o.date + "/" + o.id + ".jpg";
        var up = await c.storage.from(BUCKET).upload(chemin, o.blob, { contentType: "image/jpeg", upsert: false });
        if (up.error && !/exist|duplicate/i.test(up.error.message || "")) continue;
        var row = { id: o.id, chauffeur_id: u, date_service: o.date, chemin: chemin };
        if (o.feuille) row.feuille_route_id = o.feuille;
        var ins = await c.from("captures_uber").upsert(row, { onConflict: "id", ignoreDuplicates: true });
        if (ins.error && ins.error.code === "23503") { delete row.feuille_route_id; ins = await c.from("captures_uber").upsert(row, { onConflict: "id", ignoreDuplicates: true }); }
        if (!ins.error) await fileRetirer(o.id);
      }
    } catch (e) { console.warn(e); }
    envoiEnCours = false;
    rendre();
  }
  function noterEtat(date, feuille, champs) {
    var l = lire(CLE_ETATS), e = l.find(function (x) { return x.date === date; });
    if (!e) { e = { date: date }; l.push(e); }
    if (feuille) e.feuille = feuille;
    Object.assign(e, champs);
    ecrire(CLE_ETATS, l);
    envoyerTout();
  }

  // ---- fenêtre ----
  var courant = null; // { date, feuille, obligatoire }
  function style() {
    if (document.getElementById("style-rappel-uber")) return;
    var s = document.createElement("style"); s.id = "style-rappel-uber";
    s.textContent = "#rappel-uber{position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.6);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:calc(env(safe-area-inset-top,0px) + 14px) 12px 30px;font-family:inherit}"
      + "#rappel-uber .ru-boite{background:#fff;color:#111;border-radius:16px;max-width:460px;width:100%;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.3)}"
      + "#rappel-uber h2{margin:0 0 10px;font-size:1.15rem;color:#1f6b3f}"
      + "#rappel-uber .ru-etape{border:2px solid #e3e3e0;border-radius:12px;padding:12px;margin-bottom:12px}"
      + "#rappel-uber .ru-etape.fait{border-color:#1f8a4c;background:#eef8f1}"
      + "#rappel-uber .ru-titre{font-weight:800;font-size:1.02rem;margin-bottom:8px}"
      + "#rappel-uber label.ru-case{display:flex;gap:10px;align-items:center;font-weight:700;font-size:1rem}"
      + "#rappel-uber label.ru-case input{width:26px;height:26px;flex-shrink:0}"
      + "#rappel-uber button{width:100%;padding:14px;border-radius:12px;border:none;font-weight:800;font-size:1rem;margin-top:8px;cursor:pointer}"
      + "#rappel-uber .ru-envoyer{background:#111;color:#fff;font-size:1.08rem}"
      + "#rappel-uber .ru-pas{background:#f0f1ee;color:#333}"
      + "#rappel-uber .ru-fermer{background:#1f8a4c;color:#fff}"
      + "#rappel-uber .ru-fermer:disabled{opacity:.45}"
      + "#rappel-uber .ru-vignettes{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}"
      + "#rappel-uber .ru-vignettes img{width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid #ccc}"
      + "#rappel-uber .ru-info{font-size:.85rem;color:#555;margin-top:6px}";
    document.head.appendChild(s);
  }
  var urlsVignettes = [];
  async function rendre() {
    var z = document.getElementById("rappel-uber");
    if (!z || !courant) return;
    var r = rappel(courant.date) || {};
    try {
      var c0 = sb(), u0 = await uid();
      if (c0 && u0) {
        var f0 = await c0.from("fin_service_uber").select("uber_eteint_a, pas_uber").eq("chauffeur_id", u0).eq("date_service", courant.date).maybeSingle();
        var k0 = await c0.from("captures_uber").select("id").eq("chauffeur_id", u0).eq("date_service", courant.date).limit(1);
        var maj = {};
        if (f0 && f0.data && f0.data.uber_eteint_a) maj.eteint = true;
        if (f0 && f0.data && f0.data.pas_uber) maj.pasUber = true;
        if (k0 && k0.data && k0.data.length) maj.capture = true;
        if (Object.keys(maj).length) { majRappel(courant.date, maj); r = rappel(courant.date) || r; }
      }
    } catch (e) {}
    if (!document.getElementById("rappel-uber") || !courant) return;
    var enAttente = (await fileListe()).filter(function (o) { return o.date === courant.date; });
    urlsVignettes.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }); urlsVignettes = [];
    var vign = enAttente.map(function (o) { var u = URL.createObjectURL(o.blob); urlsVignettes.push(u); return '<img src="' + u + '" alt="">'; }).join("");
    var etape2Faite = !!(r.capture || r.pasUber);
    z.innerHTML = '<div class="ru-boite">'
      + (courant.obligatoire ? '<h2>✅ Feuille clôturée.</h2><p style="margin:0 0 12px;font-weight:600;">Encore deux choses à faire, dans cet ordre :</p>' : '<h2>📸 Uber du jour</h2>')
      + '<div class="ru-info" style="margin:0 0 10px;">Service du <b>' + dateFr(courant.date) + '</b></div>'
      + '<div class="ru-etape' + (r.eteint ? " fait" : "") + '"><div class="ru-titre">1) 🔴 Éteins ton application Uber (passe HORS LIGNE)</div>'
      + '<div class="ru-info" style="margin:0 0 8px;">Sinon le chauffeur suivant ne pourra pas passer en ligne avec cette voiture.</div>'
      + '<label class="ru-case"><input type="checkbox" class="ru-eteint"' + (r.eteint ? " checked disabled" : "") + '> ✅ J\'ai bien éteint mon Uber</label></div>'
      + '<div class="ru-etape' + (etape2Faite ? " fait" : "") + '"><div class="ru-titre">2) 📸 Envoie la capture d\'écran de ton Uber du jour</div>'
      + '<div class="ru-info" style="margin:0 0 4px;">Le résumé du jour : total gagné et surtout le montant reçu en cash. Plusieurs images possibles.</div>'
      + '<button type="button" class="ru-envoyer">📸 Envoyer la capture Uber</button>'
      + '<input type="file" accept="image/*" multiple class="ru-fichier" style="display:none">'
      + '<div class="ru-vignettes">' + vign + '</div>'
      + (enAttente.length ? '<div class="ru-info">⏳ ' + enAttente.length + ' image(s) en attente d\'envoi — elles partiront toutes seules dès qu\'il y a du réseau.</div>' : "")
      + (r.capture ? '<div class="ru-info" style="color:#1f6b3f;font-weight:700;">✅ Capture ajoutée</div>' : "")
      + (r.pasUber ? '<div class="ru-info" style="color:#1f6b3f;font-weight:700;">✅ Noté : pas d\'Uber aujourd\'hui</div>' : '<button type="button" class="ru-pas">🚫 Pas d\'Uber aujourd\'hui</button>')
      + '</div>'
      + '<button type="button" class="ru-fermer">' + (r.eteint && etape2Faite ? "✅ Terminé" : (courant.obligatoire ? "Plus tard (le rappel reviendra)" : "Fermer")) + '</button>'
      + (courant.obligatoire && !r.eteint ? '<div class="ru-info" style="text-align:center;">Coche d\'abord « J\'ai bien éteint mon Uber » pour fermer.</div>' : "")
      + '</div>';
    var fermer = z.querySelector(".ru-fermer");
    fermer.disabled = !!(courant.obligatoire && !r.eteint);
    fermer.onclick = function () { if (!fermer.disabled) fermerFenetre(); };
    var cb = z.querySelector(".ru-eteint");
    cb.onchange = function () {
      if (!cb.checked) return;
      majRappel(courant.date, { eteint: true });
      noterEtat(courant.date, courant.feuille, { uber_eteint_a: new Date().toISOString() });
      rendre();
    };
    var fi = z.querySelector(".ru-fichier");
    z.querySelector(".ru-envoyer").onclick = function () { fi.click(); };
    fi.onchange = async function () {
      var fichiers = Array.prototype.slice.call(fi.files || []);
      if (!fichiers.length) return;
      for (var i = 0; i < fichiers.length; i++) {
        var b = await compresser(fichiers[i]);
        await fileAjouter({ id: nouvelId(), date: courant.date, feuille: courant.feuille || null, blob: b, ajoutee: Date.now() });
      }
      majRappel(courant.date, { capture: true, pasUber: false });
      rendre();
      envoyerTout();
    };
    var pas = z.querySelector(".ru-pas");
    if (pas) pas.onclick = function () {
      majRappel(courant.date, { pasUber: true });
      noterEtat(courant.date, courant.feuille, { pas_uber: true });
      rendre();
    };
  }
  function fermerFenetre() {
    try { ecrire(CLE_RAPPELS, lire(CLE_RAPPELS).filter(function (x) { return !(x.eteint && (x.capture || x.pasUber)); })); } catch (e) {}
    var z = document.getElementById("rappel-uber"); if (z) z.remove();
    urlsVignettes.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }); urlsVignettes = [];
    courant = null;
  }
  function ouvrir(date, feuille, obligatoire) {
    style();
    courant = { date: date || aujourdhui(), feuille: feuille || null, obligatoire: !!obligatoire };
    var z = document.getElementById("rappel-uber");
    if (!z) { z = document.createElement("div"); z.id = "rappel-uber"; document.body.appendChild(z); }
    rendre();
  }

  // Juste après la clôture / signature de la feuille (feuille-de-route.html)
  function apresCloture(feuille) {
    try {
      var date = (feuille && feuille.date_service) || aujourdhui();
      var r = rappel(date);
      majRappel(date, { feuille: feuille && feuille.id ? feuille.id : (r && r.feuille) || null, eteint: false, capture: !!(r && r.capture), pasUber: !!(r && r.pasUber) });
      ouvrir(date, feuille && feuille.id, true);
    } catch (e) { console.warn(e); }
  }
  // À l'ouverture de l'app : le rappel revient tant que les deux étapes ne sont pas faites
  async function verifierAuDemarrage() {
    if (!(await uid())) { setTimeout(verifierAuDemarrage, 15000); return; } // pas encore connecté
    try { await envoyerTout(); } catch (e) {}
    try {
      // Nettoyage : rappels de plus de 3 jours, ou déjà faits côté serveur
      var limite = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
      var tous = lire(CLE_RAPPELS).filter(function (r) { return r.date && r.date >= limite; });
      var c = sb(), u = await uid();
      if (c && u && tous.length) {
        var dates = tous.map(function (r) { return r.date; });
        var fins = await c.from("fin_service_uber").select("date_service, uber_eteint_a, pas_uber").eq("chauffeur_id", u).in("date_service", dates);
        var caps = await c.from("captures_uber").select("date_service").eq("chauffeur_id", u).in("date_service", dates);
        var faits = {};
        ((fins && fins.data) || []).forEach(function (f) { faits[f.date_service] = { eteint: !!f.uber_eteint_a, pas: !!f.pas_uber }; });
        ((caps && caps.data) || []).forEach(function (x) { faits[x.date_service] = faits[x.date_service] || {}; faits[x.date_service].cap = true; });
        tous.forEach(function (r) {
          var f = faits[r.date];
          if (f) { if (f.eteint) r.eteint = true; if (f.cap) r.capture = true; if (f.pas) r.pasUber = true; }
        });
      }
      tous = tous.filter(function (r) { return !(r.eteint && (r.capture || r.pasUber)); });
      ecrire(CLE_RAPPELS, tous);
      if (tous.length && !document.getElementById("rappel-uber")) ouvrir(tous[0].date, tous[0].feuille, true);
    } catch (e) {}
  }
  // Bouton accessible à tout moment (chauffeur.html)
  function ouvrirManuel() {
    var l = lire(CLE_RAPPELS);
    var r = l.length ? l[l.length - 1] : null;
    ouvrir(r ? r.date : aujourdhui(), r ? r.feuille : null, !!r);
  }

  window.addEventListener("online", envoyerTout);
  setInterval(function () { if (document.visibilityState === "visible") envoyerTout(); }, 60000);
  window.RappelUber = { apresCloture: apresCloture, verifierAuDemarrage: verifierAuDemarrage, ouvrir: ouvrirManuel, envoyer: envoyerTout };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(verifierAuDemarrage, 1500); });
  else setTimeout(verifierAuDemarrage, 1500);
})();
