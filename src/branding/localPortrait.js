// In-process neon-competitive portraits.
//
// Face-first roster art built as SVG. No image API and no secret.
// Dark field, one controlled accent rim, and a signature that follows
// the archetype DNA (collar, jacket, hood, lens, animal, scar).

const { buildVisualDNA } = require("./buildVisualDNA");

function hash32(seed) {
  let h = 2166136261;
  const s = String(seed || "neon");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function unit(seed, n) {
  return (hash32(`${seed}:${n}`) % 10000) / 10000;
}

function num(value) {
  return Math.round(value * 10) / 10;
}

function hexColor(value, fallback) {
  const match = String(value || "").trim().match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toUpperCase()}` : fallback;
}

function rgbOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mix(a, b, t) {
  const A = rgbOf(a);
  const B = rgbOf(b);
  const ch = (x, y) => Math.max(0, Math.min(255, Math.round(x + (y - x) * t)));
  return `#${[ch(A.r, B.r), ch(A.g, B.g), ch(A.b, B.b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function xml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function token(...parts) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function resolveKind({ archetype, dna, selections }) {
  const arch = String(archetype || "").toLowerCase();
  const body = String((selections && selections.bodyType) || "").toLowerCase();
  const attire = String((selections && selections.attire) || "").toLowerCase();
  const sig = String((dna && dna.signatureFeature) || "").toLowerCase();
  const emblem = String((dna && dna.emblem) || "").toLowerCase();
  const bag = token(arch, body, attire, sig, emblem);
  if (arch === "robot_ai" || /full_robot|skeletal|lens|optic|visor|synthetic/.test(bag)) return "robot";
  if (arch === "animal" || body === "non_human" || /animal_face|mascot/.test(bag)) return "animal";
  if (arch === "primal" || /feral|claw/.test(bag)) return "primal";
  if (arch === "antihero" || /hood|broken_hood|hood_mask/.test(bag)) return "hood";
  if (arch === "executive" || /aristocratic_collar|sharp_suit_collar|formal|business/.test(bag)) return "executive";
  if (arch === "street" || /streetwear|jacket/.test(bag)) return "street";
  if (arch === "athlete" || /performance|sports/.test(bag)) return "athlete";
  if (arch === "celebrity" || /luxury|glamour/.test(bag)) return "celebrity";
  if (arch === "criminal" || /scar/.test(bag)) return "criminal";
  if (arch === "comedian" || /smile|playful/.test(bag)) return "comedian";
  if (arch === "tech" || /cyber_gear|tech_frame|circuit/.test(bag)) return "tech";
  if (/hood_mask|broken_hood/.test(bag)) return "hood";
  return "human";
}

function facePlan(seed, kind, selections) {
  const body = String((selections && selections.bodyType) || "");
  const expression = String((selections && selections.expression) || "").toLowerCase();
  const attitude = String((selections && selections.facialAttitude) || "").toLowerCase();
  let jaw = 158 + unit(seed, 1) * 26;
  let faceH = 196 + unit(seed, 2) * 22;
  let eyeGap = 70 + unit(seed, 3) * 16;
  let brow = (unit(seed, 4) - 0.5) * 12;
  let smile = (unit(seed, 5) - 0.42) * 16;
  const lit = unit(seed, 6) > 0.45 ? 1 : -1;
  if (/female/.test(body)) { jaw *= 0.9; faceH *= 1.04; }
  if (/muscular|heavy/.test(body)) jaw *= 1.1;
  if (body === "elder") smile -= 4;
  if (kind === "animal" || kind === "primal") { jaw *= 1.06; faceH *= 0.94; }
  if (kind === "robot") { jaw = 168; faceH = 188; }
  const mood = token(expression, attitude);
  if (/aggressive|intense|predatory|cold|serious/.test(mood)) { smile = -10; eyeGap *= 0.96; }
  if (/playful|manic|cocky|smug|smile|unhinged/.test(mood)) smile = 14;
  if (/mysterious/.test(mood)) smile = -2;
  if (/confident/.test(mood) && smile < 2) smile = 6;
  return {
    jaw: num(jaw),
    faceH: num(faceH),
    eyeGap: num(eyeGap),
    brow: num(brow),
    smile: num(smile),
    lit,
    elder: body === "elder",
    young: body === "young_adult",
    mood,
  };
}

