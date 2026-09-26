// pfparena.js — Felt-roster portraits for Liar's Dice Arena.
//
// Same recipe contract as the neon rigs (1024 square, data-layer groups, face
// box metadata). The picture is different: a warm table light on a real face,
// a team-colored costume, and one silhouette you can still name inside a
// ~96px circle. Accent color is cloth, metal, and eyes — not a wireframe
// around an empty bust.
//
// House names (Dracula, The Fox, …) get an authored look. Everyone else is
// drawn from the recipe: skin, hair, headwear, attire, attitude.

const FACE_TOP = 176;
const FACE_BOTTOM = 708;

function esc(v) {
  return String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function el(tag, attrs, inner) {
  const a = Object.entries(attrs || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join("");
  return inner == null ? `<${tag}${a}/>` : `<${tag}${a}>${inner}</${tag}>`;
}
function layer(name, inner, extra) {
  if (!inner) return "";
  return el("g", Object.assign({ "data-layer": name }, extra || {}), inner);
}
function hex(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ""));
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgb([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function mix(a, b, t) {
  const A = hex(a);
  const B = hex(b);
  const p = Math.max(0, Math.min(1, Number(t) || 0));
  return rgb([A[0] + (B[0] - A[0]) * p, A[1] + (B[1] - A[1]) * p, A[2] + (B[2] - A[2]) * p]);
}
function shade(c, amt) {
  return amt >= 0 ? mix(c, "#ffffff", amt) : mix(c, "#000000", -amt);
}
function luma(h) {
  const [r, g, b] = hex(h);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function expression(attitude, intensity) {
  const i = Math.max(0.55, Math.min(2.2, Number(intensity) || 1));
  const table = {
    SMUG: { lid: 0.34 * i, brow: [18, -10], mouth: "smirk", amp: 16 + 10 * i },
    STOIC: { lid: 0.14, brow: [1, 1], mouth: "flat", amp: 3 + i },
    MANIC: { lid: -0.22 * i, brow: [22, -18], mouth: "grin", amp: 22 + 12 * i },
    SERENE: { lid: 0.2, brow: [10, 10], mouth: "soft", amp: 12 + 6 * i },
    PREDATORY: { lid: 0.46 * i, brow: [-14, -8], mouth: "tight", amp: 4 + i },
    MYSTERIOUS: { lid: 0.36, brow: [4, 16], mouth: "flat", amp: 4 + 2 * i },
    COLD: { lid: 0.26, brow: [-10, -10], mouth: "tight", amp: 2 + i },
    PLAYFUL: { lid: 0.02, brow: [22, 4], mouth: "smile", amp: 16 + 10 * i },
    REGAL: { lid: 0.12, brow: [10, 8], mouth: "soft", amp: 10 + 6 * i },
  };
  return Object.assign({ i }, table[String(attitude || "").toUpperCase()] || table.STOIC);
}

// Authored house looks. Keyed by display name with a leading "The " removed.
// These are the seats on the Arena card, so the silhouette is the brand.
const HOUSE = {
  dracula: {
    face: "male_lean",
    skin: ["#F6E3D6", "#E4BBA8", "#C48B80"],
    hair: "#140E12",
    hairHi: "#3A2A30",
    hairStyle: "widow",
    wear: "crown",
    cloth: "#7A1C2C",
    clothDeep: "#3A0E16",
    lining: "#E4C27A",
    accent: "#F43B5F",
    collar: "high",
    iris: "#8E1C32",
    lip: "#A85A62",
  },
  caesar: {
    face: "male_muscular",
    skin: ["#E6C094", "#C99662", "#8E643C"],
    hair: "#2A2118",
    hairHi: "#4A3A28",
    hairStyle: "cropped",
    wear: "laurel",
    cloth: "#3C3832",
    clothDeep: "#221E1A",
    lining: "#E4C27A",
    accent: "#FFC247",
    collar: "lapel",
    iris: "#3A2A18",
    lip: "#A06A52",
  },
  reaper: {
    face: "androgynous",
    skin: ["#E4DCE8", "#C4B6CC", "#8E8498"],
    hair: "#1A1522",
    hairHi: "#3A3048",
    hairStyle: "none",
    wear: "hood",
    cloth: "#2A2436",
    clothDeep: "#14101A",
    lining: "#B15CFF",
    accent: "#B15CFF",
    collar: "wrap",
    iris: "#6A3CA8",
    lip: "#8A708C",
  },
  athena: {
    face: "female_lean",
    skin: ["#F6E0D2", "#E2BBA6", "#C48B78"],
    hair: "#241C16",
    hairHi: "#4A3A2C",
    hairStyle: "swept",
    wear: "owl",
    cloth: "#1E4E86",
    clothDeep: "#10243E",
    lining: "#E2B340",
    accent: "#E2B340",
    collar: "lapel",
    iris: "#1E3348",
    lip: "#C07870",
  },
  shark: {
    face: "male_lean",
    skin: ["#E4A67E", "#C47C52", "#8A4E34"],
    hair: "#12382F",
    hairHi: "#1E5848",
    hairStyle: "none",
    wear: "fins",
    cloth: "#146454",
    clothDeep: "#0A2E28",
    lining: "#D7FFD0",
    accent: "#7CFF6A",
    collar: "notch",
    iris: "#143028",
    lip: "#A06048",
  },
  oracle: {
    face: "androgynous",
    skin: ["#E8E0F2", "#C8BCD8", "#9084A4"],
    hair: "#241838",
    hairHi: "#4A3870",
    hairStyle: "none",
    wear: "halo",
    cloth: "#3C2878",
    clothDeep: "#1A1030",
    lining: "#C9B6F2",
    accent: "#C9B6F2",
    collar: "wrap",
    iris: "#5A4890",
    lip: "#A090B0",
  },
  fox: {
    face: "female_lean",
    skin: ["#F3C9A2", "#D79A6A", "#A86C42"],
    hair: "#8C3A12",
    hairHi: "#C86A32",
    hairStyle: "swept",
    wear: "fox",
    cloth: "#A85A1C",
    clothDeep: "#5C2E0E",
    lining: "#F6C453",
    accent: "#F6C453",
    collar: "notch",
    iris: "#6A3412",
    lip: "#C47060",
  },
  brutus: {
    face: "male_muscular",
    skin: ["#D08A62", "#A86440", "#6E4028"],
    hair: "#1A1410",
    hairHi: "#3A3028",
    hairStyle: "none",
    wear: "helm",
    cloth: "#8A4630",
    clothDeep: "#4A2418",
    lining: "#E8C4A8",
    accent: "#F0A07A",
    collar: "plate",
    iris: "#2A1810",
    lip: "#8E5040",
    scar: true,
  },
  monk: {
    face: "male_lean",
    skin: ["#E8C8A6", "#C8A078", "#8E6848"],
    hair: "#3A3028",
    hairHi: "#6A5A48",
    hairStyle: "none",
    wear: "cowl",
    cloth: "#2F6A48",
    clothDeep: "#163624",
    lining: "#C8D8B8",
    accent: "#7DAF6A",
    collar: "wrap",
    iris: "#3A4030",
    lip: "#A87860",
  },
  siren: {
    face: "female_lean",
    skin: ["#F6D4C6", "#E4A898", "#C07870"],
    hair: "#142028",
    hairHi: "#3A6870",
    hairStyle: "long",
    wear: "long",
    cloth: "#0E7A72",
    clothDeep: "#083E3C",
    lining: "#6AE7FF",
    accent: "#6AE7FF",
    collar: "wave",
    iris: "#1A4048",
    lip: "#C86878",
  },
  miser: {
    face: "elder",
    skin: ["#DDD0BE", "#C0B09A", "#8A7A64"],
    hair: "#8A8478",
    hairHi: "#C8C2B4",
    hairStyle: "cropped",
    wear: "none",
    cloth: "#3E4658",
    clothDeep: "#22262E",
    lining: "#C5A47E",
    accent: "#C5A47E",
    collar: "tight",
    iris: "#3A3428",
    lip: "#A08878",
  },
  jester: {
    face: "male_lean",
    skin: ["#F0C8A8", "#D4A07A", "#A87050"],
    hair: "#2A1028",
    hairHi: "#F25CA2",
    hairStyle: "asymmetric",
    wear: "asymmetric",
    cloth: "#8E3A9A",
    clothDeep: "#4A1848",
    lining: "#F25CA2",
    accent: "#F25CA2",
    collar: "diamond",
    iris: "#4A1840",
    lip: "#C06078",
  },
};

function castKey(row) {
  const name = String((row.identity && row.identity.name) || "")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .trim();
  return HOUSE[name] ? name : "";
}

function facePreset(kind) {
  const table = {
    male_lean: { hw: 176, jaw: 124 },
    male_muscular: { hw: 198, jaw: 158 },
    female_lean: { hw: 166, jaw: 102 },
    female_athletic: { hw: 174, jaw: 112 },
    androgynous: { hw: 170, jaw: 110 },
    heavy_set: { hw: 210, jaw: 172 },
    elder: { hw: 172, jaw: 120 },
    young_adult: { hw: 164, jaw: 106 },
    non_human: { hw: 180, jaw: 128 },
    full_robot: { hw: 186, jaw: 150 },
    skeletal_synthetic: { hw: 160, jaw: 108 },
  };
  return table[kind] || table.male_lean;
}

function resolveLook(row) {
  const key = castKey(row);
  const house = key ? HOUSE[key] : null;
  const species = house ? "human" : String(row.species || "human");
  const face = (house && house.face) || row.faceKind || (species === "robot" ? "full_robot" : species === "skeletal" ? "skeletal_synthetic" : "male_lean");
  const g = facePreset(face);
  g.jaw += Number(row.jawShift) || 0;
  g.top = 214;
  g.bot = 704;
  g.eyeY = 456;
  g.mouthY = 624;
  const primary = (row.colors && row.colors.primary) || "#3A342C";
  const accent = (house && house.accent) || (row.colors && row.colors.accent) || "#E4C27A";
  const skinPack = house
    ? house.skin
    : [row.colors.skin, row.colors.skinShadow, row.colors.skinDeep];
  let cloth = house ? house.cloth : primary;
  let clothDeep = house ? house.clothDeep : shade(primary, -0.3);
  if (!house && luma(cloth) < 0.14) {
    cloth = mix(primary, accent, 0.34);
    clothDeep = mix("#1A1612", primary, 0.55);
  }
  const hairStyle = house
    ? house.hairStyle
    : (species === "robot" || species === "skeletal" || species === "animal" ? "none" : (row.hair || "swept"));
  const wear = house
    ? house.wear
    : (species === "animal" ? "fins" : (row.headwear || "none"));
  return {
    key,
    species: house ? "human" : species,
    face,
    g,
    skin: skinPack[0],
    skinShadow: skinPack[1],
    skinDeep: skinPack[2],
    hair: house ? house.hair : ((row.colors && row.colors.hair) || "#241C16"),
    hairHi: house ? house.hairHi : shade((row.colors && row.colors.hair) || "#241C16", 0.28),
    hairStyle,
    wear,
    cloth,
    clothDeep,
    lining: house ? house.lining : (luma(accent) > 0.72 ? mix(accent, "#1A140C", 0.35) : accent),
    accent,
    collar: house ? house.collar : collarFor(row),
    iris: house ? house.iris : mix(accent, "#1A120C", 0.62),
    lip: house ? house.lip : ((row.colors && row.colors.lip) || "#A06058"),
    sclera: species === "robot" || species === "skeletal" ? "#10141C" : "#F7F1EA",
    scar: !!(house && house.scar),
    elder: face === "elder" || row.age === "elder",
    attire: row.attire || "",
    accessory: row.accessory || "",
    augment: !!row.augment,
  };
}

function collarFor(row) {
  const a = String(row.attire || "");
  if (a === "hood_mask") return "wrap";
  if (a === "tactical" || a === "cyber_gear") return "plate";
  if (a === "performance_costume") return "diamond";
  if (a === "luxury" || a === "formal" || a === "business") return "lapel";
  if (a === "sports") return "stripe";
  if (a === "streetwear") return "notch";
  if (row.headwear === "hood" || row.headwear === "cowl") return "wrap";
  return "plain";
}

function facePath(x, g) {
  const top = g.top;
  const bot = g.bot;
  const hw = g.hw;
  const jaw = g.jaw;
  const mid = top + (bot - top) * 0.46;
  return [
    `M ${x} ${top - 6}`,
    `C ${x + hw * 0.62} ${top - 18}, ${x + hw + 8} ${top + 78}, ${x + hw} ${mid}`,
    `C ${x + hw + 6} ${mid + 86}, ${x + jaw + 16} ${bot - 78}, ${x + jaw * 0.72} ${bot - 28}`,
    `Q ${x} ${bot + 22}, ${x - jaw * 0.72} ${bot - 28}`,
    `C ${x - jaw - 16} ${bot - 78}, ${x - hw - 6} ${mid + 86}, ${x - hw} ${mid}`,
    `C ${x - hw - 8} ${top + 78}, ${x - hw * 0.62} ${top - 18}, ${x} ${top - 6}`,
    "Z",
  ].join(" ");
}

function hairPath(style, x, g, turn) {
  const top = g.top;
  const L = x - g.hw - 18;
  const R = x + g.hw + 18;
  const t = turn * 10;
  if (style === "none") return { back: "", front: "" };
  if (style === "widow") {
    return {
      back: "",
      front: [
        `M ${L + 8} ${top + 150}`,
        `C ${L} ${top + 20}, ${x - 80 + t} ${top - 70}, ${x + t} ${top + 78}`,
        `C ${x + 70 + t} ${top - 78}, ${R} ${top + 10}, ${R - 8} ${top + 150}`,
        `L ${R - 36} ${top + 86}`,
        `C ${x + 40 + t} ${top + 8}, ${x - 20 + t} ${top + 36}, ${L + 36} ${top + 96}`,
        "Z",
      ].join(" "),
    };
  }
  if (style === "cropped") {
    return {
      back: "",
      front: [
        `M ${L + 16} ${top + 120}`,
        `C ${L + 8} ${top + 10}, ${x - 40 + t} ${top - 64}, ${x + 50 + t} ${top - 58}`,
        `C ${R - 8} ${top + 4}, ${R - 10} ${top + 90}, ${R - 20} ${top + 120}`,
        `L ${x + 20 + t} ${top + 36}`,
        `L ${L + 28} ${top + 70}`,
        "Z",
      ].join(" "),
    };
  }
  if (style === "swept") {
    return {
      back: "",
      front: [
        `M ${L + 4} ${top + 168}`,
        `C ${L - 10} ${top + 20}, ${x - 90 + t} ${top - 78}, ${x + 30 + t} ${top - 64}`,
        `C ${x + 150 + t} ${top - 40}, ${R + 8} ${top + 30}, ${R - 6} ${top + 130}`,
        `C ${x + 80 + t} ${top + 40}, ${x - 10 + t} ${top + 70}, ${L + 40} ${top + 110}`,
        "Z",
      ].join(" "),
    };
  }
  if (style === "long") {
    return {
      back: `M ${L - 36} ${top + 80} C ${L - 70} ${top + 360}, ${L - 40} ${top + 640}, ${L + 20} ${top + 700} L ${R - 20} ${top + 700} C ${R + 40} ${top + 640}, ${R + 70} ${top + 360}, ${R + 36} ${top + 80} Z`,
      front: [
        `M ${L - 8} ${top + 210}`,
        `C ${L - 16} ${top + 10}, ${x - 40 + t} ${top - 72}, ${x + 80 + t} ${top - 56}`,
        `C ${R + 10} ${top + 16}, ${R + 6} ${top + 200}, ${R - 20} ${top + 250}`,
        `C ${x + 40 + t} ${top + 48}, ${x - 30 + t} ${top + 90}, ${L + 24} ${top + 160}`,
        "Z",
      ].join(" "),
    };
  }
  if (style === "asymmetric") {
    return {
      back: `M ${L - 10} ${top + 140} L ${L - 36} ${top + 520} L ${L + 70} ${top + 500} L ${L + 40} ${top + 160} Z`,
      front: [
        `M ${L - 16} ${top + 200}`,
        `C ${L - 20} ${top}, ${x - 20 + t} ${top - 70}, ${x + 120 + t} ${top - 40}`,
        `C ${R} ${top + 20}, ${R - 16} ${top + 110}, ${x + 40 + t} ${top + 48}`,
        `C ${x - 40 + t} ${top + 90}, ${L + 10} ${top + 300}, ${L - 8} ${top + 340}`,
        "Z",
      ].join(" "),
    };
  }
  if (style === "wild") {
    const spikes = [];
    for (let i = 0; i < 7; i++) {
      const px = L + 20 + i * ((R - L - 30) / 6);
      const ph = top - 30 - ((i * 29) % 48);
      spikes.push(`${px} ${top + 50} L ${px + 22} ${ph} L ${px + 46} ${top + 46}`);
    }
    return {
      back: "",
      front: `M ${L} ${top + 80} L ${spikes.join(" L ")} L ${R} ${top + 80} L ${x} ${top + 20} Z`,
    };
  }
  return {
    back: "",
    front: `M ${L + 10} ${top + 130} C ${L} ${top + 10} ${x} ${top - 60} ${R} ${top + 20} L ${R - 16} ${top + 120} L ${x} ${top + 40} Z`,
  };
}

function wearOver(look, x, g) {
  const top = g.top;
  const L = x - g.hw;
  const R = x + g.hw;
  const gold = "#E4C27A";
  const goldDeep = "#B8893A";
  if (look.wear === "crown") {
    return el("path", {
      d: `M ${L + 6} ${top + 8} L ${L + 18} ${top - 78} L ${x - 78} ${top - 8} L ${x - 36} ${top - 108} L ${x} ${top - 16} L ${x + 36} ${top - 108} L ${x + 78} ${top - 8} L ${R - 18} ${top - 78} L ${R - 6} ${top + 8} Z`,
      fill: gold,
    }) + el("path", {
      d: `M ${L + 6} ${top + 8} H ${R - 6} L ${R - 12} ${top + 32} H ${L + 12} Z`,
      fill: goldDeep,
    }) + el("circle", { cx: x, cy: top - 16, r: 8, fill: look.accent })
      + el("circle", { cx: x - 78, cy: top - 6, r: 6, fill: look.accent })
      + el("circle", { cx: x + 78, cy: top - 6, r: 6, fill: look.accent });
  }
  if (look.wear === "laurel") {
    const leaves = [];
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const y = top + 28 - Math.sin(t * Math.PI) * 78;
      const lx = L + 8 + t * (g.hw - 16);
      const rx = R - 8 - t * (g.hw - 16);
      leaves.push(el("ellipse", {
        cx: lx, cy: y, rx: 16, ry: 8, fill: gold,
        transform: `rotate(${-40 + i * 8} ${lx} ${y})`,
      }));
      leaves.push(el("ellipse", {
        cx: rx, cy: y, rx: 16, ry: 8, fill: gold,
        transform: `rotate(${40 - i * 8} ${rx} ${y})`,
      }));
    }
    return el("path", {
      d: `M ${L - 4} ${top + 70} Q ${x} ${top - 86} ${R + 4} ${top + 70}`,
      fill: "none",
      stroke: goldDeep,
      "stroke-width": 10,
      "stroke-linecap": "round",
    }) + leaves.join("");
  }
  if (look.wear === "helm") {
    return el("path", {
      d: `M ${L - 8} ${top + 150} Q ${x} ${top - 120} ${R + 8} ${top + 150} L ${R - 8} ${top + 168} Q ${x} ${top - 70} ${L + 8} ${top + 168} Z`,
      fill: "#6A7078",
    }) + el("path", {
      d: `M ${L - 8} ${top + 150} L ${L - 28} ${top + 250} L ${L + 36} ${top + 230} L ${L + 20} ${top + 160} Z`,
      fill: "#4E545C",
    }) + el("path", {
      d: `M ${R + 8} ${top + 150} L ${R + 28} ${top + 250} L ${R - 36} ${top + 230} L ${R - 20} ${top + 160} Z`,
      fill: "#8A9098",
    }) + el("path", {
      d: `M ${x - 16} ${top - 96} L ${x + 16} ${top - 96} L ${x + 10} ${top + 150} L ${x - 10} ${top + 150} Z`,
      fill: look.accent,
    }) + el("path", {
      d: `M ${x - 8} ${top + 40} L ${x + 8} ${top + 40} L ${x + 5} ${g.eyeY + 20} L ${x - 5} ${g.eyeY + 20} Z`,
      fill: "#3A4048",
    });
  }
  if (look.wear === "owl") {
    const y = top + 4;
    return el("path", {
      d: `M ${L + 8} ${y + 28} Q ${x} ${top - 78} ${R - 8} ${y + 28}`,
      fill: "none",
      stroke: gold,
      "stroke-width": 16,
      "stroke-linecap": "round",
    }) + el("circle", { cx: x - 22, cy: y - 4, r: 12, fill: "#1A140C" })
      + el("circle", { cx: x + 22, cy: y - 4, r: 12, fill: "#1A140C" })
      + el("circle", { cx: x - 22, cy: y - 6, r: 5, fill: gold })
      + el("circle", { cx: x + 22, cy: y - 6, r: 5, fill: gold })
      + el("path", { d: `M ${x - 8} ${y + 8} L ${x + 8} ${y + 8} L ${x} ${y + 26} Z`, fill: goldDeep });
  }
  if (look.wear === "halo") {
    return el("ellipse", {
      cx: x, cy: top - 78, rx: 168, ry: 36,
      fill: "none", stroke: look.lining, "stroke-width": 18,
    }) + el("ellipse", {
      cx: x, cy: top - 78, rx: 168, ry: 36,
      fill: "none", stroke: gold, "stroke-width": 4,
    });
  }
  if (look.wear === "fox" || look.wear === "fins" || look.wear === "ears") {
    const ear = look.wear === "fox" ? look.hair : (look.wear === "fins" ? look.cloth : look.hair);
    const inner = look.wear === "fox" ? "#F3D7B0" : shade(ear, 0.35);
    return el("path", {
      d: `M ${L + 16} ${top + 36} L ${L - 36} ${top - 120} L ${L + 108} ${top + 8} Z`,
      fill: ear,
    }) + el("path", {
      d: `M ${L + 28} ${top + 28} L ${L - 8} ${top - 78} L ${L + 78} ${top + 10} Z`,
      fill: inner,
    }) + el("path", {
      d: `M ${R - 16} ${top + 36} L ${R + 36} ${top - 120} L ${R - 108} ${top + 8} Z`,
      fill: ear,
    }) + el("path", {
      d: `M ${R - 28} ${top + 28} L ${R + 8} ${top - 78} L ${R - 78} ${top + 10} Z`,
      fill: inner,
    });
  }
  if (look.wear === "cap") {
    return el("path", {
      d: `M ${L - 10} ${top + 36} L ${L + 16} ${top - 36} Q ${x} ${top - 110} ${R - 16} ${top - 36} L ${R + 10} ${top + 36} Z`,
      fill: look.clothDeep,
    }) + el("path", {
      d: `M ${L - 78} ${top + 48} L ${R + 36} ${top + 28} L ${R + 28} ${top + 58} L ${L - 70} ${top + 78} Z`,
      fill: look.cloth,
    }) + el("rect", { x: x - 28, y: top - 8, width: 56, height: 12, rx: 4, fill: look.lining });
  }
  return "";
}

// Pieces that sit on the skin and must stay behind the eyes.
function wearUnder(look, x, g) {
  const L = x - g.hw;
  const R = x + g.hw;
  const y = g.eyeY;
  if (look.wear === "fox") {
    return el("path", {
      d: `M ${L + 4} ${y - 6} Q ${x} ${y - 58} ${R - 4} ${y - 6} L ${R - 18} ${y + 34} Q ${x} ${y + 62} ${L + 18} ${y + 34} Z`,
      fill: look.lining,
    }) + el("path", {
      d: `M ${x - 16} ${y - 18} L ${x + 16} ${y - 6} L ${x + 6} ${y + 26} L ${x - 20} ${y + 14} Z`,
      fill: "#B8893A",
    });
  }
  if (look.wear === "halfmask") {
    return el("path", {
      d: `M ${x + 10} ${y - 36} C ${x + 50} ${y + 8} ${R - 8} ${y + 16} ${R + 6} ${y + 78} L ${R - 24} ${y + 130} C ${x + 36} ${y + 96} ${x - 8} ${y + 16} ${x + 10} ${y - 36} Z`,
      fill: look.clothDeep,
      opacity: 0.94,
    });
  }
  return "";
}

function hoodRim(look, x, g) {
  if (look.wear !== "hood" && look.wear !== "cowl") return "";
  const top = g.top - 20;
  const bot = g.bot - 40;
  return el("path", {
    d: `M ${x - g.hw - 36} ${top + 80} Q ${x} ${top - 70} ${x + g.hw + 36} ${top + 80} L ${x + g.jaw + 10} ${bot} Q ${x} ${bot + 36} ${x - g.jaw - 10} ${bot} Z`,
    fill: "none",
    stroke: look.lining,
    "stroke-width": look.wear === "cowl" ? 26 : 22,
  });
}

function hoodBody(look, x) {
  if (look.wear !== "hood" && look.wear !== "cowl") return "";
  return el("path", {
    d: `M ${x - 340} 1040 L ${x - 300} 760 Q ${x - 240} 420 ${x} 150 Q ${x + 240} 420 ${x + 300} 760 L ${x + 340} 1040 Z`,
    fill: look.cloth,
  }) + el("path", {
    d: `M ${x - 250} 980 Q ${x - 180} 520 ${x - 40} 220 Q ${x} 160 ${x + 40} 220 Q ${x + 180} 520 ${x + 250} 980`,
    fill: "none",
    stroke: look.clothDeep,
    "stroke-width": 28,
    opacity: 0.65,
  });
}

function shoulders(look, x, wide) {
  const w = wide ? 430 : 370;
  const y0 = 730;
  return el("path", {
    d: `M ${x - w} 1040 L ${x - w + 24} 860 Q ${x - 200} ${y0} ${x - 78} 712 L ${x + 78} 712 Q ${x + 200} ${y0} ${x + w - 24} 860 L ${x + w} 1040 Z`,
    fill: look.cloth,
  }) + el("path", {
    d: `M ${x - 20} 712 L ${x - w + 24} 860 L ${x - w} 1040 L ${x - 80} 1040 Z`,
    fill: shade(look.cloth, 0.16),
    opacity: 0.55,
  }) + el("path", {
    d: `M ${x + 30} 712 L ${x + w - 24} 860 L ${x + w} 1040 L ${x + 70} 1040 Z`,
    fill: look.clothDeep,
    opacity: 0.72,
  });
}

function collarMarkup(look, x) {
  const c = look.collar;
  const lining = look.lining;
  const deep = look.clothDeep;
  if (c === "high") {
    return el("path", {
      d: `M ${x - 150} 760 L ${x - 118} 560 L ${x - 48} 700 L ${x} 760 Z`,
      fill: look.cloth,
    }) + el("path", {
      d: `M ${x + 150} 760 L ${x + 118} 560 L ${x + 48} 700 L ${x} 760 Z`,
      fill: deep,
    }) + el("path", {
      d: `M ${x - 118} 560 L ${x - 150} 760 L ${x - 132} 748 L ${x - 104} 572 Z`,
      fill: lining,
    }) + el("path", {
      d: `M ${x} 790 L ${x + 16} 812 L ${x} 834 L ${x - 16} 812 Z`,
      fill: look.accent,
    });
  }
  if (c === "lapel") {
    return el("path", {
      d: `M ${x - 78} 730 L ${x - 170} 1040 L ${x - 70} 1040 L ${x - 8} 820 Z`,
      fill: "#F4EFE6",
    }) + el("path", {
      d: `M ${x + 78} 730 L ${x + 170} 1040 L ${x + 70} 1040 L ${x + 8} 820 Z`,
      fill: "#E7E0D4",
    }) + el("path", {
      d: `M ${x - 78} 730 L ${x - 8} 860 L ${x - 36} 1040 L ${x - 150} 980 Z`,
      fill: deep,
    }) + el("path", {
      d: `M ${x + 78} 730 L ${x + 8} 860 L ${x + 36} 1040 L ${x + 150} 980 Z`,
      fill: look.cloth,
    }) + el("path", {
      d: `M ${x - 70} 748 L ${x - 16} 860`,
      fill: "none",
      stroke: lining,
      "stroke-width": 8,
      "stroke-linecap": "round",
    });
  }
  if (c === "notch") {
    return el("path", {
      d: `M ${x - 150} 760 L ${x - 46} 700 L ${x} 790 L ${x + 46} 700 L ${x + 150} 760 L ${x + 70} 900 L ${x} 860 L ${x - 70} 900 Z`,
      fill: deep,
    }) + el("path", {
      d: `M ${x - 46} 700 L ${x} 790 L ${x + 46} 700`,
      fill: "none",
      stroke: lining,
      "stroke-width": 10,
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
    });
  }
  if (c === "plate") {
    return el("ellipse", { cx: x - 230, cy: 860, rx: 110, ry: 54, fill: shade(look.cloth, 0.12) })
      + el("ellipse", { cx: x + 230, cy: 860, rx: 110, ry: 54, fill: deep })
      + el("path", {
        d: `M ${x - 8} 760 L ${x + 8} 760 L ${x + 18} 980 L ${x + 4} 1000 L ${x - 4} 980 Z`,
        fill: "#C8CCD0",
      }) + el("path", {
        d: `M ${x - 18} 800 L ${x + 18} 800 L ${x} 848 Z`,
        fill: look.accent,
      });
  }
  if (c === "wrap") {
    return el("path", {
      d: `M ${x - 200} 800 Q ${x} 700 ${x + 200} 800 Q ${x} 900 ${x - 200} 800 Z`,
      fill: deep,
    }) + el("circle", { cx: x, cy: 830, r: 16, fill: "none", stroke: lining, "stroke-width": 6 });
  }
  if (c === "wave") {
    return el("path", {
      d: `M ${x - 180} 760 Q ${x - 80} 700 ${x} 770 Q ${x + 80} 840 ${x + 180} 740`,
      fill: "none",
      stroke: lining,
      "stroke-width": 18,
      "stroke-linecap": "round",
    }) + el("path", {
      d: `M ${x + 150} 500 q 36 20 10 48 q -28 8 -36 -10 q 16 -6 8 -20 Z`,
      fill: lining,
    });
  }
  if (c === "tight") {
    return el("path", {
      d: `M ${x - 90} 730 L ${x - 70} 700 L ${x + 70} 700 L ${x + 90} 730 L ${x + 40} 820 L ${x - 40} 820 Z`,
      fill: deep,
    }) + el("circle", { cx: x, cy: 748, r: 14, fill: lining })
      + el("rect", { x: x - 5, y: 760, width: 10, height: 36, rx: 3, fill: shade(lining, -0.25) });
  }
  if (c === "diamond") {
    return el("path", {
      d: `M ${x - 70} 760 L ${x} 820 L ${x + 70} 760 L ${x + 24} 800 L ${x} 770 L ${x - 24} 800 Z`,
      fill: lining,
    }) + el("path", {
      d: `M ${x - 150} 900 L ${x - 110} 860 L ${x - 70} 900 L ${x - 110} 940 Z`,
      fill: lining,
    }) + el("path", {
      d: `M ${x + 150} 940 L ${x + 110} 900 L ${x + 70} 940 L ${x + 110} 980 Z`,
      fill: "#F4EFE6",
    });
  }
  if (c === "stripe") {
    return el("path", {
      d: `M ${x - 200} 900 H ${x + 200} L ${x + 190} 948 H ${x - 190} Z`,
      fill: "#F4EFE6",
    }) + el("rect", { x: x - 22, y: 780, width: 44, height: 70, rx: 6, fill: lining });
  }
  return el("path", {
    d: `M ${x - 70} 730 Q ${x} 800 ${x + 70} 730 L ${x + 40} 860 L ${x - 40} 860 Z`,
    fill: deep,
  });
}

function mouthPath(kind, x, y, amp) {
  const a = Math.max(8, amp);
  if (kind === "grin") {
    return el("path", {
      d: `M ${x - 70} ${y - 8} Q ${x} ${y + a + 18} ${x + 70} ${y - 8} Q ${x} ${y + a * 0.45} ${x - 70} ${y - 8} Z`,
      fill: "#2A1216",
    }) + el("path", {
      d: `M ${x - 58} ${y - 2} Q ${x} ${y + a * 0.35} ${x + 58} ${y - 2} L ${x + 52} ${y + 8} Q ${x} ${y + a * 0.55} ${x - 52} ${y + 8} Z`,
      fill: "#F6F1E8",
    });
  }
  if (kind === "smirk") {
    return el("path", {
      d: `M ${x - 58} ${y + 6} Q ${x + 6} ${y + a} ${x + 68} ${y - a * 0.45}`,
      fill: "none",
      stroke: "#7A3040",
      "stroke-width": 10,
      "stroke-linecap": "round",
    });
  }
  if (kind === "smile" || kind === "soft") {
    const depth = kind === "soft" ? a * 0.7 : a;
    return el("path", {
      d: `M ${x - 62} ${y} Q ${x} ${y + depth} ${x + 62} ${y}`,
      fill: "none",
      stroke: "#8A4050",
      "stroke-width": kind === "soft" ? 8 : 10,
      "stroke-linecap": "round",
    });
  }
  if (kind === "tight") {
    return el("path", {
      d: `M ${x - 54} ${y + 4} L ${x + 54} ${y - 2}`,
      fill: "none",
      stroke: "#6A3838",
      "stroke-width": 9,
      "stroke-linecap": "round",
    });
  }
  return el("path", {
    d: `M ${x - 48} ${y} L ${x + 48} ${y + Math.round(a * 0.15)}`,
    fill: "none",
    stroke: "#7A4048",
    "stroke-width": 9,
    "stroke-linecap": "round",
  });
}

function eyesMarkup(look, x, g, f) {
  const y = g.eyeY;
  const gap = 78;
  const ry = Math.max(8, 28 * (1 - Math.min(0.62, Math.max(-0.35, f.lid))));
  const rx = 40;
  const open = (cx) => el("ellipse", { cx, cy: y, rx, ry, fill: look.sclera });
  const lid = (cx) => el("path", {
    d: `M ${cx - rx} ${y} Q ${cx} ${y - ry - 8} ${cx + rx} ${y}`,
    fill: "none",
    stroke: look.skinDeep,
    "stroke-width": 6,
    "stroke-linecap": "round",
  });
  const closed = (cx) => el("path", {
    d: `M ${cx - rx + 4} ${y + 2} Q ${cx} ${y + 16} ${cx + rx - 4} ${y + 2}`,
    fill: "none",
    stroke: look.skinDeep,
    "stroke-width": 8,
    "stroke-linecap": "round",
  });
  const iris = (cx) => el("circle", { cx, cy: y + 1, r: Math.max(8, ry * 0.62), fill: look.iris })
    + el("circle", { cx: cx - 6, cy: y - 5, r: 4.5, fill: "#FFFFFF" });
  const lx = x - gap;
  const rx2 = x + gap;
  const eyesOpen = open(lx) + open(rx2) + lid(lx) + lid(rx2);
  const pupils = iris(lx) + iris(rx2);
  const eyesClosed = el("ellipse", { cx: lx, cy: y, rx: rx + 2, ry: ry + 4, fill: look.skin })
    + el("ellipse", { cx: rx2, cy: y, rx: rx + 2, ry: ry + 4, fill: look.skin })
    + closed(lx) + closed(rx2);
  return {
    eyesOpen: layer("eyesOpen", eyesOpen),
    pupils: layer("pupils", pupils),
    eyesClosed: layer("eyesClosed", eyesClosed, { opacity: "0" }),
  };
}

function brows(look, x, g, f) {
  const y = g.eyeY - 52;
  const gap = 78;
  const [inn, out] = f.brow;
  const stroke = shade(look.hair, -0.15);
  const one = (cx, dir) => {
    const liftIn = dir > 0 ? inn : out;
    const liftOut = dir > 0 ? out : inn;
    return el("path", {
      d: `M ${cx - 48} ${y - liftOut} Q ${cx} ${y - 16 - (liftIn + liftOut) / 2} ${cx + 50} ${y - liftIn}`,
      fill: "none",
      stroke,
      "stroke-width": 12,
      "stroke-linecap": "round",
    });
  };
  return one(x - gap, -1) + one(x + gap, 1);
}

function nose(x, y, shadow, deep) {
  return el("path", {
    d: `M ${x - 8} ${y} L ${x + 20} ${y + 62} L ${x - 16} ${y + 74} L ${x - 28} ${y + 58} Z`,
    fill: shadow,
    opacity: 0.85,
  }) + el("path", {
    d: `M ${x + 6} ${y + 58} L ${x + 18} ${y + 66} L ${x + 4} ${y + 72} Z`,
    fill: deep,
    opacity: 0.55,
  });
}

function accessoryMarkup(look, x, g) {
  const kind = String(look.accessory || "none");
  const y = g.eyeY;
  if (kind === "glasses") {
    return el("g", { fill: "none", stroke: "#1A140C", "stroke-width": 7 },
      el("rect", { x: x - 78 - 48, y: y - 32, width: 100, height: 64, rx: 12 })
      + el("rect", { x: x + 26, y: y - 32, width: 100, height: 64, rx: 12 })
      + el("path", { d: `M ${x - 26} ${y} H ${x + 26}` }));
  }
  if (kind === "mask") {
    return el("path", {
      d: `M ${x - g.jaw} ${y + 70} L ${x + g.jaw} ${y + 70} L ${x + g.jaw - 20} ${g.bot - 10} Q ${x} ${g.bot + 16} ${x - g.jaw + 20} ${g.bot - 10} Z`,
      fill: look.clothDeep,
      opacity: 0.92,
    });
  }
  if (kind === "jewelry") {
    return el("circle", { cx: x - g.hw - 8, cy: y + 20, r: 10, fill: look.lining })
      + el("circle", { cx: x + g.hw + 8, cy: y + 20, r: 10, fill: look.lining });
  }
  if (kind === "scar_tattoo" || look.scar) {
    return el("path", {
      d: `M ${x + 48} ${y - 70} L ${x + 92} ${y + 40}`,
      fill: "none",
      stroke: shade(look.skinDeep, -0.15),
      "stroke-width": 7,
      "stroke-linecap": "round",
    });
  }
  if (look.augment) {
    return el("rect", { x: x + g.hw - 10, y: y - 10, width: 54, height: 16, rx: 4, fill: look.lining });
  }
  return look.scar ? el("path", {
    d: `M ${x + 48} ${y - 70} L ${x + 92} ${y + 40}`,
    fill: "none",
    stroke: shade(look.skinDeep, -0.15),
    "stroke-width": 7,
    "stroke-linecap": "round",
  }) : "";
}

function robotHead(look, x, g, f, id) {
  const outline = facePath(x, g);
  const metal = look.species === "skeletal" ? "#E7E2D6" : "#C5CED6";
  const metalD = look.species === "skeletal" ? "#8A8478" : "#5C6770";
  const plate = el("path", { d: outline, fill: `url(#${id("metal")})` })
    + el("path", {
      d: `M ${x - g.hw + 28} ${g.top + 80} H ${x + g.hw - 28} M ${x - g.hw + 36} ${g.bot - 120} H ${x + g.hw - 36}`,
      fill: "none",
      stroke: metalD,
      "stroke-width": 4,
      opacity: 0.7,
    });
  const visorY = g.eyeY - 16;
  const visor = layer("eyesOpen", el("rect", {
    x: x - g.hw + 36,
    y: visorY,
    width: (g.hw - 36) * 2,
    height: 52,
    rx: 10,
    fill: "#0E1218",
  }) + el("rect", {
    x: x - g.hw + 48,
    y: visorY + 14,
    width: (g.hw - 48) * 2,
    height: 22,
    rx: 6,
    fill: look.lining,
  }));
  const pupils = layer("pupils", el("rect", {
    x: x - 36,
    y: visorY + 18,
    width: 28,
    height: 14,
    rx: 3,
    fill: "#F4EFE6",
  }) + el("rect", {
    x: x + 12,
    y: visorY + 18,
    width: 22,
    height: 14,
    rx: 3,
    fill: "#F4EFE6",
    opacity: 0.8,
  }));
  const closed = layer("eyesClosed", el("rect", {
    x: x - g.hw + 36,
    y: visorY,
    width: (g.hw - 36) * 2,
    height: 52,
    rx: 10,
    fill: metalD,
  }), { opacity: "0" });
  const jaw = look.species === "skeletal"
    ? el("path", {
      d: `M ${x - 70} ${g.mouthY} H ${x + 70} M ${x - 48} ${g.mouthY - 16} V ${g.mouthY + 28} M ${x - 16} ${g.mouthY - 16} V ${g.mouthY + 28} M ${x + 16} ${g.mouthY - 16} V ${g.mouthY + 28} M ${x + 48} ${g.mouthY - 16} V ${g.mouthY + 28}`,
      fill: "none",
      stroke: metalD,
      "stroke-width": 6,
      "stroke-linecap": "round",
    })
    : mouthPath(f.mouth === "grin" ? "grin" : "flat", x, g.mouthY, f.amp);
  return {
    outline,
    inner: plate + visor + pupils + closed + jaw,
    metal,
  };
}

function animalMuzzle(look, x, g) {
  return el("path", {
    d: `M ${x - 78} ${g.eyeY + 70} Q ${x} ${g.eyeY + 20} ${x + 78} ${g.eyeY + 70} L ${x + 56} ${g.mouthY + 30} Q ${x} ${g.mouthY + 70} ${x - 56} ${g.mouthY + 30} Z`,
    fill: shade(look.skin, 0.18),
  }) + el("path", {
    d: `M ${x - 16} ${g.eyeY + 78} L ${x + 16} ${g.eyeY + 78} L ${x} ${g.eyeY + 108} Z`,
    fill: "#1A120E",
  });
}

function renderArenaPfp(row, opts) {
  const size = (opts && opts.size) || 1024;
  const nonce = String((opts && opts.nonce) || "pfp").replace(/[^a-zA-Z0-9_-]/g, "") || "pfp";
  const id = (n) => `${nonce}_${n}`;
  const src = row && row.colors ? row : {};
  const look = resolveLook(src);
  const f = expression(src.attitude, src.intensity);
  const turn = Number(src.turn) || 0;
  const x = 512 + turn * 18;
  const g = look.g;
  const wide = /HEAVY|BROAD|MECHANICAL|BULK/.test(String(src.silhouette || "")) || look.face === "male_muscular" || look.face === "heavy_set";
  const outline = facePath(x, g);
  const hair = hairPath(look.hairStyle, x, g, turn);
  const felt = "#12100C";
  const feltMid = "#241C14";
  const gold = "#E4C27A";

  const defs = el("defs", null, [
    el("radialGradient", { id: id("felt"), cx: "50%", cy: "42%", r: "68%" },
      el("stop", { offset: "0%", "stop-color": feltMid })
      + el("stop", { offset: "55%", "stop-color": "#16130F" })
      + el("stop", { offset: "100%", "stop-color": felt })),
    el("radialGradient", { id: id("team"), cx: "50%", cy: "40%", r: "48%" },
      el("stop", { offset: "0%", "stop-color": look.accent, "stop-opacity": 0.42 })
      + el("stop", { offset: "70%", "stop-color": look.cloth, "stop-opacity": 0.2 })
      + el("stop", { offset: "100%", "stop-color": look.cloth, "stop-opacity": 0 })),
    el("linearGradient", { id: id("metal"), x1: "0", y1: "0", x2: "1", y2: "1" },
      el("stop", { offset: "0%", "stop-color": "#F2F4F6" })
      + el("stop", { offset: "45%", "stop-color": "#A8B2BA" })
      + el("stop", { offset: "100%", "stop-color": "#5A646C" })),
    el("radialGradient", { id: id("vig"), cx: "50%", cy: "46%", r: "72%" },
      el("stop", { offset: "62%", "stop-color": "#000000", "stop-opacity": 0 })
      + el("stop", { offset: "100%", "stop-color": "#000000", "stop-opacity": src.darker ? 0.55 : 0.4 })),
    el("clipPath", { id: id("face") }, el("path", { d: outline })),
  ].join(""));

  const machine = look.species === "robot" || look.species === "skeletal";
  const beast = !look.key && look.species === "animal";

  let headInner = "";
  if (machine) {
    const bot = robotHead(look, x, g, f, id);
    headInner = el("path", {
      d: `M ${x - 64} ${g.bot - 40} L ${x + 64} ${g.bot - 40} L ${x + 78} 790 L ${x - 78} 790 Z`,
      fill: shade(look.cloth, 0.1),
    }) + bot.inner;
  } else {
    const eyes = eyesMarkup(look, x, g, f);
    const cheek = el("ellipse", {
      cx: x - 70,
      cy: g.eyeY + 36,
      rx: 54,
      ry: 32,
      fill: "#FFFFFF",
      opacity: 0.16,
    });
    const jawShade = el("path", {
      d: `M ${x - g.jaw * 0.9} ${g.bot - 120} Q ${x} ${g.bot - 20} ${x + g.jaw * 0.9} ${g.bot - 120} L ${x + g.jaw * 0.4} ${g.bot - 10} Q ${x} ${g.bot + 10} ${x - g.jaw * 0.4} ${g.bot - 10} Z`,
      fill: look.skinDeep,
      opacity: 0.28,
    });
    const side = el("path", {
      d: `M ${x + 20} ${g.top + 30} L ${x + g.hw} ${g.top + 120} L ${x + g.hw - 8} ${g.bot - 80} L ${x + g.jaw * 0.3} ${g.bot - 20} L ${x + 10} ${g.eyeY + 40} Z`,
      fill: look.skinShadow,
      opacity: 0.55,
    });
    const wrinkles = look.elder ? el("path", {
      d: `M ${x - 90} ${g.eyeY + 78} q 28 16 60 8 M ${x + 30} ${g.eyeY + 78} q 28 14 58 4 M ${x - 40} ${g.top + 70} H ${x + 46}`,
      fill: "none",
      stroke: look.skinDeep,
      "stroke-width": 4,
      "stroke-linecap": "round",
      opacity: 0.7,
    }) : "";
    const ears = el("ellipse", { cx: x - g.hw - 8, cy: g.eyeY + 10, rx: 22, ry: 36, fill: look.skinShadow })
      + el("ellipse", { cx: x + g.hw + 8, cy: g.eyeY + 10, rx: 22, ry: 36, fill: look.skin });
    const painted = el("g", { "clip-path": `url(#${id("face")})` }, [
      el("path", { d: outline, fill: look.skin }),
      cheek,
      side,
      jawShade,
      wrinkles,
      beast ? animalMuzzle(look, x, g) : "",
      wearUnder(look, x, g),
      brows(look, x, g, f),
      eyes.eyesOpen,
      eyes.pupils,
      eyes.eyesClosed,
      nose(x, g.eyeY + 16, look.skinShadow, look.skinDeep),
      mouthPath(f.mouth, x + (f.mouth === "smirk" ? 8 : 0), g.mouthY, f.amp),
      accessoryMarkup(look, x, g),
    ].join(""));
    const neck = el("path", {
      d: `M ${x - 58} ${g.bot - 36} L ${x + 62} ${g.bot - 36} L ${x + 78} 800 L ${x - 74} 800 Z`,
      fill: look.skinShadow,
    });
    headInner = neck + ears + painted + el("path", {
      d: outline,
      fill: "none",
      stroke: look.skinDeep,
      "stroke-width": 6,
      opacity: 0.45,
    });
  }

  const hairBack = layer("hairBack", hoodBody(look, x) + (hair.back ? el("path", { d: hair.back, fill: shade(look.hair, -0.25) }) : ""));
  const hairFrontBits = (hair.front ? el("path", { d: hair.front, fill: look.hair }) : "")
    + (hair.front ? el("path", {
      d: `M ${x - 36} ${g.top - 8} L ${x + 78} ${g.top - 28} L ${x + 16} ${g.top + 28} Z`,
      fill: look.hairHi,
      opacity: 0.55,
    }) : "")
    + wearOver(look, x, g)
    + hoodRim(look, x, g);
  const hairFront = layer("hairFront", hairFrontBits);

  const bg = layer("bg", el("rect", { width: 1024, height: 1024, fill: `url(#${id("felt")})` }));
  const grid = layer("bgGrid", el("g", { stroke: gold, "stroke-width": 2, opacity: 0.07 },
    el("path", { d: "M180 0 V1024 M844 0 V1024 M0 180 H1024", fill: "none" })));
  const bgFx = layer("bgFx", el("circle", { cx: 512, cy: 460, r: 340, fill: `url(#${id("team")})` }));
  const aura = layer("aura", el("ellipse", {
    cx: 512, cy: 430, rx: 300, ry: 250,
    fill: gold, opacity: 0.08,
  }));
  const torso = layer("torso", shoulders(look, x, wide));
  const collarFx = layer("collarFx", collarMarkup(look, x));
  const head = layer("head", headInner);
  const rim = layer("rimGlow", el("path", {
    d: outline,
    fill: "none",
    stroke: "#F4EFE6",
    "stroke-width": 8,
    opacity: 0.28,
  }) + el("path", {
    d: `M ${x + g.hw - 10} ${g.top + 80} C ${x + g.hw + 8} ${g.eyeY}, ${x + g.jaw} ${g.bot - 40}, ${x + 20} ${g.bot}`,
    fill: "none",
    stroke: look.lining,
    "stroke-width": 6,
    opacity: 0.35,
    "stroke-linecap": "round",
  }), { opacity: "0.9" });
  const particles = layer("particles", [
    el("circle", { cx: 180, cy: 220, r: 3, fill: gold, opacity: 0.45 }),
    el("circle", { cx: 840, cy: 260, r: 2.5, fill: gold, opacity: 0.35 }),
    el("circle", { cx: 760, cy: 180, r: 2, fill: look.lining, opacity: 0.4 }),
  ].join(""));
  const scan = layer("scanFx", el("rect", { x: 0, y: 708, width: 1024, height: 2, fill: gold, opacity: 0.05 }), { opacity: "0.08" });
  const post = el("rect", { width: 1024, height: 1024, fill: `url(#${id("vig")})` })
    + el("circle", {
      cx: 512, cy: 512, r: 470,
      fill: "none",
      stroke: gold,
      "stroke-width": 10,
      opacity: 0.45,
    })
    + el("circle", {
      cx: 512, cy: 512, r: 448,
      fill: "none",
      stroke: gold,
      "stroke-width": 2,
      opacity: 0.28,
    });

  const body = [
    defs,
    bg,
    grid,
    bgFx,
    aura,
    particles,
    hairBack,
    torso,
    collarFx,
    head,
    rim,
    hairFront,
    scan,
    post,
  ].join("");

  const sc = src.scale || {};
  const attrs = {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 1024 1024",
    width: size,
    height: size,
    "data-asset": "PFP_PORTRAIT",
    "data-style": "lda-pfp-v2",
    "data-rig": "arena",
    "data-pfp-style": src.styleId || "neon-competitive",
    "data-engine": "procedural-svg",
    "data-layered": "1",
    "data-signature": src.signature || look.wear || "",
    "data-character-scale": sc.characterHeight,
    "data-face-scale": sc.faceHeight,
    "data-face-top": FACE_TOP,
    "data-face-bottom": FACE_BOTTOM,
    "data-species": look.species,
    "data-face": look.face,
    "data-age": src.age || "",
    "data-archetype": src.archetypeId || "",
    "data-cast": look.key || "",
    "aria-hidden": "true",
  };
  const open = "<svg" + Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join("") + ">";
  return open + body + "</svg>";
}

module.exports = { renderArenaPfp, HOUSE, castKey, FACE_TOP, FACE_BOTTOM };
