/* District map and ranked table (Step B.2).

   Behaviour follows `design-reference/district-map-approved.html`, which is the
   approved end state; this file is that page's script with the production
   adaptations the handoff named — relative links, the site's own tooltip and
   table furniture, and the styling moved into `districts.css`.

   Two rules carried straight over from the rest of the site. Every value shown
   is ADE's own published district figure for the selected subject and grade;
   the only computed quantity is a change between two of them, and it is
   produced only where both endpoint years published a figure over the N floor.
   And a shape with no computable figure is hatched, never given a pale fill
   that would sit beside the neutral middle of the diverging scale and read as
   "roughly no change".

   The model is deliberately separable from the DOM: `makeModel(payload)` holds
   the whole selection-and-ranking contract and touches nothing on the page, so
   `verify.py` can exercise the real shipped ranking code against the real
   shipped payload under Node rather than re-implementing it in a test and
   checking the re-implementation. */

(function (global) {
  "use strict";

  var VIEWS = [
    { id: "y2024", label: "2024", kind: "level", y: 2024 },
    { id: "y2025", label: "2025", kind: "level", y: 2025 },
    { id: "y2026", label: "2026", kind: "level", y: 2026 },
    { id: "g2425", label: "2024 → 25", kind: "growth", a: 2024, b: 2025 },
    { id: "g2526", label: "2025 → 26", kind: "growth", a: 2025, b: 2026 },
    { id: "g2426", label: "2024 → 26", kind: "growth", a: 2024, b: 2026 },
  ];

  /* Fixed breaks, not quantiles of the selected year: the whole point of the
     three single-year views is that flipping between them shows real movement,
     which a scale re-fitted per year would hide. Five breaks, six buckets —
     the top one is "50% or better". */
  var LEVEL_STEPS = [10, 20, 30, 40, 50];
  var LEVEL_LABELS = ["under 10%", "10–20%", "20–30%", "30–40%", "40–50%", "50% or better"];

  /* Diverging breaks for the change views, in percentage points. */
  var GROWTH_BREAKS = [-9, -6, -2, 2, 6, 9];
  var GROWTH_LABELS = ["−9 or worse", "−9 to −6", "−6 to −2", "under ±2",
    "+2 to +6", "+6 to +9", "+9 or better"];

  var SEQ = ["--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5", "--seq-6"];
  var DIV = ["--div-neg-3", "--div-neg-2", "--div-neg-1", "--div-zero",
    "--div-pos-1", "--div-pos-2", "--div-pos-3"];

  function levelBucket(v) {
    var i = 0;
    while (i < LEVEL_STEPS.length && v >= LEVEL_STEPS[i]) i++;
    return Math.min(i, SEQ.length - 1);
  }

  function growthBucket(v) {
    var b = GROWTH_BREAKS;
    if (v < b[0]) return 0;
    if (v < b[1]) return 1;
    if (v < b[2]) return 2;
    if (v <= b[3]) return 3;
    if (v <= b[4]) return 4;
    if (v <= b[5]) return 5;
    return 6;
  }

  var gradeLabel = function (g) {
    return g === "ALL" ? "all grades" : "grade " + parseInt(g, 10);
  };

  /* ---------------------------------------------------------------- model */

  function makeModel(D) {
    var state = { view: VIEWS[VIEWS.length - 1], subject: D.subjects[0],
      grade: "ALL", sortKey: "val", sortDir: -1 };
    var FLOOR = D.floor;
    var YEARS = D.years.map(Number);

    function recordFor(lea) {
      return ((D.values[state.subject] || {})[state.grade] || {})[lea] || {};
    }

    /* The figure the current view asks for, or the reason there isn't one.
       A change needs both endpoint years published AND both over the floor:
       a difference between a solid figure and one resting on nine students is
       not a change anybody should read off a colour. */
    function cellFor(lea) {
      var rec = recordFor(lea);
      var v = state.view;
      if (v.kind === "level") {
        var y = rec[v.y];
        if (!y || y[0] === null || y[0] === undefined) {
          return { val: null, reason: "no published figure for " + v.y, rec: rec };
        }
        return { val: y[0], n: y[1], rec: rec };
      }
      var a = rec[v.a], b = rec[v.b];
      if (!a || a[0] === null || a[0] === undefined) {
        return { val: null, reason: "no published figure for " + v.a, rec: rec };
      }
      if (!b || b[0] === null || b[0] === undefined) {
        return { val: null, reason: "no published figure for " + v.b, rec: rec };
      }
      if ((a[1] || 0) < FLOOR || (b[1] || 0) < FLOOR) {
        return { val: null, rec: rec,
          reason: "fewer than " + FLOOR + " tested in one endpoint year" };
      }
      return { val: Math.round((b[0] - a[0]) * 10) / 10, n: b[1], rec: rec };
    }

    function bucketFor(val) {
      return state.view.kind === "level" ? levelBucket(val) : growthBucket(val);
    }
    function tokenFor(val) {
      return state.view.kind === "level" ? SEQ[levelBucket(val)] : DIV[growthBucket(val)];
    }

    /* The column the rank and the sort both read. `val` is the current view's
       own figure; a year column is that year's published percentage; `n` is the
       number tested in the view's reference year. */
    function accessor(row) {
      if (state.sortKey === "val") return row.val;
      if (state.sortKey === "n") {
        var yr = state.view.kind === "level" ? state.view.y : state.view.b;
        var c = row.rec[yr];
        return c && c[1] !== null && c[1] !== undefined ? c[1] : null;
      }
      var y = row.rec[state.sortKey];
      return y && y[0] !== null && y[0] !== undefined ? y[0] : null;
    }

    /* Every district in the state, every time — including the thirty with no
       boundary, which the map cannot show at all, and any district that
       published nothing for this subject and grade, which is listed with its
       reason rather than dropped. The table is the only path those districts
       have into this feature.

       Rank 1 is the highest value on the SORTED column whatever direction the
       display is in: reversing a sort re-orders the rows, it does not renumber
       the districts. Rows with no value on that column are unranked and sink to
       the bottom in both directions. */
    function rows() {
      var out = [];
      for (var lea in D.names) {
        var c = cellFor(lea);
        out.push({ lea: lea, name: D.names[lea], val: c.val,
          reason: c.reason || null, rec: c.rec, mapped: !!D.paths[lea] });
      }
      // Ranking and display share the same tie-break, deliberately: without it
      // three districts on the same figure get ranks in the order the payload
      // happened to list them, and the table then shows 12, 13, 11 down the
      // page, which reads as a bug rather than as a tie.
      var ranked = out.filter(function (r) { return accessor(r) !== null; })
        .sort(function (a, b) {
          return accessor(b) - accessor(a) || a.name.localeCompare(b.name);
        });
      ranked.forEach(function (r, i) { r.rank = i + 1; });
      out.forEach(function (r) { if (accessor(r) === null) r.rank = null; });
      out.sort(function (a, b) {
        var av = accessor(a), bv = accessor(b);
        if (av === null && bv === null) return a.name.localeCompare(b.name);
        if (av === null) return 1;
        if (bv === null) return -1;
        if (av === bv) return a.name.localeCompare(b.name);
        return state.sortDir * (av - bv);
      });
      return out;
    }

    function metricLabel() {
      var v = state.view;
      return v.kind === "level"
        ? v.y + " % ready or exceeding"
        : v.a + "→" + v.b + " change (pp)";
    }
    function metricColumn() {
      var v = state.view;
      return v.kind === "level" ? "pct_proficient_" + v.y
        : "change_pp_" + v.a + "_to_" + v.b;
    }
    function selectionLabel() {
      return state.subject + " · " + gradeLabel(state.grade) + " · " + metricLabel();
    }

    function formatValue(val) {
      if (val === null) return null;
      return state.view.kind === "level"
        ? val.toFixed(1) + "%"
        : (val > 0 ? "+" : "") + val.toFixed(1) + "pp";
    }

    /* The CSV mirrors the table exactly: the same rows in the same order, the
       same rank, and the reason in place of a value wherever the table shows
       one. A download that quietly dropped the unavailable rows would be a
       different, tidier dataset than the one on the screen. */
    function csv() {
      var lines = ["rank,lea,district," + metricColumn()
        + ",pct_2024,pct_2025,pct_2026,n_2024,n_2025,n_2026,note"];
      rows().forEach(function (r) {
        var pct = YEARS.map(function (y) {
          var c = r.rec[y]; return c && c[0] !== null && c[0] !== undefined ? c[0] : "";
        });
        var ns = YEARS.map(function (y) {
          var c = r.rec[y]; return c && c[1] !== null && c[1] !== undefined ? c[1] : "";
        });
        var note = r.val === null ? r.reason : (r.mapped ? "" : "no boundary on map");
        lines.push([r.rank === null ? "" : r.rank, r.lea,
          '"' + r.name.replace(/"/g, '""') + '"',
          r.val === null ? "" : r.val].concat(pct, ns,
          ['"' + note + '"']).join(","));
      });
      return lines.join("\r\n") + "\r\n";
    }

    function csvName() {
      return "atlas-districts-" + state.subject + "-" + state.grade + "-"
        + state.view.id + ".csv";
    }

    function gradesFor(subject) {
      return (D.grades_avail[subject] || []);
    }

    function setSubject(s) {
      state.subject = s;
      // A grade the new subject is not tested at cannot stay selected — the
      // page would then be showing "grade 11 Math", which Arkansas does not
      // administer, as an empty map rather than as a nonsense selection.
      if (gradesFor(s).indexOf(state.grade) === -1) state.grade = "ALL";
    }
    function setGrade(g) { if (gradesFor(state.subject).indexOf(g) !== -1) state.grade = g; }
    function setView(id) {
      VIEWS.forEach(function (v) { if (v.id === id) state.view = v; });
    }
    function sortBy(key) {
      if (state.sortKey === key) state.sortDir = -state.sortDir;
      else { state.sortKey = key; state.sortDir = -1; }
    }

    return { state: state, VIEWS: VIEWS, years: YEARS, floor: FLOOR,
      cellFor: cellFor, rows: rows, accessor: accessor, bucketFor: bucketFor,
      tokenFor: tokenFor, csv: csv, csvName: csvName, metricLabel: metricLabel,
      metricColumn: metricColumn, selectionLabel: selectionLabel,
      formatValue: formatValue, gradesFor: gradesFor, setSubject: setSubject,
      setGrade: setGrade, setView: setView, sortBy: sortBy };
  }

  var API = { makeModel: makeModel, VIEWS: VIEWS, LEVEL_STEPS: LEVEL_STEPS,
    LEVEL_LABELS: LEVEL_LABELS, GROWTH_BREAKS: GROWTH_BREAKS,
    GROWTH_LABELS: GROWTH_LABELS, levelBucket: levelBucket,
    growthBucket: growthBucket, gradeLabel: gradeLabel };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.ATLAS_DISTRICTS = API;

  if (typeof document === "undefined") return;   // required under Node; stop here

  /* ------------------------------------------------------------------ page */

  var node = document.getElementById("districts-data");
  if (!node) return;
  var D = JSON.parse(node.textContent);
  var M = makeModel(D);
  var SVG_NS = "http://www.w3.org/2000/svg";

  var cssVar = function (n) {
    return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  };
  var surface = function () { return cssVar("--surface-1") || "#fff"; };

  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in (attrs || {})) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) {
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }
  function svg(tag, attrs, text) {
    var n = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* ---------- tooltip (the site's own, same as the statewide layer) ------- */

  var tip = h("div", { class: "tooltip", role: "status" });
  tip.style.display = "none";
  document.body.appendChild(tip);

  function showTip(x, y, title, subtitle, rows, note) {
    tip.innerHTML = "";
    tip.appendChild(h("div", { class: "tt-title" }, [title]));
    if (subtitle) tip.appendChild(h("div", { class: "tt-note", style: "margin:0 0 4px" }, [subtitle]));
    (rows || []).forEach(function (r) {
      tip.appendChild(h("div", { class: "tt-row" }, [
        h("span", { class: "k" }, [r.k]), h("span", { class: "v" }, [String(r.v)]),
      ]));
    });
    if (note) tip.appendChild(h("div", { class: "tt-note" }, [note]));
    tip.style.display = "block";
    var w = tip.offsetWidth, ht = tip.offsetHeight;
    var left = x + 14, top = y - ht / 2;
    if (left + w > window.scrollX + document.documentElement.clientWidth - 8) left = x - w - 14;
    tip.style.left = left + "px";
    tip.style.top = Math.max(window.scrollY + 8, top) + "px";
  }
  var hideTip = function () { tip.style.display = "none"; };
  window.addEventListener("scroll", hideTip, { passive: true });

  function tipRows(row) {
    return M.years.map(function (y) {
      var c = row.rec[y];
      return { k: String(y), v: c && c[0] !== null && c[0] !== undefined
        ? c[0].toFixed(1) + "%  (n=" + (c[1] === null ? "—" : c[1].toLocaleString()) + ")"
        : "not published" };
    });
  }

  /* ---------- map ---------- */

  function renderMap() {
    var host = document.getElementById("district-map");
    host.innerHTML = "";
    var s = svg("svg", {
      viewBox: "0 0 " + D.view.w + " " + D.view.h, class: "map districts", role: "img",
      "aria-label": "Map of Arkansas school districts, shaded by "
        + M.selectionLabel() + ". The same figures are listed in the ranked table below.",
    });

    var defs = svg("defs");
    var pat = svg("pattern", { id: "nofig-districts", width: 6, height: 6,
      patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
    pat.appendChild(svg("rect", { width: 6, height: 6, fill: surface() }));
    pat.appendChild(svg("line", { x1: 0, y1: 0, x2: 0, y2: 6,
      stroke: cssVar("--hatch-ink"), "stroke-width": 2 }));
    defs.appendChild(pat);
    s.appendChild(defs);

    var drawn = 0, hatched = 0;
    Object.keys(D.paths).sort().forEach(function (lea) {
      var c = M.cellFor(lea);
      var known = c.val !== null;
      if (known) drawn++; else hatched++;
      var p = svg("path", {
        d: D.paths[lea], class: "shape",
        fill: known ? cssVar(M.tokenFor(c.val)) : "url(#nofig-districts)",
        // Even-odd for the same reason the co-op map uses it: a boundary with
        // an interior ring is not guaranteed to wind the opposite way.
        "fill-rule": "evenodd", stroke: surface(), "stroke-width": 0.6,
      });
      var name = D.names[lea] || lea;
      p.appendChild(svg("title", {}, name + " — "
        + (known ? M.formatValue(c.val) : c.reason)));
      var row = { rec: c.rec };
      p.addEventListener("mousemove", function (ev) {
        showTip(ev.pageX, ev.pageY, name,
          M.state.subject + " · " + gradeLabel(M.state.grade),
          [{ k: M.metricLabel(), v: known ? M.formatValue(c.val) : c.reason }]
            .concat(tipRows(row)),
          "Each year is ADE's own published district figure; a change is computed from two of them.");
      });
      p.addEventListener("mouseleave", hideTip);
      p.addEventListener("click", function () {
        window.location.href = "district/" + lea + ".html";
      });
      s.appendChild(p);
    });
    host.appendChild(s);
    host.appendChild(scaleKey());
    host.appendChild(h("p", { class: "mapnote" }, [note(drawn, hatched)]));
  }

  function scaleKey() {
    var kids = [M.state.view.kind === "level"
      ? "Percent ready or exceeding:" : "Change in percentage points:"];
    var tokens = M.state.view.kind === "level" ? SEQ : DIV;
    var labels = M.state.view.kind === "level" ? LEVEL_LABELS : GROWTH_LABELS;
    tokens.forEach(function (t, i) {
      kids.push(h("span", { class: "sw", style: "background:" + cssVar(t)
        + (t === "--div-zero" || t === "--seq-1" ? ";border:1px solid var(--border)" : "") }));
      kids.push(labels[i]);
    });
    kids.push(h("span", { class: "sw hatch-seq" }));
    kids.push("no figure for this view");
    return h("div", { class: "scalekey" }, kids);
  }

  function note(drawn, hatched) {
    var unmatched = D.unmatched.length;
    var parts = [
      drawn + " districts coloured, " + hatched + " hatched (no figure for this view). "
      + unmatched + " districts — open-enrollment charters and state-operated schools — have "
      + "no geographic service area and so no boundary to draw; they are in the ranked table "
      + "below with their figures, tagged “no boundary”.",
      "Showing " + M.state.subject + ", " + gradeLabel(M.state.grade) + ".",
    ];
    if (M.state.view.kind === "growth") {
      parts.push("Change views need a published figure over " + M.floor
        + " tested students in both endpoint years, at the selected grade.");
    }
    parts.push("Every percentage is ADE's own published district figure.");
    parts.push(D.source_note);
    return parts.join(" ");
  }

  /* ---------- ranked table ---------- */

  function renderTable() {
    var t = document.getElementById("rank-table");
    t.innerHTML = "";
    var v = M.state.view;
    var nYear = v.kind === "level" ? v.y : v.b;
    var cols = [
      { k: null, label: "#", title: "Rank on the sorted column, highest value first" },
      { k: null, label: "District" },
      { k: "val", label: v.kind === "level" ? v.y + " %" : "Δ " + v.a + "→" + v.b + " (pp)" },
      { k: "2024", label: "2024" }, { k: "2025", label: "2025" }, { k: "2026", label: "2026" },
      { k: "n", label: "n (" + nYear + ")" },
    ];

    var thead = document.createElement("thead");
    var tr = document.createElement("tr");
    cols.forEach(function (c) {
      var sorted = c.k && c.k === M.state.sortKey;
      var th = h("th", {
        class: sorted ? "sorted" : "",
        "data-sort": c.k || null,
        scope: "col",
        title: c.k ? "Sort by this column" : (c.title || null),
        "aria-sort": sorted ? (M.state.sortDir < 0 ? "descending" : "ascending") : (c.k ? "none" : null),
      }, [c.label]);
      if (c.k) {
        th.appendChild(h("span", { class: "glyph" },
          [sorted ? (M.state.sortDir < 0 ? "▾" : "▴") : "⇅"]));
        th.addEventListener("click", function () { M.sortBy(c.k); renderTable(); });
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    t.appendChild(thead);

    var tbody = document.createElement("tbody");
    var rows = M.rows();
    rows.forEach(function (r) {
      var cells = [h("td", { class: "rank" }, [r.rank === null ? "—" : String(r.rank)])];

      var link = h("a", { href: "district/" + r.lea + ".html" }, [r.name]);
      var nameCell = h("td", { class: "name" }, [link]);
      if (!r.mapped) nameCell.appendChild(h("span", { class: "noboundary" }, [" no boundary"]));
      cells.push(nameCell);

      cells.push(r.val === null
        ? h("td", { class: "metric na" }, [r.reason])
        : h("td", { class: "metric" }, [M.formatValue(r.val)]));

      M.years.forEach(function (y) {
        var c = r.rec[y];
        cells.push(c && c[0] !== null && c[0] !== undefined
          ? h("td", {}, [c[0].toFixed(1) + "%"])
          : h("td", { class: "na" }, ["—"]));
      });
      var nc = r.rec[nYear];
      cells.push(nc && nc[1] !== null && nc[1] !== undefined
        ? h("td", {}, [nc[1].toLocaleString()])
        : h("td", { class: "na" }, ["—"]));

      var row = document.createElement("tr");
      cells.forEach(function (c) { row.appendChild(c); });
      tbody.appendChild(row);
    });
    t.appendChild(tbody);

    document.getElementById("rank-caption").textContent =
      rows.filter(function (r) { return r.val !== null; }).length
      + " of " + Object.keys(D.names).length + " districts have a figure for "
      + M.selectionLabel() + ". The rest are listed with the reason and are not ranked.";
  }

  /* ---------- controls ---------- */

  function chipRow(hostId, items, isOn, onPick, isDisabled, disabledTitle) {
    var host = document.getElementById(hostId);
    host.innerHTML = "";
    items.forEach(function (item) {
      var off = isDisabled ? isDisabled(item) : false;
      var b = h("button", {
        type: "button", class: "chip", "aria-pressed": String(isOn(item)),
        disabled: off ? "disabled" : null,
        title: off ? disabledTitle(item) : null,
        onclick: function () { if (!off) { onPick(item); renderAll(); } },
      }, [item.label]);
      host.appendChild(b);
    });
  }

  function renderControls() {
    chipRow("view-chips", VIEWS,
      function (v) { return v.id === M.state.view.id; },
      function (v) { M.setView(v.id); });
    chipRow("subject-chips",
      D.subjects.map(function (s) { return { id: s, label: s }; }),
      function (s) { return s.id === M.state.subject; },
      function (s) { M.setSubject(s.id); });
    chipRow("grade-chips",
      D.grades.map(function (g) { return { id: g, label: g === "ALL" ? "All grades" : "Gr " + parseInt(g, 10) }; }),
      function (g) { return g.id === M.state.grade; },
      function (g) { M.setGrade(g.id); },
      function (g) { return M.gradesFor(M.state.subject).indexOf(g.id) === -1; },
      function () { return M.state.subject + " is not tested at this grade in Arkansas"; });
  }

  function renderAll() {
    renderControls();
    renderMap();
    renderTable();
    document.querySelectorAll("[data-selecho]").forEach(function (el) {
      el.textContent = M.selectionLabel();
    });
  }

  document.getElementById("rank-toggle").addEventListener("click", function (ev) {
    ev.preventDefault();
    var wrap = document.getElementById("rank-wrap");
    var opening = wrap.classList.contains("closed");
    wrap.classList.toggle("closed", !opening);
    ev.target.textContent = opening ? "Hide ranked table ▴" : "View as ranked table ▾";
    ev.target.setAttribute("aria-expanded", String(opening));
  });

  document.getElementById("rank-csv").addEventListener("click", function (ev) {
    ev.preventDefault();
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([M.csv()], { type: "text/csv" }));
    a.download = M.csvName();
    a.click();
    URL.revokeObjectURL(a.href);
  });

  var mq = window.matchMedia("(prefers-color-scheme: dark)");
  (mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(renderAll);
  new MutationObserver(renderAll).observe(document.documentElement, {
    attributes: true, attributeFilter: ["data-theme"],
  });

  renderAll();
})(typeof globalThis !== "undefined" ? globalThis : this);
