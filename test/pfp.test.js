// Live portraits are neon-competitive images. The procedural renderer is closed.
const { PFP_STYLE_STAMP, PFP_STYLE_VERSION, promptFor, renderPfp, buildRecipe, validatePfpMetadata } = require("../src/pfp");
const { ImageProvider, NeonImageProvider, createImageProvider } = require("../src/imageprovider");
const { createImage } = require("../src/branding/imageProvider");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

eq(PFP_STYLE_STAMP, 6, "style stamp");
eq(PFP_STYLE_VERSION, "v1", "style version");

const visual = {
  silhouette: "structured_clean",
  facialAttitude: "confident_controlled",
  primaryColor: "#101216",
  secondaryColor: "#1C1F26",
  accentColor: "#F43B5F",
  emblem: "signal_peak",
  backgroundMotif: "city_signal_grid",
  lightingStyle: "crimson_neon_edge",
};
const base = buildRecipe({ name: "Vesper", title: "The Quiet Cipher", archetype: "executive", visual, variation: 1, treatment: "standard" });
const prompt = promptFor(base);
assert(prompt.includes("Premium modern competitive portrait"), "prompt locks the neon description");
assert(prompt.includes("controlled neon accent lighting"), "prompt keeps neon as an accent");
assert(prompt.includes("Not fantasy"), "prompt rejects fantasy");
assert(prompt.includes("readable at 48px"), "prompt targets the small size");
assert(!prompt.includes("lda-pfp-v2"), "prompt does not name the retired renderer");
assert(!prompt.includes("No external image model"), "prompt does not refuse an image model");
assert(!prompt.includes("procedural SVG"), "prompt does not describe an SVG bust");

let retired = false;
try { renderPfp(base); }
catch (err) { retired = err.code === "pfp_procedural_retired"; }
assert(retired, "procedural renderer is closed");

const meta = validatePfpMetadata({ width: 1024, height: 1024, fileSize: 4000 });
assert(meta.ok, "square metadata");
assert(!validatePfpMetadata({ width: 800, height: 600 }).ok, "rejects a landscape");

const live = createImageProvider();
assert(live instanceof NeonImageProvider, "live provider is neon-competitive");
eq(live.id, "neon-competitive", "provider id");

const savedKey = process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;
createImage({ prompt, seed: "x", width: 256, height: 256, visualDNA: visual, archetype: "executive" }).then((image) => {
  if (savedKey) process.env.OPENAI_API_KEY = savedKey;
  assert(image && image.buffer && image.buffer.length > 32, "local portrait without a key");
  eq(image.model, "neon-competitive-local", "local model");
  assert(image.buffer.slice(0, 4).toString() === "RIFF", "webp bytes");
  let threw = false;
  const bare = new ImageProvider();
  return bare.generate({}).catch(() => { threw = true; }).then(() => {
    assert(threw, "base provider stays abstract");
    console.log("pfp ok");
  });
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
