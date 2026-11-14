// Home page: watchlist cards, filters, upcoming earnings, side by side, Edit list.
import * as A from "./analysis.js";
import * as GH from "./github.js";
import { sparkline } from "./charts.js";
import { arrow, card, grid, h, isNum, logo, pill, pref, signClass, signalsFor, state, tagIcon, tagSvg, termBtn, tickers, unseenChanges, view } from "./core.js";
import { ideaList, ideasHidden, ideasNew } from "./ideas.js";
import { openResearch, openTaskSheet, startTask } from "./research.js";
import { route } from "./router.js";
import { canHover } from "./sheets.js";
import { partsLine } from "./summary.js";
import { scoreRing, toneClass } from "./ticker.js";

// ================================================================ home
export function renderHome() {
  const every = tickers();
  // archived tickers are paused: they sit in a collapsed panel and stay out of everything else here
  const all = every.filter((t) => t.tag !== "archived"), archived = every.filter((t) => t.tag === "archived");
  const counts = { all: all.length };
  for (const t of all) counts[t.tag] = (counts[t.tag] || 0) + 1;
  if (!["all", "watching", "researching"].includes(state.filter)) state.filter = "all";
  const shown = state.filter === "all" ? all : all.filter((t) => t.tag === state.filter);

  const hero = h("div", { class: "home-hero" },
    h("div", {},
      h("h1", {}, "Your watchlist"),
      h("div", { class: "muted small" }, `Data updated ${A.ago(state.index?.updated)} · prices delayed`)),
    GH.connected() ? h("button", { class: "btn primary", type: "button", on: { click: () => openResearch() } }, "＋ Research a ticker") : null);

  const chips = h("div", { class: "chips", role: "group", "aria-label": "Filter by tag" },
    ["all", "watching", "researching"].filter((f) => f === "all" || counts[f]).map((f) =>
      h("button", { class: "chip", type: "button", "aria-pressed": String(state.filter === f), on: { click: () => { state.filter = f; pref("filter", f); route(); } } },
        f === "all" ? null : tagSvg(f), `${f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)} · ${counts[f] || 0}`)));

  const grid = h("div", { class: "grid", style: "margin-top:12px" }, shown.map(({ d, tag }) => tickerCard(d, tag)));
  if (!shown.length) grid.append(h("div", { class: "empty card" }, "Nothing here yet."));
  const editBtn = GH.connected() && every.length
    ? h("button", { class: "btn sm", type: "button", on: { click: () => { view.replaceChildren(); renderEdit(route); window.scrollTo(0, 0); } } }, "Edit list") : null;

  view.append(hero, h("div", { class: "home-bar" }, chips, editBtn), grid);
  // one quiet line to the Ideas page; ideas never mix into the watchlist itself
  const ideas = state.ideas ? ideaList().filter((i) => !ideasHidden().has(i.x.symbol)) : [];
  if (ideas.length) {
    const fresh = ideasNew(ideas).size;
    view.append(h("a", { class: "ideas-link", href: "#/ideas" },
      h("span", { class: "grow" }, h("b", {}, "Ideas to look into"), h("span", { class: "muted" }, ` · ${ideas.length} companies that pass your checklist`)),
      fresh ? h("span", { class: "new-badge" }, `${fresh} new`) : null, h("span", { class: "muted", "aria-hidden": "true" }, "›")));
  }
  if (archived.length) {
    // the daily refresh still checks archived prices, so a big move since archiving stands out
    const moved = archived.filter((t) => isNum(t.sinceArchived?.move)).sort((a, b) => Math.abs(b.sinceArchived.move) - Math.abs(a.sinceArchived.move))[0];
    const mv = (m) => h("span", { class: signClass(m) }, `${arrow(m)} ${A.pct(m, { sign: true })}`);
    const panel = h("details", { class: "card arch-panel", ...(pref("archOpen") === "1" ? { open: true } : {}), on: { toggle: (e) => pref("archOpen", e.currentTarget.open ? "1" : "0") } },
      h("summary", {}, h("b", {}, `Archived · ${archived.length}`),
        h("span", { class: "muted small" }, "Paused: not refreshed, saved history kept"),
        moved && Math.abs(moved.sinceArchived.move) >= 0.005 ? h("span", { class: "small" }, "Biggest move since archiving: ", h("b", {}, moved.symbol), " ", mv(moved.sinceArchived.move)) : null),
      h("div", { class: "arch-list" }, archived.map(({ d, archivedOn, archivedPrice, sinceArchived: sa }) => h("a", { class: "list-row", href: `#/t/${d.symbol}`, style: "color:inherit;text-decoration:none" },
        h("div", { class: "grow" }, h("div", {}, h("b", {}, d.symbol), " ", h("span", { class: "muted" }, A.shortName(d))),
          h("div", { class: "muted small" }, `${archivedOn ? `Archived ${A.date(archivedOn)}` : "Archived"} at ${A.price(isNum(archivedPrice) ? archivedPrice : d.quote.price)}`,
            sa ? ` · now ${A.price(sa.price)} (${A.date(sa.date, { month: "short", day: "numeric" })})` : "")),
        sa && isNum(sa.move) ? h("div", { class: "small", style: "text-align:right" }, h("b", { class: "tnum" }, mv(sa.move)), h("div", { class: "muted" }, "since archived")) : null))));
    view.append(panel);
  }

  if (!GH.connected()) {
    view.append(h("div", { class: "card connect-hint", style: "margin-top:16px" },
      h("div", {}, h("h3", {}, "Want to research new tickers?"), h("p", { class: "muted small", style: "margin:2px 0 0" }, "Connect your GitHub repo once, and you can add any ticker from here and watch it load.")),
      h("a", { class: "btn sm", href: "#/settings" }, "Set up")));
  }

  const lower = h("div", { class: "home-lower" });
  // upcoming earnings
  const upcoming = all.filter((t) => t.d.earnings?.next?.date && A.daysUntil(t.d.earnings.next.date) >= -1)
    .sort((a, b) => a.d.earnings.next.date.localeCompare(b.d.earnings.next.date));
  if (upcoming.length) {
    lower.append(h("div", {}, h("div", { class: "section-title" }, h("h2", {}, "Upcoming earnings")),
      card(null, {}, upcoming.map(({ d }) => {
        const n = d.earnings.next, dt = new Date(n.date + "T12:00:00"), days = A.daysUntil(n.date);
        return h("a", { class: "list-row", href: `#/t/${d.symbol}/earnings`, style: "color:inherit;text-decoration:none" },
          h("div", { class: "datebox" }, h("span", {}, dt.toLocaleDateString("en-US", { month: "short" })), h("b", {}, dt.getDate())),
          h("div", { class: "grow" }, h("div", {}, h("b", {}, d.symbol), " ", h("span", { class: "muted" }, A.shortName(d))),
            h("div", { class: "muted small" }, `${days <= 0 ? "Today" : `In ${days} day${days === 1 ? "" : "s"}`}${n.time ? ` · ${n.time}` : ""}${n.isEstimate ? " · date estimated" : ""}`)),
          isNum(n.epsEstimate) ? h("div", { class: "small", style: "text-align:right" }, h("div", { class: "muted" }, "EPS est."), h("b", { class: "tnum" }, A.price(n.epsEstimate))) : null);
      }))));
  }

  // side-by-side comparison
  const eq = all.filter((t) => t.d.type === "EQUITY");
  if (eq.length > 1) {
    const rows = eq.map(({ d }) => {
      const up = isNum(d.analysts?.targets?.mean) ? d.analysts.targets.mean / d.quote.price - 1 : null;
      const y1 = A.priceChange(d, 252);
      return h("tr", {},
        h("td", { class: "sym" }, h("a", { href: `#/t/${d.symbol}` }, d.symbol)),
        h("td", { class: signClass(y1) }, A.pct(y1, { sign: true })),
        h("td", {}, A.times(d.valuation?.forwardPE)),
        h("td", {}, d.valuation?.peg ? A.num(d.valuation.peg, 2) : "—"),
        h("td", { class: signClass(d.fundamentals?.revenueGrowth) }, A.pct(d.fundamentals?.revenueGrowth, { sign: true })),
        h("td", {}, A.pct(d.fundamentals?.operatingMargin)),
        h("td", { class: signClass(up) }, A.pct(up, { sign: true })));
    });
    const th = (label, key) => h("th", {}, key ? termBtn(key, label) : label);
    lower.append(h("div", {}, h("div", { class: "section-title" }, h("h2", {}, "Side by side"), h("span", { class: "muted small only-touch" }, "Scroll sideways")),
      card(null, {}, h("div", { class: "table-wrap" }, h("table", { class: "cmp" },
        h("thead", {}, h("tr", {}, th("Ticker"), th("1Y return"), th("Fwd P/E", "forwardPE"), th("PEG", "peg"), th("Sales growth", "revenueGrowth"), th("Op. margin", "operatingMargin"), th("To target", "priceTarget"))),
        h("tbody", {}, rows))))));
  }
  view.append(lower);

  view.append(h("p", { class: "disclaimer" }, "For learning and research only. Not financial advice. Data from Yahoo Finance, may be delayed or incomplete."));
}

