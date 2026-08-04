/* Statewide layer: county and co-op three-year change, the distribution of
   district change, and growth against level.

   Same two rules as the entity pages. A figure ADE suppressed, or one whose
   endpoint year tested fewer than the N floor, is reported as unavailable with
   its reason -- never drawn as zero, never quietly dropped from a count. And
   every mark carries its own number in text, so the diverging fill is a second
   channel rather than the only one. */

(function () {
  "use strict";

  const DATA = JSON.parse(document.getElementById("statewide-data").textContent);
  const SUBJECTS = DATA.subjects;
  const FIRST = DATA.years.first, LAST = DATA.years.last;
  const SVG_NS = "http://www.w3.org/2000/svg";

  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const surface = () => cssVar("--surface-1") || "#fff";

  function h(tag, attrs, kids) {
    const n = document.createElement(tag);
    for (const k in (attrs || {})) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach((c) => n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return n;
  }
  function svg(tag, attrs, text) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    return n;
  }

  const REASONS = {
    not_published_both_years: "not published in both years",
    below_n_floor: "fewer than " + DATA.small_n_floor + " tested",
  };

  /* Three steps per arm. The thresholds are round numbers in percentage
     points, not quantiles of the data: a quantile scale would repaint every
     entity whenever the subject changed, and "dark red" would mean something
     different on each tab. */
  function divColor(d) {
    if (d === null) return null;
    const a = Math.abs(d);
    const arm = d > 0 ? "pos" : "neg";
    if (a < 1) return cssVar("--div-zero");
    const step = a < 3 ? 1 : a < 7 ? 2 : 3;
    return cssVar(`--div-${arm}-${step}`);
  }

  const state = { subject: SUBJECTS[0] };

  /* ---------- tooltip ---------- */

  const tip = h("div", { class: "tooltip", role: "status" });
  tip.style.display = "none";
  document.body.appendChild(tip);

  function showTip(x, y, title, rows, note) {
    tip.innerHTML = "";
    tip.appendChild(h("div", { class: "tt-title" }, [title]));
    (rows || []).forEach((r) => {
      tip.appendChild(h("div", { class: "tt-row" }, [
        h("span", { class: "k" }, [r.k]), h("span", { class: "v" }, [String(r.v)]),
      ]));
    });
    if (note) tip.appendChild(h("div", { class: "tt-note" }, [note]));
    tip.style.display = "block";
    const w = tip.offsetWidth, hgt = tip.offsetHeight;
    let left = x + 14, top = y - hgt / 2;
    if (left + w > window.scrollX + document.documentElement.clientWidth - 8) left = x - w - 14;
    tip.style.left = left + "px";
    tip.style.top = Math.max(window.scrollY + 8, top) + "px";
  }
  const hideTip = () => { tip.style.display = "none"; };
  window.addEventListener("scroll", hideTip, { passive: true });

  /* ---------- the scale key, shared by the maps and the lists ---------- */

  function scaleKey() {
    return h("div", { class: "scalekey" }, [
      "Change in percentage points:",
      h("span", { class: "sw", style: `background:${cssVar("--div-neg-3")}` }), "−7 or worse",
      h("span", { class: "sw", style: `background:${cssVar("--div-neg-2")}` }), "−3",
      h("span", { class: "sw", style: `background:${cssVar("--div-neg-1")}` }), "−1",
      h("span", { class: "sw", style: `background:${cssVar("--div-zero")};border:1px solid var(--border)` }), "under ±1",
      h("span", { class: "sw", style: `background:${cssVar("--div-pos-1")}` }), "+1",
      h("span", { class: "sw", style: `background:${cssVar("--div-pos-2")}` }), "+3",
      h("span", { class: "sw", style: `background:${cssVar("--div-pos-3")}` }), "+7 or better",
      h("span", { class: "sw hatch" }), "no change figure",
    ]);
  }

  /* ---------- choropleth ----------

     Shapes are Census boundary geometry (Step B.1's granted exception); every
     value colouring one is ADE's own published figure. A shape whose entity has
     no computable change is hatched, never filled with a colour that would read
     as a small change, and the reason travels with it in the tooltip and in the
     list below.

     Fill is never the only channel: the sorted list under each map carries the
     same entities with their numbers in text, which is also the print and
     no-hover path. */

  function renderMap(hostId, grain, entries) {
    const host = document.getElementById(hostId);
    if (!host) return;
    host.innerHTML = "";
    const geo = DATA.geography;
    const paths = geo && geo[grain];
    if (!paths || !Object.keys(paths).length) return;

    const byId = {};
    entries.forEach((e) => { byId[e.id] = e; });
    const view = geo.view;
    const s = svg("svg", {
      viewBox: `0 0 ${view.width} ${view.height}`, class: "map",
      role: "img",
      "aria-label": `Map of Arkansas ${grain === "coop" ? "education service cooperatives"
        : "counties"}, shaded by change in ${state.subject} between ${FIRST} and ${LAST}. `
        + "The same figures are listed in text below the map.",
    });

    // "No figure" has to be unmistakable against `--div-zero`, which is also
    // pale: a shape that reads as "roughly no change" when the truth is "we
    // cannot say" is exactly the error this site exists not to make. Hence a
    // hatch rather than another flat tone, at a spacing coarse enough to
    // survive the print scale.
    const patternId = "nofig-" + hostId;
    const defs = svg("defs");
    const pat = svg("pattern", {
      id: patternId, width: 5, height: 5, patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)",
    });
    pat.appendChild(svg("rect", { width: 5, height: 5, fill: surface() }));
    pat.appendChild(svg("line", { x1: 0, y1: 0, x2: 0, y2: 5,
      stroke: cssVar("--text-secondary"), "stroke-width": 1.8 }));
    defs.appendChild(pat);
    s.appendChild(defs);

    Object.keys(paths).sort().forEach((id) => {
      const e = byId[id];
      const known = e && e.delta !== null;
      const p = svg("path", {
        d: paths[id], class: "shape",
        fill: known ? divColor(e.delta) : `url(#${patternId})`,
        // Even-odd, not the default: a co-op area that encloses another one
        // carries that neighbour as an interior ring, and shapely does not
        // promise the two rings wind in opposite directions -- under the
        // nonzero rule an enclosed co-op would be painted over by the one
        // around it.
        "fill-rule": "evenodd",
        stroke: surface(), "stroke-width": 0.7,
      });
      const label = (e && e.name) || id;
      p.appendChild(svg("title", {}, label + " — " + (known
        ? (e.delta > 0 ? "+" : "") + e.delta.toFixed(1) + "pp"
        : (e ? REASONS[e.reason] || "no change figure" : "no figure published"))));
      if (e) {
        p.addEventListener("mousemove", (ev) => {
          showTip(ev.pageX, ev.pageY, e.name, [
            { k: String(FIRST), v: e.first === null ? "not published" : e.first.toFixed(1) + "%" },
            { k: String(LAST), v: e.last === null ? "not published" : e.last.toFixed(1) + "%" },
            { k: "Change", v: known ? (e.delta > 0 ? "+" : "") + e.delta.toFixed(1) + "pp"
                                    : REASONS[e.reason] || "not available" },
            { k: "Tested " + LAST, v: e.n_last === null ? "—" : e.n_last.toLocaleString() },
          ], "Both figures are ADE's own published figures; the change is computed from them.");
        });
        p.addEventListener("mouseleave", hideTip);
      }
      s.appendChild(p);
    });
    host.appendChild(s);
    host.appendChild(scaleKey());

    const cov = geo.coverage || {};
    const notes = [geo.source_note];
    if (grain === "coop" && cov.districts_without_boundary) {
      notes.push(
        `Co-operative areas are the combined boundaries of their member districts, from ADE's `
        + `own Master List. ${cov.districts_matched} of ${cov.districts_total} districts have a `
        + `published boundary; the other ${cov.districts_without_boundary.length} are `
        + "open-enrollment charters and state-operated schools, which have no geographic service "
        + "area. Their students are counted in the co-operative's published figure but add no "
        + "area to the map.");
    }
    const missing = entries.filter((e) => e.delta === null).length;
    if (missing) {
      notes.push(`${missing} shaded with hatching: no change figure for ${state.subject}, `
        + "for the reason given in the list below.");
    }
    host.appendChild(h("p", { class: "mapnote" }, [notes.join(" ")]));
  }

  /* ---------- sorted diverging rows (the numbers under each map) ---------- */

  function renderRows(hostId, grain, linkPrefix) {
    const host = document.getElementById(hostId);
    host.innerHTML = "";
    const entries = (DATA[grain] || {})[state.subject] || [];
    const withDelta = entries.filter((e) => e.delta !== null);
    const span = Math.max(5, ...withDelta.map((e) => Math.abs(e.delta)));

    const sorted = [...entries].sort((a, b) => {
      if (a.delta === null && b.delta === null) return a.name.localeCompare(b.name);
      if (a.delta === null) return 1;
      if (b.delta === null) return -1;
      return b.delta - a.delta;
    });

    const list = h("div", { class: "rows" });
    sorted.forEach((e) => {
      const bar = h("div", { class: "rbar" });
      bar.appendChild(h("u", { style: "left:50%" }));
      if (e.delta !== null) {
        const frac = Math.abs(e.delta) / span / 2;
        const left = e.delta >= 0 ? 50 : 50 - frac * 100;
        const mark = h("i", {
          style: `left:${left}%;width:${Math.max(frac * 100, 0.4)}%;background:${divColor(e.delta)}`,
        });
        bar.appendChild(mark);
      }
      // Co-op names all end in the same four words; dropping them keeps the
      // part that identifies the co-op readable instead of ellipsised. The
      // full published name stays on the row's tooltip.
      const shown = e.name.replace(/\s+Educationa?l?\s+Service\s+Cooperative$/i, " Co-op");
      const nameCell = h("div", { class: "rname", title: e.name }, [
        linkPrefix ? h("a", { href: linkPrefix + e.id + ".html" }, [shown]) : shown,
      ]);
      const val = e.delta === null
        ? h("div", { class: "rval na" }, [REASONS[e.reason] || "not available"])
        : h("div", { class: "rval" }, [(e.delta > 0 ? "+" : "") + e.delta.toFixed(1)]);
      const row = h("div", { class: "rowitem" }, [nameCell, bar, val]);
      row.addEventListener("mousemove", (ev) => {
        showTip(ev.pageX, ev.pageY, e.name, [
          { k: String(FIRST), v: e.first === null ? "not published" : e.first.toFixed(1) + "%" },
          { k: String(LAST), v: e.last === null ? "not published" : e.last.toFixed(1) + "%" },
          { k: "Change", v: e.delta === null ? (REASONS[e.reason] || "not available")
                                             : (e.delta > 0 ? "+" : "") + e.delta.toFixed(1) + "pp" },
          { k: "Tested " + LAST, v: e.n_last === null ? "—" : e.n_last.toLocaleString() },
        ], "Both figures are ADE's own published figures; the change is computed from them.");
      });
      row.addEventListener("mouseleave", hideTip);
      list.appendChild(row);
    });
    host.appendChild(list);

    // The key sits with the map above when there is one; repeating it here
    // would just be two legends for one scale.
    if (!document.getElementById(hostId.replace("-rows", "-map"))) {
      host.appendChild(scaleKey());
    }
    const unavailable = entries.length - withDelta.length;
    if (unavailable) {
      host.appendChild(h("p", { style: "color:var(--text-muted);font-size:12.5px;margin:10px 0 0" }, [
        `${unavailable} of ${entries.length} have no change figure for ${state.subject}: `
        + `either a year is unpublished or an endpoint tested fewer than ${DATA.small_n_floor} students. `
        + "They are listed with the reason rather than left out.",
      ]));
    }
  }

  /* ---------- distribution of district change ---------- */

  function renderChangeDist() {
    const host = document.getElementById("change-dist");
    const note = document.getElementById("change-note");
    host.innerHTML = ""; note.innerHTML = "";
    const d = (DATA.district_change || {})[state.subject];
    if (!d || !d.n) {
      note.textContent = "No district published a change figure for this subject.";
      return;
    }
    const W = 780, H = 230, M = { t: 18, r: 20, b: 40, l: 20 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `Distribution of district change in ${state.subject}` });
    const x = (v) => M.l + (iw * (v - d.lo)) / (d.hi - d.lo);
    const peak = Math.max.apply(null, d.bins) || 1;
    const bw = iw / d.bins.length;

    for (let v = d.lo; v <= d.hi + 0.001; v += 10) {
      s.appendChild(svg("text", { class: "ticklabel", x: x(v), y: H - 14, "text-anchor": "middle" },
        (v > 0 ? "+" : "") + v + "pp"));
    }
    d.bins.forEach((count, i) => {
      if (!count) return;
      const v0 = d.lo + i * d.bin_width;
      const bh = Math.max(2, (ih * count) / peak);
      const mid = v0 + d.bin_width / 2;
      const rect = svg("rect", {
        x: x(v0) + 1, y: M.t + ih - bh, width: Math.max(1, bw - 2), height: bh,
        rx: 3, fill: divColor(mid),
      });
      rect.addEventListener("mousemove", (ev) => showTip(ev.pageX, ev.pageY,
        `${(v0 > 0 ? "+" : "") + v0}pp to ${(v0 + d.bin_width > 0 ? "+" : "") + (v0 + d.bin_width)}pp`,
        [{ k: "Districts", v: count }]));
      rect.addEventListener("mouseleave", hideTip);
      s.appendChild(rect);
    });
    s.appendChild(svg("line", { class: "axisline", x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih }));
    s.appendChild(svg("line", { x1: x(0), x2: x(0), y1: M.t, y2: M.t + ih,
      stroke: cssVar("--axis"), "stroke-width": 1 }));
    s.appendChild(svg("text", { class: "ticklabel", x: x(0), y: M.t - 4, "text-anchor": "middle" }, "no change"));
    if (d.median !== null) {
      s.appendChild(svg("line", { x1: x(d.median), x2: x(d.median), y1: M.t, y2: M.t + ih,
        stroke: surface(), "stroke-width": 4 }));
      s.appendChild(svg("line", { x1: x(d.median), x2: x(d.median), y1: M.t, y2: M.t + ih,
        stroke: cssVar("--text-primary"), "stroke-width": 1.5 }));
      s.appendChild(svg("text", { class: "serieslabel", x: x(d.median) + 5, y: M.t + 10,
        fill: cssVar("--text-primary") }, `median ${d.median > 0 ? "+" : ""}${d.median.toFixed(1)}pp`));
    }
    host.appendChild(s);

    const stats = h("div", { class: "statgrid" }, [
      h("div", { class: "stat" }, [h("div", { class: "k" }, ["Districts plotted"]),
        h("div", { class: "v" }, [String(d.n)])]),
      h("div", { class: "stat" }, [h("div", { class: "k" }, ["Improved"]),
        h("div", { class: "v" }, [String(d.n_improved)])]),
      h("div", { class: "stat" }, [h("div", { class: "k" }, ["Declined"]),
        h("div", { class: "v" }, [String(d.n_declined)])]),
      h("div", { class: "stat" }, [h("div", { class: "k" }, ["No change figure"]),
        h("div", { class: "v" }, [String(d.n_excluded)])]),
    ]);
    note.appendChild(stats);
    note.appendChild(h("p", { style: "margin:0" }, [
      `Each bar counts districts whose ${FIRST}→${LAST} change fell in that two-point range. `
      + `${d.n_excluded} districts are not plotted because a year is unpublished or an `
      + `endpoint tested fewer than ${DATA.small_n_floor} students`
      + (d.n_clamped ? `; ${d.n_clamped} sit beyond ±30pp and are drawn in the end bar.` : ".")]));
  }

  /* ---------- growth against level ---------- */

  function renderScatter() {
    const host = document.getElementById("scatter");
    const note = document.getElementById("scatter-note");
    host.innerHTML = ""; note.innerHTML = "";
    const sc = (DATA.scatter || {})[state.subject];
    if (!sc || !sc.points.length) {
      note.textContent = "No district has both a published " + LAST + " figure and a published change for this subject.";
      return;
    }
    const W = 780, H = 420, M = { t: 20, r: 20, b: 48, l: 54 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `District change against level, ${state.subject}` });

    const levels = sc.points.map((p) => p.level), deltas = sc.points.map((p) => p.delta);
    const xlo = Math.max(0, Math.floor((Math.min.apply(null, levels) - 3) / 10) * 10);
    const xhi = Math.min(100, Math.ceil((Math.max.apply(null, levels) + 3) / 10) * 10);
    const dmax = Math.max(5, Math.ceil(Math.max.apply(null, deltas.map(Math.abs)) / 5) * 5);
    const x = (v) => M.l + (iw * (v - xlo)) / (xhi - xlo);
    const y = (v) => M.t + ih / 2 - (ih / 2) * (v / dmax);

    for (let v = xlo; v <= xhi + 0.001; v += 10) {
      s.appendChild(svg("line", { class: "gridline", x1: x(v), x2: x(v), y1: M.t, y2: M.t + ih }));
      s.appendChild(svg("text", { class: "ticklabel", x: x(v), y: M.t + ih + 20, "text-anchor": "middle" }, v + "%"));
    }
    for (let v = -dmax; v <= dmax + 0.001; v += dmax / 2) {
      s.appendChild(svg("line", { class: "gridline", x1: M.l, x2: M.l + iw, y1: y(v), y2: y(v) }));
      s.appendChild(svg("text", { class: "ticklabel", x: M.l - 8, y: y(v) + 4, "text-anchor": "end" },
        (v > 0 ? "+" : "") + v));
    }
    s.appendChild(svg("line", { class: "axisline", x1: M.l, x2: M.l + iw, y1: y(0), y2: y(0) }));
    s.appendChild(svg("text", { class: "axistitle", x: M.l + iw / 2, y: H - 10, "text-anchor": "middle" },
      `Percent Ready or Exceeding, ${LAST}`));
    s.appendChild(svg("text", { class: "axistitle", x: 14, y: M.t + ih / 2,
      "text-anchor": "middle", transform: `rotate(-90 14 ${M.t + ih / 2})` },
      `Change since ${FIRST} (pp)`));

    // The state's own published figure, as a reference line -- ADE's State
    // sheet, not a mean of the dots.
    const st = ((DATA.state || {})[state.subject] || [])[0];
    if (st && st.last !== null) {
      s.appendChild(svg("line", { x1: x(st.last), x2: x(st.last), y1: M.t, y2: M.t + ih,
        stroke: cssVar("--text-secondary"), "stroke-width": 1, "stroke-dasharray": "4 3" }));
      s.appendChild(svg("text", { class: "ticklabel", x: x(st.last) + 5, y: M.t + 12 },
        `Arkansas ${st.last.toFixed(1)}%`));
    }

    sc.points.forEach((p) => {
      const c = svg("circle", { cx: x(p.level), cy: y(p.delta), r: 4.5,
        fill: divColor(p.delta), stroke: surface(), "stroke-width": 1.5, opacity: 0.95 });
      c.addEventListener("mousemove", (ev) => showTip(ev.pageX, ev.pageY, p.name, [
        { k: LAST + " level", v: p.level.toFixed(1) + "%" },
        { k: "Change", v: (p.delta > 0 ? "+" : "") + p.delta.toFixed(1) + "pp" },
        { k: "Tested", v: p.n === null ? "—" : p.n.toLocaleString() },
      ]));
      c.addEventListener("mouseleave", hideTip);
      c.addEventListener("click", () => { window.location.href = "district/" + p.id + ".html"; });
      c.style.cursor = "pointer";
      s.appendChild(c);
    });
    host.appendChild(s);
    note.textContent = `${sc.points.length} districts plotted. ${sc.n_excluded} are not plotted: `
      + `a year is unpublished, or an endpoint tested fewer than ${sc.n_floor} students, which makes `
      + "both the level and the change too volatile to position. Click a point for that district's page.";
  }

  /* ---------- controls ---------- */

  function renderControls() {
    const host = document.getElementById("subject-chips");
    host.innerHTML = "";
    SUBJECTS.forEach((s) => {
      host.appendChild(h("button", {
        type: "button", class: "chip", "aria-pressed": String(s === state.subject),
        onclick: () => { state.subject = s; renderAll(); },
      }, [s]));
    });
  }

  function renderAll() {
    renderControls();
    renderMap("county-map", "county", (DATA.county || {})[state.subject] || []);
    renderMap("coop-map", "coop", (DATA.coop || {})[state.subject] || []);
    renderRows("county-rows", "county", null);
    renderRows("coop-rows", "coop", null);
    renderChangeDist();
    renderScatter();
    document.querySelectorAll("[data-selecho]").forEach((el) => { el.textContent = state.subject; });
  }

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  (mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(renderAll);
  new MutationObserver(renderAll).observe(document.documentElement, {
    attributes: true, attributeFilter: ["data-theme"],
  });

  renderAll();
})();
