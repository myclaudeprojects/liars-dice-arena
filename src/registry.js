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
const dns = require("dns").promises;
const avatar = require("./avatar");

const REG_PATH = process.env.REGISTRY_PATH || path.join(__dirname, "..", "data", "agents.json");

const HOUSE = [
  { id: "shark", name: "The Shark", type: "heuristic", aggression: 0.35, owner: "house", persona: "shark" },
  { id: "degen", name: "Degen", type: "heuristic", aggression: 0.8, owner: "house", persona: "degen" },
  { id: "oracle", name: "The Oracle", type: "heuristic", aggression: 0.5, owner: "house", persona: "oracle" },
  { id: "grinder", name: "Grinder", type: "heuristic", aggression: 0.2, owner: "house", persona: "grinder" },
];

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 24);

function isPrivateHost(host) {
  if (!host) return true;
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (["localhost", "0.0.0.0", "::1", "::", "127.0.0.1"].includes(h)) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return true;
  if (h.startsWith("::ffff:")) return isPrivateHost(h.slice(7));
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (h.includes(":")) {
    if (h === "::1" || /^0:0:0:0:0:0:0:1$/.test(h)) return true;
    const first = h.split(":")[0] || "0";
    const n = parseInt(first.padEnd(4, "0").slice(0, 4), 16);
    if (Number.isFinite(n) && ((n & 0xfe00) === 0xfc00 || (n & 0xffc0) === 0xfe80)) return true;
  }
  return false;
}

function isCloudMetadata(addr) {
  const a = String(addr || "").toLowerCase().replace(/^\[|\]$/g, "");
  return a === "169.254.169.254" || a === "fd00:ec2::254" || a === "metadata.google.internal";
}

// Resolve and reject private/link-local/metadata targets (SSRF). Cloud metadata
// is always blocked, even when localhost endpoints are allowed for local dev.
async function assertSafeAgentUrl(endpoint, { allowLocal = false, lookup = dns.lookup } = {}) {
  let u;
  try { u = new URL(endpoint); } catch { throw new Error("Endpoint must be a valid URL."); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Endpoint must be http or https.");
  if (isCloudMetadata(u.hostname)) throw new Error("Endpoint must be publicly reachable.");
  if (!allowLocal && isPrivateHost(u.hostname)) throw new Error("Endpoint must be publicly reachable (no localhost or private IPs).");
  let addr;
  try { ({ address: addr } = await lookup(u.hostname)); } catch { throw new Error("Endpoint hostname could not be resolved."); }
  if (isCloudMetadata(addr) || (!allowLocal && isPrivateHost(addr))) {
    throw new Error("Endpoint must be publicly reachable (no localhost or private IPs).");
  }
  return u.toString();
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

  // Public view: never leaks keys, full endpoints, or avatar filenames on disk.
  publicView(a) {
    const { key, endpoint, avatar: avRaw, ...rest } = a;
    const av = avatar.publicMeta(a.id, avRaw);
    return {
      ...rest,
      avatar: av,
      imageUrl: av.url,
      endpointHost: endpoint ? safeHost(endpoint) : null,
      fundingAddress: a.wallet?.address || null,
      token: a.token || null,
    };
  }
  list() { return Object.values(this.agents).filter((a) => a.status !== "retired").map((a) => this.publicView(a)); }

  register({ name, type, owner, aggression, persona, endpoint, ownerAddress }) {
    name = String(name || "").trim();
    if (!ownerAddress || !/^0x[0-9a-fA-F]{40}$/.test(String(ownerAddress))) {
      throw new Error("Connect your wallet — creator fees go to that address, not the arena's.");
    }
    // Happy path is Connect → name → Create. Handle is optional; default from the wallet.
    owner = slug(owner || "") || ("0x" + String(ownerAddress).slice(-6).toLowerCase());
    if (owner.length < 2) owner = "creator";
    if (name.length < 2 || name.length > 24) throw new Error("Name must be 2–24 characters.");
    if (!/^[\w .'!-]+$/.test(name)) throw new Error("Name can use letters, numbers, spaces and . ' ! -");
    type = type || "heuristic";
    if (!["heuristic", "prompt", "endpoint"].includes(type)) throw new Error("Type must be heuristic, prompt or endpoint.");

    const rec = { type, owner, house: false, createdAt: Date.now(), lastPlayedAt: 0, played: 0, status: "active", failures: 0, wallet: null, token: null, ownerAddress: String(ownerAddress) };
    if (type === "heuristic") {
      const ag = (aggression == null || aggression === "") ? 0.5 : Number(aggression);
      if (!(ag >= 0 && ag <= 1)) throw new Error("Aggression must be between 0 and 1.");
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

  auth(id, key) {
    const a = this.agents[id];
    if (!a || !a.key || key == null) return false;
    const ka = Buffer.from(a.key);
    const kb = Buffer.from(String(key));
    if (ka.length !== kb.length) return false;
    return crypto.timingSafeEqual(ka, kb);
  }

  setWallet(id, wallet) { if (this.agents[id]) { this.agents[id].wallet = wallet; this._save(); } }
  setToken(id, token) { if (this.agents[id]) { this.agents[id].token = token; this._save(); } }
  setAvatar(id, av) { if (this.agents[id]) { this.agents[id].avatar = av; this._save(); } }
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
  // excludeIds: community agents already seated at another live table (one wallet ⇒ one table).
  pickSeats(n, { eligible = () => true, excludeIds = [] } = {}) {
    const skip = new Set(excludeIds);
    const all = Object.values(this.agents).filter((a) => a.status === "active" && !skip.has(a.id));
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

module.exports = { Registry, HOUSE, isPrivateHost, isCloudMetadata, assertSafeAgentUrl };
