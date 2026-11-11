// Small, dependency-free SVG charts. Colors come from CSS custom properties so
// light/dark mode swap in one place (styles.css).

const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks };
}

function tooltip(wrap) {
  let t = wrap.querySelector(".tt");
  if (!t) { t = document.createElement("div"); t.className = "tt"; t.setAttribute("role", "status"); wrap.appendChild(t); }
  return {
    show(x, y, title, rows) {
      t.replaceChildren();
      const h = document.createElement("div"); h.className = "tt-title"; h.textContent = title; t.appendChild(h);
      for (const r of rows) {
        const line = document.createElement("div"); line.className = "tt-row";
        if (r.color) { const k = document.createElement("span"); k.className = "tt-key"; k.style.background = r.color; line.appendChild(k); }
        const v = document.createElement("strong"); v.textContent = r.value; line.appendChild(v);
        if (r.label) { const l = document.createElement("span"); l.className = "tt-label"; l.textContent = r.label; line.appendChild(l); }
        t.appendChild(line);
      }
      t.style.display = "block";
      const w = wrap.clientWidth, tw = t.offsetWidth;
      const left = Math.min(Math.max(x - tw / 2, 0), w - tw);
      t.style.left = `${left}px`;
      t.style.top = `${Math.max(y - t.offsetHeight - 12, 0)}px`;
    },
    hide() { t.style.display = "none"; },
  };
}

export function legend(items) {
  const l = document.createElement("div");
  l.className = "legend";
  for (const it of items) {
    const s = document.createElement("span");
    const k = document.createElement("i");
    k.className = it.kind === "line" ? "lk-line" : it.kind === "tick" ? "lk-tick" : "lk-rect";
    k.style.background = it.color;
    s.append(k, document.createTextNode(it.name));
    l.appendChild(s);
  }
  return l;
}

// Re-render on container resize. With opts.fill, in the laptop one-screen layout
// (html.dash-on) the chart takes its container's height instead of a fixed one.
function responsive(container, draw, opts = {}) {
  let lastW = 0, lastH = 0;
  const fillH = () => (opts.fill && document.documentElement.classList.contains("dash-on") && container.clientHeight > 90 ? container.clientHeight : opts.height);
  if (opts.fill) container.classList.add("fill");
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth, h = fillH();
    if (w && (Math.abs(w - lastW) > 2 || Math.abs(h - lastH) > 2)) {
      lastW = w; lastH = h;
      requestAnimationFrame(() => draw(container.clientWidth, fillH()));
    }
  });
  ro.observe(container);
  return ro;
}

// ---------------------------------------------------------------- line chart

