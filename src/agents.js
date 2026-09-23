// agents.js — The "brains". Each seat gets an Agent that, given a game view,
// returns an action { type:'bid', count, face } | { type:'challenge' } plus a
// short natural-language "thought" (the entertainment).
//
// Two kinds:
//   MockAgent  — heuristic + probability. No API key. Plays a real, decent game.
//   LLMAgent   — calls a chat model. Personas make Claude/GPT/etc. play differently.
//
// The LLMAgent is model-agnostic: you pass a `complete({system,user})` function.
// A ready Anthropic and OpenAI adapter live in llm.js. This keeps the engine and
// game loop free of any vendor specifics.

const { DICE_SIDES, isHigherBid, makeRng } = require("./engine");

// Decision stream. Separate from the dice rng so a personality change does
// not reshuffle cups that the seed already determined.
function decisionRng(seed) {
  return makeRng((Number(seed) ^ 0x9E3779B9) >>> 0);
}

// Caesar calls on milder negative slack than the gambler's `-1 - aggression`.
// Dracula's aggression is 0.86, so that formula sits at -1.86. -0.55 is tighter.
const CAESAR_CALL_SLACK = -0.55;

function callSlackLimit(agent) {
  if (agent && agent.id === "caesar") return CAESAR_CALL_SLACK;
  const aggression = agent && Number.isFinite(agent.aggression) ? agent.aggression : 0.5;
  return -1 - aggression;
}

// Expected number of dice showing `face` among `unknownDice` dice we can't see,
// with ones wild. Each unknown die matches a given non-1 face with prob 2/6
// (the face itself or a wild 1); for face===1 it's 1/6.
function expectedMatches(unknownDice, face, onesWild) {
  const p = face === 1 ? 1 / DICE_SIDES : (onesWild ? 2 / DICE_SIDES : 1 / DICE_SIDES);
  return unknownDice * p;
}

// How many of `face` do I already hold (wilds included)?
function myMatches(myDice, face, onesWild) {
  let n = 0;
  for (const d of myDice) {
    if (d === face) n++;
    else if (onesWild && d === 1 && face !== 1) n++;
  }
  return n;
}

function faceRanks(dice, onesWild) {
  const rows = [];
  for (let f = 1; f <= DICE_SIDES; f++) rows.push({ face: f, held: myMatches(dice, f, onesWild) });
  rows.sort((a, b) => (b.held - a.held) || (a.face - b.face));
  return rows;
}

function minimumStep(currentBid, totalDice, face) {
  if (!currentBid) return { count: Math.max(1, 1), face: face || 2 };
  if (currentBid.face < DICE_SIDES) return { count: currentBid.count, face: currentBid.face + 1 };
  if (currentBid.count + 1 <= totalDice) return { count: currentBid.count + 1, face: Math.min(DICE_SIDES, Math.max(2, face || 2)) };
  return null;
}

// Facts the show is allowed to store. Bluff means the bid count is above
// the bidder's own matches plus expected matches from dice they cannot see.
function bidFacts(view, action) {
  if (!view || !action || action.type !== "bid") return { bluff: false, step: null, held: 0, expected: 0 };
  const held = myMatches(view.you.dice, action.face, view.onesWild);
  const unknown = view.totalDice - view.you.dice.length;
  const expected = expectedMatches(unknown, action.face, view.onesWild);
  const step = view.currentBid ? action.count - view.currentBid.count : null;
  return { bluff: action.count > held + expected, step, held, expected };
}

function challengeDecision(view, extra) {
  return {
    action: { type: "challenge" },
    thought: extra.thought,
    decision: {
      challenged: true,
      bestFace: extra.bestFace ?? null,
      secondFace: extra.secondFace ?? null,
      chosenFace: null,
      count: null,
      bestHeld: extra.bestHeld ?? 0,
      expected: extra.expected ?? 0,
      bluff: false,
      step: null,
      wild: !!extra.wild,
    },
  };
}

