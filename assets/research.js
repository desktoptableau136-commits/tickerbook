// Research a ticker (with name search), the ticker menu, and the background task sheet.
import * as GH from "./github.js";
import * as Lookup from "./lookup.js";
import { h, loadAll, pill, state, tickers } from "./core.js";
import { route } from "./router.js";
import { closeSheet, openSheet, sheetEl, sheetHead } from "./sheets.js";

// ---------------------------------------------------------------- research + tasks
export function openResearch(prefill = "") {
  if (state.task?.running) return openTaskSheet();
  let tag = "researching";
  openSheet((s) => {
    const input = h("input", { id: "r-ticker", value: prefill, placeholder: "e.g. Disney or DIS", autocapitalize: "none", autocomplete: "off", spellcheck: "false", maxlength: 60,
      role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": "r-suggest", enterkeyhint: "search" });
    // name search: suggestions under the box; picking one fills in its ticker
    const list = h("ul", { class: "suggest", id: "r-suggest", role: "listbox", "aria-label": "Matching companies and funds", hidden: true });
    const picked = h("div", { class: "hint", "aria-live": "polite" }, "Type a company name or a ticker. Takes about a minute.");
    let matches = [], active = -1, chosen = null, namesOk = null;
    const tagOf = (sym) => state.index.tickers.find((t) => t.symbol === sym)?.tag;
    const describe = (m) => [m.name, m.fund ? "Fund" : m.x || null].filter(Boolean).join(" · ");
    // native replaceChildren stringifies null, so build through h()
    const showPicked = (m) => picked.replaceChildren(h("span", {}, h("b", {}, m.s), ` · ${describe(m)}`,
      m.also.length ? h("div", {}, `The same company also trades as ${m.also.join(", ")}. These are share classes: they usually differ only in voting rights, and their prices move almost together.`) : null,
      m.other ? h("div", {}, `This isn't ${m.other}, the company's main stock. A second listing under the same name is usually a bond or note.`) : null,
      m.x === "OTC" ? h("div", {}, "Trades over the counter, so Yahoo's data can be thin.") : null));
    const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1; };
    const choose = (m) => {
      const tg = tagOf(m.s);
      if (tg && tg !== "archived") { closeSheet(); location.hash = `#/t/${m.s}`; return; }
      chosen = m; input.value = m.s; close(); err.replaceChildren(); showPicked(m);
    };
    const setActive = (i) => {
      active = i;
      [...list.children].forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
      if (i >= 0) { input.setAttribute("aria-activedescendant", `r-opt-${i}`); list.children[i]?.scrollIntoView({ block: "nearest" }); }
    };
    const update = () => {
      chosen = null;
      const q = input.value.trim();
      if (namesOk === false || q.length < 1) { close(); list.replaceChildren(); return; }
      matches = Lookup.searchNames(q);
      if (!matches.length) {
        close();
        if (q.length >= 3 && !Lookup.known(q)) picked.replaceChildren(`No US-listed company or ETF matches “${q}”. It may be private, listed only outside the US, or very new (this list updates daily). If you know its ticker, type that.`);
        return;
      }
      picked.replaceChildren("Pick one below, or keep typing.");
      list.replaceChildren(...matches.map((m, i) => {
        const tg = tagOf(m.s);
        return h("li", { id: `r-opt-${i}`, role: "option", "aria-selected": "false", on: { mousedown: (e) => e.preventDefault(), click: () => choose(m) } },
          h("span", { class: "sg-sym" }, m.s),
          h("span", { class: "sg-name" }, h("span", {}, m.name), h("span", { class: "muted small" }, [m.fund ? "Fund" : m.x, m.why].filter(Boolean).join(" · "))),
          tg ? h("span", { class: "sg-tag small" }, tg === "archived" ? "Archived" : "On your list ›") : null);
      }));
      list.hidden = false; input.setAttribute("aria-expanded", "true"); setActive(-1);
    };
    Lookup.loadNames().then((ok) => {
      namesOk = ok;
      if (!ok) picked.replaceChildren("Name search isn't available right now, so type the ticker. Takes about a minute.");
      else if (input.value.trim()) { update(); const m = Lookup.known(input.value.trim()); if (m && !list.hidden) { const hit = matches.find((x) => x.s === m.s); if (hit) { chosen = hit; close(); showPicked(hit); } } }
    });
    input.addEventListener("input", update);
    input.addEventListener("keydown", (e) => {
      if (list.hidden) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((active + 1) % matches.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active <= 0 ? matches.length - 1 : active - 1); }
      else if (e.key === "Enter" && active >= 0) { e.preventDefault(); choose(matches[active]); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    });
    input.addEventListener("blur", () => setTimeout(close, 120));
    const seg = h("div", { class: "seg", role: "group", "aria-label": "Tag" },
      ["researching", "watching"].map((t) => h("button", { type: "button", "aria-pressed": String(t === tag),
        on: { click: (e) => { tag = t; seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); } } }, t[0].toUpperCase() + t.slice(1))));
    const err = h("div", {});
    const form = h("form", { on: { submit: (e) => {
      e.preventDefault();
      const typed = input.value.trim(), t = chosen?.s || typed.toUpperCase();
      const bad = (msg) => err.replaceChildren(h("div", { class: "notice bad", style: "margin-bottom:12px" }, msg));
      // a name that isn't a ticker: ask them to pick rather than guess and research the wrong company
      if (!chosen && !Lookup.known(typed) && matches.length && namesOk) { bad("That isn't a ticker on the list. Pick the company from the suggestions."); update(); return; }
      if (!/^[A-Z0-9][A-Z0-9.\-=^]{0,14}$/.test(t)) { bad("That doesn't look like a ticker symbol."); return; }
      const tg = tagOf(t);
      if (tg && tg !== "archived") { closeSheet(); location.hash = `#/t/${t}`; return; }
      startTask({ action: "add", ticker: t, tag, title: `Researching ${t}` });
    } } },
      h("div", { class: "field sg-field" }, h("label", { for: "r-ticker" }, "Company or ticker"), input, list, picked),
      h("div", { class: "field" }, h("label", {}, "Add it as"), seg),
      err,
      h("button", { class: "btn primary block", type: "submit" }, "Start research"));
    s.append(sheetHead("Research a ticker"), form);
  });
}