// A series may carry `tip(i, v)` to word its own hover value (e.g. "−12% · $182.40").
export function lineChart(container, opts) {
  const { dates, series, yFormat = (v) => v.toFixed(2), xFormat, area = true, refLine, ariaLabel } = opts;
  container.classList.add("chart");
  responsive(container, (W, height) => {
    container.querySelectorAll("svg").forEach((s) => s.remove());
    const m = { t: 12, r: 12, b: 26, l: 52 };
    const w = W - m.l - m.r, h = height - m.t - m.b;
    const all = series.flatMap((s) => s.values.filter((v) => v != null));
    if (refLine != null) all.push(refLine);
    let mn = Math.min(...all), mx = Math.max(...all);
    const pad = (mx - mn) * 0.06 || 1;
    let { lo, hi, ticks } = niceTicks(mn - pad, mx + pad, height < 170 ? 2 : height < 240 ? 3 : 4);
    // optional ceiling (e.g. 0% for "drop from peak" charts, which can never go above it)
    if (opts.yMax != null && hi > opts.yMax) { hi = opts.yMax; ticks = ticks.filter((t) => t <= hi + 1e-9); }
    const n = dates.length;
    const X = (i) => m.l + (n === 1 ? w / 2 : (i / (n - 1)) * w);
    const Y = (v) => m.t + h - ((v - lo) / (hi - lo)) * h;

    const svg = el("svg", { width: W, height, viewBox: `0 0 ${W} ${height}`, role: "img", "aria-label": ariaLabel || "Line chart", tabindex: 0 });
    container.prepend(svg);

    for (const t of ticks) {
      el("line", { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: "grid" }, svg);
      const tx = el("text", { x: m.l - 8, y: Y(t) + 4, class: "axis", "text-anchor": "end" }, svg);
      tx.textContent = yFormat(t, true);
    }
    if (refLine != null) el("line", { x1: m.l, x2: W - m.r, y1: Y(refLine), y2: Y(refLine), class: "baseline" }, svg);

    // x labels: every point when few and they fit, otherwise ~4 evenly spaced
    // label every point when they fit; otherwise every `step`-th point counting back from the latest
    const fits = Math.max(2, Math.floor(w / 72) + 1);
    const step = n <= fits ? 1 : Math.ceil((n - 1) / (Math.min(4, fits) - 1));
    const idx = [];
    for (let i = n - 1; i >= 0; i -= step) idx.unshift(i);
    if (step > 1 && idx[0] !== 0 && X(idx[0]) - X(0) > 70) idx.unshift(0);
    const nx = idx.length;
    for (let k = 0; k < nx; k++) {
      const i = idx[k];
      const tx = el("text", { x: X(i), y: height - 6, class: "axis", "text-anchor": k === 0 ? "start" : k === nx - 1 ? "end" : "middle" }, svg);
      tx.textContent = xFormat ? xFormat(dates[i], n) : dates[i];
    }

    series.forEach((s, si) => {
      let d = "", started = false;
      s.values.forEach((v, i) => {
        if (v == null) { started = false; return; }
        d += `${started ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
        started = true;
      });
      if (area && series.length === 1) {
        const firstI = s.values.findIndex((v) => v != null);
        const area = `${d}L${X(n - 1).toFixed(1)},${m.t + h}L${X(firstI).toFixed(1)},${m.t + h}Z`;
        el("path", { d: area, fill: s.color, opacity: 0.1 }, svg);
      }
      el("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      const li = s.values.length - 1 - [...s.values].reverse().findIndex((v) => v != null);
      el("circle", { cx: X(li), cy: Y(s.values[li]), r: 4, fill: s.color, class: "ring" }, svg);
    });

    // hover layer
    const cross = el("line", { y1: m.t, y2: m.t + h, class: "cross", visibility: "hidden" }, svg);
    const dots = series.map((s) => el("circle", { r: 4, fill: s.color, class: "ring", visibility: "hidden" }, svg));
    const hit = el("rect", { x: m.l, y: 0, width: w, height, fill: "transparent", class: "hit" }, svg);
    const tt = tooltip(container);
    let cur = -1;
    const showAt = (i) => {
      cur = Math.max(0, Math.min(n - 1, i));
      const x = X(cur);
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
      let topY = height;
      series.forEach((s, si) => {
        const v = s.values[cur];
        if (v == null) { dots[si].setAttribute("visibility", "hidden"); return; }
        dots[si].setAttribute("cx", x); dots[si].setAttribute("cy", Y(v)); dots[si].setAttribute("visibility", "visible");
        topY = Math.min(topY, Y(v));
      });
      tt.show(x, topY, opts.tipTitle ? opts.tipTitle(dates[cur]) : dates[cur],
        series.filter((s) => s.values[cur] != null).map((s) => ({ color: s.color, value: s.tip ? s.tip(cur, s.values[cur]) : yFormat(s.values[cur]), label: series.length > 1 ? s.name : opts.tipLabel?.(cur) })));
    };
    const hide = () => { cross.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); tt.hide(); };
    hit.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      showAt(Math.round(((e.clientX - r.left - m.l) / w) * (n - 1)));
    });
    hit.addEventListener("pointerleave", hide);
    svg.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); showAt((cur < 0 ? n - 1 : cur) + (e.key === "ArrowRight" ? 1 : -1)); }
      if (e.key === "Escape") hide();
    });
    svg.addEventListener("blur", hide);
  }, { fill: opts.fill, height: opts.height ?? 220 });
}

// ---------------------------------------------------------------- column chart

export function columnChart(container, opts) {
  const { categories, series, markers = [], yFormat = (v) => v.toFixed(2), tipRows, ariaLabel, colorFor } = opts;
  container.classList.add("chart");
  responsive(container, (W, height) => {
    container.querySelectorAll("svg").forEach((s) => s.remove());
    const m = { t: 14, r: 8, b: 26, l: 52 };
    const w = W - m.l - m.r, h = height - m.t - m.b;
    const vals = [...series, ...markers].flatMap((s) => s.values.filter((v) => v != null));
    const mn = Math.min(0, ...vals), mx = Math.max(0, ...vals);
    const { lo, hi, ticks } = niceTicks(mn, mx, height < 170 ? 2 : height < 240 ? 3 : 4);
    const Y = (v) => m.t + h - ((v - lo) / (hi - lo)) * h;
    const n = categories.length;
    const band = w / n;
    const gap = 2;
    const bw = Math.min(24, (band * 0.7 - gap * (series.length - 1)) / series.length);
    const groupW = bw * series.length + gap * (series.length - 1);

    const svg = el("svg", { width: W, height, viewBox: `0 0 ${W} ${height}`, role: "img", "aria-label": ariaLabel || "Column chart" });
    container.prepend(svg);
    for (const t of ticks) {
      el("line", { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? "baseline" : "grid" }, svg);
      const tx = el("text", { x: m.l - 8, y: Y(t) + 4, class: "axis", "text-anchor": "end" }, svg);
      tx.textContent = yFormat(t, true);
    }
    const tt = tooltip(container);
    categories.forEach((c, i) => {
      const cx = m.l + band * i + band / 2;
      const g = el("g", { class: "col", tabindex: 0, role: "img" }, svg);
      series.forEach((s, si) => {
        const v = s.values[i];
        if (v == null) return;
        const x = cx - groupW / 2 + si * (bw + gap);
        const y0 = Y(0), y1 = Y(v);
        const top = Math.min(y0, y1), hgt = Math.max(Math.abs(y1 - y0), 1);
        const r = Math.min(4, hgt, bw / 2);
        // rounded data-end, square at the baseline
        const d = v >= 0
          ? `M${x},${y0}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${y0}Z`
          : `M${x},${y0}V${top + hgt - r}Q${x},${top + hgt} ${x + r},${top + hgt}H${x + bw - r}Q${x + bw},${top + hgt} ${x + bw},${top + hgt - r}V${y0}Z`;
        el("path", { d, fill: colorFor ? colorFor(si, i, v) : s.color, class: "bar" }, g);
      });
      markers.forEach((mk) => {
        const v = mk.values[i];
        if (v == null) return;
        el("line", { x1: cx - groupW / 2 - 4, x2: cx + groupW / 2 + 4, y1: Y(v), y2: Y(v), stroke: mk.color, "stroke-width": 2, "stroke-linecap": "round" }, g);
      });
      const hitR = el("rect", { x: m.l + band * i, y: m.t, width: band, height: h, fill: "transparent" }, g);
      const rows = tipRows ? tipRows(i) : [...series, ...markers].map((s) => ({ color: s.color, value: s.values[i] == null ? "—" : yFormat(s.values[i]), label: s.name }));
      g.setAttribute("aria-label", `${c}: ${rows.map((r) => `${r.label} ${r.value}`).join(", ")}`);
      const show = () => { g.classList.add("on"); tt.show(cx, Math.min(...[...series, ...markers].map((s) => (s.values[i] == null ? height : Y(Math.max(s.values[i], 0))))), c, rows); };
      const hide = () => { g.classList.remove("on"); tt.hide(); };
      hitR.addEventListener("pointerenter", show);
      hitR.addEventListener("pointerleave", hide);
      g.addEventListener("focus", show);
      g.addEventListener("blur", hide);
      const labelEvery = Math.ceil(52 / band);
      if ((n - 1 - i) % labelEvery === 0) {
        const tx = el("text", { x: cx, y: height - 6, class: "axis", "text-anchor": "middle" }, svg);
        tx.textContent = c;
      }
    });
  }, { fill: opts.fill, height: opts.height ?? 200 });
}

// ---------------------------------------------------------------- sparkline (static string)

export function sparkline(values, { width = 96, height = 32, color = "var(--series-1)" } = {}) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return "";
  const mn = Math.min(...v), mx = Math.max(...v);
  const X = (i) => 2 + (i / (v.length - 1)) * (width - 6);
  const Y = (x) => 3 + (1 - (x - mn) / (mx - mn || 1)) * (height - 6);
  const d = v.map((x, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join("");
  return `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${X(v.length - 1)}" cy="${Y(v[v.length - 1])}" r="3" fill="${color}" class="ring"/></svg>`;
}

// ---------------------------------------------------------------- horizontal bars (HTML)

export function hbars(items, format) {
  const max = Math.max(...items.map((i) => i.value), 0) || 1;
  const wrap = document.createElement("div");
  wrap.className = "hbars";
  for (const it of items) {
    const r = document.createElement("div"); r.className = "hbar";
    const l = document.createElement("span"); l.className = "hbar-label"; l.textContent = it.label;
    const track = document.createElement("span"); track.className = "hbar-track";
    const fill = document.createElement("span"); fill.className = "hbar-fill"; fill.style.width = `${(it.value / max) * 100}%`;
    if (it.highlight) fill.classList.add("hl");
    track.appendChild(fill);
    const v = document.createElement("span"); v.className = "hbar-val"; v.textContent = format(it.value);
    r.append(l, track, v);
    wrap.appendChild(r);
  }
  return wrap;
}