// ---- MockAgent: a genuinely competent heuristic player -------------------
class MockAgent {
  constructor({ id, name, aggression = 0.5, chaos = 0 }) {
    this.id = id;
    this.name = name;
    this.aggression = aggression; // 0..1 — higher = bluffs & pushes more
    this.chaos = chaos; // 0..1 — chance to leave the strongest held face
    this.kind = "mock";
  }

  async act(view, rng) {
    const rand = typeof rng === "function" ? rng : Math.random;
    const { you, currentBid, totalDice, onesWild } = view;
    const unknown = totalDice - you.dice.length;
    const foes = (view.table || []).filter((t) => t.alive && t.id !== you.id);
    const oppDice = foes.reduce((sum, t) => sum + t.diceCount, 0);
    const ahead = foes.length > 0 && you.dice.length > oppDice;

    if (currentBid) {
      const mine = myMatches(you.dice, currentBid.face, onesWild);
      const need = currentBid.count - mine;
      const exp = expectedMatches(unknown, currentBid.face, onesWild);
      const slack = exp - need;
      if (slack < callSlackLimit(this)) {
        return challengeDecision(view, {
          bestHeld: mine,
          expected: exp,
          thought: `They need ${need} more ${faceName(currentBid.face)}s from ${unknown} unknown dice (I expect ~${exp.toFixed(1)}). That's a stretch — calling.`,
        });
      }
    }

    const ranks = faceRanks(you.dice, onesWild);
    const best = ranks[0];
    const second = ranks[1] || null;
    let bestFace = best.face;
    let bestHeld = best.held;
    let wild = false;
    let honestBump = 0;
    let mix = "best";

    if (this.id === "reaper") {
      // Bounded mix, not a uniform face. Wild-branch rate is `chaos`.
      if (rand() < this.chaos) {
        wild = true;
        if (rand() < 0.5 && second) {
          mix = "second";
          bestFace = second.face;
          bestHeld = second.held;
        } else {
          mix = "count";
          honestBump = rand() < 0.5 ? 0 : 1;
        }
      }
    } else if (this.id !== "caesar" && this.chaos > 0 && rand() < this.chaos) {
      bestFace = 1 + Math.floor(rand() * DICE_SIDES);
      bestHeld = myMatches(you.dice, bestFace, onesWild);
    }

    const exp = expectedMatches(unknown, bestFace, onesWild);
    let targetCount = Math.max(1, Math.round(bestHeld + exp) + honestBump);
    let plannedFace = bestFace;

    if (this.id === "caesar") {
      // Minimum legal step, unless the count he already holds is a legal raise.
      // He will not publish a count his dice plus the expected unknowns do not support.
      const heldBid = { count: Math.max(1, best.held), face: best.face };
      const heldSupported = best.held >= 1;
      if (!currentBid) {
        targetCount = heldSupported ? best.held : 1;
        bestFace = best.face;
        bestHeld = best.held;
      } else if (heldSupported && isHigherBid(currentBid, heldBid)) {
        targetCount = heldBid.count;
        bestFace = heldBid.face;
        bestHeld = best.held;
      } else {
        const min = minimumStep(currentBid, totalDice, best.face);
        const minHeld = min ? myMatches(you.dice, min.face, onesWild) : 0;
        const minExp = min ? expectedMatches(unknown, min.face, onesWild) : 0;
        if (!min || min.count > totalDice || !isHigherBid(currentBid, min) || min.count > minHeld + minExp) {
          return challengeDecision(view, {
            bestFace: best.face,
            secondFace: second && second.face,
            bestHeld: best.held,
            expected: exp,
            thought: `The next step is thinner than the dice support. Calling.`,
          });
        }
        targetCount = min.count;
        bestFace = min.face;
        bestHeld = minHeld;
      }
      plannedFace = bestFace;
    } else if (currentBid) {
      const legal = isHigherBid(currentBid, { count: targetCount, face: bestFace });
      if (!legal) {
        let step = rand() < this.aggression ? 1 : 0;
        // Ahead: a larger count step than +1, still gated by aggression.
        // Behind: the same aggressive bump. No separate cautious mode.
        if (this.id === "dracula" && ahead && rand() < this.aggression) step = 2;
        targetCount = currentBid.count + step;
        bestFace = currentBid.count === targetCount
          ? Math.min(DICE_SIDES, currentBid.face + 1)
          : bestFace;
        if (targetCount === currentBid.count && bestFace <= currentBid.face) {
          targetCount = currentBid.count + 1;
        }
      } else if (this.id === "dracula" && ahead && rand() < this.aggression) {
        const jumped = Math.min(totalDice, targetCount + 1);
        if (isHigherBid(currentBid, { count: jumped, face: bestFace })) targetCount = jumped;
      }
    } else if (this.id === "dracula" && ahead && rand() < this.aggression) {
      targetCount = Math.min(totalDice, targetCount + 1);
    }

    targetCount = Math.min(Math.max(1, targetCount), totalDice);
    const heldNow = myMatches(you.dice, bestFace, onesWild);
    const expNow = expectedMatches(unknown, bestFace, onesWild);
    if (currentBid && !isHigherBid(currentBid, { count: targetCount, face: bestFace })) {
      return challengeDecision(view, {
        bestFace: best.face,
        secondFace: second && second.face,
        bestHeld: heldNow,
        expected: expNow,
        wild,
        thought: `Can't go higher than ${currentBid.count}×${currentBid.face} with ${totalDice} dice on the table. Liar.`,
      });
    }
    const bluffing = targetCount > heldNow + expNow;
    const step = currentBid ? targetCount - currentBid.count : null;
    return {
      action: { type: "bid", count: targetCount, face: bestFace },
      thought: bluffing
        ? `I only really have ${heldNow}. Pushing ${targetCount}×${faceName(bestFace)} to pressure them.`
        : `Holding ${heldNow} ${faceName(bestFace)}s, expecting ~${expNow.toFixed(1)} more. ${targetCount}×${faceName(bestFace)} is honest.`,
      decision: {
        challenged: false,
        bestFace: best.face,
        secondFace: second ? second.face : null,
        chosenFace: bestFace,
        count: targetCount,
        bestHeld: heldNow,
        expected: expNow,
        bluff: bluffing,
        step,
        wild,
        mix,
        plannedFace,
        ahead,
      },
    };
  }
}

