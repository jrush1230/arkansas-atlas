
/* Rendering for an entity page. Reads the payload embedded in the page, so
   the page works from file:// with no fetch and no server.

   Two rules run through everything here:
   - A suppressed or unpublished figure renders as its status wording, never as
     0 and never as a blank that could be read as 0. Lines break at a gap
     rather than joining across one.
   - Aqua and magenta sit below 3:1 on the light surface, so every series
     carries a visible direct label at its last published point and the same
     numbers appear in the benchmark table underneath. */

(function () {
  "use strict";

  const DATA = JSON.parse(document.getElementById("entity-data").textContent);
  const YEARS = DATA.meta.years;
  const SUBJECT_ORDER = ["ELA", "Reading", "Math", "Science", "Algebra", "Geometry", "Biology"];
  const SUBJECTS = [...DATA.meta.subjects].sort(
    (a, b) => SUBJECT_ORDER.indexOf(a) - SUBJECT_ORDER.indexOf(b));
  const STATUS = DATA.meta.status_labels;
  const SMALL_N = DATA.meta.small_n_floor;

  const LEVEL_VARS = ["--level-1", "--level-2", "--level-3", "--level-4"];
  const LEVEL_NAMES = ["Level 1 · In need of support", "Level 2 · Close",
                       "Level 3 · Ready", "Level 4 · Exceeding"];
  const BENCH_VARS = {
    self: "--series-entity", district: "--series-district",
    county: "--series-county", coop: "--series-coop", state: "--series-state",
  };
  const SELF_LABEL = DATA.entity.type === "district" ? "This district" : "This school";
  const DISPLAY_NAME = DATA.entity.display_name || DATA.entity.name;
  // Short in the chart (where a long name collides with its neighbours' labels),
  // full in the table underneath.
  const BENCH_NAMES = { self: SELF_LABEL, district: "District", county: "County",
                        coop: "Co-op", state: "State" };

  const SVG_NS = "http://www.w3.org/2000/svg";
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const surface = () => cssVar("--surface-1") || "#fff";

  function svg(tag, attrs, text) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    return n;
  }
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

  const pct = (v) => (v === null || v === undefined ? null : v.toFixed(1) + "%");

  /* Ink for a label sitting *on* a filled mark. Picked from the fill's own
     luminance rather than from its position in the ramp: the level ramp runs
     light-to-dark on the light surface and dark-to-light on the dark one, so an
     index-based rule puts white text on the palest segment in dark mode. */
  function inkOn(fill) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(fill).trim());
    if (!m) return cssVar("--text-primary");
    const n = parseInt(m[1], 16);
    const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    const lum = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
    return lum > 0.42 ? "#111111" : "#ffffff";
  }
  const statusText = (code) => STATUS[code] || "not published";

  /* ---------- state ---------- */

  const state = {
    subject: firstSubjectWithData(),
    mode: "grade",
    grade: "ALL",
    series: { self: true, district: true, county: true, coop: true, state: true },
  };

  function firstSubjectWithData() {
    for (const s of SUBJECTS) {
      const cells = DATA.trend[s] && DATA.trend[s].ALL;
      if (cells && YEARS.some((y) => cells[y] && cells[y].pct_proficient !== null)) return s;
    }
    return SUBJECTS[0];
  }

  function gradesFor(subject) {
    const per = DATA.trend[subject] || {};
    return Object.keys(per).filter((g) => {
      if (g === "ALL") return true;
      return YEARS.some((y) => per[g][y] && per[g][y].status !== "not_offered");
    }).sort((a, b) => (a === "ALL" ? -1 : b === "ALL" ? 1 : a.localeCompare(b)));
  }

  function cellFor(level, subject, grade, year) {
    if (level === "self") return (DATA.trend[subject] || {})[grade]?.[year] || null;
    const b = (DATA.benchmarks[subject] || {})[grade]?.[year];
    return b ? b[level] || null : null;
  }

  /* Cohort view: grade advances with each year (Gr g in Y0, g+1 in Y1, ...). */
  function chainGrade(grade, yr) {
    const gi = parseInt(grade, 10) + YEARS.indexOf(yr);
    return gi <= 12 ? String(gi).padStart(2, "0") : null;
  }
  function cellForView(level, subject, grade, yr) {
    if (state.mode !== "cohort" || grade === "ALL") return cellFor(level, subject, grade, yr);
    const g = chainGrade(grade, yr);
    return g ? cellFor(level, subject, g, yr) : null;
  }
  function viewGrade(yr) {
    return state.mode === "cohort" && state.grade !== "ALL" ? chainGrade(state.grade, yr) : state.grade;
  }
  function cohortYearLabel(yr) {
    const g = state.mode === "cohort" && state.grade !== "ALL" ? chainGrade(state.grade, yr) : null;
    return g ? ` \u00b7 Gr ${parseInt(g, 10)}` : "";
  }

  function activeLevels() {
    const levels = ["self"];
    for (const k of ["district", "county", "coop", "state"]) {
      if (DATA.benchmarks.levels && DATA.benchmarks.levels[k]) levels.push(k);
    }
    return levels;
  }

  /* ---------- tooltip ---------- */

  const tip = h("div", { class: "tooltip", role: "status" });
  tip.style.display = "none";
  document.body.appendChild(tip);

  function showTip(x, y, title, rows, note) {
    tip.innerHTML = "";
    tip.appendChild(h("div", { class: "tt-title" }, [title]));
    rows.forEach((r) => {
      tip.appendChild(h("div", { class: "tt-row" }, [
        h("span", { class: "k" }, [
          r.color ? h("span", { class: "swatch-inline", style: `background:${r.color}` }) : "",
          r.k,
        ]),
        h("span", { class: "v" }, [r.v]),
      ]));
    });
    if (note) tip.appendChild(h("div", { class: "tt-note" }, [note]));
    tip.style.display = "block";
    const w = tip.offsetWidth, hgt = tip.offsetHeight;
    let left = x + 14, top = y - hgt / 2;
    if (left + w > window.scrollX + document.documentElement.clientWidth - 8) left = x - w - 14;
    top = Math.max(window.scrollY + 8, top);
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }
  const hideTip = () => { tip.style.display = "none"; };

  /* ---------- trend chart ---------- */

  function renderTrend() {
    const host = document.getElementById("trend-chart");
    host.innerHTML = "";
    // Series values and coincident-series groups are computed BEFORE geometry so
    // the right margin can be sized to the widest endpoint label — a merged
    // "This school · District 34.6%" label must fit inside the SVG, not run off it.
    const seriesLevels = activeLevels().filter((l) => state.series[l]);
    const seriesRows = seriesLevels.map((level) => {
      const cells = YEARS.map((yr) => cellForView(level, state.subject, state.grade, yr));
      const sig = JSON.stringify(cells.map((c) => (c && c.pct_proficient !== null ? Math.round(c.pct_proficient * 10) : null)));
      return { level, cells, sig, empty: cells.every((c) => !c || c.pct_proficient === null) };
    });
    const SPECIFICITY = ["self", "district", "county", "coop", "state"];
    const groups = [];
    seriesRows.forEach((r) => {
      if (r.empty) return;
      let g = groups.find((x) => x.sig === r.sig);
      if (!g) { g = { sig: r.sig, members: [] }; groups.push(g); }
      g.members.push(r);
    });
    groups.forEach((g) => g.members.sort((a, b) => SPECIFICITY.indexOf(a.level) - SPECIFICITY.indexOf(b.level)));
    const groupLabelText = (g) => {
      const lastC = [...g.members[0].cells].reverse().find((c) => c && c.pct_proficient !== null);
      return g.members.map((m) => BENCH_NAMES[m.level]).join(" \u00b7 ")
        + " " + (lastC ? lastC.pct_proficient.toFixed(1) + "%" : "");
    };
    const maxLabelChars = Math.max(14, ...groups.map((g) => groupLabelText(g).length));
    const W = 780, H = 360,
      M = { t: 18, r: Math.max(120, Math.min(300, Math.round(maxLabelChars * 7.0) + 20)), b: 46, l: 46 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `${state.subject} percent proficient, ${YEARS[0]} to ${YEARS[YEARS.length - 1]}` });

    // Domain: snapped to 10s around the data, but never narrower than 40
    // percentage points. Zooming all the way in on a 3-point spread would
    // make a rounding-sized difference look like a collapse; a fixed 0-100
    // axis makes every Arkansas school look identical. The floor is the
    // compromise, and the axis always shows where it starts.
    const vals = [];
    activeLevels().forEach((lv) => YEARS.forEach((yr) => {
      const c = cellForView(lv, state.subject, state.grade, yr);
      if (c && c.pct_proficient !== null) vals.push(c.pct_proficient);
    }));
    let lo = 0, hi = 100;
    if (vals.length) {
      lo = Math.max(0, Math.floor((Math.min.apply(null, vals) - 3) / 5) * 5);
      hi = Math.min(100, Math.ceil((Math.max.apply(null, vals) + 3) / 5) * 5);
      if (hi - lo < 30) {
        const mid = (hi + lo) / 2;
        lo = Math.max(0, Math.round((mid - 15) / 5) * 5);
        hi = Math.min(100, lo + 30);
        lo = Math.max(0, hi - 30);
      }
    }
    const step = (hi - lo) <= 40 ? 10 : 20;
    const y = (v) => M.t + ih - (ih * (v - lo)) / (hi - lo);
    const x = (i) => M.l + (YEARS.length === 1 ? iw / 2 : (iw * i) / (YEARS.length - 1));

    for (let v = Math.ceil(lo / step) * step; v <= hi + 0.001; v += step) {
      s.appendChild(svg("line", { class: "gridline", x1: M.l, x2: M.l + iw, y1: y(v), y2: y(v) }));
      s.appendChild(svg("text", { class: "ticklabel", x: M.l - 9, y: y(v) + 4, "text-anchor": "end" }, v + "%"));
    }
    s.appendChild(svg("line", { class: "axisline", x1: M.l, x2: M.l + iw, y1: y(lo), y2: y(lo) }));
    const zeroNote = document.getElementById("trend-axis-note");
    if (zeroNote) {
      zeroNote.textContent = lo > 0
        ? `Vertical axis runs ${lo}%–${hi}%, not from zero.` : "";
    }
    YEARS.forEach((yr, i) => {
      const xl = state.mode === "cohort" && state.grade !== "ALL" && chainGrade(state.grade, yr)
        ? `${yr} \u00b7 Gr ${parseInt(chainGrade(state.grade, yr), 10)}` : String(yr);
      s.appendChild(svg("text", { class: "ticklabel", x: x(i), y: M.t + ih + 22, "text-anchor": "middle" }, xl));
      const rel = DATA.release[yr];
      if (rel) s.appendChild(svg("text", { class: "ticklabel", x: x(i), y: M.t + ih + 37,
        "text-anchor": "middle", "font-size": "10.5" }, releaseShort(rel)));
    });

    const labelItems = [];
    // Groups were computed above (before geometry); now lay them out and draw.
    groups.forEach((g) => {
      const lead = g.members[0];
      const isSelf = g.members.some((m) => m.level === "self");
      const color = cssVar(BENCH_VARS[lead.level]);
      const pts = YEARS.map((yr, i) => {
        const c = lead.cells[i];
        return c && c.pct_proficient !== null ? { i, x: x(i), y: y(c.pct_proficient), c } : null;
      });

      // Break the line across a suppressed year rather than interpolating over it.
      let run = [];
      const flush = () => {
        if (run.length > 1) {
          s.appendChild(svg("path", {
            d: "M" + run.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("L"),
            fill: "none", stroke: color, "stroke-width": isSelf ? 2.5 : 2,
            "stroke-linecap": "round", "stroke-linejoin": "round",
            opacity: isSelf ? 1 : 0.9,
          }));
        }
        run = [];
      };
      pts.forEach((p) => { if (p) run.push(p); else flush(); });
      flush();

      pts.forEach((p) => {
        if (!p) return;
        s.appendChild(svg("circle", { cx: p.x, cy: p.y, r: isSelf ? 5 : 4,
          fill: color, stroke: surface(), "stroke-width": 2 }));
      });

      const last = [...pts].reverse().find(Boolean);
      if (last) labelItems.push({
        level: lead.level, color, last,
        names: g.members.map((m) => BENCH_NAMES[m.level]),
        bold: isSelf,
      });
    });

    // Endpoint labels: ordered stacking, not greedy push-away. Labels keep the
    // same vertical order as their lines, each displaced the minimum needed for
    // a 15px gap; a short leader ties any displaced label back to its line.
    // Anchor x is the end of the data, not the chart edge — a cohort chain that
    // runs off the tested grade range ends early, and labels must end with it.
    {
      const lastX = labelItems.length
        ? Math.max(...labelItems.map((it) => it.last.x)) : M.l + iw;
      const gap = 15, top = M.t + 8, bot = M.t + ih;
      const items = [...labelItems].sort((a, b) => a.last.y - b.last.y);
      items.forEach((it) => { it.ly = Math.min(Math.max(it.last.y + 4, top), bot); });
      for (let i = 1; i < items.length; i++)
        items[i].ly = Math.max(items[i].ly, items[i - 1].ly + gap);
      if (items.length && items[items.length - 1].ly > bot) {
        items[items.length - 1].ly = bot;
        for (let i = items.length - 2; i >= 0; i--)
          items[i].ly = Math.min(items[i].ly, items[i + 1].ly - gap);
      }
      items.forEach((it) => {
        if (Math.abs(it.ly - (it.last.y + 4)) > 8) {
          s.appendChild(svg("line", { x1: lastX + 2, y1: it.last.y,
            x2: lastX + 10, y2: it.ly - 4, stroke: it.color,
            "stroke-width": 1, opacity: 0.55 }));
        }
        const g = svg("text", { class: "serieslabel", x: lastX + 12, y: it.ly, fill: it.color });
        g.appendChild(svg("tspan", { "font-weight": it.bold ? "700" : "600" },
          (it.names || [BENCH_NAMES[it.level]]).join(" \u00b7 ")));
        g.appendChild(svg("tspan", { dx: "5" }, it.last.c.pct_proficient.toFixed(1) + "%"));
        s.appendChild(g);
      });
    }

    // Suppressed / not-offered markers on the entity's own line. In cohort view
    // a chain can run past the subject's tested grade range (or off grade 12);
    // say so instead of leaving a bare dash floating in an empty year.
    YEARS.forEach((yr, i) => {
      const c = cellForView("self", state.subject, state.grade, yr);
      if (c && c.pct_proficient === null) {
        const cohortG = state.mode === "cohort" && state.grade !== "ALL"
          ? chainGrade(state.grade, yr) : null;
        const label = cohortG && c.status === "not_offered"
          ? `${state.subject} is not tested in Grade ${parseInt(cohortG, 10)}`
          : statusText(c.status);
        s.appendChild(svg("text", { class: "pointlabel", x: x(i), y: M.t + ih / 2,
          "text-anchor": "middle" }, label));
      } else if (!c && state.mode === "cohort" && state.grade !== "ALL" && !chainGrade(state.grade, yr)) {
        s.appendChild(svg("text", { class: "pointlabel", x: x(i), y: M.t + ih / 2,
          "text-anchor": "middle" }, "beyond Grade 12"));
      }
    });

    // Hover band per year -> one tooltip listing every series at that year.
    YEARS.forEach((yr, i) => {
      const bw = iw / YEARS.length;
      const band = svg("rect", { x: x(i) - bw / 2, y: M.t, width: bw, height: ih, fill: "transparent" });
      band.addEventListener("mousemove", (ev) => {
        const rows = seriesLevels.map((level) => {
          const c = cellForView(level, state.subject, state.grade, yr);
          return {
            color: cssVar(BENCH_VARS[level]),
            k: BENCH_NAMES[level],
            v: c && c.pct_proficient !== null
              ? `${c.pct_proficient.toFixed(1)}%  (n=${c.n_tested})`
              : statusText(c ? c.status : "not_published"),
          };
        });
        const self = cellForView("self", state.subject, state.grade, yr);
        const note = self && self.small_n ? `Fewer than ${SMALL_N} students tested — treat with caution.` : null;
        showTip(ev.pageX, ev.pageY, `${state.subject} · ${gradeLabel(state.grade)} · ${yr}`, rows, note);
      });
      band.addEventListener("mouseleave", hideTip);
      s.appendChild(band);
    });

    host.appendChild(s);
    renderTrendLegend(seriesLevels);
  }

  function releaseShort(label) {
    // ADE renamed its final release stage between years ("Post-Appeals" in 2024,
    // "Post-Corrections" in 2025+) — same meaning, different words. Displaying
    // both invites readers to think they differ, so both render as "Final";
    // the exact ADE stage name stays in the provenance/methodology record.
    const l = String(label).toLowerCase();
    if (l.includes("post-corrections") || l.includes("post-appeals")) return "Final";
    if (l.includes("pre-appeals")) return "Preliminary";
    return "";
  }
  const gradeLabel = (g) => (g === "ALL" ? "All grades" : "Grade " + parseInt(g, 10));

  function renderTrendLegend(active) {
    const host = document.getElementById("trend-legend");
    host.innerHTML = "";
    activeLevels().forEach((level) => {
      const on = state.series[level];
      const b = h("button", {
        type: "button", "aria-pressed": String(on),
        onclick: () => { state.series[level] = !state.series[level]; renderTrend(); },
      }, [
        h("span", { class: "swatch line", style: `background:${cssVar(BENCH_VARS[level])}` }),
        BENCH_NAMES[level],
      ]);
      host.appendChild(b);
    });
    host.appendChild(h("span", { class: "hint", style: "color:var(--text-muted);font-size:12px" },
      ["Click a series to show or hide it."]));
  }

  /* ---------- level distribution ---------- */

  function renderLevels() {
    const host = document.getElementById("level-chart");
    host.innerHTML = "";
    const rows = YEARS.map((yr) => ({ yr, c: cellForView("self", state.subject, state.grade, yr) }));
    const W = 780, M = { t: 34, r: 12, b: 66, l: 12 };
    const ih = 232;
    const H = M.t + ih + M.b;
    const iw = W - M.l - M.r;
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `Performance level distribution for ${state.subject}` });

    const withData = rows.filter((r) => r.c && r.c.pct_levels);
    const maxUp = Math.max(1, ...withData.map((r) => r.c.pct_levels[2] + r.c.pct_levels[3]));
    const maxDown = Math.max(1, ...withData.map((r) => r.c.pct_levels[0] + r.c.pct_levels[1]));
    const kY = ih / (maxUp + maxDown);
    const originY = M.t + maxUp * kY;
    const colW = 120;
    const yYear = M.t + ih + 38;
    const yTested = M.t + ih + 56;

    if (withData.length) {
      s.appendChild(svg("line", { x1: M.l, y1: originY, x2: W - M.r, y2: originY,
        stroke: cssVar("--text-secondary"), "stroke-width": 1.5 }));
    }

    rows.forEach((r, ri) => {
      const xc = M.l + (iw * (ri + 0.5)) / rows.length;
      const x0 = xc - colW / 2;
      s.appendChild(svg("text", { class: "ticklabel", x: xc, y: yYear,
        "text-anchor": "middle", "font-weight": "600" }, String(r.yr) + cohortYearLabel(r.yr)));

      if (!r.c || !r.c.pct_levels) {
        s.appendChild(svg("rect", { x: x0, y: M.t, width: colW, height: ih, rx: 4,
          fill: "none", stroke: cssVar("--grid"), "stroke-width": 1, "stroke-dasharray": "4 3" }));
        const vg = viewGrade(r.yr);
        const emptyLabel = !vg ? "beyond Grade 12"
          : r.c && r.c.status === "not_offered" && state.mode === "cohort" && state.grade !== "ALL"
            ? `not tested in Gr ${parseInt(vg, 10)}` : statusText(r.c ? r.c.status : "not_published");
        s.appendChild(svg("text", { class: "pointlabel", x: xc, y: yTested,
          "text-anchor": "middle" }, emptyLabel));
        return;
      }

      const Lp = r.c.pct_levels;
      let curUp = originY, curDown = originY;
      [{ li: 2, up: true }, { li: 3, up: true }, { li: 1, up: false }, { li: 0, up: false }].forEach(({ li, up }) => {
        const p = Lp[li];
        const hpx = Math.max(0, p * kY);
        const drawH = Math.max(0, hpx - 2);
        const fill = cssVar(LEVEL_VARS[li]);
        let y0;
        if (up) { y0 = curUp - hpx + 1; curUp -= hpx; } else { y0 = curDown + 1; curDown += hpx; }
        const isOuter = li === 0 || li === 3;
        if (drawH > 0) {
          s.appendChild(svg("rect", {
            x: x0, y: y0, width: colW, height: drawH,
            rx: isOuter ? 4 : 0, fill: fill,
          }));
          if (drawH >= 15) {
            s.appendChild(svg("text", {
              x: xc, y: y0 + drawH / 2 + 4, "text-anchor": "middle",
              fill: inkOn(fill), "font-size": "11.5", "font-weight": "600",
            }, p.toFixed(0) + "%"));
          }
        }
        const seg = svg("rect", { x: x0, y: y0, width: colW, height: Math.max(drawH, 1), fill: "transparent" });
        seg.addEventListener("mousemove", (ev) => {
          const counts = r.c.n_levels;
          showTip(ev.pageX, ev.pageY, `${r.yr} \u00b7 ${LEVEL_NAMES[li]}`, [
            { color: cssVar(LEVEL_VARS[li]), k: "Share", v: p.toFixed(1) + "%" },
            { k: "Students", v: counts && counts[li] !== null ? counts[li] : statusText(r.c.counts_status) },
            { k: "Tested", v: r.c.n_tested },
          ], r.c.pct_basis === "published_pct"
            ? "Percentages as published by ADE; per-level counts not available for this cell."
            : null);
        });
        seg.addEventListener("mouseleave", hideTip);
        s.appendChild(seg);
      });

      const profPct = r.c.pct_proficient;
      const belowPct = Lp[0] + Lp[1];
      s.appendChild(svg("text", { x: xc, y: curUp - 7, "text-anchor": "middle",
        fill: cssVar("--text-primary"), "font-size": "13", "font-weight": "700" },
        "\u25b2 " + profPct.toFixed(1) + "%"));
      s.appendChild(svg("text", { x: xc, y: curDown + 16, "text-anchor": "middle",
        fill: cssVar("--text-secondary"), "font-size": "12", "font-weight": "600" },
        "\u25bc " + belowPct.toFixed(1) + "%"));
      s.appendChild(svg("text", { class: "pointlabel", x: xc, y: yTested, "text-anchor": "middle" },
        `${r.c.n_tested} tested` + (r.c.small_n ? "  \u26a0 small group" : "")));
    });

    host.appendChild(s);

    const legend = document.getElementById("level-legend");
    legend.innerHTML = "";
    legend.style.justifyContent = "center";
    LEVEL_NAMES.forEach((name, i) => {
      legend.appendChild(h("span", { style: "display:inline-flex;align-items:center;gap:7px;color:var(--text-secondary)" }, [
        h("span", { class: "swatch", style: `background:${cssVar(LEVEL_VARS[i])};width:12px;height:12px;border-radius:3px` }),
        name,
      ]));
    });
  }

  /* ---------- benchmark table (also the relief for the sub-3:1 series) ---------- */

  function renderBenchTable() {
    const host = document.getElementById("bench-table");
    host.innerHTML = "";
    const levels = activeLevels();
    const t = h("table", { class: "data" });
    const thead = h("thead", {}, [h("tr", {}, [h("th", {}, ["Compared with"])].concat(
      YEARS.map((yr) => h("th", {}, [String(yr) + cohortYearLabel(yr)]))).concat([h("th", {}, ["2024 → 2026"])]))]);
    t.appendChild(thead);
    const tb = h("tbody");
    levels.forEach((level) => {
      const cells = YEARS.map((yr) => cellForView(level, state.subject, state.grade, yr));
      const tr = h("tr", level === "self" ? { class: "self" } : {});
      tr.appendChild(h("td", {}, [
        h("span", { class: "swatch-inline", style: `background:${cssVar(BENCH_VARS[level])}` }),
        level === "self" ? DISPLAY_NAME : BENCH_NAMES[level] +
          (DATA.benchmarks.levels[level] ? ` · ${DATA.benchmarks.levels[level].name}` : ""),
      ]));
      cells.forEach((c) => {
        if (!c || c.pct_proficient === null) {
          tr.appendChild(h("td", { class: "na" }, [statusText(c ? c.status : "not_published")]));
        } else {
          tr.appendChild(h("td", {}, [
            pct(c.pct_proficient),
            c.small_n ? h("span", { class: "badge small-n", title: `Fewer than ${SMALL_N} tested` }, [" n=" + c.n_tested]) : "",
          ]));
        }
      });
      const a = cells[0], b = cells[cells.length - 1];
      if (a && b && a.pct_proficient !== null && b.pct_proficient !== null) {
        const d = b.pct_proficient - a.pct_proficient;
        const cls = d > 0.05 ? "up" : d < -0.05 ? "down" : "flat";
        tr.appendChild(h("td", {}, [h("span", { class: "delta " + cls },
          [(d > 0 ? "▲ +" : d < 0 ? "▼ " : "± ") + d.toFixed(1) + "pp"])]));
      } else {
        tr.appendChild(h("td", { class: "na" }, ["—"]));
      }
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    host.appendChild(t);
    host.appendChild(h("p", { style: "color:var(--text-muted);font-size:12.5px;margin:10px 0 0" }, [
      state.mode === "cohort" && state.grade !== "ALL"
        ? "Every percentage above is ADE's own published figure for that grain. The change column " +
          "follows largely the same group of students as it moves up a grade each year."
        : "Every percentage above is ADE's own published figure for that grain. " +
          "The change column is computed from those figures and compares different groups of students in each year.",
    ]));
  }

  /* ---------- distribution strip ---------- */

  function renderDistribution() {
    const host = document.getElementById("dist-chart");
    const note = document.getElementById("dist-note");
    host.innerHTML = ""; note.innerHTML = "";
    const yr = YEARS[YEARS.length - 1];
    const vg = viewGrade(yr);
    if (!vg) {
      note.textContent = "The class is beyond Grade 12 by " + yr + ", so there is no distribution to place it in.";
      return;
    }
    const pos = ((DATA.distribution[state.subject] || {})[vg] || {})[yr];
    const dist = DATA.dist_values && DATA.dist_values[state.subject]
      && DATA.dist_values[state.subject][vg];
    const self = cellForView("self", state.subject, state.grade, yr);

    if (!pos || !dist || !dist.bins || !dist.n) {
      note.textContent = state.mode === "cohort" && state.grade !== "ALL"
        ? `${state.subject} is not tested in Grade ${parseInt(vg, 10)} in ${yr}, so there is no distribution to place the class in.`
        : "No statewide distribution is available for this subject and grade.";
      return;
    }

    const W = 780, H = 150, M = { t: 26, r: 20, b: 34, l: 20 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `Distribution of ${DATA.entity.type} results statewide` });
    const x = (v) => M.l + (iw * v) / 100;
    const peak = Math.max.apply(null, dist.bins) || 1;
    const barW = iw / 101;

    for (let v = 0; v <= 100; v += 25) {
      s.appendChild(svg("text", { class: "ticklabel", x: x(v), y: H - 12, "text-anchor": "middle" }, v + "%"));
    }

    dist.bins.forEach((count, v) => {
      if (!count) return;
      const bh = Math.max(1.5, (ih * count) / peak);
      s.appendChild(svg("rect", {
        x: x(v) - barW / 2, y: M.t + ih - bh, width: Math.max(1, barW - 1), height: bh,
        fill: cssVar("--text-muted"), opacity: 0.42, rx: 1,
      }));
    });
    s.appendChild(svg("line", { class: "axisline", x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih }));
    // Quartile marks sit above the bars, not under the axis, where they would
    // land on top of the 25%/50%/75% tick labels.
    if (dist.quartiles) {
      dist.quartiles.forEach((q, qi) => {
        s.appendChild(svg("line", { x1: x(q), x2: x(q), y1: M.t + 8, y2: M.t + ih,
          stroke: cssVar("--axis"), "stroke-width": 1, "stroke-opacity": 0.9 }));
        s.appendChild(svg("text", { class: "ticklabel", x: x(q), y: M.t + 4,
          "text-anchor": "middle", "font-size": "10" }, ["25th", "median", "75th"][qi]));
      });
    }

    if (self && self.pct_proficient !== null && pos.band) {
      const px = x(self.pct_proficient);
      s.appendChild(svg("line", { x1: px, x2: px, y1: M.t - 4, y2: M.t + ih,
        stroke: surface(), "stroke-width": 5 }));
      s.appendChild(svg("line", { x1: px, x2: px, y1: M.t - 4, y2: M.t + ih,
        stroke: cssVar("--series-entity"), "stroke-width": 2.5 }));
      s.appendChild(svg("text", { class: "serieslabel", x: px, y: M.t - 10,
        "text-anchor": px > W - 130 ? "end" : px < 100 ? "start" : "middle",
        fill: cssVar("--series-entity") }, `${self.pct_proficient.toFixed(1)}%`));
      note.appendChild(h("span", {}, [
        "In " + yr + " this " + DATA.entity.type + " sits in the ",
        h("span", { class: "badge band" }, [pos.band]),
        ` of ${pos.n} ${DATA.entity.type}s statewide with a published ${state.subject} figure ` +
        `for ${gradeLabel(state.grade).toLowerCase()}. `,
        pos.n_excluded_small
          ? `${pos.n_excluded_small} more published a figure but tested fewer than ${SMALL_N} students and are left out of the distribution.`
          : "",
      ]));
    } else {
      note.textContent = pos.status === "below_n_floor"
        ? `Not placed in the distribution: fewer than ${SMALL_N} students tested, which makes a percentage too volatile to position honestly.`
        : "Not placed in the distribution: no published figure for this cut.";
    }
    host.appendChild(s);
  }

  /* ---------- change against level (district pages) ----------

     The same points the statewide page plots, packed small enough to embed
     here: identical eligibility (both endpoint years published, both over the
     N floor), identical exclusions, and the reference line is ADE's own State
     figure rather than a mean of the dots.

     Always all grades. The page's grade chips do not filter it, because the
     all-grades district figure is the only cut ADE publishes for every
     district; the heading and the note both say so instead of quietly
     ignoring the selection. */

  function renderScatter() {
    const host = document.getElementById("scatter-chart");
    if (!host) return;
    const note = document.getElementById("scatter-note");
    const legend = document.getElementById("scatter-legend");
    host.innerHTML = ""; note.innerHTML = ""; legend.innerHTML = "";

    const SC = DATA.scatter;
    const block = SC && SC.subjects[state.subject];
    if (!block || !block.points.length) {
      note.textContent = "No district has both a published " + SC.years.last
        + " figure and a published change in " + state.subject + ", so there is nothing to plot.";
      return;
    }

    const selfId = DATA.entity.id;
    const myCountyIx = SC.counties.findIndex((c) =>
      DATA.entity.county && c.toLowerCase() === String(DATA.entity.county).toLowerCase());
    const myCoopIx = SC.coops.indexOf(DATA.entity.coop ? DATA.entity.coop.id : null);

    // A district in this county is also in this co-operative; the tighter
    // grouping wins the colour, and the legend says so.
    const groupOf = (p) => (p[0] === selfId ? "self"
      : (myCountyIx >= 0 && p[4] === myCountyIx) ? "county"
      : (myCoopIx >= 0 && p[5] === myCoopIx) ? "coop" : "other");

    const W = 780, H = 420, M = { t: 20, r: 20, b: 48, l: 54 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `Every Arkansas district's ${state.subject} change since ${SC.years.first} `
        + `against its ${SC.years.last} level, with ${DISPLAY_NAME} marked.` });

    const levels = block.points.map((p) => p[1]), deltas = block.points.map((p) => p[2]);
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
      `Percent Ready or Exceeding, ${SC.years.last}`));
    s.appendChild(svg("text", { class: "axistitle", x: 14, y: M.t + ih / 2,
      "text-anchor": "middle", transform: `rotate(-90 14 ${M.t + ih / 2})` },
      `Change since ${SC.years.first} (pp)`));

    const stateLevel = SC.state_level[state.subject];
    if (stateLevel !== undefined && stateLevel !== null) {
      s.appendChild(svg("line", { x1: x(stateLevel), x2: x(stateLevel), y1: M.t, y2: M.t + ih,
        stroke: cssVar("--series-state"), "stroke-width": 1, "stroke-dasharray": "4 3" }));
      s.appendChild(svg("text", { class: "ticklabel", x: x(stateLevel) + 5, y: M.t + 12 },
        `Arkansas ${stateLevel.toFixed(1)}%`));
    }

    const FILL = { other: cssVar("--text-muted"), county: cssVar("--series-county"),
                   coop: cssVar("--series-coop"), self: cssVar("--series-entity") };
    const ORDER = { other: 0, coop: 1, county: 2, self: 3 };
    const counts = { other: 0, county: 0, coop: 0, self: 0 };
    const drawn = block.points.map((p) => ({ p: p, g: groupOf(p) }));
    drawn.forEach((d) => { counts[d.g] += 1; });
    drawn.sort((a, b) => ORDER[a.g] - ORDER[b.g]);

    drawn.forEach((d) => {
      const p = d.p, isSelf = d.g === "self";
      const c = svg("circle", {
        cx: x(p[1]), cy: y(p[2]), r: isSelf ? 7 : d.g === "other" ? 3.6 : 5,
        fill: FILL[d.g], stroke: surface(), "stroke-width": isSelf ? 2 : 1.2,
        opacity: d.g === "other" ? 0.5 : 0.95,
      });
      c.appendChild(svg("title", {}, `${SC.names[p[0]]} — ${p[1].toFixed(1)}% in ${SC.years.last}, `
        + `${p[2] > 0 ? "+" : ""}${p[2].toFixed(1)}pp since ${SC.years.first}`));
      c.addEventListener("mousemove", (ev) => showTip(ev.pageX, ev.pageY, SC.names[p[0]], [
        { k: SC.years.last + " level", v: p[1].toFixed(1) + "%" },
        { k: "Change", v: (p[2] > 0 ? "+" : "") + p[2].toFixed(1) + "pp" },
        { k: "Tested", v: p[3] === null ? "—" : p[3].toLocaleString() },
        { k: "County", v: p[4] >= 0 ? SC.counties[p[4]] : "—" },
      ], isSelf ? null : "Click for this district's page."));
      c.addEventListener("mouseleave", hideTip);
      if (!isSelf) {
        c.style.cursor = "pointer";
        c.addEventListener("click", () => { window.location.href = "./" + p[0] + ".html"; });
      }
      s.appendChild(c);
      if (isSelf) {
        const px = x(p[1]);
        const anchor = px > W - 140 ? "end" : px < 120 ? "start" : "middle";
        // Drawn twice: the surface-coloured copy underneath is a halo, because
        // this label lands in the middle of a dense cloud and would otherwise
        // read as struck through by whatever dots sit behind it.
        [{ stroke: surface(), "stroke-width": 4, "stroke-linejoin": "round" }, {}]
          .forEach((extra) => {
            s.appendChild(svg("text",
              Object.assign({ class: "serieslabel", x: px, y: y(p[2]) - 12,
                "text-anchor": anchor, fill: cssVar("--series-entity") }, extra),
              DISPLAY_NAME));
          });
      }
    });
    host.appendChild(s);

    [["self", "This district"], ["county", "Same county"],
     ["coop", "Same co-operative"], ["other", "Every other district"]].forEach(([key, label]) => {
      if (!counts[key]) return;
      legend.appendChild(h("span", { class: "legend-item" }, [
        h("span", { class: "swatch dot", style: `background:${FILL[key]}` }),
        `${label} (${counts[key]})`,
      ]));
    });

    const missing = !counts.self;
    note.appendChild(h("span", {}, [
      `${block.points.length} districts plotted; ${block.n_excluded} are not, because a year is `
      + `unpublished or an endpoint tested fewer than ${SC.n_floor} students, which makes both the `
      + `level and the change too volatile to position. `
      + (missing
          ? `This district is one of them for ${state.subject}, so it is not marked on the chart. `
          : "")
      + "Districts in this county are marked as county peers; they are in this co-operative too. ",
    ]));
    // On paper there is nothing to click, so the hint goes with the screen.
    note.appendChild(h("span", { class: "no-print" }, ["Click any other district for its page."]));
  }

  /* ---------- cohort ---------- */

  function renderCohort() {
    const host = document.getElementById("cohort-body");
    if (!host) return;
    host.innerHTML = "";
    const chains = (DATA.cohorts || []).filter((c) => c.subject === state.subject);
    if (!chains.length) {
      host.appendChild(h("p", { style: "color:var(--text-muted);font-size:14px;margin:0" },
        ["No cohort can be followed for this subject at this school — it needs the same students tested in three consecutive grades."]));
      return;
    }
    const t = h("table", { class: "data" });
    t.appendChild(h("thead", {}, [h("tr", {}, [h("th", {}, ["Cohort"])].concat(
      YEARS.map((y) => h("th", {}, [String(y)]))).concat([h("th", {}, ["Change"])]))]));
    const tb = h("tbody");
    chains.forEach((ch) => {
      const tr = h("tr", {}, [h("td", {}, [ch.label])]);
      ch.steps.forEach((st) => {
        tr.appendChild(st.pct_proficient === null
          ? h("td", { class: "na" }, [statusText(st.status)])
          : h("td", {}, [`Gr ${parseInt(st.grade, 10)} · ${st.pct_proficient.toFixed(1)}%`]));
      });
      const a = ch.steps[0], b = ch.steps[ch.steps.length - 1];
      if (a.pct_proficient !== null && b.pct_proficient !== null) {
        const d = b.pct_proficient - a.pct_proficient;
        tr.appendChild(h("td", {}, [h("span", { class: "delta " + (d > 0.05 ? "up" : d < -0.05 ? "down" : "flat") },
          [(d > 0 ? "+" : "") + d.toFixed(1) + "pp"])]));
      } else tr.appendChild(h("td", { class: "na" }, ["—"]));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    host.appendChild(t);
  }

  /* ---------- controls ---------- */

  function renderControls() {
    const sh = document.getElementById("subject-chips");
    sh.innerHTML = "";
    SUBJECTS.forEach((s) => {
      const has = YEARS.some((y) => {
        const c = (DATA.trend[s] || {}).ALL?.[y];
        return c && c.pct_proficient !== null;
      });
      sh.appendChild(h("button", {
        type: "button", class: "chip", "aria-pressed": String(s === state.subject),
        disabled: has ? null : "disabled",
        title: has ? null : "Not administered at this school, or suppressed in every year",
        onclick: () => { state.subject = s; state.grade = "ALL"; renderAll(); },
      }, [s]));
    });

    const mh = document.getElementById("mode-chips");
    if (mh) {
      mh.innerHTML = "";
      [["grade", "Same grade, different students"], ["cohort", "Same students, moving up"]].forEach(([m, lbl]) => {
        mh.appendChild(h("button", {
          type: "button", class: "chip", "aria-pressed": String(state.mode === m),
          onclick: () => { state.mode = m; renderAll(); },
        }, [lbl]));
      });
    }

    const gh = document.getElementById("grade-chips");
    gh.innerHTML = "";
    if (state.mode === "cohort") {
      // A start grade is followable if its chain has at least two published points.
      const starts = gradesFor(state.subject).filter((g) => {
        if (g === "ALL") return false;
        return YEARS.filter((y) => {
          const cg = chainGrade(g, y);
          const per = cg && (DATA.trend[state.subject] || {})[cg];
          return per && per[y] && per[y].pct_proficient !== null;
        }).length >= 2;
      });
      if (!starts.includes(state.grade)) state.grade = starts[0] || "ALL";
      if (!starts.length) {
        gh.appendChild(h("span", { style: "font-size:13px;color:var(--text-muted)" },
          ["No class can be followed for this subject here \u2014 it needs the same group tested in consecutive grades."]));
      }
      starts.forEach((g) => {
        const gi = parseInt(g, 10), ge = Math.min(gi + YEARS.length - 1, 12);
        gh.appendChild(h("button", {
          type: "button", class: "chip", "aria-pressed": String(g === state.grade),
          onclick: () => { state.grade = g; renderAll(); },
        }, [`Gr ${gi} \u2192 ${ge}`]));
      });
    } else {
      gradesFor(state.subject).forEach((g) => {
        const per = (DATA.trend[state.subject] || {})[g] || {};
        const has = YEARS.some((y) => per[y] && per[y].pct_proficient !== null);
        gh.appendChild(h("button", {
          type: "button", class: "chip", "aria-pressed": String(g === state.grade),
          disabled: has ? null : "disabled",
          title: has ? null : "No published result for this grade in any year (suppressed or not tested)",
          onclick: () => { state.grade = g; renderAll(); },
        }, [gradeLabel(g)]));
      });
    }
  }

  function renderAll() {
    renderControls();
    renderTrend();
    renderLevels();
    renderBenchTable();
    renderDistribution();
    renderScatter();
    renderCohort();
    const std = state.subject + " \u00b7 " + gradeLabel(state.grade);
    const traj = state.mode === "cohort" && state.grade !== "ALL"
      ? state.subject + " \u00b7 class starting Grade " + parseInt(state.grade, 10) + " in " + YEARS[0]
      : std;
    document.querySelectorAll("[data-selecho]").forEach((el) => {
      el.textContent = traj;
    });
    // The scatter is all-grades whatever the grade chips say, so its echo
    // carries the subject alone -- echoing a grade it does not apply would
    // claim a filter that is not there.
    document.querySelectorAll("[data-selecho-subject]").forEach((el) => {
      el.textContent = state.subject;
    });
    const dynsub = state.mode === "cohort" && state.grade !== "ALL"
      ? `${state.subject} \u2014 following the class that started Grade ${parseInt(state.grade, 10)} in ${YEARS[0]}.`
      : `${state.subject}, ${gradeLabel(state.grade).toLowerCase()}.`;
    document.querySelectorAll("[data-dynsub]").forEach((el) => {
      el.textContent = dynsub + " ";
    });
    const sub = document.getElementById("trend-sub");
    if (sub) {
      if (state.mode === "cohort" && state.grade !== "ALL") {
        const g0 = parseInt(state.grade, 10);
        const seq = YEARS.map((y, i) => (g0 + i <= 12 ? `Grade ${g0 + i} in ${y}` : null))
          .filter(Boolean).join(", ");
        sub.textContent = `Percentage scoring Ready or Exceeding (Levels 3 and 4) in ${state.subject}, `
          + `following the class that started Grade ${g0} in ${YEARS[0]} \u2014 ${seq}. `
          + `Benchmark lines follow the same advancing grades. These are largely the same students, `
          + `though students transferring in and out mean the group is not identical year to year.`;
      } else {
        sub.textContent = `Percentage of students scoring Ready or Exceeding (Levels 3 and 4) in `
          + `${state.subject}, ${gradeLabel(state.grade).toLowerCase()}. Each year tests a different `
          + `group of students at the same grade, so a change between years is not the same as a group `
          + `of students improving. Switch the view to \u201cSame students, moving up\u201d to track one group `
          + `as it moves up a grade each year.`;
      }
    }
  }

  window.addEventListener("scroll", hideTip, { passive: true });

  // SVG fills are resolved from CSS custom properties at draw time, so a theme
  // change after load would otherwise leave every chart painted in the old
  // mode's palette while the page chrome around it switched. Redraw on both
  // signals: the OS setting, and the viewer's own theme stamp.
  const rerender = () => renderAll();
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  (mq.addEventListener ? mq.addEventListener.bind(mq, "change")
                       : mq.addListener.bind(mq))(rerender);
  new MutationObserver(rerender).observe(document.documentElement, {
    attributes: true, attributeFilter: ["data-theme"],
  });

  renderAll();
})();

