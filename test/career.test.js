const fs = require("fs");
const path = require("path");
const { SimMarket } = require("../src/simmarket");
const { careerModel, careerGeometry, careerMarkup, CHART_CAP } = require("../public/career");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) {
  const left = JSON.stringify(a);
  const right = JSON.stringify(b);
  if (left !== right) throw new Error((m || "eq") + `: ${left} !== ${right}`);
}

const agents = [{ id: "dracula", name: "Dracula" }, { id: "caesar", name: "Caesar" }];
const hash = "a".repeat(64);

function fresh() {
  const book = new SimMarket();
  book.openPredictor("predictor1");
  return book;
}
function seat(book, matchId) {
  book.createMarket({ matchId, agents, prices: { dracula: 0.6, caesar: 0.4 } });
}
function settle(book, matchId, winnerId) {
  book.lock(matchId);
  book.settle(matchId, { winnerId, resultHash: hash });
}

const emptyPerson = { id: "predictor1", credits: 1000, picks: 0, correct: 0, accuracy: 0, pnl: 0, series: [], cashValue: 0 };
const empty = careerModel(emptyPerson);
eq(empty.mode, "empty", "new predictor has no line");
eq(empty.values, [], "empty series plots nothing");
eq(empty.recorded, 0, "no invented point");
const emptyHtml = careerMarkup(emptyPerson);
assert(emptyHtml.includes("No settled picks yet"), "empty copy");
assert(emptyHtml.includes("Win rate"), "empty chart still names win rate");
assert(!emptyHtml.includes('class="dot'), "empty chart has no outcome dots");
assert(emptyHtml.includes('data-points="0"'), "empty chart records zero points");
assert(careerMarkup(emptyPerson, { quiet: true }) === "", "payoff hides an empty line");

const legacyPerson = { id: "predictor8", picks: 1, correct: 1, accuracy: 100, pnl: 12, series: [], cashValue: 0 };
const legacy = careerModel(legacyPerson);
eq(legacy.mode, "legacy", "old total is not a line");
eq(legacy.values, [], "legacy points are not invented");
eq(legacy.pnl, 12, "legacy total stays");
const legacyHtml = careerMarkup(legacyPerson);
assert(legacyHtml.includes("+12"), "legacy total is visible");
assert(legacyHtml.includes("100%"), "legacy win rate stays");
assert(legacyHtml.includes("total only"), "legacy copy");
assert(!legacyHtml.includes('class="dot'), "legacy chart has no invented dot");
assert(!legacyHtml.includes("USDC"), "chart is not a money product");
assert(!legacyHtml.includes("wallet"), "chart does not mention a wallet");

seat(freshBook = fresh(), "m1");
freshBook.buy({ matchId: "m1", predictorId: "predictor1", agentId: "dracula", side: "yes", stake: 100 });
settle(freshBook, "m1", "dracula");
const first = freshBook.openPredictor("predictor1");
const firstModel = careerModel(first);
eq(firstModel.recorded, 1, "one settled pick");
assert(firstModel.origin, "first pick starts at zero");
eq(firstModel.values, [0, first.pnl], "line runs from zero to the result");
eq(firstModel.latestCum, first.pnl, "end of the line is the book total");
const firstGeo = careerGeometry(firstModel);
eq(firstGeo.dots.length, 1, "first pick is one dot");
assert(firstGeo.dots[0].won, "winning pick");
assert(firstGeo.plotted[0].x < firstGeo.plotted[1].x, "time runs left to right");
assert(firstGeo.plotted[0].y > firstGeo.plotted[1].y, "a gain sits above the start");
assert(firstGeo.zeroY != null, "zero line is on a first pick");
const firstHtml = careerMarkup(first);
assert(firstHtml.includes("First settled pick"), "first pick copy");
assert(firstHtml.includes(">+"), "win chip");
assert(firstHtml.includes('data-points="1"'), "one recorded point");
assert(firstHtml.includes("No cash value"), "full chart says test credits");
assert(!careerMarkup(first, { compact: true }).includes("No cash value"), "payoff chart stays short");
eq(careerGeometry(firstModel, { compact: true }).box.h < firstGeo.box.h, true, "compact chart is shorter");

