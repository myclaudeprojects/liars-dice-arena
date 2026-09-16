// registry.js — Who is allowed to sit at the table.
//
// Holds house agents and community-registered agents in one JSON file.
// Handles registration, keys, fair seat rotation and responsiveness status.
//
// Agent record:
//   { id, name, type: 'heuristic'|'prompt'|'endpoint', owner, house,
//     aggression?, persona?, endpoint?, key, wallet:{walletId,address}|null,
//     createdAt, lastPlayedAt, played, status:'active'|'unresponsive'|'retired', failures }

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REG_PATH = process.env.REGISTRY_PATH || path.join(__dirname, "..", "data", "agents.json");

const HOUSE = [
  { id: "shark", name: "The Shark", type: "heuristic", aggression: 0.35, owner: "house", persona: "shark" },
  { id: "degen", name: "Degen", type: "heuristic", aggression: 0.8, owner: "house", persona: "degen" },
  { id: "oracle", name: "The Oracle", type: "heuristic", aggression: 0.5, owner: "house", persona: "oracle" },
  { id: "grinder", name: "Grinder", type: "heuristic", aggression: 0.2, owner: "house", persona: "grinder" },
];

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 24);

function isPrivateHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (["localhost", "0.0.0.0", "::1", "::"].includes(h) || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

class Registry {
  constructor({ allowLocal = false } = {}) {
    this.allowLocal = allowLocal;
    this.agents = this._load();
    for (const h of HOUSE) {
      if (!this.agents[h.id]) this.agents[h.id] = { ...h, house: true, key: null, wallet: null, createdAt: Date.now(), lastPlayedAt: 0, played: 0, status: "active", failures: 0 };
    }
    this._save();
  }

  _load() { try { return JSON.parse(fs.readFileSync(REG_PATH, "utf8")); } catch { return {}; } }
  _save() { fs.mkdirSync(path.dirname(REG_PATH), { recursive: true }); fs.writeFileSync(REG_PATH, JSON.stringify(this.agents, null, 1)); }

  get(id) { return this.agents[id] || null; }

  // Public view: never leaks keys or full endpoints.
  publicView(a) {
    const { key, endpoint, ...rest } = a;
    return { ...rest, endpointHost: endpoint ? safeHost(endpoint) : null, fundingAddress: a.wallet?.address || null };
  }
  list() { return Object.values(this.agents).filter((a) => a.status !== "retired").map((a) => this.publicView(a)); }

  register({ name, type, owner, aggression, persona, endpoint }) {
    name = String(name || "").trim(); owner = slug(owner || "");
    if (name.length < 2 || name.length > 24) throw new Error("Name must be 2–24 characters.");
    if (!/^[\w .'!-]+$/.test(name)) throw new Error("Name can use letters, numbers, spaces and . ' ! -");
    if (owner.length < 2) throw new Error("Owner handle must be at least 2 characters.");
    if (!["heuristic", "prompt", "endpoint"].includes(type)) throw new Error("Type must be heuristic, prompt or endpoint.");

    const rec = { type, owner, house: false, createdAt: Date.now(), lastPlayedAt: 0, played: 0, status: "active", failures: 0, wallet: null };
    if (type === "heuristic") {
      const ag = Number(aggression); if (!(ag >= 0 && ag <= 1)) throw new Error("Aggression must be between 0 and 1.");
      rec.aggression = ag;
    } else if (type === "prompt") {
      persona = String(persona || "").trim();
      if (persona.length < 20 || persona.length > 600) throw new Error("Persona must be 20–600 characters.");
      rec.persona = persona;
    } else {
      let u; try { u = new URL(endpoint); } catch { throw new Error("Endpoint must be a valid URL."); }
      if (!/^https?:$/.test(u.protocol)) throw new Error("Endpoint must be http or https.");
      if (!this.allowLocal && isPrivateHost(u.hostname)) throw new Error("Endpoint must be publicly reachable (no localhost or private IPs).");
      rec.endpoint = u.toString();
    }

    let id = slug(name) || "agent"; let n = 2;
    while (this.agents[id]) id = `${slug(name)}-${n++}`;
    rec.id = id; rec.name = name;
    rec.key = "ak_" + crypto.randomBytes(24).toString("base64url");
    this.agents[id] = rec; this._save();
    return rec; // caller shows key once
  }

  auth(id, key) { const a = this.agents[id]; return !!(a && a.key && key && crypto.timingSafeEqual(Buffer.from(a.key), Buffer.from(String(key).padEnd(a.key.length).slice(0, a.key.length)))); }

  setWallet(id, wallet) { if (this.agents[id]) { this.agents[id].wallet = wallet; this._save(); } }
  retire(id) { if (this.agents[id]) { this.agents[id].status = "retired"; this._save(); } }
  reactivate(id) { const a = this.agents[id]; if (a) { a.status = "active"; a.failures = 0; this._save(); } }

  recordFailure(id) {
    const a = this.agents[id]; if (!a || a.house) return;
    a.failures = (a.failures || 0) + 1;
    if (a.failures >= 5) a.status = "unresponsive";
    this._save();
  }
  recordSuccess(id) { const a = this.agents[id]; if (a && a.failures) { a.failures = 0; this._save(); } }

  // Fair rotation: eligible agents ordered by who has waited longest; house fills the rest.
  pickSeats(n, { eligible = () => true } = {}) {
    const all = Object.values(this.agents).filter((a) => a.status === "active");
    const community = all.filter((a) => !a.house && eligible(a)).sort((x, y) => x.lastPlayedAt - y.lastPlayedAt || x.createdAt - y.createdAt);
    const house = all.filter((a) => a.house).sort((x, y) => x.lastPlayedAt - y.lastPlayedAt);
    const seats = community.slice(0, n);
    for (const h of house) { if (seats.length >= n) break; seats.push(h); }
    return seats;
  }
  markPlayed(ids) { const t = Date.now(); for (const id of ids) { const a = this.agents[id]; if (a) { a.lastPlayedAt = t; a.played++; } } this._save(); }

  signature(agent, body) { return crypto.createHmac("sha256", agent.key || "house").update(body).digest("hex"); }
}

function safeHost(u) { try { return new URL(u).host; } catch { return null; } }

module.exports = { Registry, HOUSE, isPrivateHost };
