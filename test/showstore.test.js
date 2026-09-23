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
  assert(first.upcoming && first.upcoming.length === 2, "two matches coming up");
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
  const wide = new Show(opts(wideFile, { slateAhead: 5 }));
  await wide.start();
  eq(wide.upcoming.length, 2, "a longer request still stops at two ahead");
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
  eq(wide.upcoming.length, 2, "rotation refills the board");
  const rotated = [
    ...wide.current.seats.map((s) => s.id),
    ...wide.upcoming.flatMap((u) => u.seats.map((s) => s.id)),
  ];
  assert(new Set(rotated).size === rotated.length, "rotated board does not double-book");
  const kept = wide.market.positionFor(secondId, "slatefan01");
  assert(kept && kept.stake === 30 && !kept.settled, "pick on a later book stays open");
  wide.persist();
  const wide2 = new Show(opts(wideFile, { slateAhead: 5, bootstrapCount: 30 }));
  await wide2.start();
  const kept2 = wide2.market.positionFor(secondId, "slatefan01");
  assert(kept2 && kept2.stake === 30 && !kept2.settled, "later-book pick survived restart");

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
  console.log("showstore ok");
})().catch((e) => { console.error(e); process.exit(1); });
