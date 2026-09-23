const { Show, playExhibit, resultHash, propMetrics, HISTORY_CAP } = require("../src/showrunner");
const { CAST, makePlayer, pairSchedule } = require("../src/characters");
const { matchStory } = require("../src/narrative");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

(async () => {
  eq(CAST.length, 12, "twelve characters");
  const strategies = new Set(CAST.map((c) => `${c.aggression}:${c.chaos}`));
  eq(strategies.size, CAST.length, "each strategy is distinct");
  eq(new Set(CAST.map((c) => c.hue)).size, CAST.length, "each hue is distinct");
  for (const c of CAST) {
    assert(c.aggression >= 0 && c.aggression <= 1 && c.chaos >= 0 && c.chaos <= 1, "strategy in range " + c.id);
    assert(c.archetype && c.line && c.strength && c.weakness, "sheet " + c.id);
  }
  const warm = new Set(pairSchedule("athena").flat());
  assert(!warm.has("athena"), "warm-up schedule holds Athena out");
  assert(CAST.filter((c) => c.id !== "athena").every((c) => warm.has(c.id)), "warm-up schedule covers the rest of the cast");

  const exhibit = await playExhibit({
    agents: [makePlayer("dracula"), makePlayer("caesar")],
    seed: 42,
    sleep: async () => {},
  });
  assert(exhibit.winnerId === "dracula" || exhibit.winnerId === "caesar", "someone wins");
  assert(exhibit.log.some((e) => e.type === "challenge" || e.type === "bid" || e.type === "hand_start"), "engine log");
  const hash = resultHash({ matchId: "mx", winnerId: exhibit.winnerId, seed: 42, log: exhibit.log });
  eq(hash, resultHash({ matchId: "mx", winnerId: exhibit.winnerId, seed: 42, log: exhibit.log }), "hash stable");
  assert(hash !== resultHash({ matchId: "mx", winnerId: exhibit.winnerId, seed: 43, log: exhibit.log }), "seed changes hash");

  const story = matchStory({
    seats: [{ id: "caesar", name: "Caesar" }, { id: "dracula", name: "Dracula" }],
    winnerId: "caesar",
    log: [
      { type: "hand_start", counts: [{ id: "caesar", dice: 1 }, { id: "dracula", dice: 2 }] },
      { type: "challenge", challengerId: "caesar", bidderId: "dracula", bidWasTrue: false, bid: { count: 4, face: 6 }, hand: 3 },
      { type: "match_over", winnerId: "caesar" },
    ],
  });
  assert(/did it|called the bluff|came back/i.test(story.title), "story from the log");
  assert(story.calledBluff && story.comeback, "comeback call");
  assert(/bluff/i.test(story.lesson), "lesson from the actual bid");

  const show = new Show({
    sleep: async () => {},
    pickWindowMs: 0,
    turnDelayMs: 0,
    revealDelayMs: 0,
    settleHoldMs: 0,
    bootstrapCount: 2,
    loopEnabled: false,
  });
  await show.bootstrap(2);
  assert(show.history.length === 2, "bootstrap matches are real");
  assert(show.history.every((h) => h.oracle && h.oracle.resultHash && h.oracle.resultHash.length === 64), "oracle hash");
  assert(show.history.every((h) => h.oracle.realMoney === false), "not real money");
  const played = new Set(show.history.flatMap((h) => h.seats.map((s) => s.id)));
  assert(!played.has("athena"), "debut held out of the warm-up");

  show.bootstrapDone = true;
  show.openNext();
  assert(show.phase === "pick", "picks open");
  assert(show.current.seats.some((s) => s.id === "athena"), "athena's first match is live");
  eq(show.upcoming.length, 4, "four books coming up");
  const board = [
    ...show.current.seats.map((s) => s.id),
    ...show.upcoming.flatMap((u) => u.seats.map((s) => s.id)),
  ];
  eq(new Set(board).size, board.length, "live plus four does not double-book");
  assert(show.upcoming.every((u) => u.seats.every((s) => s.id !== "athena")), "the debut is not also coming up");
  const marketId = show.current.matchId;
  show.market.openPredictor("showfan01");
  const before = show.market.requirePredictor("showfan01").credits;
  const seat = show.current.seats[0];
  const preview = show.market.publicMarket(show.market.requireMarket(marketId), "showfan01");
  assert(preview.props && preview.props.length >= 4, "match lists the prop contracts");
  const duration = preview.props.find((p) => p.type === "duration_under");
  show.market.buy({
    matchId: marketId, predictorId: "showfan01", agentId: seat.id, side: "yes", stake: 50,
  });
  show.market.buyProp({
    matchId: marketId, propId: duration.id, predictorId: "showfan01", side: "yes", stake: 20,
  });
  const archived = await show.playOpen();
  assert(archived.winnerId, "played");
  assert(archived.oracle.resultHash === resultHash({
    matchId: archived.matchId, winnerId: archived.winnerId, seed: archived.seed, log: archived.engineLog,
  }), "settled hash matches the engine log");
  const pred = show.market.requirePredictor("showfan01");
  const won = archived.winnerId === seat.id;
  const settledProps = show.market.publicMarket(show.market.requireMarket(marketId), "showfan01").props;
  assert(settledProps.every((p) => p.status === "settled"), "props settle before the book is done");
  eq(settledProps.find((p) => p.id === duration.id).result, "yes", "a fast match is under 90 seconds");
  assert(settledProps.find((p) => p.id === duration.id).you.won, "duration yes pays");
  if (won) assert(pred.credits > before - 50, "winner paid from the result");
  else assert(pred.credits > before - 70 && pred.credits < before, "winner stake is lost and the winning prop still pays");
  assert(pred.picks === 2, "winner and prop both count");
  assert(pred.settled.some((s) => s.matchId === marketId), "winner prediction recorded");
  assert(pred.settled.some((s) => s.matchId === marketId + ":" + duration.id), "prop prediction recorded");
  const book = show.market.requireMarket(marketId);
  eq(book.status, "settled", "book settled");
  eq(book.winnerId, archived.winnerId, "book winner is the match winner");
  const settledView = show.snapshot("showfan01");
  assert(settledView.live.market.you, "snapshot carries the position");
  assert(settledView.you && settledView.you.credits === pred.credits, "snapshot balance matches the settled book");
  assert(show.snapshot().custody === false && show.snapshot().cashValue === 0, "snapshot is not a real market");
  assert(archived.share && archived.share.text, "settled match has a share card");
  eq(archived.share.href, "#replay=" + encodeURIComponent(archived.matchId), "share card links to the replay");
  eq(archived.share.matchId, archived.matchId, "share card names the match");
  assert(!/usdc|wallet|\$/i.test(archived.share.text), "share text stays on the show");
  eq(show.matchDetail(archived.matchId).share.href, archived.share.href, "history keeps the replay link");

  eq(HISTORY_CAP, 100, "history keeps 100 matches");
  const shelf = new Show({ loopEnabled: false });
  for (let i = 0; i < 105; i++) shelf.rememberHistory({ matchId: "h" + i });
  eq(shelf.history.length, 100, "history cap drops the oldest");
  eq(shelf.history[0].matchId, "h104", "newest stays first");
  eq(shelf.history[99].matchId, "h5", "the oldest kept match is still on the list");

  const sample = propMetrics({
    log: [
      { type: "hand_start", counts: [{ id: "dracula", dice: 5 }, { id: "caesar", dice: 5 }] },
      { type: "challenge", loserId: "caesar" },
      { type: "hand_start", counts: [{ id: "dracula", dice: 5 }, { id: "caesar", dice: 4 }] },
    ],
    seats: [{ id: "dracula" }, { id: "caesar" }],
    winnerId: "dracula",
    durationMs: 1200,
  });
  eq(sample.roundWinners[0], "dracula", "first round winner is the other seat");
  eq(sample.totalDiceRolled.dracula, 10, "dice roll up across hands");
  eq(sample.durationMs, 1200, "duration comes from the match clock");

  console.log("showrunner ok");
})().catch((e) => { console.error(e); process.exit(1); });
