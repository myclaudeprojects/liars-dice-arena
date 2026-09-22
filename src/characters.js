// characters.js — The cast. Personality is a strategy, not a costume.
// Records, streaks, and rivalries are filled by matches actually played.

const { MockAgent } = require("./agents");

const CAST = [
  {
    id: "dracula",
    name: "Dracula",
    archetype: "The Gambler",
    style: ["Aggressive", "High pressure", "High variance"],
    aggression: 0.86,
    chaos: 0.12,
    hue: 350,
    line: "Loves pressure. Takes unusual risks.",
    weakness: "Overconfidence when he is ahead.",
    strength: "Pushing timid opponents off honest bids.",
  },
  {
    id: "caesar",
    name: "Caesar",
    archetype: "The Strategist",
    style: ["Patient", "Calculating", "Tight"],
    aggression: 0.22,
    chaos: 0.02,
    hue: 38,
    line: "Patient. Forces uncomfortable decisions.",
    weakness: "Can give one bid too many before he calls.",
    strength: "Waiting until a claim is actually thin.",
  },
  {
    id: "reaper",
    name: "The Reaper",
    archetype: "The Chaos Agent",
    style: ["Unpredictable", "High variance"],
    aggression: 0.58,
    chaos: 0.62,
    hue: 152,
    line: "Difficult to read. Sometimes brilliant, sometimes ridiculous.",
    weakness: "The wild bid that was never there.",
    strength: "You cannot study a pattern that is not there.",
  },
  {
    id: "athena",
    name: "Athena",
    archetype: "The Reader",
    style: ["Conservative", "Probability"],
    aggression: 0.16,
    chaos: 0.04,
    hue: 208,
    line: "Calls when the math is ugly. Rarely bluffs for fun.",
    weakness: "Pure pressure can walk her backward.",
    strength: "She knows what the table can hold.",
  },
  {
    id: "shark",
    name: "The Shark",
    archetype: "The Pressure Player",
    style: ["Pressure", "Bluffer"],
    aggression: 0.5,
    chaos: 0.18,
    hue: 174,
    line: "Smells a thin bid and leans on it.",
    weakness: "Calls an honest run one die too early.",
    strength: "Making the next bid feel expensive.",
  },
  {
    id: "oracle",
    name: "The Oracle",
    archetype: "The Clock",
    style: ["Steady", "Low variance"],
    aggression: 0.38,
    chaos: 0.05,
    hue: 262,
    line: "Rarely spectacular. Rarely foolish.",
    weakness: "A student can learn the rhythm.",
    strength: "Does not beat themselves.",
  },
];

const BY_ID = Object.fromEntries(CAST.map((c) => [c.id, c]));

function character(id) {
  const c = BY_ID[id];
  if (!c) throw new Error("unknown_character");
  return c;
}

function makePlayer(id) {
  const c = character(id);
  return new MockAgent({ id: c.id, name: c.name, aggression: c.aggression, chaos: c.chaos });
}

// Round-robin of every pairing. Bootstrap can skip a debut so "new" is real.
function pairSchedule(excludeId) {
  const ids = CAST.map((c) => c.id).filter((id) => id !== excludeId);
  const pairs = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i], ids[j]]);
  }
  return pairs;
}

module.exports = { CAST, BY_ID, character, makePlayer, pairSchedule };
