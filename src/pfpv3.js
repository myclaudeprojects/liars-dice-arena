// pfpv3.js — "Neon Noir" portrait rig.
//
// Consumes the SAME recipe buildRecipe() produces and returns an SVG that keeps
// the contract the rest of the app depends on (1024 square, data-style tag,
// FACE_TOP/FACE_BOTTOM coordinates, the data-layer groups the animation runtime
// moves). The picture is one noir bust lit by neon:
//   - the legacy geometric face is not drawn, and neon is not a second layer on it
//   - one open rim along the lit contour (no closed wireframe, no visor seam)
//   - a scene per background selection
//   - attire / accessories / species drawn as real silhouettes
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

// Smooth bust. The previous rig filled an angular polygon and then stroked that
// same polygon in neon, which read as the old face under a wireframe visor.
function smoothFace(x, g, turn) {
  const t = turn * 14;
  const top = FACE_TOP;
  const bot = FACE_BOTTOM;
  const L = x - g.w + t * 0.4;
  const R = x + g.w + t * 0.4;
  const chin = x + t * 1.2;
  const jaw = g.jaw;
  const n = (v) => Number(v).toFixed(1);
  return [
    `M ${n(x + t)} ${n(top)}`,
    `C ${n(R - 36)} ${n(top - 6)}, ${n(R + 6)} ${n(top + 64)}, ${n(R - 2)} ${n(top + 168)}`,
    `C ${n(R + 4)} ${n(top + 270)}, ${n(R - 16)} 548, ${n(x + jaw * 0.62 + t)} ${n(bot - 52)}`,
    `C ${n(x + jaw * 0.28 + t)} ${n(bot + 4)}, ${n(chin + 8)} ${n(bot + 2)}, ${n(chin)} ${n(bot)}`,
    `C ${n(chin - 8)} ${n(bot + 2)}, ${n(x - jaw * 0.28 + t)} ${n(bot + 4)}, ${n(x - jaw * 0.62 + t)} ${n(bot - 52)}`,
    `C ${n(L + 16)} 548, ${n(L - 4)} ${n(top + 270)}, ${n(L + 2)} ${n(top + 168)}`,
    `C ${n(L - 6)} ${n(top + 64)}, ${n(L + 36)} ${n(top - 6)}, ${n(x + t)} ${n(top)} Z`,
  ].join(" ");
}

// One lit contour. Open on purpose: a closed stroke of the face, shifted inward,
// is the visor seam and the wireframe overlay.
function litEdge(x, g, turn, litSide) {
  const t = turn * 14;
  const top = FACE_TOP;
  const bot = FACE_BOTTOM;
  const L = x - g.w + t * 0.4;
  const R = x + g.w + t * 0.4;
  const n = (v) => Number(v).toFixed(1);
  if (litSide < 0) {
    return `M ${n(x + t * 0.3)} ${n(top + 10)} C ${n(L + 28)} ${n(top + 4)}, ${n(L - 2)} ${n(top + 90)}, ${n(L + 6)} ${n(top + 190)} C ${n(L + 10)} ${n(top + 300)}, ${n(L + 22)} 600, ${n(x - g.jaw * 0.4 + t)} ${n(bot - 28)}`;
  }
  return `M ${n(x + t * 0.3)} ${n(top + 10)} C ${n(R - 28)} ${n(top + 4)}, ${n(R + 2)} ${n(top + 90)}, ${n(R - 6)} ${n(top + 190)} C ${n(R - 10)} ${n(top + 300)}, ${n(R - 22)} 600, ${n(x + g.jaw * 0.4 + t)} ${n(bot - 28)}`;
}

function sideEdge(pts, litSide) {
  const seq = litSide < 0 ? [pts[0], pts[11], pts[10], pts[9], pts[8], pts[7]] : [pts[0], pts[1], pts[2], pts[3], pts[4], pts[5]];
  return seq.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
}

