/* Taxi Wal Driver — notifications natives (iPhone / Android)
   Ce script ne fait rien dans un navigateur normal : il s'active seulement dans l'app
   Taxi Wal Driver, quand le module PushNotifications de Capacitor est présent.
   Il enregistre l'adresse de notification du téléphone dans Supabase
   (fonction enregistrer_token_push_natif), pour que le serveur puisse prévenir
   le chauffeur ou l'admin même quand l'app est fermée. */
(function () {
  "use strict";
  var Cap = window.Capacitor;
  var natif = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  var Push = natif && Cap.Plugins ? Cap.Plugins.PushNotifications : null;
  if (!natif || !Push) return;

  window.TAXIWAL_PUSH_NATIF = true;
  var plateforme = (Cap.getPlatform && Cap.getPlatform()) || "ios";
  var dernierToken = null;
  var enregistrementEnCours = false;

  // Le client Supabase de la page (déclaré « let supabase » dans le script principal)
  function clientSupabase() {
    try { if (typeof supabase !== "undefined" && supabase && supabase.auth) return supabase; } catch (e) {}
    return null;
  }

  // Petit message en haut de l'écran quand une notification arrive app ouverte
  function afficherBandeau(titre, corps) {
    try {
      var d = document.createElement("div");
      d.style.cssText = "position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 10px);z-index:99999;" +
        "background:#fff;border-left:6px solid #c81e2c;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.25);" +
        "padding:12px 14px;font-family:-apple-system,system-ui,sans-serif;color:#111;";
      var t = document.createElement("div"); t.style.cssText = "font-weight:800;margin-bottom:3px;"; t.textContent = titre || "Taxi Wal";
      var c = document.createElement("div"); c.style.cssText = "font-size:.9rem;color:#333;"; c.textContent = corps || "";
      d.appendChild(t); d.appendChild(c);
      d.addEventListener("click", function () { d.remove(); });
      document.body.appendChild(d);
      setTimeout(function () { try { d.remove(); } catch (e) {} }, 7000);
    } catch (e) {}
  }

  function rafraichirPage() {
    try { if (typeof window.chargerCourses === "function") window.chargerCourses(); } catch (e) {}
    try { if (typeof chargerCourses === "function") chargerCourses(); } catch (e) {}
    try { if (typeof chargerCoursesAdmin === "function") chargerCoursesAdmin(true); } catch (e) {}
  }

  async function envoyerToken(token) {
    var sb = clientSupabase();
    if (!sb || !token) return;
    try {
      var r = await sb.auth.getUser();
      if (!r || !r.data || !r.data.user) return;
      var res = await sb.rpc("enregistrer_token_push_natif", { p_token: token, p_plateforme: plateforme });
      if (res && res.error) console.error("Token notifications :", res.error.message);
    } catch (e) { console.error("Token notifications :", e); }
  }

  // Demande l'autorisation puis inscrit le téléphone auprès d'Apple / Google
  async function activer() {
    if (enregistrementEnCours) return;
    enregistrementEnCours = true;
    try {
      var perm = await Push.checkPermissions();
      if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await Push.requestPermissions();
      if (perm.receive !== "granted") {
        console.warn("Notifications refusées par l'utilisateur");
        return;
      }
      await Push.register();
    } catch (e) { console.error("Notifications :", e); }
    finally { enregistrementEnCours = false; }
  }
  window.TaxiWalPush = { activer: activer };

  Push.addListener("registration", function (t) {
    dernierToken = t && t.value;
    envoyerToken(dernierToken);
  });
  Push.addListener("registrationError", function (e) { console.error("Inscription notifications :", e); });
  Push.addListener("pushNotificationReceived", function (n) {
    afficherBandeau(n && n.title, n && n.body);
    rafraichirPage();
  });
  Push.addListener("pushNotificationActionPerformed", function () { rafraichirPage(); });

  // Masque l'ancien bandeau « notifications désactivées » (prévu pour la version web)
  function masquerAncienBandeau() {
    var b = document.getElementById("bandeau-notifs");
    if (b) b.style.display = "none";
  }

  // Attend que la page ait créé son client Supabase et qu'un utilisateur soit connecté
  var essais = 0;
  var attente = setInterval(async function () {
    essais++;
    masquerAncienBandeau();
    var sb = clientSupabase();
    if (!sb) { if (essais > 60) clearInterval(attente); return; }
    clearInterval(attente);
    try {
      var r = await sb.auth.getUser();
      if (r && r.data && r.data.user) activer();
      sb.auth.onAuthStateChange(function (evt) {
        if (evt === "SIGNED_IN") { if (dernierToken) envoyerToken(dernierToken); else activer(); }
      });
    } catch (e) {}
  }, 500);
  setInterval(masquerAncienBandeau, 3000);
})();
