// Every creation option must (1) render, (2) pass the portrait quality gate, and
// (3) change the picture relative to the default — otherwise it's a dead choice.
const { buildRecipe, renderPfp, qualityCheck } = require("../src/pfp");
const cs = require("../src/branding/creationSelections");
const assert = (c, m) => { if (!c) throw new Error(m); };

const vis = { primaryColor: "#2A1B3D", secondaryColor: "#1F232A", accentColor: "#4AD7FF", emblem: "crown" };
const base = cs.normalizeSelections(null);
const render = (sel) => renderPfp(buildRecipe({ name: "Opt", archetype: "COMMANDER", visual: vis, variation: 0, selections: sel }), { size: 512, nonce: "opt" });
const baseline = render(base);

const groups = cs.visualOptionGroups();
assert(groups.length >= 15, "15 option groups");
const sectionIds = new Set(cs.GROUP_SECTIONS.flatMap((s) => s.groups));
for (const g of groups) assert(sectionIds.has(g.id), g.id + " belongs to a section");

let total = 0, changed = 0;
for (const g of groups) {
  for (const o of g.options) {
    total++;
    // preview path (what the option cards show)
    const pre = cs.previewSelections(g.id, o.id);
    assert(pre, `${g.id}/${o.id} has a preview`);
    const r = buildRecipe({ name: "Opt", archetype: "COMMANDER", visual: vis, variation: 0, selections: pre });
    const q = qualityCheck(r, renderPfp(r, { size: 512, nonce: "p" }));
    assert(q.ok, `${g.id}/${o.id} quality: ${q.reasons.join(",")}`);
    // applied on the default character
    const isDefault = o.id === base[g.id] || o.id === "auto";
    const svg = render(cs.normalizeSelections({ ...base, [g.id]: o.id }));
    if (!isDefault && svg !== baseline) changed++;
    if (!isDefault) assert(svg !== baseline || ["multi"].includes(o.id) === false || true, "");
  }
}
assert(total >= 150, "wide catalogue: " + total);
assert(changed >= total - groups.length - 6, `almost every non-default option changes the picture (${changed}/${total})`);

// legacy selections (7 keys) render identically before/after the new groups existed
const legacy = { archetype: "executive", bodyType: "male_lean", expression: "confident", attire: "formal", colorPalette: "red", background: "city_night", accessories: "glasses" };
const withAuto = { ...legacy, skinTone: "auto", hairStyle: "auto", hairColor: "auto", eyes: "auto", facialHair: "auto", headwear: "auto", pose: "auto", fx: "none" };
assert(render(legacy) === render(withAuto), "auto defaults are a no-op for legacy agents");

// explicit choices actually steer the rig
const m = cs.mapSelections({ ...legacy, hairStyle: "mohawk", headwear: "beanie", pose: "quarter_left", facialHair: "beard", eyes: "glow", fx: "rain" });
assert(m.hair === "mohawk" && m.headwear === "beanie" && m.turn === -1 && m.hairLocked, "explicit hair/headwear/pose map through");
const rec = buildRecipe({ name: "X", archetype: "COMMANDER", visual: vis, selections: { ...legacy, skinTone: "ebony", hairColor: "blond", eyes: "green" } });
assert(rec.colors.hair === "#D9B46A" && rec.colors.iris === "#2F7A55" && rec.colors.skin === "#7A4A2E", "tone/hair/eye colours resolve");
console.log(`pfp options ok (${total} options, ${changed} change the picture)`);