// Angular plate for synthetic heads only. Returns points for reuse.
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
  } else if (bg === "dice_table") {
    parts.push(el("rect", { x: 0, y: 0, width: 1024, height: 1024, fill: `url(#${id("felt")})` }));
    parts.push(el("ellipse", { cx: 512, cy: 980, rx: 620, ry: 160, fill: "#5a3b22", opacity: 0.8 }), el("ellipse", { cx: 512, cy: 960, rx: 560, ry: 120, fill: mix(deep, "#144b39", 0.6) }));
    const die = (cx, cy, rot, pips) => el("g", { transform: `rotate(${rot} ${cx} ${cy})`, opacity: 0.85 }, el("rect", { x: cx - 36, y: cy - 36, width: 72, height: 72, rx: 12, fill: "#f4efe6" }) + pips.map(([px, py]) => el("circle", { cx: cx + px, cy: cy + py, r: 7, fill: "#1a1a17" })).join(""));
    parts.push(die(130, 900, -18, [[-18, -18], [18, 18], [18, -18], [-18, 18]]), die(880, 920, 12, [[0, 0]]), die(210, 960, 30, [[-18, -18], [0, 0], [18, 18]]));
    for (let i = 0; i < 7; i++) parts.push(el("circle", { cx: 760 + i * 24, cy: 900 - i * 6, r: 28, fill: i % 2 ? a : "#e8c458", stroke: "#f4efe6", "stroke-width": 4, "stroke-dasharray": "14 16", opacity: 0.8 }));
  } else if (bg === "rooftop") {
    for (let i = 0; i < 12; i++) { const w = 50 + rand() * 90, h = 120 + rand() * 260, x0 = i * 90 - 30; parts.push(el("rect", { x: x0, y: 700 - h, width: w, height: h, fill: mix(deep, mid, 0.6) })); for (let k = 0; k < 8; k++) if (rand() > 0.5) parts.push(el("rect", { x: x0 + 8 + rand() * (w - 16), y: 700 - h + 10 + rand() * (h - 30), width: 6, height: 8, fill: rand() > 0.7 ? a : "#ffe9b0", opacity: 0.6 })); }
    parts.push(el("rect", { x: 0, y: 700, width: 1024, height: 324, fill: shade(deep, -0.3) }), el("rect", { x: 0, y: 690, width: 1024, height: 14, fill: mix(deep, "#c9d3d8", 0.25) }));
    for (let i = 0; i < 9; i++) parts.push(el("rect", { x: 40 + i * 120, y: 640, width: 12, height: 60, fill: mix(deep, "#c9d3d8", 0.25) }));
    parts.push(el("circle", { cx: 840, cy: 160, r: 70, fill: "#f4efe6", opacity: 0.85 }), el("circle", { cx: 810, cy: 140, r: 70, fill: deep, opacity: 0.9 }));
  } else if (bg === "boardroom") {
    for (let i = 0; i < 5; i++) parts.push(el("rect", { x: 40 + i * 200, y: 60, width: 150, height: 520, fill: "#1b2230", opacity: 0.7 }), el("rect", { x: 48 + i * 200, y: 70, width: 134, height: 500, fill: mix(deep, a, 0.12), opacity: 0.8 }));
    parts.push(el("rect", { x: 0, y: 720, width: 1024, height: 304, fill: "#2a1e14" }), el("rect", { x: 0, y: 712, width: 1024, height: 10, fill: "#6b4a2a" }));
    parts.push(el("rect", { x: 60, y: 600, width: 904, height: 120, rx: 14, fill: "#3a2a1a" }), el("rect", { x: 80, y: 610, width: 864, height: 12, rx: 6, fill: shade("#3a2a1a", 0.3), opacity: 0.6 }));
  } else if (bg === "neon_alley") {
    parts.push(el("rect", { x: 0, y: 0, width: 1024, height: 1024, fill: mix(deep, a, 0.08) }));
    parts.push(el("polygon", { points: "0,0 300,0 420,1024 0,1024", fill: shade(deep, -0.2) }), el("polygon", { points: "1024,0 720,0 600,1024 1024,1024", fill: shade(deep, -0.2) }));
    for (let i = 0; i < 6; i++) parts.push(el("rect", { x: 120 + (i % 2) * 20, y: 140 + i * 130, width: 160, height: 60, rx: 10, fill: i % 2 ? a : mix(a, "#ffffff", 0.4), opacity: 0.6, filter: `url(#${id("bloom")})` }), el("rect", { x: 740 - (i % 2) * 20, y: 200 + i * 120, width: 140, height: 50, rx: 10, fill: i % 2 ? "#ff5aa8" : a, opacity: 0.55, filter: `url(#${id("bloom")})` }));
    parts.push(el("rect", { x: 0, y: 860, width: 1024, height: 164, fill: shade(deep, -0.35) }), el("rect", { x: 0, y: 860, width: 1024, height: 164, fill: `url(#${id("fog")})`, opacity: 0.9 }));
  } else if (bg === "bunker") {
    for (let i = 0; i < 6; i++) parts.push(el("rect", { x: 0, y: 40 + i * 160, width: 1024, height: 130, fill: i % 2 ? "#1c2126" : "#161a1f" }), el("rect", { x: 0, y: 170 + i * 160, width: 1024, height: 6, fill: "#2f3841" }));
    for (let i = 0; i < 8; i++) parts.push(el("circle", { cx: 60 + i * 130, cy: 100, r: 10, fill: "#2f3841", stroke: "#3f4a55", "stroke-width": 3 }));
    parts.push(el("rect", { x: 380, y: 60, width: 264, height: 26, rx: 6, fill: "#3a2a12" }), el("rect", { x: 380, y: 60, width: 264, height: 26, rx: 6, fill: a, opacity: 0.35, filter: `url(#${id("bloom")})` }));
    parts.push(el("path", { d: "M300 60 L 300 900 M724 60 L724 900", stroke: "#2f3841", "stroke-width": 16 }));
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
  } else if (style === "buzz") {
    front = el("path", { d: `M ${L + 12} ${top + 120} L ${L + 8} ${top + 36} Q ${x + t} ${top - 34} ${R - 8} ${top + 36} L ${R - 12} ${top + 120} L ${R - 44} ${top + 70} Q ${x + t} ${top + 30} ${L + 44} ${top + 70} Z`, fill: base, opacity: 0.85 });
  } else if (style === "undercut") {
    front = el("path", { d: `M ${L + 30} ${top + 110} L ${L + 30} ${top + 20} L ${x - 40 + t} ${top - 70} L ${x + 130 + t} ${top - 56} L ${R - 30} ${top + 24} L ${R - 30} ${top + 110} L ${R - 60} ${top + 60} L ${x + 60 + t} ${top + 30} L ${L + 70} ${top + 60} Z`, fill: base })
      + el("path", { d: `M ${L + 8} ${top + 140} L ${L + 6} ${top + 60} L ${L + 30} ${top + 40} L ${L + 34} ${top + 130} Z M ${R - 8} ${top + 140} L ${R - 6} ${top + 60} L ${R - 30} ${top + 40} L ${R - 34} ${top + 130} Z`, fill: dark, opacity: 0.9 })
      + el("path", { d: `M ${x - 30 + t} ${top - 50} L ${x + 110 + t} ${top - 40} L ${x + 40 + t} ${top - 4} Z`, fill: hi, opacity: 0.6 });
  } else if (style === "braids") {
    const strands = []; for (let i = 0; i < 6; i++) { const sx = L - 10 + i * ((R - L + 20) / 5); const sy = top + 500 + (i % 2) * 40; const d = `M ${sx} ${top + 60} Q ${sx - 20 + (i % 2) * 40} ${top + 300} ${sx + (i < 3 ? -30 : 30)} ${sy}`; strands.push(el("path", { d, fill: "none", stroke: dark, "stroke-width": 26, "stroke-linecap": "round" }) + el("path", { d, fill: "none", stroke: base, "stroke-width": 12, "stroke-dasharray": "22 16", "stroke-linecap": "round" })); }
    back = strands.join("");
    front = el("path", { d: `M ${L + 4} ${top + 130} L ${L} ${top + 40} Q ${x + t} ${top - 60} ${R} ${top + 40} L ${R - 4} ${top + 130} L ${R - 40} ${top + 60} Q ${x + t} ${top + 20} ${L + 40} ${top + 60} Z`, fill: base })
      + el("path", { d: `M ${L + 20} ${top + 60} L ${R - 20} ${top + 60} M ${L + 40} ${top + 20} L ${R - 40} ${top + 20}`, stroke: hi, "stroke-width": 4, opacity: 0.5 });
  } else if (style === "mohawk") {
    const spikes = []; for (let i = 0; i < 7; i++) { const px = x - 60 + i * 20 + t; spikes.push(`${px},${top + 40} ${px + 10},${top - 150 - (i % 2) * 30} ${px + 20},${top + 40}`); }
    front = el("polygon", { points: spikes.join(" "), fill: base }) + el("path", { d: `M ${x - 70 + t} ${top + 60} L ${x + 70 + t} ${top + 60} L ${x + 50 + t} ${top + 20} L ${x - 50 + t} ${top + 20} Z`, fill: base })
      + el("path", { d: `M ${x - 40 + t} ${top - 60} L ${x + t} ${top - 150} L ${x + 30 + t} ${top - 40} Z`, fill: hi, opacity: 0.55 })
      + el("path", { d: `M ${L + 8} ${top + 130} L ${L + 6} ${top + 50} L ${x - 70 + t} ${top + 30} L ${x - 60 + t} ${top + 110} Z M ${R - 8} ${top + 130} L ${R - 6} ${top + 50} L ${x + 70 + t} ${top + 30} L ${x + 60 + t} ${top + 110} Z`, fill: dark, opacity: 0.8 });
  } else if (style === "bun") {
    back = el("circle", { cx: x + t, cy: top - 70, r: 70, fill: dark }) + el("circle", { cx: x - 16 + t, cy: top - 84, r: 40, fill: base, opacity: 0.9 });
    front = el("path", { d: `M ${L + 2} ${top + 140} L ${L - 2} ${top + 40} Q ${x + t} ${top - 60} ${R + 2} ${top + 40} L ${R - 2} ${top + 140} L ${R - 40} ${top + 70} Q ${x + t} ${top + 24} ${L + 40} ${top + 70} Z`, fill: base })
      + el("path", { d: `M ${L + 30} ${top + 40} L ${x + t} ${top - 40} M ${R - 30} ${top + 40} L ${x + t} ${top - 40}`, stroke: hi, "stroke-width": 5, opacity: 0.45, fill: "none" });
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
  if (kind === "helm") return el("path", { d: `M ${L - 6} ${top + 60} Q ${x + t} ${top - 120} ${R + 6} ${top + 60} L ${R + 6} ${top + 150} L ${L - 6} ${top + 150} Z`, fill: "#14161c" }) + el("path", { d: `M ${L + 8} ${top + 48} Q ${x + t} ${top - 96} ${R - 8} ${top + 48}`, fill: "none", stroke: c.trim, "stroke-width": 5, "stroke-linecap": "round" });
  if (kind === "halfmask") return el("path", { d: `M ${x - 8 + t} 488 C ${x + 70 + t} 460 ${R - 8} 510 ${R - 18} 590 C ${R - 36} 660 ${x + 36 + t} 688 ${x + t} 700 C ${x - 20 + t} 640 ${x - 24 + t} 560 ${x - 8 + t} 488 Z`, fill: "#14161c", opacity: 0.94 }) + el("path", { d: `M ${x + 4 + t} 500 C ${x + 80 + t} 478 ${R - 28} 530 ${R - 36} 610`, fill: "none", stroke: c.trim, "stroke-width": 4, "stroke-linecap": "round" });
  if (kind === "beanie") return el("path", { d: `M ${L - 10} ${top + 150} L ${L - 6} ${top + 20} Q ${x + t} ${top - 120} ${R + 6} ${top + 20} L ${R + 10} ${top + 150} L ${R - 30} ${top + 130} L ${L + 30} ${top + 130} Z`, fill: c.clothDeep }) + el("path", { d: `M ${L - 12} ${top + 90} L ${R + 12} ${top + 90} L ${R + 12} ${top + 150} L ${L - 12} ${top + 150} Z`, fill: shade(c.clothDeep, 0.12) }) + el("circle", { cx: x + t, cy: top - 110, r: 22, fill: c.trim });
  if (kind === "bandana") return el("path", { d: `M ${L - 14} ${top + 120} L ${L - 8} ${top + 40} Q ${x + t} ${top - 40} ${R + 8} ${top + 40} L ${R + 14} ${top + 120} L ${R + 60} ${top + 200} L ${R + 20} ${top + 210} L ${R - 10} ${top + 140} L ${L + 10} ${top + 140} Z`, fill: c.trim, opacity: 0.9 }) + el("path", { d: `M ${L + 20} ${top + 70} L ${R - 20} ${top + 70} M ${L + 40} ${top + 100} L ${R - 40} ${top + 100}`, stroke: shade(c.trim, -0.35), "stroke-width": 3, fill: "none", opacity: 0.6 });
  if (kind === "visor") return el("path", { d: `M ${L - 24} 380 L ${R + 24} 380 L ${R + 12} 470 L ${L - 12} 470 Z`, fill: "#0b0e14", opacity: 0.92 }) + el("path", { d: `M ${L - 10} 396 L ${R + 10} 396`, stroke: c.trim, "stroke-width": 5, "stroke-linecap": "round", opacity: 0.9 }) + el("path", { d: `M ${L} 430 L ${R} 430`, stroke: c.trim, "stroke-width": 2, opacity: 0.35 });
  if (kind === "helmet") return el("path", { d: `M ${L - 6} ${top + 60} Q ${x + t} ${top - 120} ${R + 6} ${top + 60} L ${R + 6} ${top + 150} L ${L - 6} ${top + 150} Z`, fill: "#14161c" }) + el("path", { d: `M ${L + 8} ${top + 48} Q ${x + t} ${top - 96} ${R - 8} ${top + 48}`, fill: "none", stroke: c.trim, "stroke-width": 5, "stroke-linecap": "round" }) + el("path", { d: `M ${L - 6} ${top + 150} L ${L - 20} ${top + 240} L ${L + 10} ${top + 240} Z M ${R + 6} ${top + 150} L ${R + 20} ${top + 240} L ${R - 10} ${top + 240} Z`, fill: "#14161c" });
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
  if (kind === "dice") { const die = (cx, cy, rot, pips) => el("g", { transform: `rotate(${rot} ${cx} ${cy})` }, el("rect", { x: cx - 44, y: cy - 44, width: 88, height: 88, rx: 14, fill: "#f4efe6", stroke: "#b9ad95", "stroke-width": 3 }) + pips.map(([px, py]) => el("circle", { cx: cx + px, cy: cy + py, r: 8, fill: "#1a1a17" })).join("")); return die(R + 120, 800, -14, [[-22, -22], [22, 22], [0, 0], [-22, 22], [22, -22]]) + die(R + 60, 880, 18, [[0, 0]]); }
  if (kind === "chips") { const chip = (cx, cy, col) => el("g", null, el("circle", { cx, cy, r: 40, fill: col, stroke: "#f4efe6", "stroke-width": 6, "stroke-dasharray": "20 22" }) + el("circle", { cx, cy, r: 22, fill: shade(col, -0.25) })); return chip(R + 80, 900, c.trim) + chip(R + 150, 860, "#e8c458") + chip(R + 120, 800, "#f4efe6"); }
  if (kind === "cards") { const card = (cx, cy, rot, col) => el("g", { transform: `rotate(${rot} ${cx} ${cy})` }, el("rect", { x: cx - 40, y: cy - 60, width: 80, height: 120, rx: 10, fill: "#f7f2e8", stroke: "#cfc3a8", "stroke-width": 3 }) + el("polygon", { points: `${cx},${cy - 30} ${cx + 22},${cy} ${cx},${cy + 30} ${cx - 22},${cy}`, fill: col })); return card(R + 70, 840, -22, "#1a1a17") + card(R + 120, 820, 0, c.trim) + card(R + 170, 840, 22, "#c8382c"); }
  if (kind === "cigar") { const sm = []; for (let i = 0; i < 4; i++) sm.push(el("path", { d: `M ${x + 130 + t} ${612 - i * 6} q 30 -50 ${10 + i * 26} -${90 + i * 40}`, fill: "none", stroke: "#dfe6ee", "stroke-width": 7 - i, "stroke-linecap": "round", opacity: 0.3 - i * 0.05 })); return el("rect", { x: x + 44 + t, y: 626, width: 90, height: 18, rx: 8, fill: "#5a3b22", transform: `rotate(-10 ${x + 44 + t} 635)` }) + el("rect", { x: x + 122 + t, y: 612, width: 16, height: 16, rx: 6, fill: "#ff7a2a", filter: `url(#${id("bloom")})` }) + sm.join(""); }
  if (kind === "unique_fx") { const s = []; const rand = rng(hashStr("fx" + x)); for (let i = 0; i < 10; i++) { const px = x + (rand() - 0.5) * 760 + t, py = 200 + rand() * 600, sz = 12 + rand() * 34; s.push(el("polygon", { points: `${px},${py - sz} ${px + sz * 0.7},${py} ${px},${py + sz} ${px - sz * 0.7},${py}`, fill: c.trim, opacity: 0.5 + rand() * 0.5, filter: `url(#${id("bloom")})` })); } return s.join(""); }
  return "";
}

