// stats.js — Persistent match history + leaderboard. Plain JSON on disk.
// On Render, point STATS_PATH at a persistent disk (or swap for Postgres later);
// without one, stats reset on each deploy — fine for a launch.

const fs = require("fs");
const path = require("path");

const STATS_PATH = process.env.STATS_PATH || path.join(__dirname, "..", "data", "stats.json");

const EMPTY = { matches: [], agents: {}, spectators: {}, totals: { matches: 0, usdcSettled: 0, bets: 0 } };

function load() {
  try { return { ...EMPTY, ...JSON.parse(fs.readFileSync(STATS_PATH, "utf8")) }; }
  catch { return structuredClone(EMPTY); }
}

function save(s) {
  fs.mkdirSync(path.dirname(STATS_PATH), { recursive: true });
  fs.writeFileSync(STATS_PATH, JSON.stringify(s));
}

// Simple ELO so the leaderboard means something across models/personas.
function elo(ratingA, ratingB, aWon, k = 24) {
  const ea = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  return ratingA + k * ((aWon ? 1 : 0) - ea);
}

class Stats {
  constructor() { this.s = load(); }

  agent(id, name, kind) {
    const a = (this.s.agents[id] ||= { id, name, kind, played: 0, won: 0, usdcWon: 0, usdcLost: 0, bluffsCaught: 0, bluffsLanded: 0, callsRight: 0, callsWrong: 0, elo: 1200 });
    a.name = name; a.kind = kind; return a;
  }

  // Called with the arena's result + the raw engine log.
  recordMatch({ matchNo, seats, winnerId, potTotal, ante, log, poolTotal, seed }) {
    const winner = this.agent(winnerId, seats.find((s) => s.id === winnerId).name, seats.find((s) => s.id === winnerId).kind);
    for (const s of seats) {
      const a = this.agent(s.id, s.name, s.kind);
      a.played++;
      if (s.id === winnerId) { a.won++; a.usdcWon += potTotal - ante; }
      else a.usdcLost += ante;
    }
    // Bluff / call accounting from challenge events.
    for (const ev of log) {
      if (ev.type !== "challenge") continue;
      const bidder = this.s.agents[ev.bidderId], ch = this.s.agents[ev.challengerId];
      if (!bidder || !ch) continue;
      if (ev.bidWasTrue) { bidder.bluffsLanded++; ch.callsWrong++; }
      else { bidder.bluffsCaught++; ch.callsRight++; }
    }
    // ELO: winner vs each loser pairwise.
    for (const s of seats) {
      if (s.id === winnerId) continue;
      const loser = this.s.agents[s.id];
      const w = winner.elo, l = loser.elo;
      winner.elo = elo(w, l, true); loser.elo = elo(l, w, false);
    }
    this.s.matches.unshift({ matchNo, at: Date.now(), winnerId, winnerName: winner.name, potTotal, poolTotal, hands: log.filter((e) => e.type === "hand_start").length, seed });
    if (this.s.matches.length > 200) this.s.matches.length = 200;
    this.s.totals.matches++; this.s.totals.usdcSettled += potTotal + (poolTotal || 0);
    save(this.s);
  }

  recordBets(bets, winnerId, payouts) {
    for (const b of bets) {
      const sp = (this.s.spectators[b.bettorId] ||= { id: b.bettorId, bets: 0, staked: 0, returned: 0, wins: 0 });
      sp.bets++; sp.staked += b.amount; if (b.agentId === winnerId) sp.wins++;
      this.s.totals.bets++;
    }
    for (const p of payouts) {
      const sp = this.s.spectators[p.bettorId]; if (sp) sp.returned += p.amount;
    }
    save(this.s);
  }

  leaderboard() {
    const agents = Object.values(this.s.agents).map((a) => ({
      ...a, elo: Math.round(a.elo), net: +(a.usdcWon - a.usdcLost).toFixed(2),
      winRate: a.played ? a.won / a.played : 0,
      bluffRate: (a.bluffsLanded + a.bluffsCaught) ? a.bluffsLanded / (a.bluffsLanded + a.bluffsCaught) : null,
      callAccuracy: (a.callsRight + a.callsWrong) ? a.callsRight / (a.callsRight + a.callsWrong) : null,
    })).sort((x, y) => y.elo - x.elo);
    const spectators = Object.values(this.s.spectators).map((s) => ({ ...s, net: +(s.returned - s.staked).toFixed(2) })).sort((x, y) => y.net - x.net).slice(0, 25);
    return { agents, spectators, totals: this.s.totals, recent: this.s.matches.slice(0, 20) };
  }
}

module.exports = { Stats };
