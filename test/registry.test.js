const os = require("os");
const fs = require("fs");
const path = require("path");
process.env.REGISTRY_PATH = path.join(os.tmpdir(), "lda-reg-" + process.pid + ".json");
try { fs.unlinkSync(process.env.REGISTRY_PATH); } catch {}

const { Registry, isPrivateHost, isCloudMetadata, assertSafeAgentUrl } = require("../src/registry");

function assert(cond, msg) { if (!cond) throw new Error(msg); }

assert(isPrivateHost("localhost"), "localhost");
assert(isPrivateHost("127.0.0.1"), "loopback");
assert(isPrivateHost("10.0.0.2"), "10/8");
assert(isPrivateHost("192.168.1.1"), "rfc1918");
assert(isPrivateHost("169.254.1.1"), "link-local");
assert(isPrivateHost("::1"), "v6 loopback");
assert(isPrivateHost("::ffff:127.0.0.1"), "v4-mapped");
assert(isPrivateHost("fc00::1"), "unique local");
assert(isPrivateHost("fe80::1"), "v6 link-local");
assert(!isPrivateHost("example.com"), "public host");
assert(!isPrivateHost("8.8.8.8"), "public ip");
assert(isCloudMetadata("169.254.169.254"), "aws metadata");

const addr = (h) => "0x" + String(h).replace(/[^0-9a-f]/gi, "a").padEnd(40, "0").slice(0, 40);

const reg = new Registry({ allowLocal: false });
const rec = reg.register({ name: "Cold Hands", type: "heuristic", owner: "alice", aggression: 0.4, ownerAddress: addr("aa") });
assert(reg.auth(rec.id, rec.key), "exact key");
assert(!reg.auth(rec.id, rec.key + "x"), "suffix must not match");
assert(!reg.auth(rec.id, rec.key.slice(0, -1)), "prefix must not match");
assert(!reg.auth(rec.id, null), "missing");
assert(rec.ownerAddress.toLowerCase() === addr("aa"), "creator stored");

let threw = false;
try { reg.register({ name: "No Wallet", type: "heuristic", owner: "bob", aggression: 0.1 }); }
catch (e) { threw = /Connect your wallet/.test(e.message); }
assert(threw, "creator wallet required");

threw = false;
try { reg.register({ name: "Local Brain", type: "endpoint", owner: "bob", endpoint: "http://127.0.0.1:9/", ownerAddress: addr("bb") }); }
catch (e) { threw = /publicly reachable/.test(e.message); }
assert(threw, "private endpoint refused");

threw = false;
try { reg.register({ name: "Bad Addr", type: "heuristic", owner: "bob", aggression: 0.1, ownerAddress: "0x123" }); }
catch (e) { threw = /Connect your wallet/.test(e.message); }
assert(threw, "bad owner address");

const recSolo = reg.register({ name: "Solo", ownerAddress: addr("cc") });
assert(recSolo.type === "heuristic" && recSolo.aggression === 0.5, "name-only defaults to heuristic 0.5");
assert(/^0x/.test(recSolo.owner) && recSolo.owner.length >= 2, "owner derived from wallet");

const view = reg.publicView(rec);
assert(view.avatar && view.avatar.kind === "generated", "default generated avatar");
assert(/\/api\/agents\/cold-hands\/avatar/.test(view.imageUrl), "public imageUrl");
assert(!view.avatar.file, "no disk filename in public view");
assert(!("key" in view), "no key leak");
reg.setAvatar(rec.id, { kind: "upload", file: "secret.png", mime: "image/png", updatedAt: 1 });
const viewUp = reg.publicView(reg.get(rec.id));
assert(viewUp.avatar.kind === "upload" && !viewUp.avatar.file, "upload kind, file stripped");
assert(viewUp.imageUrl.includes("v=1"), "cache buster");

const extra = [];
for (const n of ["One", "Two", "Three"]) extra.push(reg.register({ name: n, type: "heuristic", owner: "rot", aggression: 0.3, ownerAddress: addr(n) }));
const seated = reg.pickSeats(2, { eligible: () => true, excludeIds: [] });
const skipped = reg.pickSeats(4, { eligible: () => true, excludeIds: seated.map((s) => s.id) });
assert(!skipped.some((s) => seated.map((x) => x.id).includes(s.id)), "pickSeats excludeIds");

(async () => {
  await assertSafeAgentUrl("https://example.com/agent", { allowLocal: false, lookup: async () => ({ address: "93.184.216.34" }) });
  let bad = false;
  try {
    await assertSafeAgentUrl("https://evil.example/agent", { allowLocal: false, lookup: async () => ({ address: "127.0.0.1" }) });
  } catch (e) { bad = /publicly reachable/.test(e.message); }
  assert(bad, "dns rebind to loopback refused");
  bad = false;
  try {
    await assertSafeAgentUrl("http://169.254.169.254/", { allowLocal: true, lookup: async () => ({ address: "169.254.169.254" }) });
  } catch { bad = true; }
  assert(bad, "metadata always refused");
  console.log("registry ok");
})().catch((e) => { console.error(e); process.exit(1); });
