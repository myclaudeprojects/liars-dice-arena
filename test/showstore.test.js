// Persistence: write the book, construct a new show on the same file, balances and history match.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { Show } = require("../src/showrunner");
const { ShowStore } = require("../src/showstore");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

function recordingFs() {
  const calls = [];
  const files = new Map();
  const fds = new Map();
  let nextFd = 3;
  const api = {
    calls,
    files,
    fds,
    mkdirSync() { calls.push("mkdir"); },
    openSync(file, flags) {
      calls.push("open:" + flags + ":" + path.basename(file));
      if (String(flags).includes("x") && files.has(file)) {
        const err = new Error("EEXIST");
        err.code = "EEXIST";
        throw err;
      }
      if (flags === "w" || String(flags).includes("w")) files.set(file, "");
      const fd = nextFd++;
      fds.set(fd, { path: file, flags });
      return fd;
    },
    writeFileSync(target, data) {
      if (typeof target === "number") {
        const info = fds.get(target);
        files.set(info.path, data);
        calls.push(String(info.path).endsWith(".tmp") ? "write-data" : "write-lock");
      } else {
        files.set(target, data);
        calls.push("write-path");
      }
    },
    fsyncSync(fd) {
      const info = fds.get(fd);
      calls.push("fsync:" + path.basename(info.path));
    },
    closeSync(fd) { fds.delete(fd); calls.push("close"); },
    renameSync(from, to) {
      calls.push("rename");
      files.set(to, files.get(from));
      files.delete(from);
    },
    readFileSync(file) {
      if (!files.has(file)) {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }
      return files.get(file);
    },
    unlinkSync(file) { files.delete(file); calls.push("unlink"); },
  };
  return { fs: api, calls, files, fds };
}