// ---- LLMAgent: personality-driven, model-agnostic ------------------------
class LLMAgent {
  constructor({ id, name, persona, complete, model }) {
    this.id = id;
    this.name = name;
    this.persona = persona;      // short character description
    this.complete = complete;    // async ({system,user}) => string
    this.model = model;
    this.kind = "llm";
  }

  async act(view) {
    const system = buildSystemPrompt(this.persona);
    const user = buildUserPrompt(view);
    let raw;
    try {
      raw = await this.complete({ system, user, model: this.model });
    } catch (e) {
      // On any model error, fall back to a safe legal move so the match never stalls.
      return safeFallback(view, `model error: ${e.message}`);
    }
    const parsed = parseAction(raw, view);
    if (!parsed) return safeFallback(view, "unparseable model reply");
    return parsed;
  }
}

function faceName(f) { return String(f); }

function buildSystemPrompt(persona) {
  return `You are a player in a live game of Liar's Dice, betting real USDC on the Arc blockchain. Spectators are watching.

${persona}

RULES: Each die is 1-6. A bid claims "there are at least COUNT dice showing FACE" across ALL dice on the table. Ones are wild (count as any face). Each bid must be strictly higher than the last (higher count, or same count + higher face). Instead of bidding you may challenge the last bid ("call liar"): all dice reveal; if the real total meets the bid, the challenger loses a die, else the bidder does. Losers drop a die; last player with dice wins the pot.

Respond with STRICT JSON only, no prose outside it:
{"thought":"<one punchy sentence of table talk / reasoning>","action":{"type":"bid","count":N,"face":F}}
or
{"thought":"<one punchy sentence>","action":{"type":"challenge"}}`;
}

