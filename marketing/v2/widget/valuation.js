/*!
 * AIVENA valuation widget loader.
 *
 * Embed on any agency website:
 *   <script src="https://aivena.es/widget/valuation.js"
 *           data-agency="YOUR_AGENCY_ID"
 *           data-lang="es"                 (optional: en es de nl fr pl sv no da fi ru it pt; auto-detects)
 *           data-name="Your Agency Name"   (optional: shown in the consent text + header)
 *           data-color="#0B7C3A"           (optional: brand colour)
 *           data-logo="https://…/logo.png" (optional: brand logo, https only)
 *   ></script>
 *
 * Renders an iframe (CSS-isolated) pointing at /widget/valuation.html on the
 * same origin this script was loaded from, and auto-resizes it via postMessage.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;

  var agency = script.getAttribute("data-agency");
  if (!agency) {
    console.error("[aivena-valuation] data-agency is required");
    return;
  }

  // Derive the widget origin from the script's own src, so previews work too.
  var src;
  try {
    src = new URL(script.src);
  } catch (e) {
    return;
  }
  var base = src.origin;

  var params = new URLSearchParams();
  params.set("agency", agency);
  var lang = script.getAttribute("data-lang");
  if (lang) params.set("lang", lang);
  var name = script.getAttribute("data-name");
  if (name) params.set("name", name);
  var color = script.getAttribute("data-color");
  if (color && /^#[0-9a-fA-F]{3,8}$/.test(color)) params.set("color", color);
  var logo = script.getAttribute("data-logo");
  if (logo && /^https:\/\//.test(logo)) params.set("logo", logo);

  var frame = document.createElement("iframe");
  frame.src = base + "/widget/valuation.html?" + params.toString();
  frame.title = "Property valuation";
  frame.style.cssText =
    "width:100%;max-width:520px;height:760px;border:0;display:block;background:transparent;";
  frame.setAttribute("loading", "lazy");
  frame.setAttribute("allowtransparency", "true");

  script.parentNode.insertBefore(frame, script.nextSibling);

  window.addEventListener("message", function (e) {
    if (e.origin !== base) return;
    var d = e.data;
    if (d && d.type === "aivena-valuation-height" && typeof d.height === "number") {
      frame.style.height = Math.max(320, Math.min(2000, Math.ceil(d.height))) + "px";
    }
  });
})();
