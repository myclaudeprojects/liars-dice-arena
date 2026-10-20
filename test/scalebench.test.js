// Scale bench: a synthetic roster the size of production (and past it).
// Prints timings. Asserts /health stays quick while the book is written,
// ?limit= actually limits, and create does not scan the whole roster per attempt.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { Show } = require("../src/showrunner");
const { EMBLEM_IDS } = require("../src/brandcreate");
const { handleShow } = require("../src/showhttp");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

const N = Number(process.env.BENCH_N || 12000);

function hex(n) {
  return "#" + ((n >>> 0) % 0x1000000).toString(16).padStart(6, "0");
}

function opts(file, extra) {
  return {
    dataPath: file,
    sleep: async () => {},
    pickWindowMs: 0,
    turnDelayMs: 0,
    revealDelayMs: 0,
    settleHoldMs: 0,
    bootstrapCount: 0,
    loopEnabled: false,
    marketsEnabled: false,
    asyncPersist: true,
    persistDelayMs: 20,
    persistMaxDelayMs: 60,
    ...extra,
  };
}

function seed(show, n) {
  const template = show.brands.full("dracula");
  const silhouettes = ["TALL_SHARP", "BROAD_IMPOSING", "SLIM_ELEGANT", "ROBED_MYSTIC", "MECHANICAL", "ASYMMETRIC_CHAOTIC"];
  for (let i = 0; i < n; i++) {
    const id = "u_b" + i;
    const brand = {
      ...template,
      agentId: id,
      brandVersion: "v1",
      version: 1,
      name: "LDA Bench" + i,
      title: "ZXQ" + i + "W",
      personality: { ...template.personality },
      visualIdentity: {
        ...template.visualIdentity,
        primaryColor: hex(i * 997),
        secondaryColor: hex(i * 997 + 80),
        accentColor: hex(i * 997 + 160),
        emblem: EMBLEM_IDS[i % EMBLEM_IDS.length],
        silhouette: silhouettes[i % silhouettes.length],
      },
      assets: { ...template.assets },
      generation: { ...template.generation },
      portrait: { id: "p" + i, file: "p" + i + ".webp" },
    };
    show.brands._versions.set(id + ":v1", brand);
    show.brands._indexEmblem(brand);
    show.brands._active.set(id, "v1");
    show.brands._meta.set(id, {
      agentId: id,
      activeBrandVersion: "v1",
      status: "READY",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    });
    const createdAt = new Date(Date.UTC(2020, 0, 1) + i * 1000).toISOString();
    show.userAgents.set(id, {
      id,
      name: "LDA Bench" + i,
      status: "READY",
      roster: "user",
      archetype: "GAMBLER",
      archetypeLabel: "Gambler",
      createdAt,
      updatedAt: createdAt,
      sheet: { id, name: "LDA Bench" + i, archetype: "Gambler", style: ["Created"], aggression: 0.5, chaos: 0.2, hue: 40, line: "line", weakness: "w", strength: "s" },
      portraitId: "p" + i,
      concepts: [],
      argus: null,
    });
    show.records.ensure(id);
  }
  show._orderIds = null;
  show._portraitCache = null;
  show._reindexNames();
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lda-scale-"));
  const file = path.join(dir, "show.json");
  const show = new Show(opts(file));
  show.ready = true;
  const seedT = Date.now();
  seed(show, N);
  const seedMs = Date.now() - seedT;

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://local");
    if (u.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, phase: show.phase }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  function get(pathname) {
    return new Promise((resolve, reject) => {
      const t = Date.now();
      const req = http.get({ hostname: "127.0.0.1", port, path: pathname }, (res) => {
        res.resume();
        res.on("end", () => resolve(Date.now() - t));
      });
      req.on("error", reject);
    });
  }

  async function hammerDuring(work) {
    const samples = [];
    let stop = false;
    const loop = (async () => {
      while (!stop) samples.push(await get("/health"));
    })();
    await new Promise((r) => setTimeout(r, 20));
    const t = Date.now();
    await work();
    const workMs = Date.now() - t;
    await new Promise((r) => setTimeout(r, 20));
    stop = true;
    await loop;
    samples.sort((a, b) => a - b);
    return {
      workMs,
      samples: samples.length,
      min: samples[0] || 0,
      p50: samples[Math.floor(samples.length / 2)] || 0,
      max: samples[samples.length - 1] || 0,
    };
  }

  const healthIdle = await get("/health");
  const listT = Date.now();
  const listed = show.agentList();
  const listMs = Date.now() - listT;
  const limitT = Date.now();
  const limited = show.agentList({ limit: 1 });
  const limitMs = Date.now() - limitT;
  eq(listed.length, N + 12, "full roster is house cast plus seeded agents");
  eq(limited.length, 1, "limit=1 returns one row");
  eq(limited[0].id, listed[0].id, "limit keeps the default order");
  const paged = await new Promise((resolve) => {
    const res = { writeHead() {}, end(body) { resolve(JSON.parse(body)); } };
    handleShow({ method: "GET" }, res, "/api/show/agents", new URLSearchParams("limit=1"), show);
  });
  eq(paged.agents.length, 1, "HTTP limit=1 returns one agent");
  eq(paged.total, N + 12, "paging response reports the full total");
  assert(paged.ok === true, "paging response stays ok");

  const syncHealth = await hammerDuring(() => { show.store.save(show._book()); });
  const asyncHealth = await hammerDuring(() => show.store.saveAsync(show._book()));

  const createT = Date.now();
  const created = show.createAgent({
    name: "Velocity Unique",
    archetype: "GAMBLER",
    shortDescription: "Counts everything and admits nothing today.",
  });
  const createMs = Date.now() - createT;
  assert(created.agent && created.agent.id, "create returns an agent");

  const genT = Date.now();
  const generated = await show.generatePortrait(created.agent.id, {});
  const generateMs = Date.now() - genT;
  assert(generated.brand && generated.brand.agentId === created.agent.id, "generate locks a brand");

  await show.whenPersisted();
  const reloaded = new Show(opts(file, { asyncPersist: false, bootstrapCount: 0 }));
  assert(reloaded.userAgents.has(created.agent.id), "async flush kept the new agent");
  eq(reloaded.userAgents.get(created.agent.id).status, "READY", "generated agent reloads ready");

  const result = {
    n: N,
    seedMs,
    healthIdleMs: healthIdle,
    agentListMs: listMs,
    agentListCount: listed.length,
    limitMs,
    limitCount: limited.length,
    syncPersistMs: syncHealth.workMs,
    healthDuringSyncPersistMaxMs: syncHealth.max,
    asyncPersistMs: asyncHealth.workMs,
    healthDuringAsyncPersist: asyncHealth,
    createMs,
    generateMs,
    fileBytes: fs.statSync(file).size,
  };
  console.log("SCALE " + JSON.stringify(result));

  assert(limitMs < 50, "limit=1 stays under 50ms, got " + limitMs);
  assert(createMs < 800, "create stays under 800ms at " + N + ", got " + createMs);
  assert(generateMs < 1500, "generate stays under 1.5s at " + N + ", got " + generateMs);
  assert(asyncHealth.max < 200, "health during async save stays under 200ms, got " + asyncHealth.max);
  assert(asyncHealth.max < syncHealth.max, "async save no longer stalls health for the whole write");
  assert(listMs < 1500, "full agent list stays under 1.5s, got " + listMs);

  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("scalebench ok");
})().catch((e) => { console.error(e); process.exit(1); });
