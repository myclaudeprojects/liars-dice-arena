// pfpv3.js — "Neon Noir" portrait rig.
//
// Consumes the SAME recipe buildRecipe() produces and returns an SVG that keeps
// the contract the rest of the app depends on (1024 square, data-style tag,
// FACE_TOP/FACE_BOTTOM coordinates, the data-layer groups the animation runtime
// moves), but draws a different picture:
//   - cel-shaded angular face planes with one hard neon rim light + bloom
//   - a scene per background selection instead of a gradient blob
//   - attire / accessories / species drawn as real silhouettes
//   - no sticker outline; edges are lit, not traced
// Everything is procedural: no fonts, no images, no network.

const FACE_TOP = 176;
const FACE_BOTTOM = 708;
const CX = 512;

function esc(v) { return String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
function el(tag, attrs, inner) {
  const a = Object.entries(attrs || {}).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
  return inner == null ? `<${tag}${a}/>` : `<${tag}${a}>${inner}</${tag}>`;
}
function layer(name, inner, extra) { return inner ? el("g", Object.assign({ "data-layer": name }, extra || {}), inner) : ""; }
function hex(h) { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "")); if (!m) return [128, 128, 128]; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgb([r, g, b]) { const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"); return `#${c(r)}${c(g)}${c(b)}`; }
function mix(a, b, t) { const A = hex(a), B = hex(b); return rgb([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]); }
function shade(c, amt) { return amt >= 0 ? mix(c, "#ffffff", amt) : mix(c, "#000000", -amt); }
function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const P = (pts) => pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ") + " Z";

// ---------------------------------------------------------------- expression
function faceOf(row) {
  const i = Math.max(0.6, Math.min(2, Number(row.intensity) || 1));
  const t = {
    SMUG:       { lid: 0.32 * i, brow: [14, -6, 0.9], mouth: "smirk", glow: 0.1 },
    STOIC:      { lid: 0.12,     brow: [0, 0, 1.0],   mouth: "flat",  glow: 0 },
    MANIC:      { lid: -0.2 * i, brow: [18, -14, 1.1],mouth: "grin",  glow: 0.35 },
    SERENE:     { lid: 0.18,     brow: [6, 6, 0.8],   mouth: "soft",  glow: 0 },
    PREDATORY:  { lid: 0.36 * i, brow: [-10, -6, 1.2],mouth: "tight", glow: 0.7 },
    MYSTERIOUS: { lid: 0.26,     brow: [2, 10, 0.9],  mouth: "flat",  glow: 0.4 },
    COLD:       { lid: 0.24,     brow: [-6, -6, 1.0], mouth: "flat",  glow: 0.15 },
    PLAYFUL:    { lid: 0.02,     brow: [22, 2, 0.9],  mouth: "smile", glow: 0.05 },
    REGAL:      { lid: 0.1,      brow: [8, 6, 1.0],   mouth: "soft",  glow: 0.1 },
  };
  const f = { ...(t[String(row.attitude).toUpperCase()] || t.STOIC) };
  // intensity (and the "expression" retouch) pushes every feature, not just the ones tied to i above
  f.lid = f.lid * (0.6 + 0.4 * i);
  f.brow = [f.brow[0] * i, f.brow[1] * i, f.brow[2] * (0.85 + 0.15 * i)];
  f.glow = Math.max(0, Math.min(1, f.glow * i + (Number(row.glowShift) || 0)));
  return f;
}

// ---------------------------------------------------------------- geometry
function faceGeom(row) {
  const kind = String(row.faceKind || "");
  const base = { w: 168, jaw: 108, chin: 0.62, cheek: 1.0 };
  const byKind = {
    male_lean: { w: 164, jaw: 118, chin: 0.6 }, male_muscular: { w: 184, jaw: 150, chin: 0.7 },
    female_lean: { w: 156, jaw: 84, chin: 0.52 }, female_athletic: { w: 162, jaw: 96, chin: 0.56 },
    androgynous: { w: 160, jaw: 98, chin: 0.56 }, heavy_set: { w: 196, jaw: 168, chin: 0.78, cheek: 1.12 },
    elder: { w: 164, jaw: 110, chin: 0.62, cheek: 0.92 }, young_adult: { w: 158, jaw: 96, chin: 0.55 },
    non_human: { w: 176, jaw: 120, chin: 0.66 }, full_robot: { w: 180, jaw: 150, chin: 0.72 }, skeletal_synthetic: { w: 150, jaw: 96, chin: 0.62 },
  };
  const g = { ...base, ...(byKind[kind] || {}) };
  g.jaw += Number(row.jawShift) || 0;
  return g;
}

// Angular face plane: forehead → temple → cheekbone → jaw → chin. Returns points for reuse.
function facePts(x, g, turn) {
  const t = turn * 14;
  const top = FACE_TOP, bot = FACE_BOTTOM;
  const L = x - g.w + t * 0.4, R = x + g.w + t * 0.4;
  return [
    [x + t, top], [R - 26, top + 34], [R, top + 150], [R - 4, 440 * g.cheek / g.cheek], [R - 22, 560],
    [x + g.jaw * 0.5 + t, bot - 30], [x + t * 1.2, bot], [x - g.jaw * 0.5 + t, bot - 30],
    [L + 22, 560], [L + 4, 440], [L, top + 150], [L + 26, top + 34],
  ];
}

// ---------------------------------------------------------------- scenes
function scene(row, c, id, r) {
  const bg = String(row.background || "abstract");
  const a = c.trim, deep = c.edge, mid = c.mid;
  const parts = [];
  const rand = rng(hashStr("scene" + (row.identity && row.identity.name) + bg));
  if (bg === "city_night") {
    for (let i = 0; i < 14; i++) { const w = 40 + rand() * 70, h = 220 + rand() * 420, x = i * 76 - 20 + rand() * 20; parts.push(el("rect", { x, y: 1024 - h, width: w, height: h, fill: mix(deep, mid, 0.5 + rand() * 0.3) }));
      for (let k = 0; k < 10; k++) if (rand() > 0.55) parts.push(el("rect", { x: x + 6 + rand() * (w - 14), y: 1024 - h + 12 + rand() * (h - 40), width: 6, height: 9, fill: rand() > 0.6 ? a : "#ffe9b0", opacity: 0.35 + rand() * 0.5 })); }
    parts.push(el("rect", { x: 0, y: 640, width: 1024, height: 384, fill: `url(#${id("fog")})` }));
  } else if (bg === "tech_lab") {
    for (let i = 0; i < 9; i++) parts.push(el("rect", { x: 60 + i * 104, y: 120, width: 2, height: 800, fill: a, opacity: 0.12 + (i % 3) * 0.05 }));
    for (let i = 0; i < 6; i++) parts.push(el("rect", { x: 0, y: 200 + i * 130, width: 1024, height: 1, fill: a, opacity: 0.1 }));
    parts.push(el("path", { d: "M80 300 H300 V420 H460 M700 640 H900 V520 H560 M120 820 H420", fill: "none", stroke: a, "stroke-width": 3, opacity: 0.35 }));
    parts.push(el("circle", { cx: 300, cy: 300, r: 7, fill: a, opacity: 0.8 }), el("circle", { cx: 900, cy: 640, r: 7, fill: a, opacity: 0.8 }));
  } else if (bg === "underground") {
    for (let i = 0; i < 5; i++) parts.push(el("ellipse", { cx: 512, cy: 380, rx: 620 - i * 110, ry: 520 - i * 95, fill: "none", stroke: mix(deep, a, 0.18), "stroke-width": 26 }));
    parts.push(el("rect", { x: 0, y: 760, width: 1024, height: 264, fill: mix(deep, mid, 0.4) }));
    parts.push(el("path", { d: "M0 790 H1024 M0 830 H1024", stroke: a, "stroke-width": 3, opacity: 0.3 }));
  } else if (bg === "club") {
    for (let i = 0; i < 6; i++) { const x0 = 120 + i * 160; parts.push(el("polygon", { points: `${x0},0 ${x0 + 60},0 ${x0 + 260 + i * 10},1024 ${x0 - 40},1024`, fill: i % 2 ? a : mix(a, "#ffffff", 0.35), opacity: 0.07 + (i % 2) * 0.05 })); }
    for (let i = 0; i < 40; i++) parts.push(el("circle", { cx: rand() * 1024, cy: rand() * 700, r: 2 + rand() * 5, fill: rand() > 0.5 ? a : "#ffffff", opacity: 0.25 + rand() * 0.5 }));
  } else if (bg === "casino") {
    for (let i = 0; i < 7; i++) parts.push(el("circle", { cx: 120 + i * 130, cy: 900 + (i % 2) * 30, r: 46, fill: mix(deep, i % 2 ? a : "#e8d9a8", 0.35), stroke: i % 2 ? a : "#e8d9a8", "stroke-width": 6, opacity: 0.55 }));
    parts.push(el("rect", { x: 0, y: 0, width: 1024, height: 1024, fill: `url(#${id("felt")})`, opacity: 0.6 }));
    for (let i = 0; i < 26; i++) parts.push(el("circle", { cx: 40 + i * 38, cy: 60, r: 5, fill: i % 2 ? "#ffd27a" : a, opacity: 0.8 }));
  } else if (bg === "studio") {
    parts.push(el("rect", { x: 640, y: 40, width: 300, height: 300, rx: 10, fill: "#ffffff", opacity: 0.16 }), el("rect", { x: 660, y: 60, width: 260, height: 260, rx: 6, fill: "#ffffff", opacity: 0.1 }));
    parts.push(el("circle", { cx: 160, cy: 200, r: 90, fill: a, opacity: 0.16 }));
    parts.push(el("ellipse", { cx: 512, cy: 980, rx: 520, ry: 120, fill: "#000000", opacity: 0.35 }));
  } else if (bg === "vault") {
    parts.push(el("circle", { cx: 512, cy: 420, r: 430, fill: "none", stroke: mix(deep, "#c9d3d8", 0.25), "stroke-width": 40 }));
    parts.push(el("circle", { cx: 512, cy: 420, r: 350, fill: "none", stroke: mix(deep, a, 0.35), "stroke-width": 10, "stroke-dasharray": "40 22" }));
    for (let i = 0; i < 12; i++) { const ang = (i / 12) * Math.PI * 2; parts.push(el("rect", { x: 512 + Math.cos(ang) * 430 - 14, y: 420 + Math.sin(ang) * 430 - 14, width: 28, height: 28, rx: 5, fill: mix(deep, "#c9d3d8", 0.5), transform: `rotate(${(ang * 180 / Math.PI).toFixed(1)} ${(512 + Math.cos(ang) * 430).toFixed(1)} ${(420 + Math.sin(ang) * 430).toFixed(1)})` })); }
  } else if (bg === "arena") {
    for (let i = 0; i < 160; i++) parts.push(el("circle", { cx: rand() * 1024, cy: 560 + rand() * 260, r: 3 + rand() * 4, fill: rand() > 0.85 ? a : "#ffffff", opacity: 0.08 + rand() * 0.25 }));
    parts.push(el("polygon", { points: "512,-40 180,1024 844,1024", fill: `url(#${id("spot")})` }));
  } else if (bg === "space") {
    for (let i = 0; i < 140; i++) parts.push(el("circle", { cx: rand() * 1024, cy: rand() * 1024, r: rand() * 2.4, fill: "#ffffff", opacity: 0.3 + rand() * 0.7 }));
    parts.push(el("circle", { cx: 820, cy: 220, r: 120, fill: mix(deep, a, 0.35) }), el("circle", { cx: 780, cy: 190, r: 120, fill: deep, opacity: 0.55 }));
    parts.push(el("ellipse", { cx: 820, cy: 236, rx: 200, ry: 26, fill: "none", stroke: a, "stroke-width": 4, opacity: 0.6 }));
  } else if (bg === "custom") {
    parts.push(el("rect", { x: 0, y: 0, width: 1024, height: 1024, fill: `url(#${id("customGrad")})` }));
  } else { // abstract
    for (let i = 0; i < 9; i++) { const x0 = rand() * 1024, y0 = rand() * 1024, s = 120 + rand() * 260, rot = rand() * 360; parts.push(el("polygon", { points: `${x0},${y0} ${x0 + s},${y0 + s * 0.35} ${x0 + s * 0.4},${y0 + s}`, fill: i % 3 ? mix(deep, a, 0.3) : a, opacity: 0.08 + rand() * 0.14, transform: `rotate(${rot.toFixed(0)} ${x0} ${y0})` })); }
  }
  return parts.join("");
}

// ---------------------------------------------------------------- hair
function hairShapes(row, x, g, c) {
  const style = String(row.hair || "none"), turn = row.turn || 0, t = turn * 14;
  const L = x - g.w - 10 + t * 0.4, R = x + g.w + 10 + t * 0.4, top = FACE_TOP;
  const hi = shade(c.hair, 0.28), base = c.hair, dark = shade(c.hair, -0.35);
  if (style === "none") return { back: "", front: "" };
  let back = "", front = "";
  if (style === "swept") {
    front = el("path", { d: `M ${L + 6} ${top + 150} L ${L - 4} ${top + 40} L ${x - 40 + t} ${top - 62} L ${x + 150 + t} ${top - 40} L ${R + 2} ${top + 60} L ${R - 30} ${top + 120} L ${x + 120 + t} ${top + 40} L ${x - 10 + t} ${top + 62} L ${x - 90 + t} ${top + 100} Z`, fill: base })
      + el("path", { d: `M ${x - 20 + t} ${top - 40} L ${x + 120 + t} ${top - 26} L ${x + 60 + t} ${top + 10} Z`, fill: hi, opacity: 0.55 });
  } else if (style === "cropped") {
    front = el("path", { d: `M ${L + 8} ${top + 130} L ${L + 2} ${top + 30} L ${x - 60 + t} ${top - 44} L ${x + 80 + t} ${top - 44} L ${R - 2} ${top + 30} L ${R - 8} ${top + 130} L ${R - 40} ${top + 60} L ${x + t} ${top + 30} L ${L + 40} ${top + 60} Z`, fill: base })
      + el("path", { d: `M ${x - 50 + t} ${top - 30} L ${x + 70 + t} ${top - 30} L ${x + 30 + t} ${top - 8} Z`, fill: hi, opacity: 0.45 });
  } else if (style === "asymmetric") {
    back = el("path", { d: `M ${L - 20} ${top + 120} L ${L - 30} ${top + 420} L ${L + 60} ${top + 470} L ${L + 40} ${top + 140} Z`, fill: dark });
    front = el("path", { d: `M ${L - 10} ${top + 160} L ${L - 14} ${top + 30} L ${x - 30 + t} ${top - 58} L ${x + 140 + t} ${top - 30} L ${R + 6} ${top + 70} L ${R - 20} ${top + 100} L ${x + 100 + t} ${top + 30} L ${x - 40 + t} ${top + 120} L ${x - 90 + t} ${top + 300} L ${L - 10} ${top + 320} Z`, fill: base })
      + el("path", { d: `M ${x - 20 + t} ${top - 40} L ${x + 110 + t} ${top - 18} L ${x - 40 + t} ${top + 70} Z`, fill: hi, opacity: 0.5 });
  } else if (style === "long") {
    back = el("path", { d: `M ${L - 40} ${top + 100} L ${L - 70} ${top + 600} L ${L + 40} ${top + 640} L ${R - 40} ${top + 640} L ${R + 70} ${top + 600} L ${R + 40} ${top + 100} Z`, fill: dark })
      + el("path", { d: `M ${L - 30} ${top + 140} L ${L - 40} ${top + 560} L ${L + 20} ${top + 560} Z`, fill: base, opacity: 0.8 });
    front = el("path", { d: `M ${L - 20} ${top + 220} L ${L - 16} ${top + 40} L ${x - 40 + t} ${top - 60} L ${x + 140 + t} ${top - 40} L ${R + 16} ${top + 60} L ${R + 6} ${top + 220} L ${R - 40} ${top + 90} L ${x + 30 + t} ${top + 34} L ${x - 50 + t} ${top + 110} Z`, fill: base })
      + el("path", { d: `M ${x - 20 + t} ${top - 44} L ${x + 120 + t} ${top - 26} L ${x + 30 + t} ${top + 4} Z`, fill: hi, opacity: 0.5 });
  } else if (style === "wild") {
    const spikes = []; for (let i = 0; i < 9; i++) { const px = L + 10 + i * ((R - L - 20) / 8); const ph = top - 40 - ((i * 37) % 60); spikes.push(`${px},${top + 70} ${px + 24},${ph} ${px + 48},${top + 60}`); }
    front = el("polygon", { points: spikes.join(" "), fill: base }) + el("path", { d: `M ${L + 4} ${top + 140} L ${L} ${top + 60} L ${R} ${top + 60} L ${R - 4} ${top + 140} L ${x + t} ${top + 40} Z`, fill: base })
      + el("path", { d: `M ${x - 60 + t} ${top - 10} L ${x + 60 + t} ${top - 40} L ${x + 20 + t} ${top + 30} Z`, fill: hi, opacity: 0.5 });
  }
  return { back, front };
}

// ---------------------------------------------------------------- headwear / accessories
function headwear(row, x, g, c) {
  const kind = String(row.headwear || ""), t = (row.turn || 0) * 14, top = FACE_TOP;
  const L = x - g.w + t * 0.4, R = x + g.w + t * 0.4;
  if (kind === "crown") return el("path", { d: `M ${L + 10} ${top + 24} L ${L + 6} ${top - 80} L ${x - 90 + t} ${top - 20} L ${x - 40 + t} ${top - 110} L ${x + t} ${top - 24} L ${x + 40 + t} ${top - 110} L ${x + 90 + t} ${top - 20} L ${R - 6} ${top - 80} L ${R - 10} ${top + 24} Z`, fill: "#e8c458" }) + el("path", { d: `M ${L + 10} ${top + 24} L ${R - 10} ${top + 24} L ${R - 14} ${top + 44} L ${L + 14} ${top + 44} Z`, fill: "#b8932f" });
  if (kind === "laurel") return el("path", { d: `M ${L - 6} ${top + 90} Q ${x + t} ${top - 70} ${R + 6} ${top + 90}`, fill: "none", stroke: "#8fd18f", "stroke-width": 14, "stroke-linecap": "round" });
  if (kind === "cap") return el("path", { d: `M ${L - 8} ${top + 40} L ${L + 10} ${top - 40} Q ${x + t} ${top - 110} ${R - 10} ${top - 40} L ${R + 8} ${top + 40} Z`, fill: c.clothDeep }) + el("path", { d: `M ${L - 70} ${top + 60} L ${R + 30} ${top + 40} L ${R + 30} ${top + 66} L ${L - 66} ${top + 84} Z`, fill: shade(c.clothDeep, -0.25) }) + el("rect", { x: x - 30 + t, y: top - 10, width: 60, height: 12, rx: 4, fill: c.trim, opacity: 0.85 });
  if (kind === "hood" || kind === "cowl") return el("path", { d: `M ${L - 70} ${top + 560} L ${L - 40} ${top + 60} Q ${x + t} ${top - 150} ${R + 40} ${top + 60} L ${R + 70} ${top + 560} L ${R - 20} ${top + 420} L ${R - 44} ${top + 70} Q ${x + t} ${top - 60} ${L + 44} ${top + 70} L ${L + 20} ${top + 420} Z`, fill: c.clothDeep }) + el("path", { d: `M ${L - 40} ${top + 60} Q ${x + t} ${top - 150} ${R + 40} ${top + 60} L ${R + 24} ${top + 80} Q ${x + t} ${top - 120} ${L - 24} ${top + 80} Z`, fill: c.trim, opacity: 0.35 });
  if (kind === "helm") return el("path", { d: `M ${L - 6} ${top + 60} Q ${x + t} ${top - 120} ${R + 6} ${top + 60} L ${R + 6} ${top + 150} L ${L - 6} ${top + 150} Z`, fill: "#5d6b78" }) + el("path", { d: `M ${x - 8 + t} ${top - 90} L ${x + 8 + t} ${top - 90} L ${x + 6 + t} ${top + 150} L ${x - 6 + t} ${top + 150} Z`, fill: c.trim });
  if (kind === "halo") return el("ellipse", { cx: x + t, cy: top - 40, rx: 150, ry: 22, fill: "none", stroke: c.trim, "stroke-width": 8, opacity: 0.85 });
  if (kind === "ears") return el("path", { d: `M ${L + 10} ${top + 60} L ${L - 30} ${top - 110} L ${L + 90} ${top + 10} Z M ${R - 10} ${top + 60} L ${R + 30} ${top - 110} L ${R - 90} ${top + 10} Z`, fill: c.hair });
  return "";
}

function accessory(row, x, g, c, id) {
  const kind = String(row.accessory || "none"), t = (row.turn || 0) * 14, eyeY = 430, gap = 74;
  const L = x - g.w + t * 0.4, R = x + g.w + t * 0.4;
  if (kind === "glasses") return el("g", { fill: "none", stroke: "#0b0b0e", "stroke-width": 7 },
    el("rect", { x: x - gap - 56 + t, y: eyeY - 36, width: 108, height: 70, rx: 12 }) + el("rect", { x: x + gap - 52 + t, y: eyeY - 36, width: 108, height: 70, rx: 12 }) + el("path", { d: `M ${x - gap + 52 + t} ${eyeY - 4} L ${x + gap - 52 + t} ${eyeY - 4}` }) + el("path", { d: `M ${x - gap - 56 + t} ${eyeY - 10} L ${L - 12} ${eyeY - 24} M ${x + gap + 56 + t} ${eyeY - 10} L ${R + 12} ${eyeY - 24}` }))
    + el("rect", { x: x - gap - 50 + t, y: eyeY - 30, width: 96, height: 58, rx: 10, fill: c.trim, opacity: 0.12 }) + el("rect", { x: x + gap - 46 + t, y: eyeY - 30, width: 96, height: 58, rx: 10, fill: c.trim, opacity: 0.12 });
  if (kind === "mask") return el("path", { d: `M ${L + 10} ${520} L ${R - 10} ${520} L ${R - 40} ${FACE_BOTTOM - 20} L ${x + t} ${FACE_BOTTOM + 6} L ${L + 40} ${FACE_BOTTOM - 20} Z`, fill: c.clothDeep }) + el("path", { d: `M ${L + 40} ${580} L ${R - 40} ${580} M ${L + 60} ${630} L ${R - 60} ${630}`, stroke: c.trim, "stroke-width": 4, opacity: 0.7 });
  if (kind === "headphones") return el("path", { d: `M ${L - 20} ${360} Q ${x + t} ${FACE_TOP - 100} ${R + 20} ${360}`, fill: "none", stroke: "#1a1c22", "stroke-width": 22 }) + el("rect", { x: L - 60, y: 330, width: 60, height: 120, rx: 18, fill: "#1a1c22" }) + el("rect", { x: R, y: 330, width: 60, height: 120, rx: 18, fill: "#1a1c22" }) + el("rect", { x: L - 50, y: 350, width: 12, height: 80, rx: 6, fill: c.trim }) + el("rect", { x: R + 38, y: 350, width: 12, height: 80, rx: 6, fill: c.trim });
  if (kind === "smoke") { const s = []; for (let i = 0; i < 5; i++) s.push(el("path", { d: `M ${x + 90 + t} ${640 - i * 4} q 40 -40 ${20 + i * 30} -${80 + i * 40} q 30 -40 ${10 + i * 20} -${110 + i * 30}`, fill: "none", stroke: "#dfe6ee", "stroke-width": 8 - i, "stroke-linecap": "round", opacity: 0.32 - i * 0.05 })); return el("rect", { x: x + 60 + t, y: 630, width: 56, height: 10, rx: 4, fill: "#f2efe8" }) + el("rect", { x: x + 112 + t, y: 630, width: 10, height: 10, rx: 3, fill: c.trim }) + s.join(""); }
  if (kind === "jewelry") return el("circle", { cx: L - 6, cy: 470, r: 12, fill: "#ffd76a" }) + el("circle", { cx: R + 6, cy: 470, r: 12, fill: "#ffd76a" }) + el("path", { d: `M ${x - 120 + t} 740 Q ${x + t} 820 ${x + 120 + t} 740`, fill: "none", stroke: "#ffd76a", "stroke-width": 8 }) + el("path", { d: `M ${x - 12 + t} 780 L ${x + 12 + t} 780 L ${x + t} 812 Z`, fill: "#ffd76a" });
  if (kind === "scar_tattoo") return el("path", { d: `M ${x + 40 + t} 340 L ${x + 90 + t} 470 M ${x + 44 + t} 360 L ${x + 72 + t} 352 M ${x + 62 + t} 410 L ${x + 90 + t} 402`, fill: "none", stroke: shade(c.skinDeep, -0.2), "stroke-width": 6, "stroke-linecap": "round" }) + el("path", { d: `M ${x - 130 + t} 560 l -30 40 l 30 40 l 30 -40 z M ${x - 150 + t} 640 l 20 30`, fill: "none", stroke: c.trim, "stroke-width": 5, opacity: 0.85 });
  if (kind === "pet") return el("g", null, el("ellipse", { cx: R + 150, cy: 840, rx: 70, ry: 52, fill: shade(c.cloth, -0.1) }) + el("circle", { cx: R + 200, cy: 790, r: 40, fill: shade(c.cloth, -0.1) }) + el("path", { d: `M ${R + 175} 760 l -18 -40 l 34 20 z M ${R + 225} 760 l 18 -40 l -34 20 z`, fill: shade(c.cloth, -0.1) }) + el("circle", { cx: R + 186, cy: 786, r: 6, fill: c.trim }) + el("circle", { cx: R + 214, cy: 786, r: 6, fill: c.trim }));
  if (kind === "prop") return el("rect", { x: R + 110, y: 560, width: 26, height: 300, rx: 12, fill: "#2a2d34", transform: `rotate(-12 ${R + 123} 710)` }) + el("circle", { cx: R + 100, cy: 548, r: 40, fill: "#2a2d34" }) + el("circle", { cx: R + 100, cy: 548, r: 26, fill: "#4b4f58" }) + el("circle", { cx: R + 100, cy: 548, r: 10, fill: c.trim });
  if (kind === "unique_fx") { const s = []; const rand = rng(hashStr("fx" + x)); for (let i = 0; i < 10; i++) { const px = x + (rand() - 0.5) * 760 + t, py = 200 + rand() * 600, sz = 12 + rand() * 34; s.push(el("polygon", { points: `${px},${py - sz} ${px + sz * 0.7},${py} ${px},${py + sz} ${px - sz * 0.7},${py}`, fill: c.trim, opacity: 0.5 + rand() * 0.5, filter: `url(#${id("bloom")})` })); } return s.join(""); }
  return "";
}

// ---------------------------------------------------------------- attire
function attire(row, x, c, wide) {
  const kind = String(row.attire || "casual"), t = (row.turn || 0) * 10;
  const sw = wide ? 1.12 : 1; // shoulder width factor
  const L = x - 360 * sw + t, R = x + 360 * sw + t;
  const base = c.cloth, deep = c.clothDeep, lit = shade(c.cloth, 0.18);
  const shoulders = el("path", { d: `M ${L} 1024 L ${L + 20} 820 Q ${L + 60} 740 ${x - 170 + t} 700 L ${x - 60 + t} 690 L ${x + 60 + t} 690 L ${x + 170 + t} 700 Q ${R - 60} 740 ${R - 20} 820 L ${R} 1024 Z`, fill: base });
  const shadow = el("path", { d: `M ${x + 60 + t} 690 L ${x + 170 + t} 700 Q ${R - 60} 740 ${R - 20} 820 L ${R} 1024 L ${x + 120 + t} 1024 Z`, fill: deep, opacity: 0.6 });
  const light = el("path", { d: `M ${L + 20} 820 Q ${L + 60} 740 ${x - 170 + t} 700 L ${x - 60 + t} 690 L ${x - 120 + t} 1024 L ${L} 1024 Z`, fill: lit, opacity: 0.35 });
  let detail = "";
  if (kind === "formal" || kind === "business" || kind === "luxury") {
    detail = el("path", { d: `M ${x - 60 + t} 690 L ${x - 210 + t} 1024 L ${x - 40 + t} 1024 L ${x + t} 800 Z`, fill: "#0d0e12" }) + el("path", { d: `M ${x + 60 + t} 690 L ${x + 210 + t} 1024 L ${x + 40 + t} 1024 L ${x + t} 800 Z`, fill: "#141519" })
      + el("path", { d: `M ${x - 60 + t} 690 L ${x + t} 780 L ${x + 60 + t} 690 L ${x + 100 + t} 780 L ${x + t} 1024 L ${x - 100 + t} 780 Z`, fill: kind === "luxury" ? "#f4ead6" : "#eef1f5" })
      + (kind === "luxury" ? el("path", { d: `M ${x - 30 + t} 760 L ${x + 30 + t} 760 L ${x + t} 1024 Z`, fill: "#e8c458" }) + el("path", { d: `M ${L + 40} 860 Q ${L + 20} 700 ${x - 200 + t} 690`, stroke: "#e8c458", "stroke-width": 8, fill: "none" }) : el("path", { d: `M ${x - 22 + t} 776 L ${x + 22 + t} 776 L ${x + 14 + t} 1024 L ${x - 14 + t} 1024 Z`, fill: kind === "business" ? deep : c.trim }));
  } else if (kind === "streetwear") {
    detail = el("path", { d: `M ${x - 190 + t} 700 Q ${x + t} 640 ${x + 190 + t} 700 L ${x + 150 + t} 760 Q ${x + t} 720 ${x - 150 + t} 760 Z`, fill: deep }) + el("path", { d: `M ${x - 40 + t} 740 L ${x - 60 + t} 980 M ${x + 40 + t} 740 L ${x + 60 + t} 980`, stroke: "#eef1f5", "stroke-width": 9, fill: "none", "stroke-linecap": "round" }) + el("rect", { x: x - 120 + t, y: 880, width: 240, height: 44, rx: 8, fill: c.trim, opacity: 0.9 });
  } else if (kind === "sports") {
    detail = el("path", { d: `M ${L + 40} 900 L ${R - 40} 900 L ${R - 44} 960 L ${L + 44} 960 Z`, fill: "#ffffff", opacity: 0.85 }) + el("path", { d: `M ${x - 80 + t} 700 L ${x + 80 + t} 700 L ${x + 50 + t} 760 L ${x - 50 + t} 760 Z`, fill: deep }) + el("rect", { x: x - 24 + t, y: 800, width: 48, height: 60, rx: 6, fill: c.trim });
  } else if (kind === "tactical") {
    detail = el("path", { d: `M ${x - 140 + t} 700 L ${x - 90 + t} 1024 M ${x + 140 + t} 700 L ${x + 90 + t} 1024`, stroke: "#101216", "stroke-width": 34, fill: "none" }) + el("rect", { x: x - 120 + t, y: 820, width: 60, height: 70, rx: 6, fill: "#2b2f37" }) + el("rect", { x: x + 60 + t, y: 820, width: 60, height: 70, rx: 6, fill: "#2b2f37" }) + el("rect", { x: x - 20 + t, y: 740, width: 40, height: 22, rx: 4, fill: c.trim });
  } else if (kind === "hood_mask") {
    detail = el("path", { d: `M ${x - 220 + t} 700 Q ${x + t} 600 ${x + 220 + t} 700 L ${x + 260 + t} 820 L ${x - 260 + t} 820 Z`, fill: deep });
  } else if (kind === "performance_costume") {
    detail = el("path", { d: `M ${L + 40} 840 L ${x - 160 + t} 700 L ${x + t} 760 L ${x + 160 + t} 700 L ${R - 40} 840 Z`, fill: c.trim, opacity: 0.85 }) + el("path", { d: `M ${x - 200 + t} 720 L ${x - 120 + t} 1024 M ${x + 200 + t} 720 L ${x + 120 + t} 1024`, stroke: "#ffd76a", "stroke-width": 6, fill: "none" });
  } else if (kind === "cyber_gear") {
    detail = el("path", { d: `M ${x - 240 + t} 720 L ${x - 60 + t} 700 L ${x - 90 + t} 900 L ${x - 260 + t} 880 Z`, fill: "#2b3340" }) + el("path", { d: `M ${x + 240 + t} 720 L ${x + 60 + t} 700 L ${x + 90 + t} 900 L ${x + 260 + t} 880 Z`, fill: "#2b3340" }) + el("path", { d: `M ${x - 220 + t} 760 L ${x - 120 + t} 750 M ${x + 220 + t} 760 L ${x + 120 + t} 750 M ${x - 50 + t} 780 L ${x + 50 + t} 780`, stroke: c.trim, "stroke-width": 6, fill: "none" }) + el("circle", { cx: x + t, cy: 840, r: 14, fill: c.trim });
  } else if (kind === "minimal") {
    detail = "";
  } else { // casual
    detail = el("path", { d: `M ${x - 90 + t} 690 Q ${x + t} 760 ${x + 90 + t} 690 L ${x + 110 + t} 720 Q ${x + t} 800 ${x - 110 + t} 720 Z`, fill: deep });
  }
  return shoulders + shadow + light + detail;
}

// ---------------------------------------------------------------- head
function head(row, x, g, c, f, id) {
  const turn = row.turn || 0, t = turn * 14, species = String(row.species || "human");
  const pts = facePts(x, g, turn);
  const outline = P(pts);
  const litSide = turn >= 0 ? -1 : 1; // rim light comes from the accent side
  const neck = el("path", { d: `M ${x - 70 + t} ${FACE_BOTTOM - 80} L ${x + 70 + t} ${FACE_BOTTOM - 80} L ${x + 90 + t} 760 L ${x - 90 + t} 760 Z`, fill: c.skinShadow });
  const ears = species === "robot" || species === "skeletal" ? "" : el("ellipse", { cx: x - g.w - 6 + t * 0.4, cy: 470, rx: 22, ry: 40, fill: c.skinShadow }) + el("ellipse", { cx: x + g.w + 6 + t * 0.4, cy: 470, rx: 22, ry: 40, fill: c.skin });

  let plate = "";
  if (species === "robot" || species === "skeletal") {
    const metal = species === "robot" ? "#c9d3da" : "#e9e6df", metalD = species === "robot" ? "#6b7683" : "#9a958b";
    plate = el("path", { d: outline, fill: `url(#${id("metal")})` })
      + el("path", { d: `M ${x + t} ${FACE_TOP + 20} L ${x + t} ${FACE_BOTTOM - 20}`, stroke: metalD, "stroke-width": 3, opacity: 0.6 })
      + el("path", { d: `M ${x - g.w + 30 + t} 340 L ${x + g.w - 30 + t} 340 M ${x - g.w + 40 + t} 560 L ${x + g.w - 40 + t} 560`, stroke: metalD, "stroke-width": 3, opacity: 0.5 })
      + el("rect", { x: x - g.w + 40 + t, y: 400, width: g.w * 2 - 80, height: 60, rx: 8, fill: "#0a0d12" })
      + el("rect", { x: x - g.w + 54 + t, y: 418, width: g.w * 2 - 108, height: 24, rx: 4, fill: c.trim, filter: `url(#${id("bloom")})`, "data-layer": "eyesOpen" })
      + el("rect", { x: x - g.w + 54 + t, y: 418, width: g.w * 2 - 108, height: 24, rx: 4, fill: "#0a0d12", opacity: "0", "data-layer": "eyesClosed" })
      + el("g", { "data-layer": "pupils" }, el("rect", { x: x - 30 + t, y: 424, width: 60, height: 12, rx: 3, fill: "#ffffff", opacity: 0.85 }))
      + el("path", { d: `M ${x - 60 + t} 620 L ${x + 60 + t} 620`, stroke: c.trim, "stroke-width": 6, "stroke-linecap": "round", opacity: 0.8 })
      + (species === "skeletal" ? el("path", { d: `M ${x - 40 + t} 660 L ${x + 40 + t} 660 M ${x - 30 + t} 640 L ${x - 30 + t} 690 M ${x - 10 + t} 640 L ${x - 10 + t} 690 M ${x + 10 + t} 640 L ${x + 10 + t} 690 M ${x + 30 + t} 640 L ${x + 30 + t} 690`, stroke: metalD, "stroke-width": 4 }) : "");
    return { outline, inner: neck + plate + el("path", { d: outline, fill: "none", stroke: shade(metal, 0.3), "stroke-width": 2, opacity: 0.5 }) };
  }

  // human / animal
  const skin = species === "animal" ? shade(c.hair, 0.15) : c.skin;
  const skinS = species === "animal" ? shade(c.hair, -0.2) : c.skinShadow;
  const skinD = species === "animal" ? shade(c.hair, -0.45) : c.skinDeep;
  const base = el("path", { d: outline, fill: shade(skin, 0.06) });
  // cel shadow plane (side away from the light) + cheek/jaw planes
  const shadowPts = litSide < 0
    ? [pts[1], pts[2], pts[3], pts[4], pts[5], pts[6], [x + t, 520], [x + 40 + t, 360], [x + 60 + t, FACE_TOP + 40]]
    : [pts[11], pts[10], pts[9], pts[8], pts[7], pts[6], [x + t, 520], [x - 40 + t, 360], [x - 60 + t, FACE_TOP + 40]];
  const shadowPlane = el("path", { d: P(shadowPts), fill: skinS, opacity: 0.85 });
  const jawPlane = el("path", { d: P([pts[4], pts[5], pts[6], pts[7], pts[8], [x - g.jaw * 0.4 + t, 600], [x + g.jaw * 0.4 + t, 600]]), fill: skinD, opacity: 0.35 });
  const cheekHi = el("path", { d: P(litSide < 0 ? [pts[10], pts[9], [x - 60 + t, 500], [x - 40 + t, 380]] : [pts[2], pts[3], [x + 60 + t, 500], [x + 40 + t, 380]]), fill: shade(skin, 0.28), opacity: 0.6 });
  const age = String(row.age) === "elder" ? el("path", { d: `M ${x - 120 + t} 600 q 20 30 60 26 M ${x + 120 + t} 600 q -20 30 -60 26 M ${x - 60 + t} ${FACE_TOP + 90} L ${x + 60 + t} ${FACE_TOP + 90} M ${x - 50 + t} ${FACE_TOP + 116} L ${x + 50 + t} ${FACE_TOP + 116}`, stroke: skinD, "stroke-width": 4, fill: "none", opacity: 0.55, "stroke-linecap": "round" }) : "";

  // features
  const eyeY = 430, gap = 74, ew = 46, eh = 22 * (1 - Math.min(0.5, Math.max(-0.2, f.lid))) + 4;
  const eye = (cx) => el("ellipse", { cx, cy: eyeY, rx: ew, ry: eh, fill: c.sclera });
  const irisR = 15, iris = (cx) => el("circle", { cx, cy: eyeY + 1, r: irisR, fill: `url(#${id("iris")})` }) + el("circle", { cx: cx - 5, cy: eyeY - 5, r: 4, fill: "#ffffff", opacity: 0.9 });
  const lid = (cx) => el("path", { d: `M ${cx - ew} ${eyeY} Q ${cx} ${eyeY - eh - 6} ${cx + ew} ${eyeY}`, fill: "none", stroke: skinD, "stroke-width": 5 });
  const closed = (cx) => el("path", { d: `M ${cx - ew} ${eyeY + 2} Q ${cx} ${eyeY + 12} ${cx + ew} ${eyeY + 2}`, fill: "none", stroke: skinD, "stroke-width": 6, "stroke-linecap": "round" });
  const eyeGlow = f.glow > 0.05 ? el("g", { filter: `url(#${id("bloom")})`, opacity: f.glow * 0.9 }, el("ellipse", { cx: x - gap + t, cy: eyeY, rx: ew + 6, ry: eh + 4, fill: c.trim }) + el("ellipse", { cx: x + gap + t, cy: eyeY, rx: ew + 6, ry: eh + 4, fill: c.trim })) : "";
  const eyesOpen = el("g", { "data-layer": "eyesOpen" }, eyeGlow + eye(x - gap + t) + eye(x + gap + t) + lid(x - gap + t) + lid(x + gap + t));
  const pupils = el("g", { "data-layer": "pupils" }, iris(x - gap + t) + iris(x + gap + t));
  const eyesClosed = el("g", { "data-layer": "eyesClosed", opacity: "0" }, el("ellipse", { cx: x - gap + t, cy: eyeY, rx: ew + 2, ry: eh + 2, fill: skin }) + el("ellipse", { cx: x + gap + t, cy: eyeY, rx: ew + 2, ry: eh + 2, fill: skin }) + closed(x - gap + t) + closed(x + gap + t));
  const [bIn, bOut, bW] = f.brow; // inner/outer lift, weight
  const brow = (cx, dir) => el("path", { d: `M ${cx - dir * (ew + 10)} ${eyeY - 56 - bOut} L ${cx} ${eyeY - 66 - (bIn + bOut) / 2} L ${cx + dir * (ew + 12)} ${eyeY - 60 - bIn}`, fill: "none", stroke: c.hair === "#20162b" ? "#1a1420" : shade(c.hair, -0.2), "stroke-width": 10 * bW, "stroke-linecap": "round", "stroke-linejoin": "round" });
  const brows = brow(x - gap + t, -1) + brow(x + gap + t, 1);
  const nose = el("path", { d: `M ${x + 6 + t} 470 L ${x + 26 + t} 560 L ${x - 6 + t} 570`, fill: "none", stroke: skinD, "stroke-width": 5, "stroke-linecap": "round", opacity: 0.6 }) + el("path", { d: `M ${x + 8 + t} 500 L ${x + 24 + t} 556 L ${x + 2 + t} 560 Z`, fill: skinS, opacity: 0.7 });
  const my = 628;
  const mouths = {
    smile: el("path", { d: `M ${x - 54 + t} ${my - 6} Q ${x + t} ${my + 34} ${x + 54 + t} ${my - 6}`, fill: "none", stroke: c.lip, "stroke-width": 7, "stroke-linecap": "round" }),
    grin: el("path", { d: `M ${x - 62 + t} ${my - 10} Q ${x + t} ${my + 46} ${x + 62 + t} ${my - 10} Z`, fill: "#1a0e12" }) + el("path", { d: `M ${x - 48 + t} ${my - 2} Q ${x + t} ${my + 14} ${x + 48 + t} ${my - 2} L ${x + 44 + t} ${my + 6} Q ${x + t} ${my + 22} ${x - 44 + t} ${my + 6} Z`, fill: "#f3efe6" }),
    smirk: el("path", { d: `M ${x - 44 + t} ${my + 4} Q ${x + 6 + t} ${my + 18} ${x + 56 + t} ${my - 14}`, fill: "none", stroke: c.lip, "stroke-width": 7, "stroke-linecap": "round" }),
    flat: el("path", { d: `M ${x - 44 + t} ${my} L ${x + 44 + t} ${my}`, fill: "none", stroke: c.lip, "stroke-width": 7, "stroke-linecap": "round" }),
    tight: el("path", { d: `M ${x - 48 + t} ${my + 4} L ${x + 48 + t} ${my - 2}`, fill: "none", stroke: c.lip, "stroke-width": 8, "stroke-linecap": "round" }),
    soft: el("path", { d: `M ${x - 46 + t} ${my - 2} Q ${x + t} ${my + 18} ${x + 46 + t} ${my - 2}`, fill: "none", stroke: c.lip, "stroke-width": 6, "stroke-linecap": "round" }),
  };
  const mouth = mouths[f.mouth] || mouths.flat;
  const muzzle = species === "animal" ? el("path", { d: `M ${x - 70 + t} 540 Q ${x + t} 500 ${x + 70 + t} 540 L ${x + 50 + t} 640 Q ${x + t} 670 ${x - 50 + t} 640 Z`, fill: shade(skin, 0.25) }) + el("path", { d: `M ${x - 22 + t} 566 L ${x + 22 + t} 566 L ${x + t} 592 Z`, fill: "#1a0e12" }) : "";
  const beard = row.premium && String(row.faceKind).startsWith("male") ? el("path", { d: `M ${x - 130 + t} 560 Q ${x + t} 760 ${x + 130 + t} 560 L ${x + 100 + t} 700 Q ${x + t} 740 ${x - 100 + t} 700 Z`, fill: shade(c.hair, -0.1), opacity: 0.85 }) : "";
  const keyWash = el("path", { d: outline, fill: `url(#${id(litSide < 0 ? "keyL" : "keyR")})`, opacity: 0.55 });
  const inner = neck + ears + base + shadowPlane + jawPlane + cheekHi + keyWash + age + muzzle + beard + brows + eyesOpen + pupils + eyesClosed + nose + mouth;
  return { outline, inner };
}

// ---------------------------------------------------------------- render
function renderPfpV3(row, opts) {
  const size = (opts && opts.size) || 1024;
  const nonce = String((opts && opts.nonce) || "pfp").replace(/[^a-zA-Z0-9_-]/g, "") || "pfp";
  const id = (n) => `${nonce}_${n}`;
  const c = row.colors;
  const turn = Number(row.turn) || 0, t = turn * 14;
  const x = CX;
  const g = faceGeom(row);
  const f = faceOf(row);
  const wide = /HEAVY|MECHANICAL|BULK/.test(String(row.silhouette || "")) || String(row.faceKind) === "male_muscular" || String(row.faceKind) === "heavy_set";
  const litSide = turn >= 0 ? -1 : 1;
  const rimX = x + litSide * (g.w + 20) + t;

  const defs = el("defs", null, [
    el("linearGradient", { id: id("sky"), x1: 0, y1: 0, x2: 0, y2: 1 }, el("stop", { offset: "0%", "stop-color": mix(c.edge, c.trim, 0.22) }) + el("stop", { offset: "60%", "stop-color": c.edge }) + el("stop", { offset: "100%", "stop-color": shade(c.edge, -0.5) })),
    el("linearGradient", { id: id("fog"), x1: 0, y1: 0, x2: 0, y2: 1 }, el("stop", { offset: "0%", "stop-color": c.trim, "stop-opacity": 0 }) + el("stop", { offset: "100%", "stop-color": c.trim, "stop-opacity": 0.28 })),
    el("linearGradient", { id: id("spot"), x1: 0, y1: 0, x2: 0, y2: 1 }, el("stop", { offset: "0%", "stop-color": "#ffffff", "stop-opacity": 0.28 }) + el("stop", { offset: "100%", "stop-color": "#ffffff", "stop-opacity": 0 })),
    el("radialGradient", { id: id("felt"), cx: "50%", cy: "45%", r: "70%" }, el("stop", { offset: "0%", "stop-color": mix(c.mid, c.trim, 0.25) }) + el("stop", { offset: "100%", "stop-color": c.edge })),
    el("linearGradient", { id: id("customGrad"), x1: 0, y1: 0, x2: 1, y2: 1 }, el("stop", { offset: "0%", "stop-color": mix(c.edge, c.trim, 0.5) }) + el("stop", { offset: "100%", "stop-color": c.edge })),
    el("radialGradient", { id: id("iris"), cx: "50%", cy: "50%", r: "50%" }, el("stop", { offset: "0%", "stop-color": mix(c.iris, c.trim, 0.55) }) + el("stop", { offset: "70%", "stop-color": c.iris }) + el("stop", { offset: "100%", "stop-color": "#05060a" })),
    el("linearGradient", { id: id("metal"), x1: 0, y1: 0, x2: 1, y2: 1 }, el("stop", { offset: "0%", "stop-color": "#e6ecf1" }) + el("stop", { offset: "55%", "stop-color": "#9aa7b3" }) + el("stop", { offset: "100%", "stop-color": "#4f5a66" })),
    el("radialGradient", { id: id("vig"), cx: "50%", cy: "48%", r: "64%" }, el("stop", { offset: "55%", "stop-color": "#000000", "stop-opacity": 0 }) + el("stop", { offset: "100%", "stop-color": "#000000", "stop-opacity": row.darker ? 0.55 : 0.38 })),
    el("filter", { id: id("bloom"), x: "-40%", y: "-40%", width: "180%", height: "180%" }, el("feGaussianBlur", { stdDeviation: 14, result: "b" }) + el("feMerge", null, el("feMergeNode", { in: "b" }) + el("feMergeNode", { in: "SourceGraphic" }))),
    el("filter", { id: id("soft"), x: "-30%", y: "-30%", width: "160%", height: "160%" }, el("feGaussianBlur", { stdDeviation: 26 })),
    el("filter", { id: id("grain") }, el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.9", numOctaves: 2, seed: hashStr(nonce) % 100 }) + el("feColorMatrix", { type: "saturate", values: 0 }) + el("feComponentTransfer", null, el("feFuncA", { type: "table", tableValues: "0 0.07" }))),
    el("clipPath", { id: id("headClip") }, el("path", { d: P(facePts(x, g, turn)) })),
    el("linearGradient", { id: id("keyL"), x1: 0, y1: 0, x2: 1, y2: 0 }, el("stop", { offset: "0%", "stop-color": c.trim, "stop-opacity": 0.75 }) + el("stop", { offset: "38%", "stop-color": c.trim, "stop-opacity": 0 })),
    el("linearGradient", { id: id("keyR"), x1: 1, y1: 0, x2: 0, y2: 0 }, el("stop", { offset: "0%", "stop-color": c.trim, "stop-opacity": 0.75 }) + el("stop", { offset: "38%", "stop-color": c.trim, "stop-opacity": 0 })),
  ].join(""));

  const hair = hairShapes(row, x, g, c);
  const hd = head(row, x, g, c, f, id);

  const bg = layer("bg", el("rect", { x: 0, y: 0, width: 1024, height: 1024, fill: `url(#${id("sky")})` }) + scene(row, c, id, 0));
  const grid = layer("bgGrid", el("g", { opacity: 0.22 }, el("path", { d: "M0 700 L1024 700 M0 780 L1024 780 M0 880 L1024 880 M512 640 L120 1024 M512 640 L904 1024 M512 640 L300 1024 M512 640 L724 1024", stroke: c.trim, "stroke-width": 1.5, fill: "none" })));
  const bgFx = layer("bgFx", el("ellipse", { cx: rimX + litSide * 140, cy: 420, rx: 300, ry: 460, fill: c.trim, opacity: 0.34, filter: `url(#${id("soft")})` }) + el("ellipse", { cx: 512, cy: 520, rx: 420, ry: 380, fill: mix(c.mid, "#ffffff", 0.08), opacity: 0.35, filter: `url(#${id("soft")})` }));
  const aura = layer("aura", el("g", { opacity: 0.55 }, el("circle", { cx: 512, cy: 512, r: 400, fill: "none", stroke: c.trim, "stroke-width": 2, "stroke-dasharray": "120 480", opacity: 0.5 }) + el("circle", { cx: 512, cy: 512, r: 430, fill: "none", stroke: c.trim, "stroke-width": 1, "stroke-dasharray": "20 60", opacity: 0.35 })));
  const rimCore = el("path", { d: hd.outline, fill: "none", stroke: c.trim, "stroke-width": 26, "clip-path": `url(#${id("headClip")})`, transform: `translate(${litSide * 30} 0)` });
  const rim = layer("rimGlow", el("g", { filter: `url(#${id("bloom")})`, opacity: 0.95 }, rimCore) + el("g", { filter: `url(#${id("soft")})`, opacity: 0.55 }, rimCore) + el("path", { d: hd.outline, fill: "none", stroke: shade(c.trim, 0.35), "stroke-width": 5, "clip-path": `url(#${id("headClip")})`, transform: `translate(${litSide * 8} 0)`, opacity: 0.9 }), { opacity: "0.85" });
  const torso = layer("torso", attire(row, x, c, wide));
  const collarFx = layer("collarFx", el("g", { filter: `url(#${id("bloom")})` }, el("path", { d: litSide < 0 ? `M ${x - 360 + t} 1000 L ${x - 340 + t} 820 Q ${x - 300 + t} 740 ${x - 170 + t} 700` : `M ${x + 360 + t} 1000 L ${x + 340 + t} 820 Q ${x + 300 + t} 740 ${x + 170 + t} 700`, stroke: c.trim, "stroke-width": 12, opacity: 0.8, fill: "none", "stroke-linecap": "round" })));
  const hairBack = layer("hairBack", hair.back);
  const headLayer = layer("head", hd.inner + layer("accessory", accessory(row, x, g, c, id)));
  const hairFront = layer("hairFront", hair.front + headwear(row, x, g, c));
  const rand = rng(hashStr(nonce + "p"));
  const particles = layer("particles", Array.from({ length: 18 }, () => el("circle", { cx: rand() * 1024, cy: rand() * 1024, r: 1.5 + rand() * 3, fill: c.trim, opacity: 0.2 + rand() * 0.5 })).join(""));
  const scan = layer("scanFx", el("rect", { x: 0, y: 480, width: 1024, height: 3, fill: c.trim, opacity: 0.35 }), { opacity: "0.12" });
  const post = el("rect", { x: 0, y: 0, width: 1024, height: 1024, fill: `url(#${id("vig")})` }) + el("rect", { x: 0, y: 0, width: 1024, height: 1024, filter: `url(#${id("grain")})`, opacity: 0.45 });

  // rimGlow sits ABOVE the head (clipped to it) so the neon edge lands on the jaw and temple.
  const body = defs + bg + grid + bgFx + aura + hairBack + torso + collarFx + headLayer + rim + hairFront + particles + scan + post;
  const sc = row.scale || {};
  const attrs = { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 1024 1024", width: size, height: size, "data-asset": "PFP_PORTRAIT", "data-style": "lda-pfp-v2", "data-rig": "v3", "data-pfp-style": row.styleId || "neon-competitive", "data-engine": "procedural-svg", "data-layered": "1", "data-signature": row.signature || "", "data-character-scale": sc.characterHeight, "data-face-scale": sc.faceHeight, "data-species": row.species, "data-face": row.faceKind, "data-age": row.age, "data-archetype": row.archetypeId, "aria-hidden": "true" };
  const open = "<svg" + Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => ` ${k}="${esc(v)}"`).join("") + ">";
  return open + body + "</svg>";
}

module.exports = { renderPfpV3, FACE_TOP, FACE_BOTTOM };
