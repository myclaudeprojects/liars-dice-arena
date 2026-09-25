const fs = require("fs"); const p = __dirname + "/../src/pfp.js"; const raw = fs.readFileSync(p, "utf8"); const crlf = raw.includes("\r\n"); let s = raw.replace(/\r\n/g, "\n");
const rep = (a, b) => { if (s.includes(b)) return; if (!s.includes(a)) throw new Error("anchor: " + a.slice(0, 60)); s = s.replace(a, b); };
// buildRecipe: an explicit house headwear wins even when selections are mapped
rep(`  const headwear = mapped
    ? (mapped.headwear || "")
    : (forced || headwearFor(visual.emblem, src.archetype, variation));`,
`  const headwear = mapped
    ? (forced || mapped.headwear || "")          // house signature headwear survives the new style
    : (forced || headwearFor(visual.emblem, src.archetype, variation));`);
// recipeFromBrand: stored selections → no override; inferred (house/legacy) → keep house headwear;
// inferred brands also get a per-agent concept variant so the cast doesn't share one face
rep(`  let selections = row.creationSelections || (row.generation && row.generation.selections) || null;
  let hasSelections = !!(selections && typeof selections === "object" && selections.archetype);`,
`  let selections = row.creationSelections || (row.generation && row.generation.selections) || null;
  let hasSelections = !!(selections && typeof selections === "object" && selections.archetype);
  const stored = hasSelections;`);
rep(`    variation: hasSelections ? (variant != null ? variant : 0) : (variant != null ? variant : hashString(row.agentId || row.name) % 5),
    treatment: "standard",
    headwear: hasSelections ? "" : (HOUSE_HEADWEAR[row.agentId] || ""),`,
`    variation: variant != null ? variant : (stored ? 0 : hashString(row.agentId || row.name) % 4),
    treatment: "standard",
    headwear: stored ? "" : (HOUSE_HEADWEAR[row.agentId] || ""),`);
fs.writeFileSync(p, crlf ? s.replace(/\n/g, "\r\n") : s); console.log("pfp.js house headwear kept");