function shoulderWidth(kind, selections, dna) {
  const bag = token(kind, selections && selections.bodyType, dna && dna.silhouette);
  if (/broad|muscular|heavy|athlete|imposing/.test(bag)) return 470;
  if (/slim|lean|elegant|tall_sharp/.test(bag)) return 360;
  if (/compact/.test(bag)) return 400;
  return 410;
}

function motifMarkup(id, motif, accent) {
  const key = String(motif || "").toLowerCase();
  if (/grid|signal|circuit|machine/.test(key)) {
    const lines = [];
    for (let i = 0; i < 5; i++) {
      const y = 160 + i * 150;
      lines.push(`<path d="M80 ${y}H944" stroke="${accent}" stroke-opacity="0.14" stroke-width="2"/>`);
    }
    return lines.join("");
  }
  if (/halo|ring|spotlight|eclipse/.test(key)) {
    return `<circle cx="512" cy="430" r="280" fill="none" stroke="${accent}" stroke-opacity="0.2" stroke-width="18"/>
      <circle cx="512" cy="430" r="340" fill="none" stroke="${accent}" stroke-opacity="0.08" stroke-width="10"/>`;
  }
  if (/pulse|void|burst/.test(key)) {
    return `<ellipse cx="512" cy="470" rx="300" ry="180" fill="${id}-pulse"/>`;
  }
  return `<path d="M140 760C280 680 760 680 900 780" fill="none" stroke="${accent}" stroke-opacity="0.16" stroke-width="10"/>`;
}

function emblemMark(emblem, accent) {
  const key = String(emblem || "").toLowerCase();
  if (/bat|wing/.test(key)) return `<path d="M512 860l-28-16 28-22 28 22z" fill="${accent}"/>`;
  if (/laurel|spear/.test(key)) return `<path d="M492 846c20-28 40-28 60 0" fill="none" stroke="${accent}" stroke-width="6"/>`;
  if (/hour|broken/.test(key)) return `<path d="M496 844h32l-16 18z M496 880h32l-16-18z" fill="${accent}"/>`;
  if (/tooth|shark|claw|dagger/.test(key)) return `<path d="M512 842l14 36h-28z" fill="${accent}"/>`;
  if (/fox|mask/.test(key)) return `<path d="M496 858l16-20 16 20" fill="none" stroke="${accent}" stroke-width="6"/>`;
  if (/owl|eye|eclipse|optic|core|ring/.test(key)) return `<circle cx="512" cy="864" r="12" fill="none" stroke="${accent}" stroke-width="5"/>`;
  return `<path d="M512 844l12 14-12 14-12-14z" fill="${accent}"/>`;
}