// ---------------------------------------------------------------- attire
function attire(row, x, c, wide, id) {
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
  } else if (kind === "trench_coat") {
    detail = el("path", { d: `M ${x - 80 + t} 690 L ${x - 250 + t} 1024 L ${x - 60 + t} 1024 L ${x + t} 840 Z M ${x + 80 + t} 690 L ${x + 250 + t} 1024 L ${x + 60 + t} 1024 L ${x + t} 840 Z`, fill: shade(base, -0.18) }) + el("path", { d: `M ${x - 80 + t} 690 L ${x - 200 + t} 760 L ${x - 120 + t} 780 Z M ${x + 80 + t} 690 L ${x + 200 + t} 760 L ${x + 120 + t} 780 Z`, fill: lit, opacity: 0.6 }) + el("path", { d: `M ${x - 60 + t} 700 L ${x + t} 840 L ${x + 60 + t} 700`, fill: "none", stroke: deep, "stroke-width": 6 }) + el("rect", { x: L + 60, y: 960, width: R - L - 120, height: 28, rx: 6, fill: deep });
  } else if (kind === "bomber_jacket") {
    detail = el("path", { d: `M ${x - 190 + t} 700 Q ${x + t} 660 ${x + 190 + t} 700 L ${x + 170 + t} 740 Q ${x + t} 700 ${x - 170 + t} 740 Z`, fill: deep }) + el("path", { d: `M ${x - 28 + t} 700 L ${x - 34 + t} 1024 L ${x + 34 + t} 1024 L ${x + 28 + t} 700 Z`, fill: "#1a1c22" }) + el("path", { d: `M ${x - 6 + t} 720 L ${x - 6 + t} 1010`, stroke: c.trim, "stroke-width": 4 }) + el("path", { d: `M ${L + 30} 880 L ${x - 70 + t} 1024 M ${R - 30} 880 L ${x + 70 + t} 1024`, stroke: shade(base, 0.25), "stroke-width": 14, opacity: 0.5 }) + el("rect", { x: x + 120 + t, y: 840, width: 90, height: 30, rx: 6, fill: c.trim, opacity: 0.85 });
  } else if (kind === "robe") {
    detail = el("path", { d: `M ${x - 120 + t} 690 L ${x + t} 1024 L ${x - 260 + t} 1024 Z M ${x + 120 + t} 690 L ${x + t} 1024 L ${x + 260 + t} 1024 Z`, fill: shade(base, -0.2) }) + el("path", { d: `M ${x - 120 + t} 690 L ${x + t} 1024 M ${x + 120 + t} 690 L ${x + t} 1024`, stroke: "#e8c458", "stroke-width": 10, fill: "none" }) + el("path", { d: `M ${L + 60} 900 L ${R - 60} 900 L ${R - 70} 940 L ${L + 70} 940 Z`, fill: "#e8c458", opacity: 0.85 });
  } else if (kind === "plate_armor") {
    detail = el("path", { d: `M ${x - 260 + t} 700 L ${x - 60 + t} 690 L ${x - 100 + t} 880 L ${x - 300 + t} 860 Z M ${x + 260 + t} 700 L ${x + 60 + t} 690 L ${x + 100 + t} 880 L ${x + 300 + t} 860 Z`, fill: "#6b7683" }) + el("path", { d: `M ${x - 240 + t} 720 L ${x - 90 + t} 712 M ${x + 240 + t} 720 L ${x + 90 + t} 712`, stroke: "#c9d3da", "stroke-width": 5, opacity: 0.7 }) + el("path", { d: `M ${x - 120 + t} 760 L ${x + 120 + t} 760 L ${x + 90 + t} 1024 L ${x - 90 + t} 1024 Z`, fill: "#4f5a66" }) + el("path", { d: `M ${x - 90 + t} 800 L ${x + 90 + t} 800 M ${x - 80 + t} 880 L ${x + 80 + t} 880 M ${x - 70 + t} 960 L ${x + 70 + t} 960`, stroke: "#8e99a6", "stroke-width": 5 }) + el("circle", { cx: x + t, cy: 830, r: 16, fill: c.trim, filter: `url(#${id("bloom")})` });
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
  const litSide = turn >= 0 ? -1 : 1;
  const chosenTone = row.selections && row.selections.skinTone && row.selections.skinTone !== "auto";
  // Neon Noir keeps the face a dark silhouette. A chosen skin tone shows as an undertone
  // (warm / olive / deep / cool) without ever painting a lit skin colour.
  const noir = chosenTone ? mix("#100E12", c.skin, row.selections.skinTone === "synthetic" ? 0.3 : 0.24) : "#100E12";
  const neck = el("path", { d: `M ${x - 70 + t} ${FACE_BOTTOM - 80} L ${x + 70 + t} ${FACE_BOTTOM - 80} L ${x + 90 + t} 760 L ${x - 90 + t} 760 Z`, fill: noir });

  if (species === "robot" || species === "skeletal") {
    const pts = facePts(x, g, turn);
    const outline = P(pts);
    const metalD = species === "robot" ? "#6b7683" : "#9a958b";
    const plate = el("path", { d: outline, fill: `url(#${id("metal")})`, "data-face-fill": "synthetic" })
      + el("path", { d: `M ${x - g.w + 40 + t} 560 L ${x + g.w - 40 + t} 560`, stroke: metalD, "stroke-width": 3, opacity: 0.45 })
      + el("rect", { x: x - g.w + 40 + t, y: 400, width: g.w * 2 - 80, height: 60, rx: 8, fill: "#0a0d12" })
      + el("rect", { x: x - g.w + 54 + t, y: 418, width: g.w * 2 - 108, height: 24, rx: 4, fill: c.trim, filter: `url(#${id("bloom")})`, "data-layer": "eyesOpen" })
      + el("rect", { x: x - g.w + 54 + t, y: 418, width: g.w * 2 - 108, height: 24, rx: 4, fill: "#0a0d12", opacity: "0", "data-layer": "eyesClosed" })
      + el("g", { "data-layer": "pupils" }, el("rect", { x: x - 30 + t, y: 424, width: 60, height: 12, rx: 3, fill: "#ffffff", opacity: 0.85 }))
      + el("path", { d: `M ${x - 60 + t} 620 L ${x + 60 + t} 620`, stroke: c.trim, "stroke-width": 6, "stroke-linecap": "round", opacity: 0.8 })
      + (species === "skeletal" ? el("path", { d: `M ${x - 40 + t} 660 L ${x + 40 + t} 660 M ${x - 30 + t} 640 L ${x - 30 + t} 690 M ${x - 10 + t} 640 L ${x - 10 + t} 690 M ${x + 10 + t} 640 L ${x + 10 + t} 690 M ${x + 30 + t} 640 L ${x + 30 + t} 690`, stroke: metalD, "stroke-width": 4 }) : "");
    return { outline, edge: sideEdge(pts, litSide), inner: neck + plate };
  }

  const outline = smoothFace(x, g, turn);
  const edge = litEdge(x, g, turn, litSide);
  const ears = el("ellipse", { cx: x - g.w - 6 + t * 0.4, cy: 470, rx: 22, ry: 40, fill: "#1A1816" }) + el("ellipse", { cx: x + g.w + 6 + t * 0.4, cy: 470, rx: 22, ry: 40, fill: noir });
  const base = el("path", { d: outline, fill: noir, "data-face-fill": "noir" });
  const keyWash = el("path", { d: outline, fill: `url(#${id(litSide < 0 ? "keyL" : "keyR")})`, opacity: 0.9 });
  const line = "#2A2428";
  const age = String(row.age) === "elder" ? el("path", { d: `M ${x - 120 + t} 600 q 20 30 60 26 M ${x + 120 + t} 600 q -20 30 -60 26 M ${x - 60 + t} ${FACE_TOP + 90} L ${x + 60 + t} ${FACE_TOP + 90} M ${x - 50 + t} ${FACE_TOP + 116} L ${x + 50 + t} ${FACE_TOP + 116}`, stroke: line, "stroke-width": 3, fill: "none", opacity: 0.7, "stroke-linecap": "round" }) : "";

  const eyeY = 430, gap = 74, ew = 46, eh = 22 * (1 - Math.min(0.5, Math.max(-0.2, f.lid))) + 4;
  const eye = (cx) => el("ellipse", { cx, cy: eyeY, rx: ew, ry: eh, fill: "#C8C2BA" });
  const irisR = 15, iris = (cx) => el("circle", { cx, cy: eyeY + 1, r: irisR, fill: `url(#${id("iris")})` }) + el("circle", { cx: cx - 5, cy: eyeY - 5, r: 4, fill: "#ffffff", opacity: 0.9 });
  const lid = (cx) => el("path", { d: `M ${cx - ew} ${eyeY} Q ${cx} ${eyeY - eh - 6} ${cx + ew} ${eyeY}`, fill: "none", stroke: line, "stroke-width": 4 });
  const closed = (cx) => el("path", { d: `M ${cx - ew} ${eyeY + 2} Q ${cx} ${eyeY + 12} ${cx + ew} ${eyeY + 2}`, fill: "none", stroke: line, "stroke-width": 5, "stroke-linecap": "round" });
  const eyeGlow = f.glow > 0.05 ? el("g", { filter: `url(#${id("bloom")})`, opacity: Math.min(0.55, f.glow * 0.7) }, el("ellipse", { cx: x - gap + t, cy: eyeY, rx: ew + 4, ry: eh + 3, fill: c.trim }) + el("ellipse", { cx: x + gap + t, cy: eyeY, rx: ew + 4, ry: eh + 3, fill: c.trim })) : "";
  const eyesOpen = el("g", { "data-layer": "eyesOpen" }, eyeGlow + eye(x - gap + t) + eye(x + gap + t) + lid(x - gap + t) + lid(x + gap + t));
  const irisAlt = (cx) => el("circle", { cx, cy: eyeY + 1, r: irisR, fill: c.irisAlt }) + el("circle", { cx: cx - 5, cy: eyeY - 5, r: 4, fill: "#ffffff", opacity: 0.9 });
  const pupils = el("g", { "data-layer": "pupils" }, iris(x - gap + t) + (c.irisAlt ? irisAlt(x + gap + t) : iris(x + gap + t)));
  const eyesClosed = el("g", { "data-layer": "eyesClosed", opacity: "0" }, el("ellipse", { cx: x - gap + t, cy: eyeY, rx: ew + 2, ry: eh + 2, fill: noir }) + el("ellipse", { cx: x + gap + t, cy: eyeY, rx: ew + 2, ry: eh + 2, fill: noir }) + closed(x - gap + t) + closed(x + gap + t));
  const [bIn, bOut, bW] = f.brow;
  const brow = (cx, dir) => el("path", { d: `M ${cx - dir * (ew + 10)} ${eyeY - 56 - bOut} L ${cx} ${eyeY - 66 - (bIn + bOut) / 2} L ${cx + dir * (ew + 12)} ${eyeY - 60 - bIn}`, fill: "none", stroke: shade(c.hair, -0.15), "stroke-width": 8 * bW, "stroke-linecap": "round", "stroke-linejoin": "round" });
  const brows = brow(x - gap + t, -1) + brow(x + gap + t, 1);
  const nose = el("path", { d: `M ${x + 4 + t} 478 L ${x + 16 + t} 552 L ${x - 6 + t} 562`, fill: "none", stroke: line, "stroke-width": 4, "stroke-linecap": "round", opacity: 0.8 });
  const my = 628;
  const mouths = {
    smile: el("path", { d: `M ${x - 54 + t} ${my - 6} Q ${x + t} ${my + 34} ${x + 54 + t} ${my - 6}`, fill: "none", stroke: c.lip, "stroke-width": 6, "stroke-linecap": "round" }),
    grin: el("path", { d: `M ${x - 62 + t} ${my - 10} Q ${x + t} ${my + 46} ${x + 62 + t} ${my - 10} Z`, fill: "#1a0e12" }) + el("path", { d: `M ${x - 48 + t} ${my - 2} Q ${x + t} ${my + 14} ${x + 48 + t} ${my - 2} L ${x + 44 + t} ${my + 6} Q ${x + t} ${my + 22} ${x - 44 + t} ${my + 6} Z`, fill: "#f3efe6" }),
    smirk: el("path", { d: `M ${x - 44 + t} ${my + 4} Q ${x + 6 + t} ${my + 18} ${x + 56 + t} ${my - 14}`, fill: "none", stroke: c.lip, "stroke-width": 6, "stroke-linecap": "round" }),
    flat: el("path", { d: `M ${x - 44 + t} ${my} L ${x + 44 + t} ${my}`, fill: "none", stroke: c.lip, "stroke-width": 6, "stroke-linecap": "round" }),
    tight: el("path", { d: `M ${x - 48 + t} ${my + 4} L ${x + 48 + t} ${my - 2}`, fill: "none", stroke: c.lip, "stroke-width": 6, "stroke-linecap": "round" }),
    soft: el("path", { d: `M ${x - 46 + t} ${my - 2} Q ${x + t} ${my + 18} ${x + 46 + t} ${my - 2}`, fill: "none", stroke: c.lip, "stroke-width": 5, "stroke-linecap": "round" }),
  };
  const mouth = mouths[f.mouth] || mouths.flat;
  const muzzle = species === "animal" ? el("path", { d: `M ${x - 70 + t} 540 Q ${x + t} 500 ${x + 70 + t} 540 L ${x + 50 + t} 640 Q ${x + t} 670 ${x - 50 + t} 640 Z`, fill: shade(c.hair, -0.25) }) + el("path", { d: `M ${x - 22 + t} 566 L ${x + 22 + t} 566 L ${x + t} 592 Z`, fill: "#1a0e12" }) : "";
  const fh = String(row.facialHair || "auto");
  const facialHair = fh === "stubble" ? el("path", { d: `M ${x - 120 + t} 560 Q ${x + t} 740 ${x + 120 + t} 560 L ${x + 96 + t} 690 Q ${x + t} 730 ${x - 96 + t} 690 Z`, fill: shade(c.hair, -0.05), opacity: 0.28 })
    : fh === "goatee" ? el("path", { d: `M ${x - 44 + t} 650 Q ${x + t} 740 ${x + 44 + t} 650 L ${x + 30 + t} 706 Q ${x + t} 724 ${x - 30 + t} 706 Z`, fill: shade(c.hair, -0.1), opacity: 0.92 }) + el("path", { d: `M ${x - 40 + t} 604 Q ${x + t} 596 ${x + 40 + t} 604 L ${x + 34 + t} 616 Q ${x + t} 610 ${x - 34 + t} 616 Z`, fill: shade(c.hair, -0.1), opacity: 0.9 })
    : fh === "beard" ? el("path", { d: `M ${x - 140 + t} 540 Q ${x - 150 + t} 720 ${x + t} 760 Q ${x + 150 + t} 720 ${x + 140 + t} 540 L ${x + 120 + t} 640 Q ${x + t} 700 ${x - 120 + t} 640 Z`, fill: shade(c.hair, -0.1), opacity: 0.94 }) + el("path", { d: `M ${x - 40 + t} 604 Q ${x + t} 596 ${x + 40 + t} 604 L ${x + 34 + t} 618 Q ${x + t} 612 ${x - 34 + t} 618 Z`, fill: shade(c.hair, -0.1) })
    : fh === "mustache" ? el("path", { d: `M ${x - 56 + t} 606 Q ${x - 24 + t} 588 ${x + t} 604 Q ${x + 24 + t} 588 ${x + 56 + t} 606 L ${x + 44 + t} 622 Q ${x + t} 614 ${x - 44 + t} 622 Z`, fill: shade(c.hair, -0.1) })
    : "";
  const beard = fh === "auto" && row.premium && String(row.faceKind).startsWith("male") ? el("path", { d: `M ${x - 130 + t} 560 Q ${x + t} 760 ${x + 130 + t} 560 L ${x + 100 + t} 700 Q ${x + t} 740 ${x - 100 + t} 700 Z`, fill: shade(c.hair, -0.1), opacity: 0.85 }) : "";
  const inner = neck + ears + base + keyWash + age + muzzle + beard + facialHair + brows + eyesOpen + pupils + eyesClosed + nose + mouth;
  return { outline, edge, inner };
}

