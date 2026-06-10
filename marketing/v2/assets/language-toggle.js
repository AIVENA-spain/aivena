/* ============================================================
   AIVENA — legal-page language toggle
   - Paired pages (privacy<->privacidad, terms<->terminos):
     the toggle is just two <a> links; the active state is set
     in the HTML. This script no-ops there (no [data-lang] blocks).
   - Single bilingual pages (cookies, contact): swaps visible
     content blocks marked data-lang="en" / data-lang="es".
     Choice persisted in sessionStorage ("aivena_lang").
   ============================================================ */
(function () {
  var blocks = document.querySelectorAll("[data-lang]");
  if (!blocks.length) return; // paired pages: nothing to swap

  var KEY = "aivena_lang";
  var buttons = document.querySelectorAll(".legal-language-toggle [data-set-lang]");

  function set(lang) {
    for (var i = 0; i < blocks.length; i++) {
      blocks[i].style.display = blocks[i].getAttribute("data-lang") === lang ? "" : "none";
    }
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].classList.toggle("active", buttons[j].getAttribute("data-set-lang") === lang);
    }
    document.documentElement.lang = lang;
    try { sessionStorage.setItem(KEY, lang); } catch (e) {}
  }

  var saved = null;
  try { saved = sessionStorage.getItem(KEY); } catch (e) {}
  set(saved === "es" ? "es" : "en");

  for (var k = 0; k < buttons.length; k++) {
    buttons[k].addEventListener("click", function () {
      set(this.getAttribute("data-set-lang"));
    });
  }
})();