function humanFace(id, colors, plan, kind) {
  const { skin, skinShade, accent, ink } = colors;
  const cx = 512;
  const cy = 418;
  const rx = plan.jaw;
  const ry = plan.faceH;
  const eyeY = cy - 8;
  const left = cx - plan.eyeGap;
  const right = cx + plan.eyeGap;
  const lid = /mysterious/.test(plan.mood || "") ? 7 : 0;
  const mouthY = cy + ry * 0.42;
  const smile = plan.smile;
  const hair = kind === "celebrity" || kind === "comedian";
  const parts = [];
  if (hair) {
    parts.push(`<path d="M${cx - rx - 8} ${cy - 20} C${cx - rx} ${cy - ry - 70} ${cx + rx} ${cy - ry - 80} ${cx + rx + 16} ${cy + 10} C${cx + rx - 20} ${cy - ry + 10} ${cx - rx + 30} ${cy - ry + 20} ${cx - rx - 8} ${cy - 20}Z" fill="${mix(ink, accent, 0.18)}"/>`);
  } else {
    parts.push(`<path d="M${cx - rx + 10} ${cy - 30} C${cx - 40} ${cy - ry - 54} ${cx + 70} ${cy - ry - 36} ${cx + rx - 6} ${cy - 10} L${cx + rx - 24} ${cy - ry * 0.45} C${cx + 20} ${cy - ry - 8} ${cx - 30} ${cy - ry + 6} ${cx - rx + 18} ${cy - 36}Z" fill="${mix(ink, "#1A120C", 0.35)}"/>`);
  }
  parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${id}-skin)"/>`);
  parts.push(`<ellipse cx="${cx + plan.lit * 18}" cy="${cy + 16}" rx="${rx * 0.72}" ry="${ry * 0.78}" fill="${skinShade}" opacity="0.28"/>`);
  parts.push(`<path d="M${cx - 10} ${cy + 8} Q${cx} ${cy + 46} ${cx + 16} ${cy + 18}" fill="none" stroke="${mix(skinShade, ink, 0.45)}" stroke-width="5" stroke-linecap="round"/>`);
  const eye = (x, tilt) => `
    <ellipse cx="${x}" cy="${eyeY}" rx="28" ry="${plan.young ? 16 : 13}" fill="${ink}"/>
    <ellipse cx="${x + plan.lit * 3}" cy="${eyeY}" rx="11" ry="11" fill="${accent}"/>
    <ellipse cx="${x + plan.lit * 6}" cy="${eyeY - 2}" rx="4" ry="4" fill="#F4F7FB"/>
    <path d="M${x - 30} ${eyeY - 22 + tilt} Q${x} ${eyeY - 34 + tilt} ${x + 30} ${eyeY - 18 + tilt}" fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round"/>
    ${lid ? `<path d="M${x - 28} ${eyeY - 2} Q${x} ${eyeY + lid} ${x + 28} ${eyeY - 2}" fill="${skin}" opacity="0.55"/>` : ""}`;
  parts.push(eye(left, plan.brow));
  parts.push(eye(right, -plan.brow));
  parts.push(`<path d="M${cx - 36} ${mouthY} Q${cx} ${mouthY + smile} ${cx + 40} ${mouthY - smile * 0.15}" fill="none" stroke="${mix(ink, accent, 0.25)}" stroke-width="6" stroke-linecap="round"/>`);
  if (plan.elder) {
    parts.push(`<path d="M${cx - 70} ${cy + 24} H${cx - 28}" stroke="${mix(skinShade, ink, 0.4)}" stroke-width="3" opacity="0.7"/>`);
  }
  if (kind === "criminal" || kind === "primal") {
    parts.push(`<path d="M${cx - 20} ${cy - 36} L${cx + 28} ${cy + 20}" stroke="${accent}" stroke-width="4" stroke-linecap="round" opacity="0.9"/>`);
  }
  if (kind === "animal" || kind === "primal") {
    parts.push(`<path d="M${cx - rx - 6} ${cy - 40} L${cx - rx + 36} ${cy - ry - 10} L${cx - rx + 54} ${cy - 8}Z" fill="${mix(skin, accent, 0.22)}"/>`);
    parts.push(`<path d="M${cx + rx + 6} ${cy - 40} L${cx + rx - 36} ${cy - ry - 10} L${cx + rx - 54} ${cy - 8}Z" fill="${mix(skin, accent, 0.22)}"/>`);
    parts.push(`<ellipse cx="${cx}" cy="${cy + ry * 0.34}" rx="34" ry="22" fill="${mix(skinShade, accent, 0.2)}"/>`);
  }
  return parts.join("");
}

function robotFace(colors, plan) {
  const { accent, ink, metal } = colors;
  const cx = 512;
  const cy = 430;
  const glow = plan.lit > 0 ? cx + 54 : cx - 54;
  return `
    <rect x="348" y="248" width="328" height="372" rx="78" fill="${metal}" stroke="${accent}" stroke-width="4"/>
    <path d="M392 300 H632" stroke="${accent}" stroke-opacity="0.45" stroke-width="3"/>
    <rect x="404" y="372" width="216" height="62" rx="31" fill="${ink}"/>
    <circle cx="${cx - 48}" cy="403" r="16" fill="${accent}" opacity="0.45"/>
    <circle cx="${glow}" cy="403" r="18" fill="${accent}"/>
    <circle cx="${glow + 5}" cy="398" r="5" fill="#F4F7FB"/>
    <rect x="456" y="500" width="112" height="10" rx="5" fill="${accent}" opacity="0.75"/>
    <circle cx="512" cy="548" r="8" fill="${accent}" opacity="0.8"/>`;
}

