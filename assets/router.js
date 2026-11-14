// Hash router: #/, #/t/SYM/<tab>, #/ideas, #/learn, #/settings.
import { fitDash, setCur, view } from "./core.js";
import { renderHome } from "./home.js";
import { renderIdeas } from "./ideas.js";
import { renderLearn } from "./learn.js";
import { renderSettings } from "./settings.js";
import { hidePop } from "./sheets.js";
import { renderTicker } from "./ticker.js";

// ================================================================ router

export function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  document.querySelectorAll("[data-nav]").forEach((a) => a.removeAttribute("aria-current"));
  const nav = document.querySelector(`[data-nav="${parts[0]}"]`);
  if (nav) nav.setAttribute("aria-current", "page");
  view.replaceChildren();
  setCur(null);
  if (parts[0] === "t" && parts[1]) renderTicker(decodeURIComponent(parts[1]).toUpperCase(), parts[2] || "summary");
  else if (parts[0] === "learn") renderLearn(parts[1]);
  else if (parts[0] === "settings") renderSettings();
  else if (parts[0] === "ideas") renderIdeas();
  else renderHome();
  hidePop(true);
  fitDash();
}
window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0); });
