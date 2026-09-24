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
  bone: ["#E7E0D6", "#C8BDB0", "#8A8078", "#6E645C"],
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
  const look = src.look && typeof src.look === "object"
    ? src.look
    : (visual.creationLook && typeof visual.creationLook === "object" ? visual.creationLook : null);
  let primary = validHex(visual.primaryColor) || "#101216";
  let secondary = validHex(visual.secondaryColor) || "#1F232A";
  let accent = validHex(visual.accentColor) || "#4AD7FF";
  if (look && validHex(look.primary)) primary = validHex(look.primary);
  if (look && validHex(look.secondary)) secondary = validHex(look.secondary);
  if (look && validHex(look.accent)) accent = validHex(look.accent);
  const tone = look && look.skin && SKIN[look.skin] ? look.skin : skinKey(src.archetype, visual.emblem, src.name);
  let pack = SKIN[tone];
  let attitude = ATTITUDES.includes(visual.facialAttitude) ? visual.facialAttitude : "STOIC";
  if (look && ATTITUDES.includes(look.attitude)) attitude = look.attitude;
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
  const forced = ["crown", "laurel", "crest", "hood", "cowl", "long", "helm", "cropped", "halfmask", "asymmetric", "swept", "ears", "wild", "halo", "cap", "visor", "bandana", "headband", "none"].includes(src.headwear)
    ? src.headwear
    : "";
  let headwear = forced || headwearFor(visual.emblem, src.archetype, variation);
  if (look && look.headwear) headwear = String(look.headwear);
  const hairColor = look && look.hairTint === "grey" ? "#C5CAD1" : hair;
  const turn = look && Number.isInteger(Number(look.turn))
    ? Math.max(-1, Math.min(1, Number(look.turn)))
    : (variation % 3) - 1;
  let intensity = treatment === "expression" ? 1.7 : 1.2;
  if (look && look.intensity && treatment !== "expression") intensity = Number(look.intensity) || intensity;
  return {
    styleVersion: PFP_STYLE_VERSION,
    styleId: PFP_STYLE_ID,
    promptVersion: PFP_PROMPT_VERSION,
    treatment,
    variation,
    turn,
    attitude,
    intensity,
    headwear,
    hair: look && look.hair ? look.hair : hairUnder(headwear),
    silhouette: (look && look.silhouette) || visual.silhouette || "SLIM_ELEGANT",
    bodyLanguage: (look && look.bodyLanguage) || visual.bodyLanguage || "",
    motif: (look && look.motif) || visual.backgroundMotif || "SIGNAL_HALO",
    lighting: (look && look.lighting) || visual.lightingStyle || "COOL_NEON_EDGE",
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
      hair: hairColor,
      cloth: primary,
      clothDeep: shade(primary, -0.32),
      trim: accent,
      edge,
      mid: darker ? "#07080C" : mix("#0C0E14", secondary, 0.22),
      glow: darker ? mix("#0C0E14", accent, 0.12) : mix("#12141A", accent, 0.3),
      iris,
    },
    signature: signatureOf(headwear),
    signatureFeature: (look && look.signatureFeature) || visual.signatureFeature || signatureOf(headwear),
    look: look || null,
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
  const visual = row.visualIdentity || {};
  return buildRecipe({
    name: row.name,
    title: row.title,
    archetype: row.archetype,
    visual,
    variation: hashString(row.agentId || row.name) % 5,
    treatment: "standard",
    headwear: HOUSE_HEADWEAR[row.agentId] || "",
    look: visual.creationLook || null,
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

function facePath(x, look) {
  const top = FACE_TOP;
  const bot = FACE_BOTTOM;
  const mid = Math.round((top + bot) / 2);
  if (!look || !look.face || look.face === "classic") {
    return `M ${x} ${top} C ${x + 188} ${top + 16} ${x + FACE_HALF + 8} ${mid - 70} ${x + FACE_HALF - 6} ${mid} C ${x + 198} ${mid + 110} ${x + 128} ${bot - 18} ${x} ${bot} C ${x - 128} ${bot - 18} ${x - 198} ${mid + 110} ${x - FACE_HALF + 6} ${mid} C ${x - FACE_HALF - 8} ${mid - 70} ${x - 188} ${top + 16} ${x} ${top} Z`;
  }
  const jawN = Math.max(-0.6, Math.min(0.85, Number(look.jaw) || 0));
  const profiles = {
    sharp: [150, 164, 92, 22],
    wide: [214, 240, 214, 8],
    round: [200, 228, 206, 48],
    oval: [148, 156, 100, 34],
    angular: [186, 150, 132, 6],
    snout: [160, 148, 64, 78],
    skull: [170, 132, 150, 4],
    synthetic: [196, 196, 176, 4],
    weathered: [164, 158, 124, 18],
    exaggerated: [210, 236, 160, 42],
    predatory: [198, 176, 148, 10],
  };
  const row = profiles[look.face] || profiles.sharp;
  const brow = row[0];
  const cheek = row[1] + Math.round(jawN * 36);
  const jawW = Math.max(48, row[2] + Math.round(jawN * 48));
  const chin = row[3];
  if (look.face === "angular" || look.face === "synthetic" || look.face === "skull") {
    return `M ${x} ${top} L ${x + brow} ${top + 36} L ${x + cheek} ${mid - 40} L ${x + jawW} ${mid + 80} L ${x + chin} ${bot} L ${x - chin} ${bot} L ${x - jawW} ${mid + 80} L ${x - cheek} ${mid - 40} L ${x - brow} ${top + 36} Z`;
  }
  return `M ${x} ${top} C ${x + brow} ${top + 20} ${x + cheek} ${mid - 80} ${x + cheek} ${mid} C ${x + cheek} ${mid + 120} ${x + jawW} ${bot - chin} ${x} ${bot} C ${x - jawW} ${bot - chin} ${x - cheek} ${mid + 120} ${x - cheek} ${mid} C ${x - cheek} ${mid - 80} ${x - brow} ${top + 20} ${x} ${top} Z`;
}

function shoulderForLook(x, look) {
  const chest = CHARACTER_BOTTOM - 70;
  const pose = look.pose || "upright";
  const kind = look.shoulder || "structured";
  if (kind === "mechanical") {
    const w = 480;
    return `M ${x - w} 1024 L ${x - w + 16} ${chest + 10} L ${x - 160} ${chest - 80} L ${x - 72} ${chest - 8} L ${x + 72} ${chest - 8} L ${x + 160} ${chest - 80} L ${x + w - 16} ${chest + 10} L ${x + w} 1024 Z`;
  }
  let w = 360;
  let rise = 0;
  let drop = 0;
  if (kind === "slim" || kind === "hooded") w = 286;
  if (kind === "athletic") w = 446;
  if (kind === "broad") w = 510;
  if (kind === "heavy") { w = 540; drop = 36; }
  if (kind === "relaxed") { w = 410; drop = 28; }
  if (kind === "asymmetric") { w = 420; rise = 96; }
  if (pose === "coiled") rise += 34;
  if (pose === "forward") rise += 18;
  if (pose === "relaxed") drop += 22;
  return `M ${x - w - 24} 1024 L ${x - w} ${chest + 70 + drop} C ${x - w + 60} ${chest - 100 - rise} ${x - 160} ${chest - 30} ${x - 78} ${chest + 8} L ${x} ${chest + 36 + drop} L ${x + 78} ${chest + 8} C ${x + 160} ${chest - 10 + rise} ${x + w - 50} ${chest - 120} ${x + w} ${chest + 64} L ${x + w + 24} 1024 Z`;
}

function shoulderPath(x, silhouette, look) {
  if (look && look.shoulder) return shoulderForLook(x, look);
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
  if (kind === "crest") {
    return el("path", { fill: color, d: `M ${x - 170} 400 C ${x - 140} 250 ${x + 140} 250 ${x + 170} 400 C ${x + 70} 320 ${x - 70} 320 ${x - 170} 400 Z M ${x - 26} 260 L ${x} 128 L ${x + 26} 260 Z` });
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

function lookToken(value) {
  return String(value || "").replace(/[^a-z0-9_-]/gi, "");
}

function wardrobeMarkup(x, look, c) {
  const w = look.wardrobe;
  const trim = c.trim;
  const deep = c.clothDeep;
  if (w === "suit" || w === "business" || w === "luxury") {
    const spread = w === "luxury" ? 46 : w === "business" ? 16 : 28;
    const lapel = `M ${x - 176} 790 L ${x - 18} 990 L ${x - spread} 1024 L ${x - 220} 900 Z M ${x + 176} 790 L ${x + 18} 990 L ${x + spread} 1024 L ${x + 220} 900 Z`;
    const tie = w === "luxury"
      ? `M ${x - 40} 850 L ${x} 990 L ${x + 40} 850 L ${x + 18} 1024 L ${x - 18} 1024 Z`
      : `M ${x - 18} 860 L ${x} 910 L ${x + 18} 860 L ${x + 24} 1024 L ${x - 24} 1024 Z`;
    return el("path", { fill: deep, d: lapel }) + el("path", { fill: trim, d: tie });
  }
  if (w === "jacket") {
    return el("path", { fill: deep, d: `M ${x - 230} 790 L ${x - 70} 870 L ${x - 130} 1024 L ${x - 270} 1024 Z M ${x + 230} 790 L ${x + 70} 870 L ${x + 130} 1024 L ${x + 270} 1024 Z` })
      + el("path", { fill: trim, d: `M ${x - 10} 870 H ${x + 10} V 1024 H ${x - 10} Z` });
  }
  if (w === "jersey") {
    return el("path", { fill: trim, d: `M ${x - 220} 890 H ${x + 220} V 948 H ${x - 220} Z` })
      + el("path", { fill: "none", stroke: trim, "stroke-width": 18, d: `M ${x - 78} 790 Q ${x} 870 ${x + 78} 790` });
  }
  if (w === "casual") {
    return el("path", { fill: shade(c.cloth, 0.18), d: `M ${x - 96} 800 Q ${x} 910 ${x + 96} 800 L ${x + 74} 1024 L ${x - 74} 1024 Z` });
  }
  if (w === "tactical") {
    return el("path", { fill: deep, d: `M ${x - 190} 810 H ${x + 190} V 1024 H ${x - 190} Z M ${x - 160} 860 H ${x - 46} V 990 H ${x - 160} Z M ${x + 46} 860 H ${x + 160} V 990 H ${x + 46} Z` })
      + el("path", { fill: trim, d: `M ${x - 210} 830 H ${x + 210} V 854 H ${x - 210} Z` });
  }
  if (w === "fashion") {
    return el("path", { fill: trim, opacity: "0.9", d: `M ${x - 30} 750 C ${x - 200} 900 ${x - 80} 1024 ${x + 30} 1024 C ${x + 110} 860 ${x + 50} 780 ${x - 30} 750 Z` });
  }
  if (w === "coat" || w === "rugged") {
    const high = `M ${x - 160} 690 L ${x - 36} 830 L ${x - 90} 1024 L ${x - 250} 1024 L ${x - 210} 760 Z M ${x + 160} 690 L ${x + 36} 830 L ${x + 90} 1024 L ${x + 250} 1024 L ${x + 210} 760 Z`;
    const straps = w === "rugged"
      ? el("path", { fill: trim, d: `M ${x - 190} 880 L ${x + 170} 950 L ${x + 156} 982 L ${x - 204} 912 Z M ${x - 170} 970 L ${x + 190} 900 L ${x + 204} 932 L ${x - 156} 1002 Z` })
      : "";
    return el("path", { fill: deep, d: high }) + straps;
  }
  if (w === "shell" || w === "cyber" || w === "mech") {
    return el("path", { fill: shade(c.cloth, 0.2), stroke: trim, "stroke-width": 12, d: `M ${x - 160} 820 L ${x - 48} 770 L ${x + 48} 770 L ${x + 160} 820 L ${x + 184} 990 L ${x} 1024 L ${x - 184} 990 Z` })
      + el("path", { fill: trim, d: `M ${x - 30} 860 H ${x + 30} V 910 H ${x - 30} Z` });
  }
  if (w === "ornament" || w === "costume") {
    return el("path", { fill: "none", stroke: trim, "stroke-width": 14, d: `M ${x - 130} 860 L ${x} 790 L ${x + 130} 860 L ${x + 86} 990 L ${x} 940 L ${x - 86} 990 Z` })
      + el("path", { fill: trim, d: `M ${x} 900 L ${x + 20} 928 L ${x} 956 L ${x - 20} 928 Z` });
  }
  if (w === "minimal") {
    return el("path", { fill: c.skin, opacity: "0.55", d: `M ${x - 64} 830 Q ${x} 900 ${x + 64} 830 L ${x + 46} 980 L ${x - 46} 980 Z` });
  }
  return "";
}

function headwearMarkup(x, look, c) {
  const kind = look.headwear;
  const trim = c.trim;
  const deep = c.clothDeep;
  if (kind === "cap") {
    return el("path", { fill: deep, d: `M ${x - 200} 340 Q ${x} 188 ${x + 188} 348 L ${x + 160} 400 Q ${x} 330 ${x - 170} 392 Z` })
      + el("path", { fill: trim, d: `M ${x - 10} 360 L ${x + 250} 410 L ${x + 220} 468 L ${x - 16} 408 Z` });
  }
  if (kind === "visor") {
    return el("path", { fill: trim, opacity: "0.42", stroke: trim, "stroke-width": 16, d: `M ${x - 220} 392 H ${x + 220} V 468 H ${x - 220} Z` });
  }
  if (kind === "bandana") {
    return el("path", { fill: trim, d: `M ${x - 190} 300 L ${x} 250 L ${x + 190} 300 L ${x + 150} 390 L ${x - 150} 390 Z` });
  }
  if (kind === "headband") {
    return el("path", { fill: trim, d: `M ${x - 188} 300 H ${x + 188} V 348 H ${x - 188} Z` });
  }
  return "";
}

function faceCueMarkup(x, look, c) {
  const bits = [];
  if (look.ageLines) {
    bits.push(el("path", {
      fill: "none",
      stroke: c.skinDeep,
      "stroke-width": 8,
      d: `M ${x - 120} 500 Q ${x - 40} 530 ${x - 130} 560 M ${x + 120} 500 Q ${x + 40} 530 ${x + 130} 560 M ${x - 80} 650 H ${x + 80}`,
    }));
  }
  if (look.beard) {
    bits.push(el("path", { fill: c.hair, d: `M ${x - 90} 640 Q ${x} 790 ${x + 96} 630 Q ${x + 40} 720 ${x} 740 Q ${x - 36} 720 ${x - 90} 640 Z` }));
  }
  if (look.face === "snout") {
    bits.push(el("path", { fill: c.skin, d: `M ${x - 78} 560 Q ${x} 760 ${x + 78} 560 Q ${x} 640 ${x - 78} 560 Z` }));
    bits.push(el("path", { fill: c.skinDeep, d: `M ${x - 22} 620 L ${x} 668 L ${x + 22} 620 Z` }));
  }
  if (look.face === "skull") {
    bits.push(el("ellipse", { cx: x - 90, cy: 450, rx: 70, ry: 54, fill: "#140E12" }));
    bits.push(el("ellipse", { cx: x + 90, cy: 450, rx: 70, ry: 54, fill: "#140E12" }));
    bits.push(el("path", { fill: "#140E12", d: `M ${x - 16} 530 L ${x} 590 L ${x + 16} 530 Z` }));
    bits.push(el("path", { fill: c.skin, d: `M ${x - 70} 640 H ${x + 70} V 670 H ${x - 70} Z M ${x - 54} 670 H ${x - 34} V 710 H ${x - 54} Z M ${x - 16} 670 H ${x + 4} V 710 H ${x - 16} Z M ${x + 22} 670 H ${x + 42} V 710 H ${x + 22} Z` }));
  }
  if (look.face === "synthetic") {
    bits.push(el("path", {
      fill: "none",
      stroke: c.trim,
      "stroke-width": 8,
      d: `M ${x - 150} 390 H ${x + 150} M ${x - 140} 520 H ${x + 140} M ${x} 280 V 680`,
    }));
    bits.push(el("rect", { x: x - 150, y: 400, width: 84, height: 48, fill: c.trim, opacity: "0.85" }));
    bits.push(el("rect", { x: x + 66, y: 400, width: 84, height: 48, fill: c.trim, opacity: "0.85" }));
  }
  if (look.pointedEar) {
    bits.push(el("path", { fill: c.skin, stroke: c.trim, "stroke-width": 8, d: `M ${x - 190} 470 L ${x - 290} 400 L ${x - 176} 540 Z M ${x + 190} 470 L ${x + 290} 400 L ${x + 176} 540 Z` }));
  }
  if (look.scar || look.accessory === "scar" || look.accessory === "claw") {
    const mark = look.accessory === "claw"
      ? `M ${x - 40} 430 L ${x + 30} 560 M ${x - 10} 420 L ${x + 54} 560 M ${x + 20} 430 L ${x + 78} 540`
      : `M ${x + 40} 430 L ${x + 110} 560`;
    bits.push(el("path", { fill: "none", stroke: c.trim, "stroke-width": 10, d: mark }));
  }
  if (look.tattoo) {
    bits.push(el("path", { fill: "none", stroke: c.trim, "stroke-width": 8, d: `M ${x + 70} 700 l 24 28 l -24 28 l 24 28` }));
  }
  return bits.join("");
}

function accessoryMarkup(x, look, c) {
  const kind = look.accessory;
  const trim = c.trim;
  if (!kind || kind === "none") return "";
  if (kind === "glasses") {
    return el("path", {
      fill: "none",
      stroke: trim,
      "stroke-width": 16,
      d: `M ${x - 210} 392 H ${x - 40} V 468 H ${x - 210} Z M ${x + 40} 392 H ${x + 210} V 468 H ${x + 40} Z M ${x - 40} 420 H ${x + 40}`,
    });
  }
  if (kind === "shades") {
    return el("path", {
      fill: trim,
      opacity: "0.72",
      stroke: "#120E12",
      "stroke-width": 10,
      d: `M ${x - 220} 388 H ${x - 24} V 478 H ${x - 220} Z M ${x + 24} 388 H ${x + 220} V 478 H ${x + 24} Z`,
    });
  }
  if (kind === "mask") {
    return el("path", { fill: "#120E12", stroke: trim, "stroke-width": 12, d: `M ${x - 150} 500 Q ${x} 470 ${x + 150} 500 L ${x + 130} 690 Q ${x} 760 ${x - 130} 690 Z` });
  }
  if (kind === "headphones") {
    return el("path", { fill: "none", stroke: trim, "stroke-width": 28, d: `M ${x - 230} 430 Q ${x} 250 ${x + 230} 430` })
      + el("circle", { cx: x - 214, cy: 500, r: 52, fill: "#16181E", stroke: trim, "stroke-width": 12 })
      + el("circle", { cx: x + 214, cy: 500, r: 52, fill: "#16181E", stroke: trim, "stroke-width": 12 });
  }
  if (kind === "cigar") {
    return el("path", { fill: "#8A5A32", d: `M ${x + 40} 600 H ${x + 210} V 628 H ${x + 40} Z` })
      + el("circle", { cx: x + 230, cy: 560, r: 16, fill: c.skin, opacity: "0.35" })
      + el("circle", { cx: x + 260, cy: 520, r: 22, fill: c.skin, opacity: "0.22" });
  }
  if (kind === "chain") {
    const links = [];
    for (let i = 0; i < 7; i++) {
      links.push(el("circle", { cx: x - 90 + i * 30, cy: 860 + (i % 2) * 10, r: 12, fill: "none", stroke: trim, "stroke-width": 6 }));
    }
    return links.join("") + el("circle", { cx: x + 214, cy: 470, r: 10, fill: trim });
  }
  if (kind === "armband") {
    return el("path", { fill: trim, d: `M ${x - 250} 900 H ${x - 150} V 948 H ${x - 250} Z` });
  }
  if (kind === "earpiece") {
    return el("rect", { x: x + 198, y: 470, width: 36, height: 22, rx: 6, fill: trim });
  }
  if (kind === "optic") {
    return el("circle", { cx: x + 118, cy: 430, r: 54, fill: "#10141A", stroke: trim, "stroke-width": 12 })
      + el("circle", { cx: x + 118, cy: 430, r: 16, fill: trim });
  }
  if (kind === "collar") {
    return el("path", { fill: trim, d: `M ${x - 80} 760 H ${x + 80} V 796 H ${x - 80} Z` })
      + el("circle", { cx: x, cy: 820, r: 16, fill: trim });
  }
  if (kind === "ornament") {
    return el("path", { fill: trim, d: `M ${x} 250 L ${x + 28} 290 L ${x} 330 L ${x - 28} 290 Z` });
  }
  if (kind === "pet") {
    const px = x + 246;
    const py = 790;
    return el("path", { fill: c.skinShadow, stroke: trim, "stroke-width": 8, d: `M ${px} ${py - 48} C ${px + 40} ${py - 48} ${px + 48} ${py} ${px} ${py + 36} C ${px - 48} ${py} ${px - 40} ${py - 48} ${px} ${py - 48} Z M ${px - 28} ${py - 40} l -18 -28 l 30 10 Z M ${px + 18} ${py - 44} l 22 -26 l -8 32 Z` })
      + el("circle", { cx: px - 8, cy: py - 8, r: 6, fill: trim });
  }
  if (kind === "weapon") {
    return el("path", { fill: trim, d: `M ${x + 180} 820 L ${x + 250} 700 L ${x + 274} 712 L ${x + 210} 860 Z` });
  }
  if (kind === "fx") {
    return el("circle", { cx: x, cy: 420, r: 300, fill: "none", stroke: trim, "stroke-width": 8, "stroke-dasharray": "16 22", opacity: "0.85" })
      + el("circle", { cx: x, cy: 420, r: 246, fill: "none", stroke: look.accent2 || trim, "stroke-width": 4, opacity: "0.7" });
  }
  return "";
}

function backgroundMarkup(kind, c, seed) {
  const trim = c.trim;
  const n = hashString(seed || kind || "bg");
  if (kind === "city_night") {
    const bars = [[70, 760, 76], [160, 820, 54], [230, 690, 96], [780, 730, 70], [870, 660, 88], [960, 800, 48]];
    const d = bars.map(([bx, y, w]) => `M ${bx} ${y} h ${w} V 1024 H ${bx} Z`).join(" ");
    return el("path", { fill: trim, opacity: "0.28", d });
  }
  if (kind === "underground") {
    return el("path", { fill: "none", stroke: trim, "stroke-width": 18, opacity: "0.55", d: `M 40 1024 C 40 560 250 430 512 430 C 774 430 984 560 984 1024` })
      + el("path", { fill: "none", stroke: trim, "stroke-width": 8, opacity: "0.4", d: `M 140 1024 C 150 680 300 560 512 560 C 724 560 874 680 884 1024` });
  }
  if (kind === "club") {
    const blobs = [el("path", { fill: "none", stroke: trim, "stroke-width": 10, opacity: "0.45", d: `M 140 200 Q 512 60 900 220` })];
    for (let i = 0; i < 6; i++) {
      const cx = 120 + ((n + i * 137) % 800);
      const cy = 140 + ((n + i * 89) % 700);
      blobs.push(el("circle", { cx, cy, r: 46 + (i % 3) * 18, fill: trim, opacity: "0.16" }));
    }
    return blobs.join("");
  }
  if (kind === "casino") {
    return el("path", { fill: "none", stroke: trim, "stroke-width": 10, opacity: "0.55", d: `M 512 120 l 70 70 l -70 70 l -70 -70 Z M 180 280 l 48 48 l -48 48 l -48 -48 Z M 820 240 l 56 56 l -56 56 l -56 -56 Z M 240 760 l 40 40 l -40 40 l -40 -40 Z` });
  }
  if (kind === "studio") {
    return el("ellipse", { cx: 512, cy: 420, rx: 280, ry: 180, fill: trim, opacity: "0.08" })
      + el("path", { fill: "none", stroke: trim, "stroke-width": 8, opacity: "0.35", d: `M 180 180 H 320 M 180 180 V 320 M 844 180 H 704 M 844 180 V 320` });
  }
  if (kind === "tech_lab") {
    return el("path", { fill: "none", stroke: trim, "stroke-width": 6, opacity: "0.5", d: `M 512 80 V 944 M 80 512 H 944 M 512 512 m -40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0` });
  }
  if (kind === "vault") {
    return el("path", { fill: "none", stroke: trim, "stroke-width": 22, opacity: "0.4", d: `M 120 160 H 904 V 900 H 120 Z` });
  }
  if (kind === "beach") {
    return el("path", { fill: trim, opacity: "0.18", d: `M 0 760 H 1024 V 1024 H 0 Z` })
      + el("circle", { cx: 760, cy: 280, r: 70, fill: trim, opacity: "0.35" });
  }
  if (kind === "space") {
    const stars = [];
    for (let i = 0; i < 18; i++) {
      const sx = 40 + ((n + i * 97) % 960);
      const sy = 40 + ((n + i * 53) % 960);
      stars.push(`M ${sx} ${sy} h 8 v 8 h -8 Z`);
    }
    return el("path", { fill: trim, opacity: "0.8", d: stars.join(" ") });
  }
  if (kind === "abstract") {
    return el("path", { fill: trim, opacity: "0.16", d: `M 80 200 C 200 40 420 80 512 220 C 640 40 900 120 860 360 C 980 520 760 700 560 640 C 360 820 40 640 120 420 C 40 300 40 240 80 200 Z` });
  }
  if (kind === "custom") {
    return el("path", { fill: trim, opacity: "0.55", d: `M 140 180 L 220 80 L 260 200 Z M 820 140 L 940 220 L 800 260 Z M 160 860 L 80 760 L 240 780 Z` });
  }
  return "";
}

function renderPfp(recipe, opts) {
  const row = recipe && recipe.colors ? recipe : buildRecipe(recipe);
  const size = normalizeSize(opts && opts.size);
  const nonce = String((opts && opts.nonce) || "pfp").replace(/[^a-zA-Z0-9_-]/g, "") || "pfp";
  const c = row.colors;
  const x = 512 + row.turn * 18;
  const lean = row.turn * 36;
  const face = row.look && row.look.emotion ? row.look.emotion : expressionOf(row.attitude, row.intensity || 1);
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
    el("clipPath", { id: id("face") }, el("path", { d: facePath(x, row.look) })),
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
    row.look && face.wink > 0.5 ? el("path", { fill: c.skin, d: `M ${x - 220} 430 Q ${x - 118} 392 ${x - 16} 430 Q ${x - 118} 458 ${x - 220} 430 Z` }) : "",
    row.look ? faceCueMarkup(x, row.look, c) : "",
  ].join("");
  const hideEars = row.look && (row.look.face === "synthetic" || row.look.face === "skull" || row.look.face === "snout");
  const ears = hideEars ? "" : [
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
  if (row.look) front.push(headwearMarkup(x, row.look, c));
  const collar = row.look || row.minimal ? "" : el("path", {
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
  const neckScale = row.look && row.look.neck ? Number(row.look.neck) || 1 : 1;
  const neckD = !row.look
    ? `M ${x - 58} 690 L ${x + 58} 690 L ${x + 46} 860 L ${x - 46} 860 Z`
    : `M ${x - Math.round(58 * neckScale)} 690 L ${x + Math.round(58 * neckScale)} 690 L ${x + Math.round(46 * neckScale)} 860 L ${x - Math.round(46 * neckScale)} 860 Z`;
  const wardrobe = row.look ? wardrobeMarkup(x, row.look, c) : "";
  const motif = motifParts(row.motif, c, row.cleaner);
  const rimGlow = [
    el("path", { d: facePath(x, row.look), fill: "none", stroke: c.trim, "stroke-width": rim + 30, opacity: "0.95", filter: `url(#${id("rim")})` }),
    el("path", { d: shoulderPath(x, row.silhouette, row.look), fill: "none", stroke: c.trim, "stroke-width": 22, opacity: "0.7", filter: `url(#${id("rim")})` }),
  ].join("");
  const torso = [
    plates,
    el("path", { fill: c.cloth, d: shoulderPath(x, row.silhouette, row.look) }),
    el("path", { fill: shade(c.cloth, 0.08), d: `M ${x - 78} 760 L ${x + 78} 760 L ${x + 96} 900 L ${x - 96} 900 Z` }),
    el("path", { fill: c.skinShadow, d: neckD }),
    wardrobe,
    el("path", { d: shoulderPath(x, row.silhouette, row.look), fill: "none", stroke: c.trim, "stroke-width": 16, opacity: "0.82" }),
  ].join("");
  const head = [
    ears,
    beast,
    el("g", { "clip-path": `url(#${id("face")})` }, [
      el("path", { fill: `url(#${id("skin")})`, d: facePath(x, row.look) }),
      el("ellipse", { cx: keyX, cy: 400, rx: 140, ry: 180, fill: "#FFFFFF", opacity: row.darker ? "0.06" : "0.14" }),
      features,
    ].join("")),
    el("path", { d: facePath(x, row.look), fill: "none", stroke: c.trim, "stroke-width": rim + 16, opacity: "0.45", filter: `url(#${id("rim")})` }),
    el("path", { d: facePath(x, row.look), fill: "none", stroke: c.trim, "stroke-width": rim, opacity: row.darker ? "0.55" : "0.9" }),
    layer("hairFront", front.join("")),
  ].join("");
  const body = [
    layer("bg", el("rect", { width: 1024, height: 1024, fill: `url(#${id("bg")})` })),
    layer("bgGrid", neonGrid(c), { opacity: row.look && row.look.background ? "0.06" : (row.cleaner ? "0.1" : "0.22") }),
    layer("bgScene", row.look && row.look.background ? backgroundMarkup(row.look.background, c, row.look.seed) : ""),
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
    layer("accessoryFx", row.look ? accessoryMarkup(x, row.look, c) : ""),
    layer("rimGlow", rimGlow, { opacity: "0.78" }),
    layer("scanFx", el("rect", { x: 0, y: 0, width: 1024, height: 1024, fill: `url(#${id("scan")})` }), { opacity: row.cleaner ? "0.05" : "0.12" }),
    layer("collarFx", collar + gem),
  ].join("");
  const scale = compositionScale();
  const lookAttr = row.look
    ? ` data-face="${lookToken(row.look.face)}" data-wardrobe="${lookToken(row.look.wardrobe)}" data-accessory="${lookToken(row.look.accessory)}" data-background="${lookToken(row.look.background)}" data-palette="${lookToken(row.look.palette)}" data-body="${lookToken(row.look.selections && row.look.selections.bodyType)}"`
    : "";
  const accent2 = row.look && row.look.accent2
    ? el("path", { d: facePath(x, row.look), fill: "none", stroke: row.look.accent2, "stroke-width": 14, opacity: "0.9" })
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="${size}" height="${size}" data-asset="${ASSET_TYPE}" data-style="${PFP_STYLE_VERSION}" data-pfp-style="${row.styleId || PFP_STYLE_ID}" data-engine="procedural-svg" data-layered="1" data-signature="${row.signature || "COLLAR"}" data-character-scale="${scale.characterHeight}" data-face-scale="${scale.faceHeight}"${lookAttr} aria-hidden="true"><defs>${defs}</defs>${body}${accent2}</svg>`;
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