function wardrobe(kind, colors, width, selections) {
  const { cloth, clothEdge, accent, ink } = colors;
  const attire = String((selections && selections.attire) || "");
  const y = 700;
  const left = 512 - width;
  const right = 512 + width;
  const body = `<path d="M${left} 1024 L${left + 70} ${y} Q512 ${y - 36} ${right - 70} ${y} L${right} 1024 Z" fill="${cloth}"/>`;
  let detail = "";
  if (kind === "executive" || attire === "formal" || attire === "business") {
    detail = `<path d="M452 760 L512 900 L572 760" fill="${ink}"/>
      <path d="M452 760 L400 ${y + 40}" stroke="${accent}" stroke-width="8"/>
      <path d="M572 760 L624 ${y + 40}" stroke="${accent}" stroke-width="8"/>`;
  } else if (kind === "street" || attire === "streetwear" || attire === "casual") {
    detail = `<path d="M430 790 H594" stroke="${accent}" stroke-width="8" stroke-linecap="round"/>
      <path d="M512 790 V980" stroke="${clothEdge}" stroke-width="6"/>`;
  } else if (kind === "athlete" || attire === "sports" || attire === "performance_costume") {
    detail = `<path d="M360 820 H664" stroke="${accent}" stroke-width="14" stroke-linecap="round" opacity="0.85"/>`;
  } else if (kind === "hood" || attire === "hood_mask") {
    detail = `<path d="M300 640 Q512 500 724 640 L760 1024 L264 1024 Z" fill="${mix(ink, cloth, 0.35)}" opacity="0.92"/>`;
  } else if (kind === "robot" || kind === "tech" || attire === "cyber_gear") {
    detail = `<path d="M390 800 H634" stroke="${accent}" stroke-width="6" opacity="0.8"/>
      <rect x="470" y="830" width="84" height="18" rx="4" fill="${accent}" opacity="0.7"/>`;
  } else if (kind === "celebrity" || attire === "luxury") {
    detail = `<circle cx="430" cy="860" r="7" fill="${accent}"/>
      <circle cx="594" cy="860" r="7" fill="${accent}"/>`;
  }
  return body + detail;
}

function accessoryMarkup(selections, colors, plan) {
  const acc = String((selections && selections.accessories) || "none");
  const { accent, ink } = colors;
  const y = 410;
  const gap = plan.eyeGap;
  if (acc === "glasses") {
    return `<rect x="${512 - gap - 36}" y="${y - 18}" width="72" height="36" rx="8" fill="none" stroke="${accent}" stroke-width="5"/>
      <rect x="${512 + gap - 36}" y="${y - 18}" width="72" height="36" rx="8" fill="none" stroke="${accent}" stroke-width="5"/>
      <path d="M${512 - gap + 36} ${y} H${512 + gap - 36}" stroke="${accent}" stroke-width="4"/>`;
  }
  if (acc === "hat_cap") {
    return `<path d="M390 300 Q512 210 650 320 L700 340 H360 Z" fill="${ink}"/>
      <path d="M360 332 H700" stroke="${accent}" stroke-width="8" stroke-linecap="round"/>`;
  }
  if (acc === "mask") {
    return `<path d="M430 470 H594 Q580 540 512 548 Q444 540 430 470Z" fill="${ink}" opacity="0.72" stroke="${accent}" stroke-width="3"/>`;
  }
  if (acc === "headphones") {
    return `<path d="M400 360 Q512 250 624 360" fill="none" stroke="${ink}" stroke-width="16"/>
      <rect x="372" y="350" width="28" height="54" rx="8" fill="${accent}"/>
      <rect x="624" y="350" width="28" height="54" rx="8" fill="${accent}"/>`;
  }
  if (acc === "jewelry") {
    return `<circle cx="360" cy="470" r="8" fill="${accent}"/>`;
  }
  if (acc === "scar_tattoo") {
    return `<path d="M560 360 L610 450" stroke="${accent}" stroke-width="4" stroke-linecap="round"/>`;
  }
  if (acc === "unique_fx") {
    return `<circle cx="512" cy="300" r="18" fill="none" stroke="${accent}" stroke-width="4"/>`;
  }
  return "";
}

