// Tickerbook entry point: loads the data and starts the router. Each page and tab lives in its own module.
import { h, loadAll, view } from "./core.js";
import { route } from "./router.js";

// ================================================================ boot
(async () => {
  try {
    await loadAll();
    route();
  } catch (e) {
    view.replaceChildren(h("div", { class: "loading" },
      h("div", {}, "Couldn't load data."),
      h("div", { class: "small" }, e.message),
      h("div", { class: "small" }, "If you just set this up, run the 'Update data and deploy' workflow once from the Actions tab on GitHub.")));
  }
})();