export function openTickerMenu(d) {
  const cur = state.index.tickers.find((t) => t.symbol === d.symbol)?.tag;
  openSheet((s) => s.append(sheetHead(d.symbol),
    h("h4", {}, "Tag"),
    h("div", { class: "seg", role: "group" }, ["watching", "researching", "archived"].map((t) =>
      h("button", { type: "button", "aria-pressed": String(t === cur), on: { click: () => { if (t !== cur) startTask({ action: "tag", ticker: d.symbol, tag: t,
        title: t === "archived" ? `Archiving ${d.symbol}` : cur === "archived" ? `Bringing back ${d.symbol}` : `Tagging ${d.symbol} as ${t}` }); } } }, t[0].toUpperCase() + t.slice(1)))),
    h("p", { class: "muted small", style: "margin:8px 0 0" }, cur === "archived"
      ? "Switching it back refreshes it right away."
      : "Archived tickers stop refreshing but keep their saved history."),
    h("h4", {}, "Data"),
    h("button", { class: "btn block", type: "button", on: { click: () => startTask({ action: "add", ticker: d.symbol, tag: cur, title: `Refreshing ${d.symbol}` }) } }, `Refresh ${d.symbol} now`),
    // deleting erases our own snapshot history, so it's only offered once a ticker is archived
    cur === "archived" ? h("div", { style: "height:8px" }) : null,
    cur === "archived" ? h("button", { class: "btn block danger", type: "button", on: { click: (e) => {
      if (e.currentTarget.dataset.confirm) startTask({ action: "remove", ticker: d.symbol, title: `Deleting ${d.symbol}` });
      else { e.currentTarget.dataset.confirm = "1"; e.currentTarget.textContent = `Tap again: erases ${d.symbol} and its saved history`; }
    } } }, "Delete for good") : null));
}

export function startTask({ action, ticker = "", tag = "researching", order = "", title }) {
  const task = state.task = { action, ticker, tag, order, title, running: true, progress: null, result: null, error: null, listeners: new Set() };
  const notify = () => task.listeners.forEach((fn) => fn());
  openTaskSheet();
  GH.runUpdate({ action, ticker, tag, order }, (p) => { task.progress = p; notify(); })
    .then(async (res) => {
      task.result = res;
      // Edit list already shows its new order; reload either way so a failed save snaps back
      if (res.ok || action === "edit") {
        try { await loadAll(); } catch (e) { console.warn(e); }
      }
    })
    .catch(async (e) => {
      task.error = e.message;
      if (action === "edit") { try { await loadAll(); } catch {} }
    })
    .finally(() => {
      task.running = false; notify(); updatePill();
      if (!sheetEl && task.result?.ok) { route(); }
    });
  updatePill();
}