// Edit list: reorder (↑/↓, or drag with a mouse), retag, archive, and delete archived tickers.
// Nothing changes until Save, which sends everything as one "edit" workflow run, so
// watchlist.json (and every device) updates together.
const TAG_CHOICES = [["watching", "Watching"], ["researching", "Researching"], ["archived", "Archived"]];
const TRASH = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
function renderEdit(done) {
  const all = tickers(), info = Object.fromEntries(all.map((t) => [t.symbol, t]));
  const tags = Object.fromEntries(all.map((t) => [t.symbol, t.tag])), del = new Set();
  let order = all.map((t) => t.symbol), dragEl = null;
  const spec = () => [...order.filter((x) => !del.has(x)).map((x) => `${x}:${tags[x]}`), ...[...del].map((x) => `-${x}`)].join(",");
  const orig = spec();
  const list = h("ol", { class: "reorder-list" }), warn = h("div", {});
  const save = h("button", { class: "btn primary", type: "button", on: { click: () => {
    if (state.task?.running) return openTaskSheet();
    // show the result right away; loadAll() after the run reads the real thing back from the repo
    const pos = new Map(order.map((x, i) => [x, i])), today = new Date().toISOString().slice(0, 10);
    state.index.tickers = state.index.tickers.filter((t) => !del.has(t.symbol))
      .map((t) => ({ ...t, tag: tags[t.symbol] ?? t.tag, archivedOn: tags[t.symbol] === "archived" ? t.archivedOn || today : undefined }))
      .sort((a, b) => (pos.get(a.symbol) ?? 1e9) - (pos.get(b.symbol) ?? 1e9));
    done();
    startTask({ action: "edit", order: spec(), title: "Saving your list" });
  } } }, "Save");
  const move = (i, step) => {
    const j = i + step;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    draw(order[j], `[data-dir="${step < 0 ? "up" : "down"}"]`);
  };
  const draw = (focusSym, focusSel) => {
    save.disabled = spec() === orig;
    list.replaceChildren(...order.map((sym, i) => {
      const { d } = info[sym], gone = del.has(sym), arch = tags[sym] === "archived", wasArch = info[sym].tag === "archived";
      const note = gone ? "Will be deleted, along with its saved history"
        : wasArch && !arch ? "Comes back and refreshes when you save"
        : arch && !wasArch ? "Will be archived: kept, but not refreshed"
        : d.name || "";
      const pick = h("select", { class: "tag-pick", "aria-label": `Tag for ${sym}`, disabled: gone, on: { change: (e) => {
        tags[sym] = e.target.value;
        if (tags[sym] !== "archived") del.delete(sym);
        draw(sym, ".tag-pick");
      } } }, TAG_CHOICES.map(([k, l]) => h("option", { value: k, ...(k === tags[sym] ? { selected: true } : {}) }, l)));
      // only archived tickers can be deleted, so a slip can't erase an active one's history
      const delBtn = arch ? h("button", { class: `move-btn del-btn${gone ? " undo" : ""}`, type: "button", "aria-label": gone ? `Keep ${sym}` : `Delete ${sym}`, title: gone ? "Undo" : "Delete",
        ...(gone ? {} : { html: TRASH }), on: { click: () => { gone ? del.delete(sym) : del.add(sym); draw(sym, ".del-btn"); } } }, gone ? "Undo" : null)
        : h("span", { class: "move-btn del-slot", "aria-hidden": "true" }); // keeps the columns lined up
      return h("li", { class: `reorder-row${gone ? " gone" : ""}${arch ? " is-archived" : ""}`, "data-sym": sym, ...(canHover.matches ? { draggable: "true" } : {}), on: {
        dragstart: (e) => { dragEl = e.currentTarget; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", sym); dragEl.classList.add("dragging"); },
        dragover: (e) => {
          if (!dragEl) return;
          e.preventDefault();
          const li = e.currentTarget;
          if (li === dragEl) return;
          const r = li.getBoundingClientRect();
          list.insertBefore(dragEl, e.clientY > r.top + r.height / 2 ? li.nextSibling : li);
        },
        drop: (e) => e.preventDefault(),
        dragend: () => { dragEl = null; order = [...list.children].map((x) => x.dataset.sym); draw(); },
      } },
        h("span", { class: "grip", "aria-hidden": "true" }, "⠿"),
        h("span", { class: "reorder-num tnum", "aria-hidden": "true" }, String(i + 1)),
        h("div", { class: "grow" }, h("b", { class: "sym" }, sym), h("div", { class: "muted small reorder-name" }, note)),
        h("div", { class: "row-ctl" }, pick, delBtn,
          h("button", { class: "move-btn", type: "button", "data-dir": "up", "aria-label": `Move ${sym} up`, disabled: i === 0, on: { click: () => move(i, -1) } }, "↑"),
          h("button", { class: "move-btn", type: "button", "data-dir": "down", "aria-label": `Move ${sym} down`, disabled: i === order.length - 1, on: { click: () => move(i, 1) } }, "↓")));
    }));
    warn.replaceChildren(del.size ? h("div", { class: "notice bad", style: "margin-top:12px" },
      `Deleting erases ${[...del].join(", ")} and ${del.size === 1 ? "its" : "their"} saved daily snapshots (past P/E and analyst estimates), which can't be rebuilt. Archiving keeps them.`) : "");
    if (focusSym) {
      const row = list.querySelector(`[data-sym="${focusSym}"]`);
      (row?.querySelector(`${focusSel}:not(:disabled)`) || row?.querySelector(".move-btn:not(:disabled)"))?.focus();
    }
  };
  draw();
  view.append(
    h("div", { class: "home-hero" }, h("div", {}, h("h1", {}, "Edit your watchlist"),
      h("div", { class: "muted small" }, "Reorder with the arrows", h("span", { class: "only-hover" }, " or by dragging a row"),
        ". Archived tickers move to a collapsed panel and stop refreshing, but keep their saved history. Only archived tickers can be deleted. Saving takes about a minute and updates every device."))),
    card(null, {}, list), warn,
    h("div", { class: "reorder-actions" }, h("button", { class: "btn", type: "button", on: { click: () => done() } }, "Cancel"), save));
}

function tickerCard(d, tag) {
  const sig = signalsFor(d), ov = A.overall(sig);
  const closes = (d.prices?.close || []).slice(-252);
  const y1 = A.priceChange(d, 252);
  const n = d.earnings?.next;
  const days = n ? A.daysUntil(n.date) : null;
  const foot = d.type === "ETF"
    ? h("span", { class: "muted" }, `Index fund · ${A.pct(d.fund?.expenseRatio, { digits: 2 })} fee`)
    : h("span", { class: "muted" }, days != null && days >= 0 ? `Earnings in ${days}d` : `1Y ${A.pct(y1, { sign: true })}`);
  const news = unseenChanges(d), drop = A.sharpDrop(d);
  return h("a", { class: `card tcard${toneClass(ov)}`, href: `#/t/${d.symbol}`, "aria-label": `${d.symbol}, ${A.price(d.quote.price)}, ${ov.lean}${news.length ? `, ${news.length} changes since you last looked` : ""}` },
    h("div", { class: "tcard-head" },
      logo(d.symbol, d.name),
      h("div", { class: "grow" },
        h("div", { class: "tcard-top" }, h("span", { class: "tcard-sym" }, d.symbol), tagIcon(tag),
          news.length ? h("span", { class: "new-badge", "data-tip": news.map((x) => x.text).join(" · "), "data-tip-title": "Since you last looked" }, `${news.length} new`) : null),
        h("div", { class: "tcard-name" }, d.name)),
      h("span", { class: "has-tip", "data-tip": `${ov.lean}${ov.score != null ? `: ${ov.good} of ${ov.total} checks positive${ov.bad ? `, ${ov.bad} negative` : ""}` : ""}. ${ov.parts?.length ? ` ${partsLine(ov)}.` : ""} A weighted checklist out of 100, not a prediction.${drop ? " It lags news, and the price just dropped sharply." : ""} Open the ticker to see each check.`, "data-tip-title": ov.score != null ? `Score ${ov.score}` : "No score yet" },
        scoreRing(ov, 40, 4, "mini"))),
    h("div", { class: "tcard-mid" },
      h("div", {},
        h("div", { class: "tcard-price tnum" }, A.price(d.quote.price)),
        h("div", { class: `tcard-chg tnum ${signClass(d.quote.changePct)}` }, `${arrow(d.quote.changePct)} ${A.pct(d.quote.changePct, { digits: 2, sign: true })} today`)),
      h("div", { html: sparkline(closes, { width: 104, height: 36 }) })),
    // the drop warning sits by the score it qualifies, so it doesn't crowd the symbol line
    h("div", { class: "tcard-foot" }, h("span", { class: "foot-left" }, pill(ov.tone, ov.short),
      drop ? h("span", { class: "drop-badge", role: "img", "aria-label": `Big drop: down ${A.pct(-drop.change, { digits: 0 })} in a month`,
        "data-tip": `Down ${A.pct(-drop.change, { digits: 0 })} in a month. The score lags news like this; open the ticker for why.`, "data-tip-title": "Big drop" },
        h("span", { "aria-hidden": "true" }, `⚠ −${A.pct(-drop.change, { digits: 0 })}`)) : null), foot));
}
