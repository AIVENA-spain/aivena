/* ============================================================
   AIVENA — cookie consent banner (LOPDGDD / GDPR)
   Self-contained, no dependencies. Include on EVERY page.
   - No non-essential cookie is set until the user chooses.
   - Choice persisted in localStorage under "aivena_cookie_consent":
       { essential:true, functional:bool, analytics:bool, decidedAt:ISO }
   - window.aivenaConsent exposes the current choice for any
     future functional/analytics code to gate on. Nothing fires
     here by itself — the pilot ships with no trackers.
   ============================================================ */
(function () {
  var KEY = "aivena_cookie_consent";
  var isES = (document.documentElement.lang || "en").toLowerCase().indexOf("es") === 0;

  var T = isES
    ? { title:"Tus cookies, tu elección",
        desc:'Usamos solo cookies esenciales por defecto. Tú decides si permites las opcionales.',
        accept:"Aceptar todas", reject:"Rechazar no esenciales", customize:"Personalizar", save:"Guardar elección",
        essential:"Esenciales", essNote:"Siempre activas", functional:"Funcionales", analytics:"Analíticas",
        functionalNote:"Recuerdan tus preferencias.", analyticsNote:"Nos ayudan a entender el uso del sitio." }
    : { title:"Your cookies, your choice",
        desc:'We use only essential cookies by default. You decide whether to allow optional ones.',
        accept:"Accept all", reject:"Reject non-essential", customize:"Customize", save:"Save choice",
        essential:"Essential", essNote:"Always on", functional:"Functional", analytics:"Analytics",
        functionalNote:"Remember your preferences.", analyticsNote:"Help us understand site usage." };

  function read() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function applyConsent(c) { window.aivenaConsent = c; /* future trackers gate on this; none ship today */ }

  var existing = read();
  if (existing) { applyConsent(existing); return; }

  /* ---- styles (injected so the banner works on pages without legal.css, e.g. the landing) ---- */
  var css =
    ".aivena-cookie{position:fixed;left:16px;right:16px;bottom:16px;z-index:1000;max-width:560px;margin:0 auto;" +
    "background:linear-gradient(180deg,rgba(14,22,20,.97),rgba(8,14,12,.98));border:1px solid rgba(31,232,116,.28);" +
    "border-radius:18px;padding:18px 20px;box-shadow:0 30px 80px -24px rgba(0,0,0,.8);color:#F1F4F2;" +
    "font-family:Inter,system-ui,sans-serif;animation:aivenaCookieIn .35s cubic-bezier(.16,1,.3,1);}" +
    "@keyframes aivenaCookieIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}" +
    ".aivena-cookie h3{font-size:15px;font-weight:600;margin:0 0 6px;}" +
    ".aivena-cookie p{font-size:13px;line-height:1.55;color:#C7D0CB;margin:0 0 14px;}" +
    ".aivena-cookie a{color:#7DF2AC;}" +
    ".aivena-cookie .row{display:flex;flex-wrap:wrap;gap:8px;}" +
    ".aivena-cookie button{font-family:inherit;font-size:13px;font-weight:600;border-radius:10px;padding:9px 14px;cursor:pointer;border:1px solid transparent;}" +
    ".aivena-cookie .b-accept{background:#1FE874;color:#04140A;}" +
    ".aivena-cookie .b-reject,.aivena-cookie .b-custom,.aivena-cookie .b-save{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.14);color:#F1F4F2;}" +
    ".aivena-cookie .b-accept:hover{background:#37ee85;}" +
    ".aivena-cookie .b-reject:hover,.aivena-cookie .b-custom:hover,.aivena-cookie .b-save:hover{border-color:rgba(31,232,116,.4);}" +
    ".aivena-cookie .opts{margin:4px 0 14px;display:none;}" +
    ".aivena-cookie .opts.show{display:block;}" +
    ".aivena-cookie .opt{display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.07);}" +
    ".aivena-cookie .opt input{margin-top:3px;accent-color:#1FE874;width:16px;height:16px;}" +
    ".aivena-cookie .opt .lbl{font-size:13px;font-weight:600;}" +
    ".aivena-cookie .opt .note{font-size:12px;color:#94A09A;}" +
    "@media(max-width:520px){.aivena-cookie .row{flex-direction:column;}.aivena-cookie button{width:100%;}}";
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  /* ---- banner DOM ---- */
  var bar = document.createElement("div");
  bar.className = "aivena-cookie";
  bar.setAttribute("role", "dialog");
  bar.setAttribute("aria-live", "polite");
  bar.setAttribute("aria-label", isES ? "Consentimiento de cookies" : "Cookie consent");
  bar.innerHTML =
    '<h3>' + T.title + '</h3>' +
    '<p>' + T.desc + '</p>' +
    '<div class="opts" id="aiCookieOpts">' +
      '<label class="opt"><input type="checkbox" checked disabled><span><span class="lbl">' + T.essential + '</span><br><span class="note">' + T.essNote + '</span></span></label>' +
      '<label class="opt"><input type="checkbox" id="aiCookieFunc"><span><span class="lbl">' + T.functional + '</span><br><span class="note">' + T.functionalNote + '</span></span></label>' +
      '<label class="opt"><input type="checkbox" id="aiCookieAna"><span><span class="lbl">' + T.analytics + '</span><br><span class="note">' + T.analyticsNote + '</span></span></label>' +
    '</div>' +
    '<div class="row">' +
      '<button class="b-accept" id="aiCookieAccept">' + T.accept + '</button>' +
      '<button class="b-reject" id="aiCookieReject">' + T.reject + '</button>' +
      '<button class="b-custom" id="aiCookieCustom">' + T.customize + '</button>' +
      '<button class="b-save" id="aiCookieSave" style="display:none">' + T.save + '</button>' +
    '</div>';
  document.body.appendChild(bar);

  function decide(functional, analytics) {
    var c = { essential: true, functional: !!functional, analytics: !!analytics, decidedAt: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {}
    applyConsent(c);
    bar.parentNode && bar.parentNode.removeChild(bar);
  }

  document.getElementById("aiCookieAccept").addEventListener("click", function () { decide(true, true); });
  document.getElementById("aiCookieReject").addEventListener("click", function () { decide(false, false); });
  document.getElementById("aiCookieCustom").addEventListener("click", function () {
    document.getElementById("aiCookieOpts").classList.add("show");
    this.style.display = "none";
    document.getElementById("aiCookieSave").style.display = "";
  });
  document.getElementById("aiCookieSave").addEventListener("click", function () {
    decide(document.getElementById("aiCookieFunc").checked, document.getElementById("aiCookieAna").checked);
  });
})();
