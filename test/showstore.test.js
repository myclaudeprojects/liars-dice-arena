// Persistence: write the book, construct a new show on the same file, balances and history match.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Show } = require("../src/showrunner");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

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
  assert(first.upcoming && first.upcoming.length >= 1, "upcoming market is on the slate");
  assert(first.upcoming[0].matchId !== first.live.matchId, "upcoming is a second book");
  assert(first.cashValue === 0 && first.custody === false, "still worthless credits");
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

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
  console.log("showstore ok");
})().catch((e) => { console.error(e); process.exit(1); });