seat(freshBook, "m4");
freshBook.buy({ matchId: "m4", predictorId: "predictor1", agentId: "caesar", side: "yes", stake: 50 });
settle(freshBook, "m4", "dracula");
const two = freshBook.openPredictor("predictor1");
const twoModel = careerModel(two);
eq(twoModel.recorded, 2, "second settle extends the series");
eq(twoModel.values.length, 3, "origin plus two recorded picks");
assert(twoModel.points[1].won === false, "loss stays a loss");
const twoHtml = careerMarkup(two);
assert(twoHtml.includes('data-career="2:'), "chart key follows the new point");
assert(twoHtml !== firstHtml, "markup changes when the series grows");
assert((twoHtml.match(/class="dot/g) || []).length === 2, "both outcomes are dots");
assert(twoHtml.includes(">L<"), "recent calls include the loss");
const crossed = careerModel({
  picks: 2,
  correct: 1,
  accuracy: 50,
  pnl: -10,
  series: [
    { matchId: "a", pnl: 40, cum: 40, won: true },
    { matchId: "b", pnl: -50, cum: -10, won: false },
  ],
});
const crossedGeo = careerGeometry(crossed);
assert(crossedGeo.dots[0].y < crossedGeo.zeroY, "a gain sits above zero");
assert(crossedGeo.dots[1].y > crossedGeo.zeroY, "a loss sits below zero");
assert(crossedGeo.dots[0].won && !crossedGeo.dots[1].won, "dots keep each call");

const book = new SimMarket();
book.importState({
  predictors: [{ id: "predictor8", credits: 900, granted: 1000, picks: 1, correct: 1, streak: 1, bestStreak: 1, pnl: 12, theories: {} }],
  markets: [],
});
seat(book, "m9");
book.buy({ matchId: "m9", predictorId: "predictor8", agentId: "dracula", side: "yes", stake: 40 });
settle(book, "m9", "dracula");
const afterLegacy = book.openPredictor("predictor8");
const gap = careerModel(afterLegacy);
eq(gap.recorded, 1, "only the new pick is plotted");
assert(!gap.origin, "the line does not pretend the old total started at zero");
eq(gap.values, [afterLegacy.series[0].cum], "the dot is the real cumulative");
eq(gap.gap, "partial", "missing history stays off the line");
assert(careerMarkup(afterLegacy).includes("Earlier picks stay in the total"), "partial copy");
assert(!(careerMarkup(afterLegacy).includes('points="0,') && careerMarkup(afterLegacy).includes("," + afterLegacy.pnl)), "no fabricated segment from zero");

eq(CHART_CAP, 100, "chart cap matches the book");
const capBook = new SimMarket();
capBook.openPredictor("predictor9");
capBook.requirePredictor("predictor9").credits = 5000;
for (let i = 0; i < 102; i++) {
  const id = "cap" + i;
  if (i % 10 === 0) capBook.buysAt.delete("predictor9");
  seat(capBook, id);
  capBook.buy({ matchId: id, predictorId: "predictor9", agentId: "caesar", side: "yes", stake: 10 });
  settle(capBook, id, "dracula");
}
const capped = capBook.openPredictor("predictor9");
const capModel = careerModel(capped);
eq(capModel.recorded, 100, "chart keeps the stored window");
assert(!capModel.origin, "dropped picks are not redrawn from zero");
eq(capModel.values[0], capped.series[0].cum, "line starts at the oldest stored total");
eq(capModel.gap, "cap", "full window says so");
assert(careerMarkup(capped).includes("Latest 100 settled picks"), "cap copy");
eq(careerGeometry(capModel).dots.length, 1, "a long line keeps the latest dot");
assert(capped.series.length === 100 && careerMarkup(capped).includes('data-points="100"'), "markup count is the series");

const hostile = careerMarkup({
  picks: 1,
  accuracy: 100,
  pnl: 5,
  series: [{ matchId: "<script>", pnl: 5, cum: 5, won: true }],
});
assert(!hostile.includes("<script>"), "match ids are not interpolated");

const css = fs.readFileSync(path.join(__dirname, "..", "public", "app.css"), "utf8");
assert(css.includes(".career-line"), "chart styles");
assert(css.includes("prefers-reduced-motion"), "reduced motion still covers the page");
assert(css.includes(".career-line, .career-line * { animation: none"), "career line stays still");
const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
assert(app.includes("ldaCareer"), "profile reads the career chart");
assert(app.includes("careerBlock(me)"), "history and profile share the chart");

console.log("career ok");
