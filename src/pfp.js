// pfp.js — Procedural square PFP portraits.
//
// There is no image-generation provider in this process. These portraits are
// deterministic SVG illustrations: one bust, one face, brand palette, dark
// premium background, controlled neon accent. The locked art direction is
// neon-competitive. The drawing engine stays lda-pfp-v2. Avatar sizes reuse
// the same paths. Only the root width and height change.

const { PFP_STYLE_ID } = require("./branding/stylePresets");
const { buildPfpPrompt } = require("./branding/buildPfpPrompt");

const PFP_STYLE_VERSION = "lda-pfp-v2";
const PFP_PROMPT_VERSION = "agent-pfp-v2";
const ASSET_TYPE = "PFP_PORTRAIT";
const MASTER_SIZE = 1024;
const AVATAR_SIZES = Object.freeze([48, 96, 160, 256, 320, 512]);
// Head + upper torso sit in this band. Face box is the readable bust crop.
const CHARACTER_TOP = 104;
const CHARACTER_BOTTOM = 882;
const FACE_TOP = 176;
const FACE_BOTTOM = 708;
const FACE_HALF = 220;
const TREATMENTS = Object.freeze(["standard", "expression", "darker", "cleaner", "minimal", "premium"]);
const ATTITUDES = Object.freeze([
  "SMUG", "STOIC", "MANIC", "SERENE", "PREDATORY", "MYSTERIOUS", "COLD", "PLAYFUL", "REGAL",
]);

const SKIN = Object.freeze({
  warm: ["#F0CDB4", "#D7A07C", "#A56B48", "#B85C56"],
  olive: ["#D2B08C", "#A67C52", "#6E4E34", "#9A5548"],
  deep: ["#A56B45", "#7A4A30", "#4A2C1C", "#6E3830"],
  porcelain: ["#F6E7DE", "#E2C2B4", "#B8897C", "#C96B6E"],
  ash: ["#E4DEEA", "#B7AEC4", "#7A7088", "#9A8498"],
  metal: ["#E6E9EE", "#B4BCC8", "#6E7886", "#8A94A4"],
  ember: ["#F0C2A4", "#C47A52", "#7A3E2C", "#B55248"],
});

function hashString(text) {
  let h = 2166136261;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function parseHex(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex || ""));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb) {
  return "#" + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");
}

function mix(a, b, t) {
  const A = parseHex(a);
  const B = parseHex(b);
  if (!A || !B) return parseHex(a) ? a : (parseHex(b) ? b : "#888888");
  const p = Math.max(0, Math.min(1, t));
  return toHex(A.map((c, i) => c + (B[i] - c) * p));
}

function shade(hex, t) {
  if (t >= 0) return mix(hex, "#FFFFFF", t);
  return mix(hex, "#000000", -t);
}

