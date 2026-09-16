// engine.js — Pure Liar's Dice logic. No wallets, no LLMs, no I/O.
// This is deterministic and fully unit-testable on its own.
//
// Rules (classic "common hand" Liar's Dice):
//  - Each player starts with N dice (default 5), hidden from others.
//  - A "bid" is a claim: "there are at least <count> dice showing <face>"
//    across ALL players' dice on the table.
//  - Players take turns. Each new bid must strictly raise the previous one
//    (higher count, or same count with a higher face).
//  - Instead of bidding, a player may CHALLENGE ("call liar") the last bid.
//  - On challenge, all dice reveal. Count how many show the bid's face
//    (1s are wild by default — they count as every face).
//      * If actual >= bid.count  -> the challenger loses (bid was true).
//      * else                    -> the bidder loses (bid was a lie).
//  - The loser drops one die. A player with 0 dice is eliminated.
//  - Last player standing wins the hand/match.

const DICE_SIDES = 6;

function rollDie(rng) {
  return 1 + Math.floor(rng() * DICE_SIDES);
}

// Deterministic RNG (mulberry32) so matches are reproducible from a seed.
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Count dice matching a face across every player's hand.
// Ones are wild unwild: pass onesWild=false to disable.
function countFace(hands, face, onesWild = true) {
  let n = 0;
  for (const hand of hands) {
    for (const d of hand) {
      if (d === face) n++;
      else if (onesWild && d === 1 && face !== 1) n++;
    }
  }
  return n;
}

// Is bid B strictly higher than bid A? (A may be null = opening bid.)
function isHigherBid(A, B) {
  if (!A) return B.count >= 1 && B.face >= 1 && B.face <= DICE_SIDES;
  if (B.face < 1 || B.face > DICE_SIDES) return false;
  if (B.count > A.count) return true;
  if (B.count === A.count && B.face > A.face) return true;
  return false;
}

class Match {
  constructor({ seats, diceCount = 5, seed = Date.now(), onesWild = true }) {
    // seats: array of { id, name }
    this.onesWild = onesWild;
    this.diceCount = diceCount;
    this.rng = makeRng(seed);
    this.seed = seed;
    this.players = seats.map((s) => ({
      id: s.id,
      name: s.name,
      dice: [],
      alive: true,
    }));
    this.turnIdx = 0;
    this.currentBid = null;      // { count, face, byId }
    this.handNumber = 0;
    this.log = [];               // structured event log
    this.winnerId = null;
    this._startHand();
  }

  _emit(type, data) {
    const ev = { type, hand: this.handNumber, ...data };
    this.log.push(ev);
    return ev;
  }

  _alivePlayers() {
    return this.players.filter((p) => p.alive);
  }

  _startHand() {
    this.handNumber++;
    this.currentBid = null;
    for (const p of this.players) {
      if (!p.alive) { p.dice = []; continue; }
      p.dice = Array.from({ length: p.diceLeft ?? this.diceCount }, () =>
        rollDie(this.rng)
      );
    }
    // First alive player after previous loser opens; simplest: first alive.
    if (!this._alivePlayers().includes(this.players[this.turnIdx])) {
      this._advanceTurn();
    }
    this._emit("hand_start", {
      counts: this.players.map((p) => ({ id: p.id, dice: p.dice.length })),
    });
  }

  _advanceTurn() {
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (this.turnIdx + i) % n;
      if (this.players[idx].alive) { this.turnIdx = idx; return; }
    }
  }

  get currentPlayer() {
    return this.players[this.turnIdx];
  }

  // Total dice in play — the max a bid count can meaningfully be.
  totalDice() {
    return this._alivePlayers().reduce((s, p) => s + p.dice.length, 0);
  }

  // Public view for a given player: their own dice + everyone's dice counts.
  viewFor(playerId) {
    const me = this.players.find((p) => p.id === playerId);
    return {
      you: { id: me.id, name: me.name, dice: [...me.dice] },
      table: this.players.map((p) => ({
        id: p.id, name: p.name, diceCount: p.dice.length, alive: p.alive,
      })),
      totalDice: this.totalDice(),
      currentBid: this.currentBid ? { ...this.currentBid } : null,
      onesWild: this.onesWild,
      whoseTurn: this.currentPlayer.id,
    };
  }

  // Apply an action from the current player.
  // action = { type: "bid", count, face } | { type: "challenge" }
  // Returns { ok, error?, resolved? }  (resolved describes a challenge outcome)
  applyAction(action) {
    const actor = this.currentPlayer;
    if (this.winnerId) return { ok: false, error: "match_over" };

    if (action.type === "bid") {
      const bid = { count: action.count, face: action.face, byId: actor.id };
      if (!Number.isInteger(bid.count) || !Number.isInteger(bid.face)) {
        return { ok: false, error: "bid_must_be_integers" };
      }
      if (bid.count > this.totalDice()) {
        return { ok: false, error: "bid_exceeds_total_dice" };
      }
      if (!isHigherBid(this.currentBid, bid)) {
        return { ok: false, error: "bid_not_higher" };
      }
      this.currentBid = bid;
      this._emit("bid", { byId: actor.id, name: actor.name, count: bid.count, face: bid.face });
      this._advanceTurn();
      return { ok: true };
    }

    if (action.type === "challenge") {
      if (!this.currentBid) return { ok: false, error: "nothing_to_challenge" };
      const bid = this.currentBid;
      const bidder = this.players.find((p) => p.id === bid.byId);
      const hands = this._alivePlayers().map((p) => p.dice);
      const actual = countFace(hands, bid.face, this.onesWild);
      const bidWasTrue = actual >= bid.count;
      const loser = bidWasTrue ? actor : bidder;   // challenger loses if bid true
      const reveal = this._alivePlayers().map((p) => ({
        id: p.id, name: p.name, dice: [...p.dice],
      }));

      const resolved = {
        challengerId: actor.id,
        bidderId: bidder.id,
        bid: { count: bid.count, face: bid.face },
        actual,
        bidWasTrue,
        loserId: loser.id,
        reveal,
      };
      this._emit("challenge", resolved);

      // Loser drops a die.
      loser.diceLeft = loser.dice.length - 1;
      if (loser.diceLeft <= 0) {
        loser.alive = false;
        loser.diceLeft = 0;
        this._emit("eliminated", { id: loser.id, name: loser.name });
      }

      // Winner of a hand?
      const alive = this._alivePlayers();
      if (alive.length === 1) {
        this.winnerId = alive[0].id;
        this._emit("match_over", { winnerId: this.winnerId, name: alive[0].name });
        return { ok: true, resolved, matchOver: true };
      }

      // Loser (if still alive) starts next hand; else next alive after loser.
      this.turnIdx = this.players.indexOf(loser);
      if (!loser.alive) this._advanceTurn();
      // carry diceLeft into next hand for everyone still alive
      for (const p of this.players) if (p.alive && p.diceLeft == null) p.diceLeft = p.dice.length;
      this._startHand();
      // reset diceLeft markers
      for (const p of this.players) p.diceLeft = p.dice.length;
      return { ok: true, resolved };
    }

    return { ok: false, error: "unknown_action" };
  }
}

module.exports = { Match, countFace, isHigherBid, makeRng, DICE_SIDES };
