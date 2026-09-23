// Career equity line for the human predictor.
// Plots the persisted settled series only. Totals from older picks stay in
// pnl and win rate. This file does not invent points for them.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ldaCareer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CHART_CAP = 100;
  const FULL = { w: 320, h: 168, l: 48, r: 14, t: 16, b: 14 };
  const COMPACT = { w: 320, h: 112, l: 48, r: 14, t: 12, b: 12 };

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function money(n) {
    const v = Math.round(num(n));
    return (v > 0 ? "+" : "") + v;
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function fmtPct(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    const rounded = Math.round(n * 10) / 10;
    return (Math.abs(rounded - Math.round(rounded)) < 0.05 ? String(Math.round(rounded)) : rounded.toFixed(1)) + "%";
  }

  function readPoints(series) {
    if (!Array.isArray(series)) return [];
    const out = [];
    for (const raw of series) {
      if (!raw || typeof raw !== "object") continue;
      out.push({
        matchId: String(raw.matchId || ""),
        pnl: num(raw.pnl),
        cum: num(raw.cum),
        won: !!raw.won,
      });
    }
    return out;
  }

  function accuracyOf(person, picks) {
    if (!picks) return null;
    if (person && person.accuracy != null && person.accuracy !== "") {
      const n = Number(person.accuracy);
      if (Number.isFinite(n)) return n;
    }
    if (person && person.correct != null) return Math.round((1000 * num(person.correct)) / picks) / 10;
    return null;
  }

  function careerModel(person) {
    const points = readPoints(person && person.series);
    const picks = Math.max(0, Math.round(num(person && person.picks)));
    const pnl = num(person && person.pnl);
    const accuracy = accuracyOf(person, picks);
    const origin = points.length > 0 && Math.abs(points[0].cum - points[0].pnl) < 0.0001;
    const values = origin ? [0, ...points.map((p) => p.cum)] : points.map((p) => p.cum);
    let mode = "line";
    if (!points.length) mode = picks > 0 || Math.abs(pnl) > 0.0001 ? "legacy" : "empty";
    let gap = "none";
    if (points.length && picks > points.length) gap = points.length >= CHART_CAP ? "cap" : "partial";
    const wins = points.reduce((n, p) => n + (p.won ? 1 : 0), 0);
    return {
      points,
      values,
      origin,
      mode,
      gap,
      pnl,
      accuracy,
      picks,
      recorded: points.length,
      wins,
      latestCum: points.length ? points[points.length - 1].cum : null,
    };
  }

  function chartBox(compact) {
    return compact ? COMPACT : FULL;
  }

  function careerGeometry(model, opts = {}) {
    const box = chartBox(!!opts.compact);
    const values = model.values || [];
    const innerW = box.w - box.l - box.r;
    const innerH = box.h - box.t - box.b;
    if (!values.length) {
      const y = round1(box.t + innerH / 2);
      return {
        box,
        plotted: [],
        dots: [],
        zeroY: y,
        baseY: y,
        labels: [{ y, text: "0" }],
        empty: true,
      };
    }
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    } else {
      const pad = (hi - lo) * 0.14;
      lo -= pad;
      hi += pad;
    }
    const span = hi - lo || 1;
    const yOf = (v) => box.t + (1 - (v - lo) / span) * innerH;
    const xOf = (i, n) => (n <= 1 ? box.l + innerW : box.l + (i / (n - 1)) * innerW);
    const plotted = values.map((v, i) => ({
      v,
      x: round1(xOf(i, values.length)),
      y: round1(yOf(v)),
      origin: !!(model.origin && i === 0),
    }));
    const offset = model.origin ? 1 : 0;
    const showEvery = model.points.length <= 20;
    const dots = [];
    model.points.forEach((p, i) => {
      const at = plotted[i + offset];
      if (!at) return;
      const last = i === model.points.length - 1;
      if (!showEvery && !last) return;
      dots.push({ x: at.x, y: at.y, won: p.won, last, pnl: p.pnl });
    });
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const zeroY = dataMin <= 0 && dataMax >= 0 ? round1(yOf(0)) : null;
    const labels = axisLabels(dataMin, dataMax, zeroY, yOf, box);
    return {
      box,
      plotted,
      dots,
      zeroY,
      baseY: zeroY == null ? round1(box.t + innerH) : zeroY,
      labels,
      empty: false,
    };
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function axisLabels(dataMin, dataMax, zeroY, yOf, box) {
    const rows = [];
    const push = (value, y) => {
      const yy = Math.min(box.h - 8, Math.max(12, y));
      if (rows.some((r) => Math.abs(r.y - yy) < 14)) return;
      rows.push({ value, y: round1(yy), text: money(value) });
    };
    push(dataMax, yOf(dataMax));
    if (zeroY != null && dataMin < -0.5 && dataMax > 0.5) push(0, zeroY);
    if (Math.abs(dataMin - dataMax) > 0.5) push(dataMin, yOf(dataMin));
    return rows;
  }

  function tone(n) {
    if (n > 0.0001) return "good";
    if (n < -0.0001) return "bad";
    return "";
  }

  function noteFor(model) {
    if (model.mode === "empty") return "No settled picks yet. Your line starts at zero after the first one.";
    if (model.mode === "legacy") {
      const n = model.picks === 1 ? "1 earlier pick is" : `${model.picks} earlier picks are`;
      return `${n} a total only. The line starts when the next one settles.`;
    }
    if (model.gap === "cap") {
      return `Latest ${model.recorded} settled picks. Older ones stay in the total and the win rate.`;
    }
    if (model.gap === "partial") return "This line starts when the chart began. Earlier picks stay in the total.";
    if (model.origin && model.recorded === 1) return "First settled pick, from zero to this result.";
    if (!model.origin && model.recorded === 1) return "One recorded result. The line does not invent the picks before it.";
    return "";
  }

  function linePath(plotted) {
    return plotted.map((p) => `${p.x},${p.y}`).join(" ");
  }

  function areaPath(plotted, baseY) {
    if (plotted.length < 2) return "";
    const first = plotted[0];
    const last = plotted[plotted.length - 1];
    const line = plotted.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
    return `${line} L${last.x} ${baseY} L${first.x} ${baseY} Z`;
  }

  function svgChart(model, geo) {
    const lineTone = tone(model.latestCum == null ? model.pnl : model.latestCum) || "flat";
    const { box } = geo;
    const parts = [`<svg class="career-line ${lineTone}" viewBox="0 0 ${box.w} ${box.h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">`];
    if (geo.zeroY != null) {
      parts.push(`<line class="zero" x1="${box.l}" y1="${geo.zeroY}" x2="${box.w - box.r}" y2="${geo.zeroY}" />`);
    }
    for (const label of geo.labels || []) {
      parts.push(`<text class="axis" x="${box.l - 8}" y="${label.y}" text-anchor="end" dominant-baseline="middle">${esc(label.text)}</text>`);
    }
    if (!geo.empty && geo.plotted.length >= 2) {
      const area = areaPath(geo.plotted, geo.baseY);
      if (area) parts.push(`<path class="area" d="${area}" />`);
      parts.push(`<polyline points="${linePath(geo.plotted)}" />`);
    }
    for (const dot of geo.dots) {
      const cls = dot.won ? "w" : "l";
      const r = dot.last ? 5.5 : 3.5;
      const call = dot.won ? "Win" : "Loss";
      parts.push(`<circle class="dot ${cls}${dot.last ? " last" : ""}" cx="${dot.x}" cy="${dot.y}" r="${r}"><title>${esc(call)}, ${esc(money(dot.pnl))} test</title></circle>`);
    }
    parts.push("</svg>");
    return parts.join("");
  }

  function outcomes(model, limit) {
    if (!model.points.length) return "";
    const shown = model.points.slice(-limit);
    const bits = shown.map((p, i) => {
      const last = i === shown.length - 1;
      const cls = p.won ? "w" : "l";
      const word = p.won ? "Win" : "Loss";
      return `<i class="${cls}${last ? " now" : ""}" role="listitem" aria-label="${word}, ${esc(money(p.pnl))} test">${p.won ? "W" : "L"}</i>`;
    }).join("");
    const extra = model.points.length > shown.length
      ? `<p class="fine">Last ${shown.length} calls. The line is every recorded pick.</p>`
      : "";
    return `<div class="career-picks" role="list" aria-label="Recent calls, oldest to newest">${bits}</div>${extra}`;
  }

  function careerMarkup(person, opts = {}) {
    if (!person) return `<p class="fine">Setting up your test-credit book…</p>`;
    const model = careerModel(person);
    if (opts.quiet && !model.points.length) return "";
    const geo = careerGeometry(model, opts);
    const pnlTone = tone(model.pnl);
    const note = noteFor(model);
    const compact = opts.compact ? " compact" : "";
    const mode = model.mode === "line" ? "" : " " + model.mode;
    const key = `${model.recorded}:${model.latestCum == null ? "" : model.latestCum}:${model.pnl}`;
    const from = model.values.length ? money(model.values[0]) : "0";
    const to = model.latestCum == null ? money(model.pnl) : money(model.latestCum);
    const summary = model.points.length
      ? `Equity line of ${model.recorded} settled picks, from ${from} to ${to} test credits.`
      : "";
    const cash = opts.compact ? "" : "Test credits. No cash value.";
    const fine = [note, cash].filter(Boolean).join(" ");
    return `<div class="career${compact}${mode}" data-career="${esc(key)}" data-points="${model.recorded}" data-origin="${model.origin ? 1 : 0}">
      <div class="career-head">
        <div><b class="${pnlTone}">${esc(money(model.pnl))}</b><span>Test PnL</span></div>
        <div><b>${esc(fmtPct(model.accuracy))}</b><span>Win rate</span></div>
        <div><b>${model.recorded}</b><span>Settled</span></div>
      </div>
      ${svgChart(model, geo)}
      ${summary ? `<p class="sr">${esc(summary)}</p>` : ""}
      ${outcomes(model, opts.compact ? 6 : 8)}
      ${fine ? `<p class="fine">${esc(fine)}</p>` : ""}
    </div>`;
  }

  return { careerModel, careerGeometry, careerMarkup, CHART_CAP };
});