function luma(hex) {
  const rgb = parseHex(hex) || [0, 0, 0];
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

function colorDistance(a, b) {
  const A = parseHex(a);
  const B = parseHex(b);
  if (!A || !B) return 0;
  const dr = A[0] - B[0];
  const dg = A[1] - B[1];
  const db = A[2] - B[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function validHex(hex) {
  return parseHex(hex) ? String(hex).toUpperCase() : "";
}

function attr(obj) {
  return Object.keys(obj).filter((k) => obj[k] != null && obj[k] !== "").map((k) => `${k}="${obj[k]}"`).join(" ");
}

function el(name, obj, inner) {
  const open = `<${name} ${attr(obj)}`;
  if (inner == null) return `${open}/>`;
  return `${open}>${inner}</${name}>`;
}

function layer(name, inner, extra) {
  if (!inner) return "";
  return el("g", Object.assign({ "data-layer": name }, extra || {}), inner);
}

function skinKey(archetype, emblem, name) {
  const a = String(archetype || "").toUpperCase();
  const e = String(emblem || "").toUpperCase();
  if (/REAPER|PHANTOM|SPECTRAL|GHOST/.test(a) || /SKULL|HOURGLASS|HOUR/.test(e)) return "ash";
  if (/MACHINE/.test(a) || /ECLIPSE|GEAR/.test(e)) return "metal";
  if (/BEAST|PIRATE/.test(a) || /WOLF|FANG|SHARK|TOOTH/.test(e)) return "ember";
  return ["warm", "olive", "deep", "porcelain"][hashString(name || a) % 4];
}

function headwearFor(emblem, archetype, variation) {
  const e = String(emblem || "").toUpperCase();
  const a = String(archetype || "").toUpperCase();
  let family = ["swept", "cropped", "long", "crest"];
  if (/CROWN|LAUREL|KING/.test(e) || /EMPEROR|NOBLE|COMMANDER|IMPERIAL/.test(a)) family = ["crown", "laurel", "crest"];
  else if (/SKULL|HOUR|SCYTHE/.test(e) || /REAPER|PHANTOM|SPECTRAL/.test(a)) family = ["hood", "cowl", "long"];
  else if (/HELM|DAGGER|TOWER|SPEARHEAD/.test(e) || /WARLORD|DUELIST|ASSASSIN/.test(a)) family = ["helm", "cropped", "crest"];
  else if (/MASK|FOX|JESTER|BROKEN_MASK/.test(e) || /TRICKSTER|MADMAN/.test(a)) family = ["halfmask", "asymmetric", "swept"];
  else if (/WOLF|FANG|SHARK|TOOTH|SERPENT/.test(e) || /BEAST/.test(a)) family = ["ears", "wild", "cropped"];
  else if (/EYE|ORACLE|ECLIPSE|CRESCENT|OWL|SUN/.test(e) || /ORACLE|SORCERER|MONK/.test(a)) family = ["halo", "cowl", "hood"];
  return family[Math.abs(variation) % family.length];
}

function hairUnder(headwear) {
  if (headwear === "crown" || headwear === "laurel" || headwear === "halo") return "swept";
  if (headwear === "crest") return "cropped";
  if (headwear === "ears") return "wild";
  if (headwear === "asymmetric") return "asymmetric";
  if (headwear === "halfmask") return "swept";
  if (headwear === "hood" || headwear === "cowl" || headwear === "helm") return "none";
  return headwear;
}

function expressionOf(attitude, intensity) {
  const i = intensity;
  const table = {
    SMUG: { squint: 0.4 * i, wide: 0, brow: [18, -4], mouth: "smirk" },
    STOIC: { squint: 0.1, wide: 0, brow: [0, 0], mouth: "flat" },
    MANIC: { squint: 0, wide: 0.34 * i, brow: [16, -10], mouth: "grin" },
    SERENE: { squint: 0.14, wide: 0.06, brow: [6, 6], mouth: "smile" },
    PREDATORY: { squint: 0.36 * i, wide: 0, brow: [-8, -8], mouth: "tight", glow: 0.7 },
    MYSTERIOUS: { squint: 0.22, wide: 0, brow: [4, 12], mouth: "flat", wink: 0.5 * i, glow: 0.35 },
    COLD: { squint: 0.24, wide: 0, brow: [-6, -6], mouth: "flat" },
    PLAYFUL: { squint: 0.04, wide: 0.14 * i, brow: [22, 0], mouth: "smile" },
    REGAL: { squint: 0.08, wide: 0, brow: [8, 8], mouth: "smile" },
  };
  return table[attitude] || table.STOIC;
}

function buildRecipe(input) {
  const src = input && typeof input === "object" ? input : {};
  const visual = src.visual && typeof src.visual === "object" ? src.visual : {};
  const treatment = TREATMENTS.includes(src.treatment) ? src.treatment : "standard";
  const variation = Math.abs(Math.floor(Number(src.variation) || 0));
  const primary = validHex(visual.primaryColor) || "#101216";
  const secondary = validHex(visual.secondaryColor) || "#1F232A";
  const accent = validHex(visual.accentColor) || "#4AD7FF";
  const tone = skinKey(src.archetype, visual.emblem, src.name);
  let pack = SKIN[tone];
  const attitude = ATTITUDES.includes(visual.facialAttitude) ? visual.facialAttitude : "STOIC";
  const darker = treatment === "darker";
  const cleaner = treatment === "cleaner" || treatment === "minimal";
  const minimal = treatment === "minimal";
  const premium = treatment === "premium";
  // Neon only reads on a controlled dark field. Secondary stays a support
  // color; it does not lighten the backdrop.
  let edge = "#07080C";
  if (colorDistance(pack[0], edge) < 78) pack = SKIN.porcelain;
  if (colorDistance(pack[0], edge) < 78) edge = "#07080C";
  const hair = luma(primary) < 0.18 ? mix(primary, "#120E10", 0.4) : shade(primary, -0.28);
  const iris = tone === "ash"
    ? mix(accent, "#F7F4FF", 0.45)
    : (luma(shade(primary, -0.5)) < 0.2 ? shade(primary, -0.35) : "#241814");
  const forced = ["crown", "laurel", "crest", "hood", "cowl", "long", "helm", "cropped", "halfmask", "asymmetric", "swept", "ears", "wild", "halo"].includes(src.headwear)
    ? src.headwear
    : "";
  const headwear = forced || headwearFor(visual.emblem, src.archetype, variation);
  return {
    styleVersion: PFP_STYLE_VERSION,
    styleId: PFP_STYLE_ID,
    promptVersion: PFP_PROMPT_VERSION,
    treatment,
    variation,
    turn: (variation % 3) - 1,
    attitude,
    intensity: treatment === "expression" ? 1.7 : 1.2,
    headwear,
    hair: hairUnder(headwear),
    silhouette: visual.silhouette || "SLIM_ELEGANT",
    bodyLanguage: visual.bodyLanguage || "",
    motif: visual.backgroundMotif || "SIGNAL_HALO",
    lighting: visual.lightingStyle || "COOL_NEON_EDGE",
    emblem: visual.emblem || "",
    ornament: minimal ? 0.12 : cleaner ? 0.28 : Math.max(0, Math.min(1, Number(visual.ornamentationLevel) || 0.45)),
    darker,
    cleaner,
    minimal,
    premium,
    colors: {
      primary,
      secondary,
      accent,
      skin: pack[0],
      skinShadow: pack[1],
      skinDeep: pack[2],
      lip: mix(pack[3], "#241014", 0.42),
      sclera: tone === "ash" || tone === "metal" ? "#E7E4F2" : "#F6F1EA",
      hair,
      cloth: primary,
      clothDeep: shade(primary, -0.32),
      trim: accent,
      edge,
      mid: darker ? "#07080C" : mix("#0C0E14", secondary, 0.22),
      glow: darker ? mix("#0C0E14", accent, 0.12) : mix("#12141A", accent, 0.3),
      iris,
    },
    signature: signatureOf(headwear),
    signatureFeature: visual.signatureFeature || signatureOf(headwear),
    scale: compositionScale(),
    safeZone: {
      circle: 0.86,
      face: {
        x: (512 - FACE_HALF) / MASTER_SIZE,
        y: FACE_TOP / MASTER_SIZE,
        w: (FACE_HALF * 2) / MASTER_SIZE,
        h: (FACE_BOTTOM - FACE_TOP) / MASTER_SIZE,
      },
    },
    identity: {
      name: String(src.name || "").slice(0, 40),
      title: String(src.title || "").slice(0, 60),
      archetype: String(src.archetype || "").slice(0, 40),
    },
  };
}

const HOUSE_HEADWEAR = Object.freeze({
  dracula: "crown",
  caesar: "laurel",
  reaper: "hood",
  athena: "laurel",
  shark: "ears",
  oracle: "halo",
  fox: "halfmask",
  brutus: "helm",
  monk: "cowl",
  siren: "long",
  miser: "cropped",
  jester: "asymmetric",
});

function recipeFromBrand(brand) {
  const row = brand && typeof brand === "object" ? brand : {};
  return buildRecipe({
    name: row.name,
    title: row.title,
    archetype: row.archetype,
    visual: row.visualIdentity || {},
    variation: hashString(row.agentId || row.name) % 5,
    treatment: "standard",
    headwear: HOUSE_HEADWEAR[row.agentId] || "",
  });
}

function signatureOf(headwear) {
  const table = {
    crown: "CROWN",
    laurel: "LAUREL",
    crest: "CREST",
    hood: "HOOD",
    cowl: "COWL",
    long: "VEIL",
    helm: "HELM",
    cropped: "COLLAR",
    halfmask: "MASK",
    asymmetric: "HAIR",
    swept: "HAIR",
    ears: "HORNS",
    wild: "MANE",
    halo: "HALO",
  };
  return table[headwear] || "COLLAR";
}

function compositionScale() {
  return {
    characterHeight: Math.round(((CHARACTER_BOTTOM - CHARACTER_TOP) / MASTER_SIZE) * 1000) / 1000,
    faceHeight: Math.round(((FACE_BOTTOM - FACE_TOP) / MASTER_SIZE) * 1000) / 1000,
  };
}

function promptFor(recipe) {
  const row = recipe || {};
  const id = row.identity || {};
  const c = row.colors || {};
  const body = buildPfpPrompt({
    styleId: row.styleId || PFP_STYLE_ID,
    agent: {
      name: id.name || "Competitor",
      title: id.title || "",
      archetype: id.archetype || "",
      brand: {
        visualDNA: {
          silhouette: row.silhouette || "",
          facialAttitude: row.attitude || "",
          bodyLanguage: row.bodyLanguage || "",
          primaryColor: c.primary || "",
          secondaryColor: c.secondary || "",
          accentColor: c.accent || "",
          emblem: row.emblem || "",
          materials: [],
          backgroundMotif: row.motif || "",
          lightingStyle: row.lighting || "",
          signatureFeature: row.signatureFeature || row.signature || "",
        },
      },
    },
  });
  return `${body}\n\nRENDERER: procedural SVG, lda-pfp-v2. No external image model.`;
}

function facePath(x) {
  const top = FACE_TOP;
  const bot = FACE_BOTTOM;
  const mid = Math.round((top + bot) / 2);
  return `M ${x} ${top} C ${x + 188} ${top + 16} ${x + FACE_HALF + 8} ${mid - 70} ${x + FACE_HALF - 6} ${mid} C ${x + 198} ${mid + 110} ${x + 128} ${bot - 18} ${x} ${bot} C ${x - 128} ${bot - 18} ${x - 198} ${mid + 110} ${x - FACE_HALF + 6} ${mid} C ${x - FACE_HALF - 8} ${mid - 70} ${x - 188} ${top + 16} ${x} ${top} Z`;
}

function shoulderPath(x, silhouette) {
  const broad = silhouette === "BROAD_IMPOSING" || silhouette === "HEAVY_ARMORED";
  const slim = silhouette === "SLIM_ELEGANT" || silhouette === "TALL_SHARP" || silhouette === "ROBED_MYSTIC";
  const w = broad ? 460 : slim ? 320 : 390;
  const rise = silhouette === "ASYMMETRIC_CHAOTIC" ? 54 : 0;
  const chest = CHARACTER_BOTTOM - 70;
  if (silhouette === "MECHANICAL") {
    return `M ${x - w} 1024 L ${x - w + 28} ${chest + 40} L ${x - 130} ${chest - 40} L ${x - 64} ${chest + 10} L ${x + 64} ${chest + 10} L ${x + 130} ${chest - 40} L ${x + w - 28} ${chest + 40} L ${x + w} 1024 Z`;
  }
  return `M ${x - w - 20} 1024 L ${x - w} ${chest + 80} C ${x - w + 70} ${chest - 90 - rise} ${x - 150} ${chest - 20} ${x - 72} ${chest + 16} L ${x} ${chest + 48} L ${x + 72} ${chest + 16} C ${x + 150} ${chest - 20 + rise} ${x + w - 70} ${chest - 90} ${x + w} ${chest + 80} L ${x + w + 20} 1024 Z`;
}

function hairPath(kind, x, lean, color) {
  if (!kind || kind === "none") return "";
  if (kind === "cropped") {
    return el("path", { fill: color, d: `M ${x - 188} 390 C ${x - 200} 230 ${x - 80} 150 ${x} 146 C ${x + 90} 150 ${x + 200} 240 ${x + 186} 400 C ${x + 120} 300 ${x - 120} 300 ${x - 188} 390 Z` });
  }
  if (kind === "long") {
    return el("path", { fill: color, d: `M ${x - 40} 200 C ${x - 230} 220 ${x - 250} 420 ${x - 210} 620 C ${x - 180} 860 ${x - 80} 900 ${x - 20} 760 C ${x - 80} 560 ${x - 40} 420 ${x + 20} 340 C ${x + 180} 300 ${x + 210} 200 ${x + 40} 170 C ${x - 20} 150 ${x - 20} 170 ${x - 40} 200 Z` });
  }
  if (kind === "wild") {
    const spikes = [-180, -90, 0, 90, 170].map((dx, i) => {
      const px = x + dx + lean;
      const h = 150 + (i % 2) * 36;
      return `M ${px - 28} 300 L ${px} ${h} L ${px + 28} 300 Z`;
    }).join(" ");
    return el("path", { fill: color, d: `M ${x - 200} 420 C ${x - 160} 180 ${x + 160} 180 ${x + 200} 420 C ${x + 80} 280 ${x - 80} 280 ${x - 200} 420 Z ${spikes}` });
  }
  if (kind === "asymmetric") {
    return el("path", { fill: color, d: `M ${x - 40} 168 C ${x - 250} 140 ${x - 280} 360 ${x - 160} 390 C ${x - 80} 250 ${x + 40} 240 ${x + 190} 360 C ${x + 220} 180 ${x + 40} 120 ${x - 40} 168 Z M ${x + 150} 250 L ${x + 250} 120 L ${x + 210} 280 Z` });
  }
  const side = lean >= 0 ? 1 : -1;
  return el("path", {
    fill: color,
    d: `M ${x - 30 * side} 160 C ${x - 240} ${200 + lean} ${x - 220} 430 ${x - 170} 390 C ${x - 80} 250 ${x + 70} 240 ${x + 188} 400 C ${x + 230} 210 ${x + 60} 130 ${x - 30 * side} 160 Z`,
  });
}

function hoodPath(x) {
  const top = CHARACTER_TOP;
  return `M ${x} ${top} C ${x + 280} ${top + 30} ${x + 310} 360 ${x + 270} 580 C ${x + 230} 780 ${x + 130} 860 ${x} 900 C ${x - 130} 860 ${x - 230} 780 ${x - 270} 580 C ${x - 310} 360 ${x - 280} ${top + 30} ${x} ${top} Z`;
}

function crownPath(x) {
  const tip = CHARACTER_TOP + 8;
  return `M ${x - 168} 250 L ${x - 132} ${tip + 36} L ${x - 78} 210 L ${x} ${tip} L ${x + 72} 198 L ${x + 124} ${tip + 28} L ${x + 172} 250 L ${x + 146} 292 L ${x - 146} 292 Z`;
}

function helmPath(x) {
  return `M ${x - 210} 400 C ${x - 228} ${CHARACTER_TOP + 80} ${x - 90} ${CHARACTER_TOP + 20} ${x} ${CHARACTER_TOP + 12} C ${x + 110} ${CHARACTER_TOP + 24} ${x + 230} ${CHARACTER_TOP + 90} ${x + 212} 400 L ${x + 156} 362 C ${x + 70} 300 ${x - 70} 300 ${x - 156} 362 Z`;
}

function motifParts(motif, colors, cleaner) {
  const opacity = cleaner ? 0.08 : 0.22;
  const fill = colors.trim;
  const ring = el("circle", { cx: 512, cy: 420, r: 286, fill: "none", stroke: fill, "stroke-width": 10, opacity });
  const bloom = el("circle", { cx: 512, cy: 400, r: 180, fill, opacity: cleaner ? 0.04 : 0.1 });
  const dots = [];
  const n = cleaner ? 0 : 5;
  const seed = hashString(motif || "SIGNAL_HALO");
  for (let i = 0; i < n; i++) {
    const ang = ((seed + i * 97) % 360) * Math.PI / 180;
    const rad = 250 + (seed + i * 13) % 48;
    dots.push(el("circle", {
      cx: Math.round(512 + Math.cos(ang) * rad),
      cy: Math.round(390 + Math.sin(ang) * rad * 0.7),
      r: 4 + (i % 3),
      fill,
      opacity: 0.85,
    }));
  }
  return { fx: ring + bloom, particles: dots.join("") };
}

function neonGrid(colors) {
  const stroke = colors.trim;
  const lines = [
    el("circle", { cx: 512, cy: 430, r: 248, fill: "none", stroke, "stroke-width": 2, opacity: "0.7" }),
    el("circle", { cx: 512, cy: 430, r: 332, fill: "none", stroke, "stroke-width": 1.5, opacity: "0.45" }),
  ];
  for (let i = 1; i <= 3; i++) {
    const y = 210 + i * 170;
    lines.push(el("line", { x1: 96, y1: y, x2: 928, y2: y, stroke, "stroke-width": 2, opacity: "0.4" }));
  }
  return lines.join("");
}

function eyeParts(cx, cy, squint, wide, colors, glow) {
  const rx = 108;
  const ry = Math.max(46, 78 * (1 + wide) * (1 - Math.min(0.4, squint)));
  const ix = 50;
  const iy = Math.max(34, ry * 0.72);
  const open = [
    el("ellipse", { cx, cy, rx: rx + 12, ry: ry + 10, fill: "#1A1412" }),
    el("ellipse", { cx, cy, rx, ry, fill: colors.sclera }),
    el("ellipse", { cx, cy: cy + 2, rx: ix, ry: iy, fill: colors.iris }),
    el("ellipse", { cx, cy: cy + 2, rx: ix * 0.62, ry: iy * 0.62, fill: colors.trim, opacity: glow ? Math.min(0.85, glow) : 0.42 }),
  ].join("");
  const pupils = [
    el("ellipse", { cx, cy: cy + 3, rx: 18, ry: 18, fill: "#120E0C" }),
    el("ellipse", { cx: cx - 18, cy: cy - 14, rx: 11, ry: 11, fill: "#F8F6F2" }),
  ].join("");
  const lidTop = Math.round(cy - ry * 0.08);
  const lidBot = Math.round(cy + ry * 0.42);
  const closed = [
    el("path", {
      fill: colors.skin,
      d: `M ${cx - rx} ${cy + 8} Q ${cx} ${lidTop} ${cx + rx} ${cy + 8} Q ${cx} ${lidBot} ${cx - rx} ${cy + 8} Z`,
    }),
    el("path", {
      fill: "#1A1412",
      d: `M ${cx - rx + 10} ${cy + 6} Q ${cx} ${cy - 8} ${cx + rx - 10} ${cy + 6} Q ${cx} ${cy + 18} ${cx - rx + 10} ${cy + 6} Z`,
    }),
  ].join("");
  return { open, pupils, closed };
}

function browMarkup(cx, cy, raise, angry) {
  const y = cy - raise;
  const inner = angry ? 16 : 0;
  return el("path", {
    fill: "#1A1412",
    d: `M ${cx - 78} ${y + 10 + inner} C ${cx - 20} ${y - 26} ${cx + 36} ${y - 20} ${cx + 82} ${y + inner} C ${cx + 36} ${y + 12} ${cx - 16} ${y + 16} ${cx - 78} ${y + 34 + inner} Z`,
  });
}

function mouthMarkup(cx, cy, kind, lip, scale) {
  const s = scale > 1 ? scale : 1;
  const p = (dx, dy) => `${Math.round(cx + dx * s)} ${Math.round(cy + dy * s)}`;
  if (kind === "grin") {
    return el("path", { fill: lip, d: `M ${p(-128, 0)} Q ${p(0, 108)} ${p(128, 0)} Q ${p(0, 34)} ${p(-128, 0)} Z` });
  }
  if (kind === "smile") {
    return el("path", { fill: lip, d: `M ${p(-88, 0)} Q ${p(0, 64)} ${p(88, 0)} Q ${p(0, 18)} ${p(-88, 0)} Z` });
  }
  if (kind === "smirk") {
    return el("path", { fill: lip, d: `M ${p(-48, 10)} Q ${p(16, -28)} ${p(104, 2)} Q ${p(30, 52)} ${p(-48, 10)} Z` });
  }
  if (kind === "tight") {
    return el("path", { fill: lip, d: `M ${p(-62, 0)} H ${Math.round(cx + 48 * s)} Q ${p(48, 28)} ${p(0, 28)} Q ${p(-62, 28)} ${p(-62, 0)} Z` });
  }
  return el("path", { fill: lip, d: `M ${p(-84, -6)} H ${Math.round(cx + 84 * s)} Q ${p(84, 30)} ${p(0, 30)} Q ${p(-84, 30)} ${p(-84, -6)} Z` });
}

function leaves(x, y, color) {
  const bits = [];
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const ly = y + t * 150;
    const lx = x - 150 + Math.sin(t * Math.PI) * 36;
    bits.push(el("ellipse", { cx: Math.round(lx), cy: Math.round(ly), rx: 16, ry: 28, fill: color, transform: `rotate(${-40 + i * 8} ${Math.round(lx)} ${Math.round(ly)})` }));
    const rx = x + 150 - Math.sin(t * Math.PI) * 36;
    bits.push(el("ellipse", { cx: Math.round(rx), cy: Math.round(ly), rx: 16, ry: 28, fill: color, transform: `rotate(${40 - i * 8} ${Math.round(rx)} ${Math.round(ly)})` }));
  }
  return bits.join("");
}

function renderPfp(recipe, opts) {
  const row = recipe && recipe.colors ? recipe : buildRecipe(recipe);
  const size = normalizeSize(opts && opts.size);
  const nonce = String((opts && opts.nonce) || "pfp").replace(/[^a-zA-Z0-9_-]/g, "") || "pfp";
  const c = row.colors;
  const x = 512 + row.turn * 18;
  const lean = row.turn * 36;
  const face = expressionOf(row.attitude, row.intensity || 1);
  const id = (name) => `${nonce}_${name}`;
  const neonLight = /NEON|RIM|GLOW|EDGE/.test(String(row.lighting || ""));
  const rim = neonLight || row.premium ? 22 : 16;
  const keyX = row.turn >= 0 ? x - 70 : x + 70;
  const beard = !row.cleaner && (row.attitude === "REGAL" || row.attitude === "STOIC") && (row.headwear === "crown" || row.headwear === "laurel");
  const pauldrons = row.silhouette === "HEAVY_ARMORED" || row.silhouette === "MECHANICAL";
  const defs = [
    el("radialGradient", { id: id("bg"), cx: "50%", cy: "40%", r: "68%" }, [
      el("stop", { offset: "0%", "stop-color": c.glow }),
      el("stop", { offset: "58%", "stop-color": c.mid }),
      el("stop", { offset: "100%", "stop-color": c.edge }),
    ].join("")),
    el("radialGradient", { id: id("vig"), cx: "50%", cy: "46%", r: "62%" }, [
      el("stop", { offset: "58%", "stop-color": "#000000", "stop-opacity": "0" }),
      el("stop", { offset: "100%", "stop-color": "#000000", "stop-opacity": row.darker ? "0.78" : "0.66" }),
    ].join("")),
    el("linearGradient", { id: id("scan"), x1: "0", y1: "0", x2: "0", y2: "1" }, [
      el("stop", { offset: "0%", "stop-color": c.trim, "stop-opacity": "0" }),
      el("stop", { offset: "47%", "stop-color": c.trim, "stop-opacity": "0" }),
      el("stop", { offset: "50%", "stop-color": c.trim, "stop-opacity": "0.9" }),
      el("stop", { offset: "53%", "stop-color": c.trim, "stop-opacity": "0" }),
      el("stop", { offset: "100%", "stop-color": c.trim, "stop-opacity": "0" }),
    ].join("")),
    el("linearGradient", { id: id("skin"), x1: keyX, y1: "280", x2: row.turn >= 0 ? x + 180 : x - 180, y2: "700", gradientUnits: "userSpaceOnUse" }, [
      el("stop", { offset: "0%", "stop-color": shade(c.skin, 0.14) }),
      el("stop", { offset: "48%", "stop-color": c.skin }),
      el("stop", { offset: "100%", "stop-color": c.skinShadow }),
    ].join("")),
    el("clipPath", { id: id("face") }, el("path", { d: facePath(x) })),
    el("filter", { id: id("rim"), x: "-20%", y: "-20%", width: "140%", height: "140%" }, el("feGaussianBlur", { stdDeviation: "6" })),
  ].join("");
  const eyesY = 430;
  const mouthY = 575;
  const leftEye = eyeParts(x - 118, eyesY, face.squint + (face.wink || 0), face.wide, c, face.glow || 0);
  const rightEye = eyeParts(x + 118, eyesY, face.squint, face.wide, c, face.glow || 0);
  const features = [
    el("ellipse", { cx: x, cy: 650, rx: 120, ry: 52, fill: c.skinDeep, opacity: "0.28" }),
    el("path", { fill: c.skinShadow, opacity: "0.55", d: `M ${x - 16} 500 L ${x + 18} 500 L ${x + 8} 560 L ${x - 8} 560 Z` }),
    layer("eyesOpen", leftEye.open + rightEye.open),
    layer("pupils", leftEye.pupils + rightEye.pupils),
    layer("eyesClosed", leftEye.closed + rightEye.closed, { opacity: "0" }),
    browMarkup(x - 118, 340, face.brow[0] * (row.intensity || 1), face.brow[0] < 0),
    browMarkup(x + 118, 340, face.brow[1] * (row.intensity || 1), face.brow[1] < 0),
    mouthMarkup(x + (face.mouth === "smirk" ? 8 : 0), mouthY, face.mouth, c.lip, row.intensity),
    beard ? el("path", { fill: c.hair, d: `M ${x - 70} 650 Q ${x} 760 ${x + 78} 646 Q ${x + 40} 700 ${x} 710 Q ${x - 36} 700 ${x - 70} 650 Z` }) : "",
  ].join("");
  const ears = [
    el("ellipse", { cx: x - 214, cy: 500, rx: 30, ry: 46, fill: c.skinShadow }),
    el("ellipse", { cx: x + 214, cy: 500, rx: 30, ry: 46, fill: c.skin }),
  ].join("");
  const beast = row.headwear === "ears" ? [
    el("path", { fill: c.hair, d: `M ${x - 168} 250 L ${x - 230} ${CHARACTER_TOP} L ${x - 70} 220 Z` }),
    el("path", { fill: c.hair, d: `M ${x + 168} 250 L ${x + 240} ${CHARACTER_TOP - 6} L ${x + 78} 220 Z` }),
    el("path", { fill: c.skin, d: `M ${x - 150} 228 L ${x - 198} ${CHARACTER_TOP + 36} L ${x - 96} 214 Z` }),
    el("path", { fill: c.skin, d: `M ${x + 150} 228 L ${x + 206} ${CHARACTER_TOP + 30} L ${x + 100} 214 Z` }),
  ].join("") : "";
  const wear = [];
  if (row.headwear === "hood" || row.headwear === "cowl") {
    wear.push(el("path", { fill: luma(c.cloth) < 0.12 ? mix(c.trim, "#120814", 0.72) : c.clothDeep, stroke: c.trim, "stroke-width": 18, d: hoodPath(x) }));
  }
  if (row.headwear === "halo") {
    wear.push(el("ellipse", { cx: x, cy: 430, rx: 310, ry: 250, fill: "none", stroke: c.trim, "stroke-width": 28, opacity: "0.9" }));
    wear.push(el("ellipse", { cx: x, cy: CHARACTER_TOP + 40, rx: 150, ry: 28, fill: "none", stroke: c.trim, "stroke-width": 16, opacity: "0.85" }));
  }
  const front = [];
  if (row.hair && row.hair !== "none") front.push(hairPath(row.hair, x, lean, c.hair));
  if (row.headwear === "crown") front.push(el("path", { fill: c.trim, d: crownPath(x) }), el("path", { fill: shade(c.trim, -0.35), d: `M ${x - 132} 286 H ${x + 132} V 312 H ${x - 132} Z` }));
  if (row.headwear === "laurel") front.push(leaves(x, 180, mix(c.trim, "#7FA06A", 0.35)));
  if (row.headwear === "helm") front.push(el("path", { fill: mix(c.trim, c.clothDeep, 0.45), d: helmPath(x) }));
  if (row.headwear === "crest") front.push(el("path", { fill: c.trim, d: `M ${x - 16} 168 L ${x} 96 L ${x + 22} 190 L ${x - 8} 186 Z` }));
  if (row.headwear === "halfmask") {
    front.push(el("path", { fill: c.clothDeep, opacity: "0.92", d: `M ${x + 8} 500 C ${x + 40} 560 ${x + 150} 540 ${x + 176} 610 L ${x + 140} 650 C ${x + 40} 630 ${x - 10} 560 ${x + 8} 500 Z` }));
  }
  if (row.headwear === "cowl") {
    front.push(el("path", { fill: c.cloth, d: `M ${x - 120} 700 Q ${x} 640 ${x + 120} 700 Q ${x} 780 ${x - 120} 700 Z` }));
  }
  const collar = row.minimal ? "" : el("path", {
    fill: c.trim,
    opacity: "0.92",
    d: `M ${x - 150} 760 L ${x} 860 L ${x + 156} 748 L ${x + 86} 900 L ${x} 868 L ${x - 86} 908 Z`,
  });
  const gem = row.premium && !row.minimal
    ? el("path", { fill: c.trim, d: `M ${x} 868 L ${x + 14} 886 L ${x} 904 L ${x - 14} 886 Z` })
    : "";
  const plates = pauldrons ? [
    el("ellipse", { cx: x - 230, cy: 860, rx: 90, ry: 48, fill: shade(c.cloth, 0.12) }),
    el("ellipse", { cx: x + 230, cy: 860, rx: 90, ry: 48, fill: shade(c.cloth, -0.08) }),
  ].join("") : "";
  const motif = motifParts(row.motif, c, row.cleaner);
  const rimGlow = [
    el("path", { d: facePath(x), fill: "none", stroke: c.trim, "stroke-width": rim + 30, opacity: "0.95", filter: `url(#${id("rim")})` }),
    el("path", { d: shoulderPath(x, row.silhouette), fill: "none", stroke: c.trim, "stroke-width": 22, opacity: "0.7", filter: `url(#${id("rim")})` }),
  ].join("");
  const torso = [
    plates,
    el("path", { fill: c.cloth, d: shoulderPath(x, row.silhouette) }),
    el("path", { fill: shade(c.cloth, 0.08), d: `M ${x - 78} 760 L ${x + 78} 760 L ${x + 96} 900 L ${x - 96} 900 Z` }),
    el("path", { fill: c.skinShadow, d: `M ${x - 58} 690 L ${x + 58} 690 L ${x + 46} 860 L ${x - 46} 860 Z` }),
    el("path", { d: shoulderPath(x, row.silhouette), fill: "none", stroke: c.trim, "stroke-width": 16, opacity: "0.82" }),
  ].join("");
  const head = [
    ears,
    beast,
    el("g", { "clip-path": `url(#${id("face")})` }, [
      el("path", { fill: `url(#${id("skin")})`, d: facePath(x) }),
      el("ellipse", { cx: keyX, cy: 400, rx: 140, ry: 180, fill: "#FFFFFF", opacity: row.darker ? "0.06" : "0.14" }),
      features,
    ].join("")),
    el("path", { d: facePath(x), fill: "none", stroke: c.trim, "stroke-width": rim + 16, opacity: "0.45", filter: `url(#${id("rim")})` }),
    el("path", { d: facePath(x), fill: "none", stroke: c.trim, "stroke-width": rim, opacity: row.darker ? "0.55" : "0.9" }),
    layer("hairFront", front.join("")),
  ].join("");
  const body = [
    layer("bg", el("rect", { width: 1024, height: 1024, fill: `url(#${id("bg")})` })),
    layer("bgGrid", neonGrid(c), { opacity: row.cleaner ? "0.1" : "0.22" }),
    layer("bgFx", motif.fx),
    layer("particles", motif.particles, { opacity: "0.52" }),
    layer("aura", [
      el("ellipse", { cx: 512, cy: 410, rx: 290, ry: 240, fill: c.trim, opacity: "0.46" }),
      el("ellipse", { cx: 512, cy: 760, rx: 340, ry: 160, fill: c.primary, opacity: "0.28" }),
    ].join(""), { opacity: row.cleaner ? "0.34" : "0.7" }),
    el("rect", { width: 1024, height: 1024, fill: `url(#${id("vig")})` }),
    layer("hairBack", wear.join("")),
    layer("torso", torso),
    layer("head", head),
    layer("rimGlow", rimGlow, { opacity: "0.78" }),
    layer("scanFx", el("rect", { x: 0, y: 0, width: 1024, height: 1024, fill: `url(#${id("scan")})` }), { opacity: row.cleaner ? "0.05" : "0.12" }),
    layer("collarFx", collar + gem),
  ].join("");
  const scale = compositionScale();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="${size}" height="${size}" data-asset="${ASSET_TYPE}" data-style="${PFP_STYLE_VERSION}" data-pfp-style="${row.styleId || PFP_STYLE_ID}" data-engine="procedural-svg" data-layered="1" data-signature="${row.signature || "COLLAR"}" data-character-scale="${scale.characterHeight}" data-face-scale="${scale.faceHeight}" aria-hidden="true"><defs>${defs}</defs>${body}</svg>`;
}

function normalizeSize(value) {
  const size = Number(value);
  if (size === MASTER_SIZE || AVATAR_SIZES.includes(size)) return size;
  return MASTER_SIZE;
}

function qualityCheck(recipe, svg) {
  const reasons = [];
  const face = recipe && recipe.safeZone && recipe.safeZone.face;
  if (!svg || !/viewBox="0 0 1024 1024"/.test(svg)) reasons.push("not_square");
  if (svg && /<text[\s>]|<image[\s>]|script|foreignObject/i.test(svg)) reasons.push("clutter");
  if (!face || face.h < 0.32 || face.w < 0.34) reasons.push("face_small");
  else {
    const cx = face.x + face.w / 2;
    const cy = face.y + face.h / 2;
    if (Math.hypot(cx - 0.5, cy - 0.5) > 0.2) reasons.push("face_off_center");
    const radius = (recipe.safeZone.circle || 0.82) / 2;
    const corners = [
      [face.x, face.y],
      [face.x + face.w, face.y],
      [face.x, face.y + face.h],
      [face.x + face.w, face.y + face.h],
    ];
    if (corners.some(([px, py]) => Math.hypot(px - 0.5, py - 0.5) > radius + 0.02)) reasons.push("outside_safe_zone");
  }
  const colors = (recipe && recipe.colors) || {};
  if (colorDistance(colors.skin, colors.edge) < 70) reasons.push("low_contrast");
  const scale = (recipe && recipe.scale) || compositionScale();
  if (!(scale.characterHeight >= 0.65 && scale.characterHeight <= 0.82)) reasons.push("character_scale");
  if (!(scale.faceHeight >= 0.45 && scale.faceHeight <= 0.7)) reasons.push("face_scale");
  if (svg && (!svg.includes(String(FACE_TOP)) || !svg.includes(String(FACE_BOTTOM)))) reasons.push("face_scale");
  if (svg && !/data-style="lda-pfp-v2"/.test(svg)) reasons.push("style_version");
  return { ok: reasons.length === 0, reasons };
}

function validatePfpMetadata({ width, height, fileSize } = {}) {
  const errors = [];
  if (width !== height) errors.push("not_square");
  if (!(width >= 768)) errors.push("resolution_too_low");
  if (fileSize != null && fileSize < 800) errors.push("suspiciously_small");
  return { ok: errors.length === 0, errors };
}

function measureFaceScale(svg) {
  const character = /data-character-scale="([0-9.]+)"/.exec(svg || "");
  const face = /data-face-scale="([0-9.]+)"/.exec(svg || "");
  return {
    characterHeight: character ? Number(character[1]) : 0,
    faceHeight: face ? Number(face[1]) : 0,
  };
}

function assetUrls(agentId) {
  const base = `/api/show/agents/${encodeURIComponent(agentId)}/pfp.svg`;
  const sizes = {};
  for (const n of AVATAR_SIZES) sizes[String(n)] = `${base}?size=${n}`;
  return { master: base, avatar: sizes["512"], sizes };
}

function pathData(svg) {
  return [...String(svg || "").matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]).join("|");
}

module.exports = {
  PFP_STYLE_VERSION,
  PFP_STYLE_ID,
  PFP_PROMPT_VERSION,
  ASSET_TYPE,
  MASTER_SIZE,
  AVATAR_SIZES,
  TREATMENTS,
  buildRecipe,
  recipeFromBrand,
  renderPfp,
  qualityCheck,
  validatePfpMetadata,
  measureFaceScale,
  compositionScale,
  promptFor,
  assetUrls,
  pathData,
  colorDistance,
};