export function openTaskSheet() {
  const task = state.task;
  if (!task) return;
  let renderRef = null;
  openSheet((s) => {
    const head = sheetHead(task.title);
    const bar = h("div", {}), meta = h("div", { class: "progress-meta" }), stages = h("ul", { class: "stage-list" }), foot = h("div", { style: "margin-top:16px" });
    const prog = h("div", { class: "progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100 }, bar);
    s.append(head, prog, meta, stages, foot);
    const render = () => {
      const p = task.progress || { percent: 0, stageIndex: 0, elapsed: 0 };
      const pctv = task.result || task.error ? 100 : Math.round(p.percent);
      bar.style.width = `${pctv}%`;
      if (task.error) bar.style.background = "var(--bad)";
      prog.setAttribute("aria-valuenow", pctv);
      meta.replaceChildren(h("span", {}, task.error ? "Stopped" : task.result ? (task.result.ok ? "Done" : "Finished with a problem") : p.stage?.label || "Starting…"), h("span", {}, `${pctv}% · ${Math.round(p.elapsed || 0)}s`));
      stages.replaceChildren(...GH.STAGES.map((st, i) => {
        const done = task.result ? true : i < p.stageIndex;
        const now = !done && i === p.stageIndex && !task.error;
        return h("li", { class: done ? "done" : now ? "now" : "" }, h("span", { class: "dot", "aria-hidden": "true" }, done ? "✓" : ""), st.label);
      }));
      foot.replaceChildren();
      if (task.error) {
        foot.append(h("div", { class: "notice bad" }, task.error),
          h("div", { style: "display:flex;gap:8px;margin-top:12px;flex-wrap:wrap" },
            h("button", { class: "btn primary", type: "button", on: { click: () => startTask(task) } }, "Try again"),
            p.runUrl ? h("a", { class: "btn", href: p.runUrl, target: "_blank", rel: "noopener noreferrer" }, "Open on GitHub") : null));
      } else if (task.result) {
        const ok = task.result.ok;
        foot.append(h("div", { class: `notice ${ok ? "good" : "bad"}` }, `${ok ? "✓" : "✕"} ${task.result.message}`));
        const btns = h("div", { style: "display:flex;gap:8px;margin-top:12px;flex-wrap:wrap" });
        if (ok && task.ticker && task.action !== "remove" && state.data[task.ticker]) btns.append(h("a", { class: "btn primary", href: `#/t/${task.ticker}`, on: { click: closeSheet } }, `Open ${task.ticker}`));
        else btns.append(h("button", { class: "btn primary", type: "button", on: { click: () => { closeSheet(); if (task.action === "remove") location.hash = "#/"; else route(); } } }, "Done"));
        if (!ok && task.action === "add") btns.append(h("button", { class: "btn", type: "button", on: { click: () => openResearch() } }, "Try another ticker"));
        foot.append(btns);
      } else {
        foot.append(h("p", { class: "muted small", style: "margin:0" }, "You can close this; it keeps going in the background. ",
          p.runUrl ? h("a", { href: p.runUrl, target: "_blank", rel: "noopener noreferrer" }, "Watch it on GitHub ›") : null));
      }
    };
    render();
    renderRef = render;
    task.listeners.add(render);
  }, { onClose: () => { task.listeners.delete(renderRef); updatePill(); if (!task.running && task.result?.ok) route(); } });
}

let pillEl = null;
function updatePill() {
  const t = state.task;
  const show = t && t.running && !sheetEl;
  if (!show) { pillEl?.remove(); pillEl = null; return; }
  if (!pillEl) {
    pillEl = h("button", { class: "task-pill", type: "button", on: { click: openTaskSheet } });
    document.body.append(pillEl);
    t.listeners.add(() => updatePill());
  }
  const p = Math.round(t.progress?.percent || 0);
  pillEl.replaceChildren(h("span", {}, `${t.title}…`), h("span", { class: "mini" }, h("div", { style: `width:${p}%` })), h("span", { class: "tnum" }, `${p}%`));
}
