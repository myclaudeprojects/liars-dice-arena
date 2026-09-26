// A chosen portrait decides archetype and play style. The spectator does not.
const fs = require("fs");
const os = require("os");
const path = require("path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lda-persona-"));
const manifest = path.join(dir, "manifest.json");
fs.writeFileSync(manifest, JSON.stringify({
  entries: [
    {
      id: "face_robot",
      file: "face_robot.webp",
      tags: {
        archetype: "robot_ai",
        bodyType: "full_robot",
        expression: "intellectual",
        attire: "cyber_gear",
        colorPalette: "cyan",
        background: "tech_lab",
        accessories: "none",
      },
      house: null,
    },
    {
      id: "face_celeb",
      file: "face_celeb.webp",
      tags: {
        archetype: "celebrity",
        bodyType: "female_athletic",
        expression: "unhinged",
        attire: "luxury",
        colorPalette: "red",
        background: "casino",
        accessories: "jewelry",
      },
      house: null,
    },
    {
      id: "face_house",
      file: "face_house.webp",
      tags: { archetype: "executive", expression: "serious", attire: "formal" },
      house: "dracula",
    },
  ],
}));
process.env.PORTRAIT_LIB = manifest;

const { Show } = require("../src/showrunner");
const { personaFromPortrait } = require("../src/brandcreate");
const { suggestLaunch, HOUSE_LAUNCH_DEFAULTS } = require("../src/argus/launch");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

function boot(file) {
  return new Show({
    dataPath: file,
    sleep: async () => {},
    pickWindowMs: 0,
    turnDelayMs: 0,
    revealDelayMs: 0,
    settleHoldMs: 0,
    bootstrapCount: 0,
    loopEnabled: false,
    marketsEnabled: false,
  });
}

const robot = personaFromPortrait({
  archetype: "robot_ai",
  bodyType: "full_robot",
  expression: "intellectual",
  attire: "cyber_gear",
}, "face_robot");
eq(robot.archetype, "MACHINE", "a robot face plays as Machine");
assert(robot.personality.calculation >= 0.9, "intellectual machine stays calculated");
eq(JSON.stringify(robot), JSON.stringify(personaFromPortrait({
  archetype: "robot_ai",
  bodyType: "full_robot",
  expression: "intellectual",
  attire: "cyber_gear",
}, "face_robot")), "the same portrait always maps the same persona");

const celeb = personaFromPortrait({
  archetype: "celebrity",
  expression: "unhinged",
  attire: "luxury",
}, "face_celeb");
eq(celeb.archetype, "GAMBLER", "a celebrity face plays as Gambler");
assert(celeb.personality.chaos > 0.45, "an unhinged face is chaotic");
assert(celeb.archetype !== robot.archetype, "different faces do not share an archetype");

(async () => {
  const show = boot(path.join(dir, "show.json"));
  const offer = show.offerPortraits({ count: 8, seed: "test" });
  assert(offer.portraits.length === 2, "house portraits are not offered");
  assert(offer.portraits.every((row) => row.id && row.url && row.archetypeLabel && row.playstyleSummary), "offer shows the derived play style");
  assert(!offer.portraits.some((row) => row.archetype), "the offer does not hand back a choosable archetype id");

  let housed = false;
  try { show.createAgent({ name: "Nightshade", portraitId: "face_house" }); }
  catch (e) { housed = e.code === "unknown_portrait"; }
  assert(housed, "a house portrait cannot be chosen");

  const made = show.createAgent({
    name: "Nightshade",
    shortDescription: "Deals in silence and waits.",
    archetype: "PIRATE",
    personality: { aggression: 0.1, bluffing: 0.1, discipline: 0.1, chaos: 0.1 },
    portraitId: "face_robot",
  });
  eq(made.agent.name, "LDA Nightshade", "typed name is stored with the LDA prefix");
  eq(made.agent.archetype, "MACHINE", "client archetype is ignored");
  eq(made.shortDescription, "Deals in silence and waits.", "typed description is kept");
  eq(made.identity.playstyleSummary, robot.playstyleSummary, "play style comes from the portrait");
  const draft = show.userAgents.get(made.agent.id);
  eq(draft.personality.calculation, robot.personality.calculation, "personality sliders come from the portrait");
  assert(draft.personality.aggression !== 0.1, "a supplied pirate personality does not stick");

  const locked = await show.generatePortrait(made.agent.id, { portraitId: "face_robot" });
  eq(locked.brand.portrait.id, "face_robot", "the selected portrait is the canonical image");
  eq(locked.brand.portrait.file, "face_robot.webp", "the library file is stored");
  eq(locked.brand.archetype, "MACHINE", "the locked brand keeps the derived archetype");
  assert(String(locked.brand.assets.canonicalPfp).includes("face_robot.webp"), "canonical url is the portrait");

  let taken = false;
  try { show.createAgent({ name: "Other", portraitId: "face_robot" }); }
  catch (e) { taken = e.code === "portrait_taken"; }
  assert(taken, "a used portrait cannot be chosen again");

  const celebAgent = show.createAgent({
    name: "Velvet",
    shortDescription: "Laughs once and raises.",
    portraitId: "face_celeb",
  });
  eq(celebAgent.agent.archetype, "GAMBLER", "the second face maps its own archetype");

  const suggested = suggestLaunch({
    name: made.agent.name,
    description: made.shortDescription,
    siteUrl: HOUSE_LAUNCH_DEFAULTS.siteUrl,
    xUrl: HOUSE_LAUNCH_DEFAULTS.xUrl,
    telegramUrl: "",
    creatorFeeWallet: HOUSE_LAUNCH_DEFAULTS.creatorFeeWallet,
    canonicalPfp: locked.brand.assets.canonicalPfp,
    publicBase: "https://liars-dice-arena.onrender.com",
    agentId: made.agent.id,
  });
  eq(suggested.launchName, "LDA Nightshade", "token name keeps the LDA prefix");
  eq(suggested.launchWebsite, "https://liarsdicearc.app/", "token website is the LDA site");
  eq(suggested.launchX, "https://x.com/LiarsDiceArc", "token X is the LDA account");
  eq(suggested.launchTelegram, "", "telegram stays empty");
  eq(suggested.launchCreator, "100", "creator share stays 100");
  eq(suggested.creatorFeeWallet, "0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488", "creator fees target the house wallet");
  assert(suggested.launchDescription.includes("Deals in silence and waits."), "token description keeps the typed line");
  assert(suggested.launchDescription.includes("Play at https://liarsdicearc.app/"), "token description points at the site");
  assert(suggested.launchImage.includes("face_robot.webp"), "token image is the portrait");

  const token = "0x" + "ab".repeat(20);
  show.attachArgusMint(made.agent.id, {
    txHash: "0x" + "cd".repeat(32),
    poolId: "0x" + "11".repeat(32),
    tokenAddress: token,
    creatorWallet: HOUSE_LAUNCH_DEFAULTS.creatorFeeWallet,
    symbol: "NIGHTSHADE",
  });
  const detail = show.agentDetail(made.agent.id);
  eq(detail.argus.tokenAddress, token, "profile stores the token address");
  eq(detail.argus.argusUrl, "https://argus.world/token/" + token, "profile links to the Argus token");
  eq(detail.playable, true, "a minted agent still plays");

  const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert(app.includes("Buy on Argus"), "profile can open the token");
  assert(app.includes("View profile"), "create reveal can open the profile");
  assert(app.includes("oneShotLaunchParams"), "the mint payload is built from the saved agent");

  console.log("portraitpersona ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