function opts(file, extra = {}) {
  return {
    dataPath: file,
    sleep: async () => {},
    pickWindowMs: 0,
    turnDelayMs: 0,
    revealDelayMs: 0,
    settleHoldMs: 0,
    bootstrapCount: 1,
    loopEnabled: false,
    ...extra,
  };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lda-show-"));
  const file = path.join(dir, "show.json");
  const show = new Show(opts(file));
  await show.start();
  const first = show.snapshot("persist01");
  assert(first.live && first.live.phase === "pick", "boots into live now");
  assert(first.upcoming && first.upcoming.length === 4, "four matches coming up");
  assert(first.upcoming[0].matchId !== first.live.matchId, "upcoming is a second book");
  const seated = [
    ...first.live.seats.map((s) => s.id),
    ...first.upcoming.flatMap((u) => u.seats.map((s) => s.id)),
  ];
  assert(new Set(seated).size === seated.length, "nobody is booked twice");
  assert(first.upcoming.every((u) => u.cashValue === 0 && u.custody === false && u.realMoney === false), "upcoming books are test credits");
  assert(first.cashValue === 0 && first.custody === false && first.realMoney === false, "still worthless credits");
  assert(first.partner.status === "not_contracted" && first.partner.realMoney === false, "partner not contracted");

  show.market.openPredictor("persist01");
  const liveId = show.current.matchId;
  const upId = show.upcoming[0].matchId;
  const liveSeat = show.current.seats[0].id;
  const upSeat = show.upcoming[0].seats[0].id;
  show.market.buy({ matchId: liveId, predictorId: "persist01", agentId: liveSeat, side: "yes", stake: 50 });
  show.market.buy({ matchId: upId, predictorId: "persist01", agentId: upSeat, side: "yes", stake: 40 });
  await show.playOpen();
  const credits = show.market.requirePredictor("persist01").credits;
  const hist = show.history.map((h) => h.matchId);
  assert(hist.includes(liveId), "settled match is history");
  assert(credits !== 1000, "the live pick changed the balance");
  const settledView = show.snapshot("persist01").you;
  assert(settledView.series && settledView.series.length === 1, "settled pick is a career point");
  eq(settledView.series[0].cum, settledView.pnl, "career cum matches total pnl");
  eq(settledView.series[0].matchId, liveId, "career point is this match");
  eq(settledView.cashValue, 0, "career snapshot has no cash value");
  show.persist();

  const reloaded = new Show(opts(file, { bootstrapCount: 30 }));
  await reloaded.start();
  eq(reloaded.market.requirePredictor("persist01").credits, credits, "balance survived restart");
  eq(reloaded.market.requirePredictor("persist01").picks, 1, "settled pick counted once");
  for (const id of hist) assert(reloaded.history.some((h) => h.matchId === id), "history survived " + id);
  eq(reloaded.history.length, hist.length, "warm-up did not replay");
  const open = reloaded.market.positionFor(upId, "persist01");
  assert(open && open.stake === 40 && !open.settled, "open pick survived restart");
  const again = reloaded.snapshot("persist01");
  assert(again.live && again.live.phase === "pick", "reloaded arena is live now");
  assert(again.live.matchId === upId, "the upcoming book became the live match");
  assert(again.upcoming.length >= 1 && again.upcoming[0].matchId !== upId, "a new upcoming market is visible");
  assert(again.you.credits === credits, "snapshot balance is the stored book");
  assert(again.you.series && again.you.series.length === 1, "career series survived restart");
  eq(again.you.series[0].cum, again.you.pnl, "reloaded career cum matches pnl");
  eq(again.you.series[0].matchId, liveId, "reloaded career point is the settled match");
  eq(again.you.cashValue, 0, "reloaded career still has no cash value");
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  eq(onDisk.market.buysAt.persist01.length, 2, "buy window is in the show file");
  eq((reloaded.market.buysAt.get("persist01") || []).length, 2, "buy window survived restart");

  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "lda-show-"));
  const file2 = path.join(dir2, "show.json");
  const mid = new Show(opts(file2));
  await mid.start();
  mid.market.openPredictor("persist02");
  const interruptedId = mid.current.matchId;
  const seat = mid.current.seats[0].id;
  mid.market.buy({ matchId: interruptedId, predictorId: "persist02", agentId: seat, side: "yes", stake: 50 });
  mid.market.lock(interruptedId);
  mid.current.phase = "live";
  mid.phase = "live";
  mid.persist();
  const resumed = new Show(opts(file2));
  await resumed.start();
  assert(resumed.history.some((h) => h.matchId === interruptedId), "interrupted match settled on reload");
  const pred = resumed.market.requirePredictor("persist02");
  eq(pred.picks, 1, "interrupted pick settled once");
  assert(pred.credits !== 1000, "stake was not refunded into a fresh grant");
  const book = resumed.market.markets.get(interruptedId);
  assert(!book || book.status === "settled", "resumed book is settled");

  const wideFile = path.join(dir, "wide.json");
  const wide = new Show(opts(wideFile, { slateAhead: 9 }));
  await wide.start();
  eq(wide.upcoming.length, 5, "a longer request stops when the cast runs out of free seats");
  const wideIds = [
    ...wide.current.seats.map((s) => s.id),
    ...wide.upcoming.flatMap((u) => u.seats.map((s) => s.id)),
  ];
  assert(new Set(wideIds).size === wideIds.length, "five-ahead request does not double-book");
  const secondId = wide.upcoming[1].matchId;
  const secondSeat = wide.upcoming[1].seats[0].id;
  wide.market.openPredictor("slatefan01");
  wide.market.buy({ matchId: secondId, predictorId: "slatefan01", agentId: secondSeat, side: "yes", stake: 30 });
  const firstUpcoming = wide.upcoming[0].matchId;
  await wide.playOpen();
  wide.openNext();
  eq(wide.current.matchId, firstUpcoming, "the queue rotates the first coming-up book into live");
  eq(wide.upcoming[0].matchId, secondId, "the later book keeps its place");
  eq(wide.upcoming.length, 5, "rotation refills the board");
  const rotated = [
    ...wide.current.seats.map((s) => s.id),
    ...wide.upcoming.flatMap((u) => u.seats.map((s) => s.id)),
  ];
  assert(new Set(rotated).size === rotated.length, "rotated board does not double-book");
  const kept = wide.market.positionFor(secondId, "slatefan01");
  assert(kept && kept.stake === 30 && !kept.settled, "pick on a later book stays open");
  wide.persist();
  const wide2 = new Show(opts(wideFile, { slateAhead: 9, bootstrapCount: 30 }));
  await wide2.start();
  const kept2 = wide2.market.positionFor(secondId, "slatefan01");
  assert(kept2 && kept2.stake === 30 && !kept2.settled, "later-book pick survived restart");

  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "lda-store-"));
  const bookFile = path.join(storeDir, "show.json");
  const store = new ShowStore(bookFile);
  store.save({ v: 1, n: 1, cashValue: 0, custody: false, realMoney: false });
  fs.writeFileSync(bookFile + ".tmp", JSON.stringify({ v: 1, n: 99 }));
  eq(store.load().n, 1, "a leftover temp file does not replace the book");
  assert(fs.existsSync(bookFile + ".tmp"), "load leaves the temp file alone");
  fs.rmSync(bookFile);
  const tmpOnly = new ShowStore(bookFile);
  eq(tmpOnly.load(), null, "a temp file with no book bootstraps from empty");
  assert(!fs.existsSync(bookFile), "an orphan temp file is not renamed into place");

  fs.writeFileSync(bookFile, "{not json");
  eq(new ShowStore(bookFile).load(), null, "corrupt JSON fails closed");
  fs.writeFileSync(bookFile, JSON.stringify({ v: 2, n: 5 }));
  eq(new ShowStore(bookFile).load(), null, "a future version fails closed");
  const fresh = new Show(opts(bookFile, { bootstrapCount: 0 }));
  await fresh.start();
  assert(fresh.snapshot().live && fresh.snapshot().live.phase === "pick", "corrupt book bootstraps a live match");
  assert(fresh.snapshot().cashValue === 0 && fresh.snapshot().custody === false && fresh.snapshot().realMoney === false, "bootstrap stays on test credits");
  const rewritten = JSON.parse(fs.readFileSync(bookFile, "utf8"));
  eq(rewritten.v, 1, "the fresh book replaces the corrupt file");
  assert(rewritten.realMoney === false && rewritten.custody === false && rewritten.cashValue === 0, "the rewritten book is not money");

  const secondStore = new ShowStore(bookFile);
  secondStore.save({ v: 1, n: 2 });
  eq(secondStore.load().n, 2, "the same process may write again");
  eq(store.load().n, 2, "a second store in this process shares the lock");

  const held = path.join(storeDir, "held.json");
  fs.writeFileSync(held, JSON.stringify({ v: 1, marker: "good" }));
  const heldLock = held + ".lock";
  const holder = spawn(process.execPath, ["-e", "const fs=require('fs'); fs.writeFileSync(process.argv[1], String(process.pid)); setInterval(()=>{}, 1000);", heldLock], { stdio: "ignore" });
  const waitUntil = async (fn) => {
    const start = Date.now();
    while (!fn()) {
      if (Date.now() - start > 2000) throw new Error("timed out waiting for the lock file");
      await new Promise((r) => setTimeout(r, 15));
    }
  };
  try {
    await waitUntil(() => {
      try { return Number(fs.readFileSync(heldLock, "utf8")) === holder.pid; }
      catch { return false; }
    });
    const blocked = new ShowStore(held, { lockWaitMs: 60 });
    let code = "";
    try { blocked.save({ v: 1, marker: "clobber" }); }
    catch (e) { code = e.code; }
    eq(code, "show_store_locked", "a live lock fails closed");
    eq(JSON.parse(fs.readFileSync(held, "utf8")).marker, "good", "the refused writer did not replace the book");
    let loadCode = "";
    try { blocked.load(); }
    catch (e) { loadCode = e.code; }
    eq(loadCode, "show_store_locked", "a live lock also refuses to load");
  } finally {
    holder.kill();
    await new Promise((r) => holder.on("exit", r));
  }

  const staleFile = path.join(storeDir, "stale.json");
  fs.writeFileSync(staleFile + ".lock", "1073741824\n");
  const stolen = new ShowStore(staleFile, { lockWaitMs: 40 });
  stolen.save({ v: 1, n: 7, cashValue: 0 });
  eq(stolen.load().n, 7, "a dead owner's lock is taken");
  eq(Number(fs.readFileSync(staleFile + ".lock", "utf8")), process.pid, "the new owner records this process");

  const order = recordingFs();
  const ordered = new ShowStore(path.join(storeDir, "ordered.json"), { fs: order.fs, lockWaitMs: 20 });
  ordered.save({ v: 1, n: 4 });
  const steps = order.calls.filter((c) => c === "write-data" || c === "rename" || c.startsWith("fsync:"));
  const writeAt = steps.indexOf("write-data");
  const renameAt = steps.indexOf("rename");
  assert(writeAt >= 0 && renameAt > writeAt, "the temp file is written before it is renamed");
  assert(steps.slice(writeAt + 1, renameAt).some((c) => c.startsWith("fsync:")), "the temp file is fsynced before rename");
  eq(JSON.parse(order.files.get(ordered.file)).n, 4, "rename publishes the new book");
  assert(!order.files.has(ordered.file + ".tmp"), "the temp name is gone after rename");

  const guard = recordingFs();
  guard.files.set(path.join(storeDir, "guard.json"), JSON.stringify({ v: 1, n: 8 }));
  guard.fs.fsyncSync = (fd) => {
    const info = guard.fds.get(fd);
    guard.calls.push("fsync:" + path.basename(info.path));
    if (String(info.path).endsWith(".tmp")) {
      const err = new Error("fsync failed");
      err.code = "EIO";
      throw err;
    }
  };
  const guarded = new ShowStore(path.join(storeDir, "guard.json"), { fs: guard.fs, lockWaitMs: 20 });
  let io = "";
  try { guarded.save({ v: 1, n: 9 }); }
  catch (e) { io = e.code; }
  eq(io, "EIO", "a failed fsync aborts the save");
  assert(!guard.calls.includes("rename"), "a failed fsync does not rename");
  eq(JSON.parse(guard.files.get(guarded.file)).n, 8, "the previous book stays in place");

  const handoff = path.join(storeDir, "handoff.json");
  const storeMod = JSON.stringify(path.join(__dirname, "..", "src", "showstore.js"));
  const holderSrc = `
    const { ShowStore } = require(${storeMod});
    const store = new ShowStore(process.argv[1], { lockWaitMs: 200 });
    store.save({ v: 1, n: 1, cashValue: 0, custody: false, realMoney: false });
    process.stdout.write("held\\n");
    setInterval(() => {}, 1000);
  `;
  const handoffChild = spawn(process.execPath, ["-e", holderSrc, handoff], { stdio: ["ignore", "pipe", "inherit"] });
  let heldOut = "";
  handoffChild.stdout.on("data", (c) => { heldOut += c; });
  try {
    await waitUntil(() => heldOut.includes("held"));
    assert(fs.existsSync(handoff + ".lock"), "the holder owns the lock");
    eq(Number(fs.readFileSync(handoff + ".lock", "utf8")), handoffChild.pid, "the holder recorded its pid");
    handoffChild.kill("SIGTERM");
    const exitCode = await new Promise((r) => handoffChild.on("exit", (code) => r(code)));
    eq(exitCode, 0, "SIGTERM is a clean release");
    assert(!fs.existsSync(handoff + ".lock"), "SIGTERM drops the show lock");
    eq(JSON.parse(fs.readFileSync(handoff, "utf8")).n, 1, "shutdown does not rewrite the book");
    const next = new ShowStore(handoff, { lockWaitMs: 200 });
    next.save({ v: 1, n: 3, cashValue: 0, custody: false, realMoney: false });
    eq(next.load().n, 3, "the next process writes after the lock is released");
  } finally {
    if (handoffChild.exitCode == null && handoffChild.signalCode == null) {
      handoffChild.kill("SIGKILL");
      await new Promise((r) => handoffChild.on("exit", r));
    }
  }

  const slowFile = path.join(storeDir, "slow.json");
  fs.writeFileSync(slowFile, JSON.stringify({ v: 1, n: 1, cashValue: 0 }));
  const slow = spawn(process.execPath, ["-e", "const fs=require('fs'); fs.writeFileSync(process.argv[1], String(process.pid)+'\\n'); setTimeout(()=>{ try { fs.unlinkSync(process.argv[1]); } catch {} process.exit(0); }, 400); setInterval(()=>{}, 1000);", slowFile + ".lock"], { stdio: "ignore" });
  try {
    await waitUntil(() => {
      try { return Number(fs.readFileSync(slowFile + ".lock", "utf8")) === slow.pid; }
      catch { return false; }
    });
    const waited = new ShowStore(slowFile, { lockWaitMs: 4000 });
    waited.save({ v: 1, n: 5, cashValue: 0, custody: false, realMoney: false });
    eq(waited.load().n, 5, "a waiter acquires the lock after the holder exits");
    eq(JSON.parse(fs.readFileSync(slowFile, "utf8")).n, 5, "the waiter publishes only after it owns the lock");
  } finally {
    if (slow.exitCode == null && slow.signalCode == null) {
      slow.kill("SIGKILL");
      await new Promise((r) => slow.on("exit", r));
    }
  }

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
  fs.rmSync(storeDir, { recursive: true, force: true });
  console.log("showstore ok");
})().catch((e) => { console.error(e); process.exit(1); });
