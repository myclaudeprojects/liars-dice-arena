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

const { DICE_SIDES, isHigherBid } = require("./engine");
const { assertSafeAgentUrl } = require("./registry");
const { effectivePlay, influencePrompt } = require("./influence");

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

// ---- MockAgent: a genuinely competent heuristic player -------------------
class MockAgent {
  constructor({ id, name, aggression = 0.5 }) {
    this.id = id;
    this.name = name;
    this.aggression = aggression; // 0..1 — higher = bluffs & pushes more
    this.kind = "mock";
  }

  influenceSnap(view) {
    if (view && view.influence) return view.influence;
    if (typeof this.influenceOf === "function") return this.influenceOf();
    return null;
  }

  async act(view) {
    const { you, currentBid, totalDice, onesWild } = view;
    const unknown = totalDice - you.dice.length;
    const play = effectivePlay(this.aggression, this.influenceSnap(view));
    const aggression = play.aggression;

    // Decide whether to challenge the current bid.
    if (currentBid) {
      const mine = myMatches(you.dice, currentBid.face, onesWild);
      const need = currentBid.count - mine;              // must come from unknown
      const exp = expectedMatches(unknown, currentBid.face, onesWild);
      // Probability the bid is at least true is lower when `need` >> expected.
      // Simple believability score:
      const slack = exp - need;                          // >0 means plausible
      // Challenge more readily when slack is very negative; aggression lowers threshold.
      // Live influence (Aggressive / Defensive / Chaos) shifts challengeEase.
      const challengeThreshold = -1.0 - aggression - play.challengeEase; // e.g. -1.0 to -2.0
      if (slack < challengeThreshold) {
        return {
          action: { type: "challenge" },
          thought: `They need ${need} more ${faceName(currentBid.face)}s from ${unknown} unknown dice (I expect ~${exp.toFixed(1)}). That's a stretch — calling.`,
        };
      }
    }

    // Otherwise make a bid. Base it on what I actually hold + expectation.
    // Pick the face I'm strongest in.
    let bestFace = 2, bestHeld = -1;
    for (let f = 1; f <= DICE_SIDES; f++) {
      const held = myMatches(you.dice, f, onesWild);
      if (held > bestHeld) { bestHeld = held; bestFace = f; }
    }
    const exp = expectedMatches(unknown, bestFace, onesWild);
    let targetCount = Math.max(1, Math.round(bestHeld + exp));

    // Must strictly beat the current bid.
    if (currentBid) {
      if (targetCount < currentBid.count ||
          (targetCount === currentBid.count && bestFace <= currentBid.face)) {
        // bump minimally, sometimes bluff a bit higher based on aggression / bidNudge
        const push = Math.random() < aggression || Math.random() < Math.max(0, play.bidNudge);
        targetCount = currentBid.count + (push ? 1 : 0);
        bestFace = currentBid.count === targetCount
          ? Math.min(DICE_SIDES, currentBid.face + 1)
          : bestFace;
        if (targetCount === currentBid.count && bestFace <= currentBid.face) {
          targetCount = currentBid.count + 1;
        }
      }
    }
    if (play.bidNudge > 0.15 && Math.random() < play.bidNudge) {
      targetCount = Math.min(totalDice, targetCount + 1);
    }
    targetCount = Math.min(targetCount, totalDice);
    if (currentBid && !isHigherBid(currentBid, { count: targetCount, face: bestFace })) {
      return { action: { type: "challenge" }, thought: `Can't go higher than ${currentBid.count}×${currentBid.face} with ${totalDice} dice on the table. Liar.` };
    }
    const bluffing = targetCount > bestHeld + exp + 0.5;
    return {
      action: { type: "bid", count: targetCount, face: bestFace },
      thought: bluffing
        ? `I only really have ${bestHeld}. Pushing ${targetCount}×${faceName(bestFace)} to pressure them.`
        : `Holding ${bestHeld} ${faceName(bestFace)}s, expecting ~${exp.toFixed(1)} more. ${targetCount}×${faceName(bestFace)} is honest.`,
    };
  }
}

// ---- LLMAgent: personality-driven, model-agnostic ------------------------
class LLMAgent {
  constructor({ id, name, persona, complete, model, timeoutMs = 6000 }) {
    this.id = id;
    this.name = name;
    this.persona = persona;      // short character description
    this.complete = complete;    // async ({system,user}) => string
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.kind = "llm";
  }

  influenceSnap(view) {
    if (view && view.influence) return view.influence;
    if (typeof this.influenceOf === "function") return this.influenceOf();
    return null;
  }

  async act(view) {
    const system = buildSystemPrompt(this.persona, influencePrompt(this.influenceSnap(view)));
    const user = buildUserPrompt(view);
    let raw;
    try {
      raw = await withTimeout(
        this.complete({ system, user, model: this.model, timeoutMs: this.timeoutMs }),
        this.timeoutMs
      );
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

function withTimeout(promise, ms) {
  const n = Number(ms);
  if (!(n > 0) || !Number.isFinite(n)) return promise;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), n);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

function buildSystemPrompt(persona, extra = "") {
  const inf = extra ? `\n\n${extra}` : "";
  return `You are a player in a live game of Liar's Dice. You ante free, nonredeemable Arena Credits into a table pot. Spectators may watch, tip your creator with one influence (Aggressive, Calculated, Chaos, or Defensive), and buy your token — they cannot stake on the outcome and are never entitled to winnings. Credits are not money.

${persona}${inf}

RULES: Each die is 1-6. A bid claims "there are at least COUNT dice showing FACE" across ALL dice on the table. Ones are wild (count as any face). Each bid must be strictly higher than the last (higher count, or same count + higher face). Instead of bidding you may challenge the last bid ("call liar"): all dice reveal; if the real total meets the bid, the challenger loses a die, else the bidder does. Losers drop a die; last player with dice wins the pot.

Respond with STRICT JSON only, no prose outside it:
{"thought":"<one punchy sentence of table talk / reasoning>","action":{"type":"bid","count":N,"face":F}}
or
{"thought":"<one punchy sentence>","action":{"type":"challenge"}}`;
}

function buildUserPrompt(view) {
  const you = view.you || { id: "?", name: "?", dice: [] };
  const table = view.table || [];
  const { currentBid, totalDice, onesWild } = view;
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
  if (!obj || !obj.action || typeof obj.action !== "object") return null;
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
  constructor({ id, name, endpoint, sign, timeoutMs = 6000, onResult = () => {}, allowLocal = false }) {
    this.id = id; this.name = name; this.endpoint = endpoint; this.sign = sign;
    this.timeoutMs = timeoutMs; this.onResult = onResult; this.kind = "remote";
    this.allowLocal = allowLocal;
  }
  async act(view) {
    const body = JSON.stringify({ agentId: this.id, view });
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      await assertSafeAgentUrl(this.endpoint, { allowLocal: this.allowLocal });
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

module.exports = { MockAgent, LLMAgent, RemoteAgent, parseAction, safeFallback, expectedMatches, myMatches, withTimeout };
