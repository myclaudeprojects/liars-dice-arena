// Batch neon-competitive portraits. No API key.
//
//   node scripts/generateNeonPfps.js
//
// Writes public/assets/agents/{id}/neon-competitive/v1/b1/ unless PFP_ASSET_DIR
// or SHOW_DATA_PATH points the store at the persistent disk.
// PFP_INCLUDE_HOUSE=1 also generates the house cast from seed brands.

const { neonAgents } = require("../src/branding/testAgents");
const { buildPfpPrompt } = require("../src/branding/buildPfpPrompt");
const { createImage } = require("../src/branding/imageProvider");
const { buildVisualDNA, composeVisualDNA } = require("../src/branding/buildVisualDNA");
const { assetRootFor, buildSeed, savePortrait, STYLE_VERSION } = require("../src/branding/pfpAssets");

function houseAgents() {
  const { SEED_BRANDS } = require("../src/brands");
  return SEED_BRANDS.map((brand) => {
    const visual = brand.visualIdentity || {};
    return {
      id: brand.agentId,
      name: brand.name,
      title: brand.title,
      archetype: visual.archetype || brand.archetype,
      brand: {
        visualDNA: composeVisualDNA({
          archetype: brand.archetype,
          visual,
        }),
      },
    };
  });
}

async function run() {
  const agents = neonAgents.slice();
  if (process.env.PFP_INCLUDE_HOUSE === "1") agents.push(...houseAgents());
  const root = assetRootFor(null);
  for (const agent of agents) {
    if (!agent.brand || !agent.brand.visualDNA) {
      agent.brand = { visualDNA: buildVisualDNA({ archetype: agent.archetype }) };
    }
    const styleId = "neon-competitive";
    const seed = buildSeed(agent.id, STYLE_VERSION);
    const prompt = buildPfpPrompt({ agent, styleId });
    const imageResult = await createImage({
      prompt,
      width: 1024,
      height: 1024,
      seed,
      agent,
      visualDNA: agent.brand.visualDNA,
      archetype: agent.archetype,
    });
    await savePortrait({
      root,
      agentId: agent.id,
      version: 1,
      buffer: imageResult.buffer,
      model: imageResult.model,
      prompt,
      seed,
      visualDNA: agent.brand.visualDNA,
      agentName: agent.name,
    });
    console.log(`Generated neon PFP: ${agent.id}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