function buildUserPrompt(view) {
  const { you, table, currentBid, totalDice, onesWild } = view;
  const others = table.filter((t) => t.id !== you.id && t.alive)
    .map((t) => `${t.name}(${t.diceCount} dice)`).join(", ");
  return `Your dice: [${you.dice.join(", ")}]
Total dice in play: ${totalDice}
Opponents: ${others}
Ones wild: ${onesWild}
Current bid: ${currentBid ? `${currentBid.count} × face ${currentBid.face}` : "none (you open)"}

It's your turn. Give your JSON.`;
}

// Parse + validate the model's action against the current view. Returns
// {action, thought} or null.
function parseAction(raw, view) {
  let obj;
  try {
    const cleaned = String(raw).replace(/```json|```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch { return null; }
  if (!obj || !obj.action) return null;
  const thought = typeof obj.thought === "string" ? obj.thought.slice(0, 200) : "";
  const a = obj.action;
  if (a.type === "challenge") {
    if (!view.currentBid) return null; // illegal to challenge nothing
    return { action: { type: "challenge" }, thought };
  }
  if (a.type === "bid") {
    const count = Number(a.count), face = Number(a.face);
    if (!Number.isInteger(count) || !Number.isInteger(face)) return null;
    if (face < 1 || face > DICE_SIDES) return null;
    if (count < 1 || count > view.totalDice) return null;
    if (!isHigherBid(view.currentBid, { count, face })) return null;
    return { action: { type: "bid", count, face }, thought };
  }
  return null;
}

// A guaranteed-legal move for when the model misbehaves.
function safeFallback(view, why) {
  if (view.currentBid) {
    // minimal legal raise, or challenge if we're at the ceiling
    let count = view.currentBid.count, face = view.currentBid.face + 1;
    if (face > DICE_SIDES) { face = 2; count++; }
    if (count > view.totalDice) {
      return { action: { type: "challenge" }, thought: `(${why}) At the ceiling — calling.` };
    }
    return { action: { type: "bid", count, face }, thought: `(${why}) Safe raise.` };
  }
  return { action: { type: "bid", count: 1, face: 2 }, thought: `(${why}) Opening light.` };
}

// ---- RemoteAgent: a community agent behind an HTTP endpoint --------------
// Each turn: POST { agentId, view } as JSON. Headers:
//   x-arena-signature: hex HMAC-SHA256 of the raw body using the agent's key
//   x-arena-agent: the agent id
// Reply within `timeoutMs` with {"thought":"...","action":{...}} (same shape as LLMAgent).
class RemoteAgent {
  constructor({ id, name, endpoint, sign, timeoutMs = 6000, onResult = () => {} }) {
    this.id = id; this.name = name; this.endpoint = endpoint; this.sign = sign;
    this.timeoutMs = timeoutMs; this.onResult = onResult; this.kind = "remote";
  }
  async act(view) {
    const body = JSON.stringify({ agentId: this.id, view });
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const r = await fetch(this.endpoint, {
        method: "POST", signal: ctrl.signal, redirect: "error",
        headers: { "content-type": "application/json", "x-arena-agent": this.id, "x-arena-signature": this.sign(body) },
        body,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = (await r.text()).slice(0, 4000);
      const parsed = parseAction(text, view);
      if (!parsed) { this.onResult(false, "unparseable or illegal reply"); return safeFallback(view, "bad reply"); }
      this.onResult(true); return parsed;
    } catch (e) {
      const why = e.name === "AbortError" ? "timeout" : e.message;
      this.onResult(false, why); return safeFallback(view, why);
    } finally { clearTimeout(t); }
  }
}

module.exports = {
  MockAgent, LLMAgent, RemoteAgent, parseAction, safeFallback,
  expectedMatches, myMatches, bidFacts, decisionRng, callSlackLimit,
};
