// stats.js — Persistent match history + leaderboard. Plain JSON on disk.
// On Render, point STATS_PATH at a persistent disk (or swap for Postgres later);
// without one, stats reset on each deploy — fine for a launch.

const fs = require("fs");
const path = require("path");

const STATS_PATH = process.env.STATS_PATH || path.join(__dirname, "..", "data", "stats.json");

const EMPTY = {
  matches: [], agents: {}, tippers: {},
  totals: { matches: 0, usdcSettled: 0, tips: 0, tipsUsdc: 0 },
};

function load() {
  try { return { ...EMPTY, ...JSON.parse(fs.readFileSync(STATS_PATH, "utf8")) }; }
  catch { return structuredClone(EMPTY); }
}

function save(s) {
  fs.mkdirSync(path.dirname(STATS_PATH), { recursive: true });
  fs.writeFileSync(STATS_PATH, JSON.stringify(s));
}

function elo(ratingA, ratingB, aWon, k = 24) {
  const ea = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  return ratingA + k * ((aWon ? 1 : 0) - ea);
}

class Stats {
  constructor() { this.s = load(); this.s.totals = { ...EMPTY.totals, ...this.s.totals }; }

  agent(id, name, kind) {
    const a = (this.s.agents[id] ||= {
      id, name, kind, played: 0, won: 0, usdcWon: 0, usdcLost: 0,
      bluffsCaught: 0, bluffsLanded: 0, callsRight: 0, callsWrong: 0, elo: 1200, form: [],
    });
    a.name = name; a.kind = kind; a.form = a.form || [];
    a.usdcWon = a.usdcWon || 0; a.usdcLost = a.usdcLost || 0;
    return a;
  }

  recordMatch({ matchNo, seats, winnerId, potTotal, ante, log, seed, unit = "USDC" }) {
    const winner = this.agent(winnerId, seats.find((s) => s.id === winnerId).name, seats.find((s) => s.id === winnerId).kind);
    for (const s of seats) {
      const a = this.agent(s.id, s.name, s.kind);
      a.played++;
      if (s.id === winnerId) { a.won++; a.usdcWon += potTotal - ante; a.form.unshift("W"); }
      else { a.usdcLost += ante; a.form.unshift("L"); }
      if (a.form.length > 8) a.form.length = 8;
    }
    for (const ev of log) {
      if (ev.type !== "challenge") continue;
      const bidder = this.s.agents[ev.bidderId], ch = this.s.agents[ev.challengerId];
      if (!bidder || !ch) continue;
      if (ev.bidWasTrue) { bidder.bluffsLanded++; ch.callsWrong++; }
      else { bidder.bluffsCaught++; ch.callsRight++; }
    }
    for (const s of seats) {
      if (s.id === winnerId) continue;
      const loser = this.s.agents[s.id];
      const w = winner.elo, l = loser.elo;
      winner.elo = elo(w, l, true); loser.elo = elo(l, w, false);
    }
    this.s.matches.unshift({
      matchNo, at: Date.now(), winnerId, winnerName: winner.name, potTotal,
      unit, hands: log.filter((e) => e.type === "hand_start").length, seed,
    });
    if (this.s.matches.length > 200) this.s.matches.length = 200;
    this.s.totals.matches++;
    this.s.totals.usdcSettled = (this.s.totals.usdcSettled || 0) + potTotal;
    save(this.s);
  }

  recordTip({ from, agentId, amount }) {
    const amt = Number(amount) || 0;
    const sp = (this.s.tippers[from || "anon"] ||= { id: from || "anon", tips: 0, tipped: 0 });
    sp.tips++; sp.tipped += amt;
    this.s.totals.tips = (this.s.totals.tips || 0) + 1;
    this.s.totals.tipsUsdc = Math.round(((this.s.totals.tipsUsdc || 0) + amt) * 1e6) / 1e6;
    const a = this.s.agents[agentId];
    if (a) { a.tipsUsdc = Math.round(((a.tipsUsdc || 0) + amt) * 1e6) / 1e6; a.tipCount = (a.tipCount || 0) + 1; }
    save(this.s);
  }

  leaderboard() {
    const agents = Object.values(this.s.agents).map((a) => ({
      ...a, elo: Math.round(a.elo),
      net: +((a.usdcWon || 0) - (a.usdcLost || 0)).toFixed(2),
      winRate: a.played ? a.won / a.played : 0,
      bluffRate: (a.bluffsLanded + a.bluffsCaught) ? a.bluffsLanded / (a.bluffsLanded + a.bluffsCaught) : null,
      callAccuracy: (a.callsRight + a.callsWrong) ? a.callsRight / (a.callsRight + a.callsWrong) : null,
      form: a.form || [],
    })).sort((x, y) => y.elo - x.elo);
    const tippers = Object.values(this.s.tippers || {}).map((s) => ({
      id: s.id, tips: s.tips || 0, tipped: s.tipped || 0,
    })).sort((x, y) => y.tipped - x.tipped).slice(0, 25);
    const totals = { ...EMPTY.totals, ...this.s.totals };
    return {
      agents, tippers, totals, recent: this.s.matches.slice(0, 20),
    };
  }
}

module.exports = { Stats };