// ---------------------------------------------------------------- effects
function fxLayer(kind, c, id, nonce) {
  if (!kind || kind === "none") return "";
  const rand = rng(hashStr(nonce + kind));
  const a = c.trim;
  let inner = "";
  if (kind === "halo_ring") inner = el("circle", { cx: 512, cy: 470, r: 330, fill: "none", stroke: a, "stroke-width": 10, opacity: 0.85, filter: `url(#${id("bloom")})` }) + el("circle", { cx: 512, cy: 470, r: 330, fill: "none", stroke: shade(a, 0.4), "stroke-width": 3 });
  else if (kind === "scanlines") { const lines = []; for (let y = 0; y < 1024; y += 8) lines.push(`M0 ${y} H1024`); inner = el("path", { d: lines.join(" "), stroke: "#000000", "stroke-width": 3, opacity: 0.22 }) + el("rect", { x: 0, y: 0, width: 1024, height: 1024, fill: a, opacity: 0.05 }); }
  else if (kind === "glitch") { const bars = []; for (let i = 0; i < 9; i++) { const y = rand() * 1024, h = 6 + rand() * 30, dx = (rand() - 0.5) * 60; bars.push(el("rect", { x: dx, y, width: 1024, height: h, fill: i % 2 ? a : "#ff2e6a", opacity: 0.18 + rand() * 0.2 })); } inner = bars.join("") + el("rect", { x: 0, y: 0, width: 1024, height: 1024, fill: "none", stroke: a, "stroke-width": 2, opacity: 0.3 }); }
  else if (kind === "embers") { const dots = []; for (let i = 0; i < 40; i++) dots.push(el("circle", { cx: rand() * 1024, cy: 300 + rand() * 724, r: 2 + rand() * 5, fill: i % 3 ? "#ff8a3d" : "#ffd27a", opacity: 0.4 + rand() * 0.6, filter: `url(#${id("bloom")})` })); inner = dots.join(""); }
  else if (kind === "rain") { const drops = []; for (let i = 0; i < 70; i++) { const px = rand() * 1024, py = rand() * 1024; drops.push(`M${px.toFixed(0)} ${py.toFixed(0)} l -8 ${22 + rand() * 30}`); } inner = el("path", { d: drops.join(" "), stroke: "#dfe6ee", "stroke-width": 2, opacity: 0.45, "stroke-linecap": "round" }) + el("rect", { x: 0, y: 0, width: 1024, height: 1024, fill: "#0b1a2a", opacity: 0.18 }); }
  else if (kind === "haze") inner = el("ellipse", { cx: 512, cy: 900, rx: 700, ry: 260, fill: "#dfe6ee", opacity: 0.22, filter: `url(#${id("soft")})` }) + el("ellipse", { cx: 300, cy: 700, rx: 400, ry: 160, fill: a, opacity: 0.12, filter: `url(#${id("soft")})` });
  else if (kind === "chip_storm") { const bits = []; for (let i = 0; i < 16; i++) { const px = rand() * 1024, py = rand() * 700, r = 14 + rand() * 18, rot = rand() * 360; bits.push(i % 2 ? el("circle", { cx: px, cy: py, r, fill: i % 4 ? a : "#e8c458", stroke: "#f4efe6", "stroke-width": 3, "stroke-dasharray": "8 10", opacity: 0.8 }) : el("rect", { x: px - r, y: py - r, width: r * 2, height: r * 2, rx: 6, fill: "#f4efe6", opacity: 0.85, transform: `rotate(${rot.toFixed(0)} ${px} ${py})` })); } inner = bits.join(""); }
  return layer("fx", inner);
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
    el("clipPath", { id: id("tipClip") }, el("rect", { x: 0, y: FACE_TOP + 250, width: 1024, height: 800 })),
    el("clipPath", { id: id("headClip") }, el("path", { d: (String(row.species) === "robot" || String(row.species) === "skeletal") ? P(facePts(x, g, turn)) : smoothFace(x, g, turn) })),
    el("linearGradient", { id: id("keyL"), x1: 0, y1: 0, x2: 1, y2: 0 }, el("stop", { offset: "0%", "stop-color": c.trim, "stop-opacity": 0.95 }) + el("stop", { offset: "14%", "stop-color": c.trim, "stop-opacity": 0 })),
    el("linearGradient", { id: id("keyR"), x1: 1, y1: 0, x2: 0, y2: 0 }, el("stop", { offset: "0%", "stop-color": c.trim, "stop-opacity": 0.95 }) + el("stop", { offset: "14%", "stop-color": c.trim, "stop-opacity": 0 })),
  ].join(""));

  const hair = hairShapes(row, x, g, c);
  if (c.hairTip) { // "dipped": lower part of the hair takes the accent
    const tip = hairShapes(row, x, g, { ...c, hair: c.hairTip });
    hair.back = hair.back + el("g", { "clip-path": `url(#${id("tipClip")})`, opacity: 0.9 }, tip.back);
    hair.front = hair.front + el("g", { "clip-path": `url(#${id("tipClip")})`, opacity: 0.9 }, tip.front);
  }
  const tilt = Number(row.tilt) || 0; // chin up / down: whole head shifts and features slide
  const fxKind = String(row.fx || "none");
  const hd = head(row, x, g, c, f, id);

  const bg = layer("bg", el("rect", { x: 0, y: 0, width: 1024, height: 1024, fill: `url(#${id("sky")})` }) + scene(row, c, id, 0));
  const grid = layer("bgGrid", el("g", { opacity: 0.22 }, el("path", { d: "M0 700 L1024 700 M0 780 L1024 780 M0 880 L1024 880 M512 640 L120 1024 M512 640 L904 1024 M512 640 L300 1024 M512 640 L724 1024", stroke: c.trim, "stroke-width": 1.5, fill: "none" })));
  const bgFx = layer("bgFx", el("ellipse", { cx: rimX + litSide * 140, cy: 420, rx: 300, ry: 460, fill: c.trim, opacity: 0.34, filter: `url(#${id("soft")})` }) + el("ellipse", { cx: 512, cy: 520, rx: 420, ry: 380, fill: mix(c.mid, "#ffffff", 0.08), opacity: 0.35, filter: `url(#${id("soft")})` }));
  const aura = layer("aura", el("g", { opacity: 0.55 }, el("circle", { cx: 512, cy: 512, r: 400, fill: "none", stroke: c.trim, "stroke-width": 2, "stroke-dasharray": "120 480", opacity: 0.5 }) + el("circle", { cx: 512, cy: 512, r: 430, fill: "none", stroke: c.trim, "stroke-width": 1, "stroke-dasharray": "20 60", opacity: 0.35 })));
  const rim = layer("rimGlow", el("path", { d: hd.edge, fill: "none", stroke: c.trim, "stroke-width": 7, "stroke-linecap": "round", filter: `url(#${id("bloom")})` }) + el("path", { d: hd.edge, fill: "none", stroke: shade(c.trim, 0.45), "stroke-width": 2.5, "stroke-linecap": "round" }), { opacity: "0.85" });
  const torso = layer("torso", attire(row, x, c, wide, id));
  const trim2 = row.secondaryAccent || c.trim;
  const collarFx = layer("collarFx", el("g", { filter: `url(#${id("bloom")})` }, el("path", { d: litSide < 0 ? `M ${x - 360 + t} 1000 L ${x - 340 + t} 820 Q ${x - 300 + t} 740 ${x - 170 + t} 700` : `M ${x + 360 + t} 1000 L ${x + 340 + t} 820 Q ${x + 300 + t} 740 ${x + 170 + t} 700`, stroke: trim2, "stroke-width": 12, opacity: 0.8, fill: "none", "stroke-linecap": "round" })));
  const hairBack = layer("hairBack", hair.back);
  const headLayer = layer("head", el("g", { transform: tilt ? `translate(0 ${tilt * -18}) scale(1 ${tilt < 0 ? 1.04 : 0.97})` : undefined, "transform-origin": "512 440" }, hd.inner + layer("accessory", accessory(row, x, g, c, id))));
  const hairFront = layer("hairFront", hair.front + headwear(row, x, g, c));
  const rand = rng(hashStr(nonce + "p"));
  const particles = layer("particles", Array.from({ length: 18 }, () => el("circle", { cx: rand() * 1024, cy: rand() * 1024, r: 1.5 + rand() * 3, fill: c.trim, opacity: 0.2 + rand() * 0.5 })).join(""));
  const scan = layer("scanFx", el("rect", { x: 0, y: 480, width: 1024, height: 3, fill: c.trim, opacity: 0.35 }), { opacity: "0.12" });
  const fx = fxLayer(fxKind, c, id, nonce);
  const post = el("rect", { x: 0, y: 0, width: 1024, height: 1024, fill: `url(#${id("vig")})` }) + el("rect", { x: 0, y: 0, width: 1024, height: 1024, filter: `url(#${id("grain")})`, opacity: 0.45 });

  // rimGlow is the lit contour only. It does not trace or cover the face.
  const body = defs + bg + grid + bgFx + aura + hairBack + torso + collarFx + headLayer + rim + hairFront + particles + scan + fx + post;
  const sc = row.scale || {};
  const synthetic = String(row.species) === "robot" || String(row.species) === "skeletal";
  const attrs = { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 1024 1024", width: size, height: size, "data-asset": "PFP_PORTRAIT", "data-style": "lda-pfp-v2", "data-rig": "v3", "data-portrait": "neon-noir", "data-composite": "pure", "data-legacy-overlay": "0", "data-face-fill": synthetic ? "synthetic" : "noir", "data-pfp-style": row.styleId || "neon-competitive", "data-engine": "procedural-svg", "data-layered": "1", "data-signature": row.signature || "", "data-character-scale": sc.characterHeight, "data-face-scale": sc.faceHeight, "data-species": row.species, "data-face": row.faceKind, "data-age": row.age, "data-archetype": row.archetypeId, "aria-hidden": "true" };
  const open = "<svg" + Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => ` ${k}="${esc(v)}"`).join("") + ">";
  return open + body + "</svg>";
}

module.exports = { renderPfpV3, FACE_TOP, FACE_BOTTOM };
