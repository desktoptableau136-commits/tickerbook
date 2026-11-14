// Settings page.
import * as GH from "./github.js";
import { card, h, loadAll, pref, tickers, view } from "./core.js";
import { startTask } from "./research.js";
import { route } from "./router.js";

// ================================================================ settings
export function renderSettings() {
  const c = GH.getConfig();
  const theme = pref("theme") || "auto";
  const themeSeg = h("div", { class: "seg", role: "group", "aria-label": "Theme" },
    [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].map(([k, l]) => h("button", { type: "button", "aria-pressed": String(theme === k),
      on: { click: () => { pref("theme", k); if (k === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = k; route(); } } }, l)));

  const f = (id, label, value, attrs = {}, hint) => h("div", { class: "field" }, h("label", { for: id }, label), h("input", { id, value: value || "", autocomplete: "off", autocapitalize: "off", spellcheck: "false", ...attrs }), hint ? h("div", { class: "hint" }, hint) : null);
  const status = h("div", {});
  const form = h("form", { on: { submit: async (e) => {
    e.preventDefault();
    const val = (id) => form.querySelector(`#${id}`).value.trim();
    GH.saveConfig({ owner: val("gh-owner"), repo: val("gh-repo"), branch: val("gh-branch") || "main", token: val("gh-token") || c.token });
    status.replaceChildren(h("div", { class: "notice" }, "Testing connection…"));
    try {
      const name = await GH.testConnection();
      status.replaceChildren(h("div", { class: "notice good" }, `✓ Connected to ${name}. You can now research tickers from the home page.`));
      loadAll().catch(() => {});
    } catch (err) { status.replaceChildren(h("div", { class: "notice bad" }, `✕ ${err.message}`)); }
  } } },
    f("gh-owner", "GitHub username", c.owner),
    f("gh-repo", "Repository name", c.repo),
    f("gh-branch", "Branch", c.branch),
    f("gh-token", "Access token", "", { type: "password", placeholder: c.token ? "•••••••• saved (leave blank to keep)" : "github_pat_…" }, "Stored only in this browser. Never sent anywhere except GitHub."),
    h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" },
      h("button", { class: "btn primary", type: "submit" }, "Save & test"),
      c.token ? h("button", { class: "btn danger", type: "button", on: { click: () => { GH.clearToken(); route(); } } }, "Forget token") : null),
    status);

  view.append(h("div", { class: "home-hero" }, h("h1", {}, "Settings")),
    h("div", { class: "cols" },
      h("div", { class: "stack" },
        card("Appearance", {}, themeSeg),
        card("Connect to GitHub", { sub: "Needed only for researching new tickers and refreshing from here" }, form),
        GH.connected() ? card("Refresh data now", { sub: "Data updates automatically each weekday after the market closes" },
          h("button", { class: "btn", type: "button", on: { click: () => startTask({ action: "refresh", title: "Refreshing all tickers" }) } }, "Refresh everything")) : null),
      card("How to create the token", { sub: "One-time, about 2 minutes" },
        h("ol", { class: "steps" },
          h("li", {}, "On GitHub, go to ", h("b", {}, "Settings → Developer settings → Personal access tokens → Fine-grained tokens"), ", then ", h("b", {}, "Generate new token"), "."),
          h("li", {}, "Name it something like 'Tickerbook' and pick an expiration (90 days is a good balance)."),
          h("li", {}, "Under ", h("b", {}, "Repository access"), " choose ", h("b", {}, "Only select repositories"), " and pick this dashboard's repo."),
          h("li", {}, "Under ", h("b", {}, "Permissions → Repository"), ", set ", h("b", {}, "Actions: Read and write"), " and ", h("b", {}, "Contents: Read-only"), ". Nothing else."),
          h("li", {}, "Generate, copy the token, and paste it here. Repeat on each device you use (phone, laptop).")),
        h("p", { class: "muted small", style: "margin:10px 0 0" }, "That token can only start this repo's data update and read its files. It can't change your code or touch other repos."))));
}