function renderNeonCompetitiveSvg({
  visualDNA,
  seed,
  agentId,
  archetype,
  selections,
  prompt,
} = {}) {
  const dna = visualDNA && visualDNA.primaryColor
    ? visualDNA
    : buildVisualDNA({ archetype });
  const kind = resolveKind({ archetype, dna, selections });
  const plan = facePlan(seed || agentId || kind, kind, {
    ...(selections || {}),
    facialAttitude: dna.facialAttitude,
    expression: (selections && selections.expression) || dna.facialAttitude,
  });
  const id = `p${hash32(seed || agentId || "portrait").toString(36)}`;
  const primary = hexColor(dna.primaryColor, "#101216");
  const secondary = hexColor(dna.secondaryColor, "#1C1F26");
  const accent = hexColor(dna.accentColor, "#4AD7FF");
  const ink = "#07080C";
  const bg = mix(primary, ink, 0.72);
  const bgEdge = mix(secondary, ink, 0.84);
  const skin = mix("#C4B4A4", accent, kind === "primal" ? 0.18 : 0.08);
  const skinShade = mix(skin, ink, 0.45);
  const cloth = mix(secondary, ink, 0.35);
  const clothEdge = mix(cloth, accent, 0.35);
  const metal = mix("#1A222C", accent, 0.12);
  const colors = { skin, skinShade, accent, ink, cloth, clothEdge, metal };
  const width = shoulderWidth(kind, selections, dna);
  const rimX = 512 + plan.lit * 150;
  const face = kind === "robot"
    ? robotFace(colors, plan)
    : humanFace(id, colors, plan, kind);
  const hood = kind === "hood"
    ? `<path d="M250 520 C280 180 760 160 790 540 C700 300 330 300 250 520Z" fill="${mix(ink, secondary, 0.2)}" stroke="${accent}" stroke-opacity="0.55" stroke-width="6"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" data-style="neon-competitive" data-engine="local" data-kind="${xml(kind)}" role="img">
  <defs>
    <radialGradient id="${id}-bg" cx="50%" cy="38%" r="68%">
      <stop offset="0%" stop-color="${mix(bg, accent, 0.16)}"/>
      <stop offset="58%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="${bgEdge}"/>
    </radialGradient>
    <linearGradient id="${id}-skin" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${mix(skin, "#F2E6D8", 0.35)}"/>
      <stop offset="55%" stop-color="${skin}"/>
      <stop offset="100%" stop-color="${skinShade}"/>
    </linearGradient>
    <radialGradient id="${id}-pulse" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}-rim" x1="${plan.lit > 0 ? "100%" : "0%"}" y1="0" x2="${plan.lit > 0 ? "0%" : "100%"}" y2="0">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#${id}-bg)"/>
  ${motifMarkup(id, dna.backgroundMotif, accent)}
  ${hood}
  ${wardrobe(kind, colors, width, selections)}
  <path d="M452 690 Q512 640 572 690 L590 820 H434 Z" fill="${mix(skinShade, cloth, 0.4)}"/>
  ${face}
  <path d="M${rimX - 30} 210 C${rimX + plan.lit * 40} 420 ${rimX + plan.lit * 20} 700 ${rimX - 10} 900" fill="none" stroke="url(#${id}-rim)" stroke-width="18" stroke-linecap="round"/>
  ${accessoryMarkup(selections, colors, plan)}
  ${emblemMark(dna.emblem, accent)}
</svg>`;
}

module.exports = {
  renderNeonCompetitiveSvg,
  resolveKind,
};
