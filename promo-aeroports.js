// Écran promo « transfert aéroport » — app client Taxi Wal. Affiché au maximum une fois par jour.
(function () {
  try {
    var CLE = "tw_promo_aeroports_vu";
    var auj = new Date().toISOString().slice(0, 10);
    try { if (localStorage.getItem(CLE) === auj) return; } catch (e) {}
    if (/[?&]promo=0/.test(location.search)) return;
    var L = (typeof LANG !== "undefined" && LANG) || "fr";
    var TX = {
      fr: { t1: "Votre transfert aéroport", t2: "au départ de Mons", sous: "Tous les aéroports, en Belgique et chez nos voisins", flotte: "Notre flotte",
        merc: "Mercedes Classe E · luxe & affaires", van: "Renault Trafic · van 7 places", berl: "Toyota · berline confort",
        a: ["Prix fixe annoncé", "Aide aux bagages", "Suivi de votre vol", "24h/24 · 7j/7", "Van 7 places", "Paiement carte ou cash"],
        res: "Réserver mon transfert", pays: "🇧🇪 Belgique · 🇫🇷 France · 🇳🇱 Pays-Bas · 🇩🇪 Allemagne · 🇱🇺 Luxembourg", fermer: "Fermer" },
      nl: { t1: "Uw luchthavenvervoer", t2: "vanuit Bergen (Mons)", sous: "Alle luchthavens, in België en de buurlanden", flotte: "Onze wagens",
        merc: "Mercedes E-Klasse · luxe & zakelijk", van: "Renault Trafic · busje 7 plaatsen", berl: "Toyota · comfortabele sedan",
        a: ["Vaste prijs vooraf", "Hulp met bagage", "Opvolging van uw vlucht", "24/7", "Busje 7 plaatsen", "Betalen met kaart of cash"],
        res: "Mijn rit reserveren", pays: "🇧🇪 België · 🇫🇷 Frankrijk · 🇳🇱 Nederland · 🇩🇪 Duitsland · 🇱🇺 Luxemburg", fermer: "Sluiten" },
      en: { t1: "Your airport transfer", t2: "from Mons", sous: "All airports, in Belgium and neighbouring countries", flotte: "Our fleet",
        merc: "Mercedes E-Class · luxury & business", van: "Renault Trafic · 7-seat van", berl: "Toyota · comfort saloon",
        a: ["Fixed price upfront", "Help with luggage", "Flight tracking", "24/7", "7-seat van", "Card or cash"],
        res: "Book my transfer", pays: "🇧🇪 Belgium · 🇫🇷 France · 🇳🇱 Netherlands · 🇩🇪 Germany · 🇱🇺 Luxembourg", fermer: "Close" }
    };
    var x = TX[L] || TX.fr;
    var SVG = "<svg viewBox=\"-70 20 820 570\"><path d=\"M243,311 Q268,208 294,248\" class=\"trait be\"/><path d=\"M243,311 Q267,270 291,310\" class=\"trait be\"/><path d=\"M243,311 Q314,244 385,284\" class=\"trait be\"/><path d=\"M243,311 Q191,166 140,206\" class=\"trait be\"/><path d=\"M243,311 Q267,167 292,207\" class=\"trait be\"/><path d=\"M243,311 Q202,256 162,296\" class=\"trait\"/><path d=\"M243,311 Q177,271 110,513\" class=\"trait\"/><path d=\"M243,311 Q168,271 92,552\" class=\"trait\"/><path d=\"M243,311 Q156,271 68,451\" class=\"trait\"/><path d=\"M243,311 Q282,11 320,51\" class=\"trait\"/><path d=\"M243,311 Q312,131 380,171\" class=\"trait\"/><path d=\"M243,311 Q377,153 511,193\" class=\"trait\"/><path d=\"M243,311 Q395,212 546,252\" class=\"trait\"/><path d=\"M243,311 Q463,271 682,370\" class=\"trait\"/><path d=\"M243,311 Q351,271 458,426\" class=\"trait\"/><g><circle cx=\"294\" cy=\"248\" r=\"7\" class=\"pt\"/><text x=\"299\" y=\"253\" class=\"avion\" text-anchor=\"middle\">\u2708</text><text x=\"304\" y=\"252\" class=\"nom\">Bruxelles-Zaventem</text></g><g><circle cx=\"291\" cy=\"310\" r=\"7\" class=\"pt\"/><text x=\"296\" y=\"314\" class=\"avion\" text-anchor=\"middle\">\u2708</text><text x=\"301\" y=\"326\" class=\"nom\">Charleroi</text></g><g><circle cx=\"385\" cy=\"284\" r=\"7\" class=\"pt\"/><text x=\"390\" y=\"289\" class=\"avion\" text-anchor=\"middle\">\u2708</text><text x=\"395\" y=\"288\" class=\"nom\">Li\u00e8ge</text></g><g><circle cx=\"140\" cy=\"206\" r=\"7\" class=\"pt\"/><text x=\"145\" y=\"210\" class=\"avion\" text-anchor=\"middle\">\u2708</text><text x=\"78\" y=\"210\" class=\"nom\">Ostende</text></g><g><circle cx=\"292\" cy=\"207\" r=\"7\" class=\"pt\"/><text x=\"297\" y=\"212\" class=\"avion\" text-anchor=\"middle\">\u2708</text><text x=\"234\" y=\"201\" class=\"nom\">Anvers</text></g><g><circle cx=\"162\" cy=\"296\" r=\"7\" class=\"pt\"/><text x=\"167\" y=\"300\" class=\"avion\" text-anchor=\"middle\">\u2708</text><text x=\"104\" y=\"300\" class=\"nom\">Lille</text></g><g><circle cx=\"110\" cy=\"513\" r=\"7\" class=\"pt\"/><text x=\"115\" y=\"517\" class=\"avion\" text-anchor=\"middle\">\u2708</text><text x=\"120\" y=\"517\" class=\"nom\">Paris-CDG</text></g><g><circle cx=\"92\" cy=\"552\" r=\"7\" class=\"pt\"/><text x=\"97\" y=\"556\" class=\"avion\" text-anchor=\"middle\">\u2708</text><text x=\"102\" y=\"566\" class=\"nom\">Paris-Orly</text></g><g><circle cx=\"68\" cy=\"451\" r=\"7\" class=\"pt\"/><text x=\"73\" y=\"455\" class=\"avion\" text-anchor=\"middle\">\u2708</text><text x=\"-2\" y=\"455\" class=\"nom\">Beauvais</text></g><g><circle cx=\"320\" cy=\"51\" r=\"7\" class=\"pt\"/><text x=\"325\" y=\"55\" class=\"avion\" text-anchor=\"middle\">\u2708</text><text x=\"330\" y=\"55\" class=\"nom\">Amsterdam</text></g><g><circle cx=\"380\" cy=\"171\" r=\"7\" class=\"pt\"/><text x=\"385\" y=\"175\" class=\"avion\" text-anchor=\"middle\">\u2708</text><text x=\"390\" y=\"175\" class=\"nom\">Eindhoven</text></g><g><circle cx=\"511\" cy=\"193\" r=\"7\" class=\"pt\"/><text x=\"516\" y=\"198\" class=\"avion\" text-anchor=\"middle\">\u2708</text><text x=\"521\" y=\"197\" class=\"nom\">D\u00fcsseldorf</text></g><g><circle cx=\"546\" cy=\"252\" r=\"7\" class=\"pt\"/><text x=\"551\" y=\"257\" class=\"avion\" text-anchor=\"middle\">\u2708</text><text x=\"556\" y=\"256\" class=\"nom\">Cologne-Bonn</text></g><g><circle cx=\"682\" cy=\"370\" r=\"7\" class=\"pt\"/><text x=\"687\" y=\"374\" class=\"avion\" text-anchor=\"middle\">\u2708</text><text x=\"610\" y=\"374\" class=\"nom\">Francfort</text></g><g><circle cx=\"458\" cy=\"426\" r=\"7\" class=\"pt\"/><text x=\"463\" y=\"430\" class=\"avion\" text-anchor=\"middle\">\u2708</text><text x=\"468\" y=\"430\" class=\"nom\">Luxembourg</text></g><text x=\"335\" y=\"365\" class=\"pays\">BELGIQUE</text><text x=\"400\" y=\"87\" class=\"pays\">PAYS-BAS</text><text x=\"560\" y=\"140\" class=\"pays\">ALLEMAGNE</text><text x=\"172\" y=\"479\" class=\"pays\">FRANCE</text><text x=\"420\" y=\"470\" class=\"pays\">LUX.</text><circle cx=\"243\" cy=\"311\" r=\"16\" class=\"mons-halo\"/><circle cx=\"243\" cy=\"311\" r=\"9\" class=\"mons\"/><text x=\"229\" y=\"341\" class=\"mons-t\">MONS</text></svg>";
    function afficher() {
      if (document.getElementById("tw-promo")) return;
      var st = document.createElement("style");
      st.textContent = "#tw-promo-fond{position:fixed;inset:0;z-index:99999;background:rgba(4,10,20,.72);overflow-y:auto;-webkit-overflow-scrolling:touch;padding:max(12px,env(safe-area-inset-top)) 10px 24px}" + "#tw-promo .carte-promo{max-width:430px;margin:0 auto;background:linear-gradient(180deg,#0e2340,#0b1a2e 60%,#081322);color:#fff;border-radius:22px;overflow:hidden;position:relative;box-shadow:0 10px 40px #0008}#tw-promo .fermer{position:absolute;top:10px;right:10px;width:34px;height:34px;border-radius:50%;border:none;background:#ffffff22;color:#fff;font-size:18px}#tw-promo .entete{padding:20px 20px 4px}#tw-promo .logo{display:inline-block;background:#ffd400;color:#1d3f8f;font-weight:900;padding:3px 10px;border-radius:6px;font-size:14px;letter-spacing:.5px}#tw-promo h1{margin:10px 0 2px;font-size:26px;line-height:1.1;font-weight:800}#tw-promo h1 span{color:#ffd400}#tw-promo .sous{color:#b9c7dc;font-size:14px}#tw-promo svg{width:100%;display:block}#tw-promo .trait{fill:none;stroke:#ffd40066;stroke-width:1.6;stroke-dasharray:4 4}#tw-promo .trait.be{stroke:#ffd400;stroke-width:2.2}#tw-promo .pt{fill:#ffd400}#tw-promo .avion{font-size:9px;fill:#0b1a2e}#tw-promo .nom{fill:#fff;font-size:12.5px;font-weight:600;paint-order:stroke;stroke:#0b1a2e;stroke-width:3px}#tw-promo .pays{fill:#ffffff30;font-size:19px;font-weight:800;letter-spacing:2px}#tw-promo .mons{fill:#ff3b30}#tw-promo .mons-halo{fill:#ff3b3044}#tw-promo .mons-t{fill:#fff;font-weight:900;font-size:15px;paint-order:stroke;stroke:#0b1a2e;stroke-width:4px}#tw-promo .photos{padding:0 16px}#tw-promo .photos .hero{position:relative;border-radius:16px;overflow:hidden;aspect-ratio:4/3;border:2px solid #ffd40088}#tw-promo .hero span{position:absolute;left:0;right:0;top:0;background:linear-gradient(#000c,transparent)!important;padding:18px 12px 8px;background:linear-gradient(transparent,#000c);font-weight:700;font-size:13px}#tw-promo .photos img{width:100%;height:100%;object-fit:cover;display:block}#tw-promo .photos small{display:block}#tw-promo .atouts{list-style:none;margin:12px 16px 0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;font-size:13.5px}#tw-promo .atouts li::before{content:\"\u2713 \";color:#ffd400;font-weight:900}#tw-promo .cta{padding:16px}#tw-promo .cta a{display:block;text-align:center;text-decoration:none;font-weight:800;border-radius:14px;padding:15px;font-size:17px}#tw-promo .reserver{background:#ffd400;color:#0b1a2e}#tw-promo .tel{margin-top:8px;color:#fff;border:1.5px solid #ffffff55;font-size:15px!important;padding:11px!important}#tw-promo .pays-bas{text-align:center;font-size:12px;color:#b9c7dc;padding:0 0 14px}#tw-promo .mini{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}#tw-promo .mini div{position:relative;border-radius:12px;overflow:hidden;aspect-ratio:4/3;border:2px solid #ffd40055}#tw-promo .mini img{width:100%;height:100%;object-fit:cover;display:block}#tw-promo .mini span{position:absolute;left:0;right:0;bottom:0;padding:14px 8px 6px;background:linear-gradient(transparent,#000c);font-weight:700;font-size:12px}#tw-promo .titre-flotte{font-weight:800;color:#ffd400;font-size:15px;letter-spacing:1px;text-transform:uppercase;margin:4px 0 8px}#tw-promo .hero img{width:100%;height:100%;object-fit:cover;object-position:center 85%;display:block}";
      document.head.appendChild(st);
      var fond = document.createElement("div");
      fond.id = "tw-promo-fond";
      fond.innerHTML = '<div id="tw-promo"><div class="carte-promo" role="dialog" aria-modal="true">'
        + '<button type="button" class="fermer" aria-label="' + x.fermer + '">✕</button>'
        + '<div class="entete"><span class="logo">TAXI WAL</span><h1>' + x.t1 + '<br><span>' + x.t2 + '</span></h1><div class="sous">' + x.sous + '</div></div>'
        + SVG
        + '<div class="photos"><div class="titre-flotte">' + x.flotte + '</div>'
        + '<div class="hero"><img src="promo-mercedes.jpg" alt=""><span>' + x.merc + '</span></div>'
        + '<div class="mini"><div><img src="promo-trafic.jpg" alt=""><span>' + x.van + '</span></div><div><img src="promo-toyota.jpg" alt=""><span>' + x.berl + '</span></div></div></div>'
        + '<ul class="atouts">' + x.a.map(function (s) { return "<li>" + s + "</li>"; }).join("") + '</ul>'
        + '<div class="cta"><a class="reserver" href="#">' + x.res + '</a><a class="tel" href="tel:+32495353594">📞 0495 35 35 94</a></div>'
        + '<div class="pays-bas">' + x.pays + '</div></div></div>';
      document.body.appendChild(fond);
      var ancienOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      function fermer() {
        try { localStorage.setItem(CLE, auj); } catch (e) {}
        document.body.style.overflow = ancienOverflow;
        fond.remove();
      }
      fond.querySelector(".fermer").addEventListener("click", fermer);
      fond.addEventListener("click", function (ev) { if (ev.target === fond) fermer(); });
      fond.querySelector(".reserver").addEventListener("click", function (ev) {
        ev.preventDefault(); fermer();
        var cible = document.getElementById("qr-depart") || document.getElementById("input-depart") || document.getElementById("section-reserver");
        if (cible) { try { cible.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) {} setTimeout(function () { try { cible.focus(); } catch (e) {} }, 400); }
      });
    }
    // Laisse l'app s'afficher d'abord (ne ralentit jamais la réservation)
    function lancer() { setTimeout(afficher, 900); }
    if (document.readyState === "complete") lancer(); else window.addEventListener("load", lancer);
  } catch (e) { /* ne jamais bloquer l'app */ }
})();
