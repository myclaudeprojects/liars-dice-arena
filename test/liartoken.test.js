const fs = require("fs");
const path = require("path");
const { argusPublicConfig, arenaToken, DEFAULT_LIAR_TOKEN } = require("../src/argus/config");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error((msg || "eq") + "\n  expected: " + expected + "\n  actual:   " + actual);
}

const TOKEN = DEFAULT_LIAR_TOKEN;
const BUY = "https://argus.world/token/" + TOKEN;

const fallback = arenaToken({});
eq(fallback.symbol, "LIAR", "symbol stays LIAR");
eq(fallback.label, "$LIAR", "label is the arena ticker");
eq(fallback.name, "Liar's Dice Arena", "name is the arena, not an agent");
eq(fallback.tokenAddress, TOKEN, "default contract");
eq(fallback.buyUrl, BUY, "default buy url");

const lower = arenaToken({ LDA_LIAR_TOKEN_ADDRESS: TOKEN.toLowerCase() });
eq(lower.tokenAddress, TOKEN, "override is checksummed");
eq(lower.buyUrl, BUY, "override builds the Argus token page");

const other = "0x1111111111111111111111111111111111111111";
const replaced = arenaToken({ LDA_LIAR_TOKEN_ADDRESS: other });
eq(replaced.tokenAddress, other, "a valid address replaces the default");
eq(replaced.buyUrl, "https://argus.world/token/" + other, "buy url follows the address");
eq(replaced.label, "$LIAR", "the arena label stays $LIAR");

const custom = "https://argus.world/token/" + other + "?ref=lda";
const preferred = arenaToken({
  LDA_LIAR_TOKEN_ADDRESS: other,
  LDA_LIAR_BUY_URL: custom,
});
eq(preferred.tokenAddress, other, "address override still applies beside a buy url");
eq(preferred.buyUrl, custom, "LDA_LIAR_BUY_URL wins");

const badUrl = arenaToken({ LDA_LIAR_BUY_URL: "javascript:alert(1)", LDA_LIAR_TOKEN_ADDRESS: "nope" });
eq(badUrl.tokenAddress, TOKEN, "a bad address keeps the default contract");
eq(badUrl.buyUrl, BUY, "a non-http buy url is ignored");

const off = argusPublicConfig({ ARGUS_MINT_ENABLED: "0" });
eq(off.enabled, false, "mint can stay off");
eq(off.arenaToken.buyUrl, BUY, "the arena coin is published while mint is off");
assert(!off.abi, "arena token does not turn the launch abi on");

const root = path.join(__dirname, "..", "public");
const html = fs.readFileSync(path.join(root, "app.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "app.css"), "utf8");
assert(html.includes('id="buy-liar"'), "header has the arena buy control");
assert(html.includes(">Buy $LIAR</a>"), "header labels the arena coin");
assert(html.includes(BUY), "header defaults to the arena token page");
assert(html.includes("/static/app.css?v=44"), "css cache query bumped");
assert(html.includes("/static/app.js?v=51"), "js cache query bumped");
const xAt = html.indexOf('id="arena-x"');
const buyAt = html.indexOf('id="buy-liar"');
assert(xAt > buyAt, "X sits beside Buy $LIAR");
assert(xAt < html.indexOf('class="top-actions"'), "X stays in the buy cluster");
const xTag = html.slice(xAt, html.indexOf("</a>", xAt));
assert(xTag.includes('href="https://x.com/LiarsDiceArc"'), "header defaults to the house X account");
assert(xTag.includes('target="_blank"') && xTag.includes('rel="noopener"'), "X link opens in a new tab");
assert(xTag.endsWith(">X"), "header labels the X link");
assert(app.includes('getElementById("arena-x")'), "client can retarget the X link");
assert(app.includes("cfg.xUrl"), "client reads the configured X url");
assert(app.includes('x.protocol === "https:"'), "client only applies an http X url");
assert(app.includes("Arena token"), "profile names the arena token");
assert(app.includes("It is not an agent token."), "profile separates $LIAR from agent tokens");
assert(app.includes("Buy ${esc(token.label)}"), "profile buy label follows the arena ticker");
assert(app.includes("rememberArgusConfig"), "the client applies the public config");
assert(app.includes("Opens argus.world. This app does not swap."), "profile uses the same external-link note");
assert(css.includes("a.buy-liar"), "header buy link is styled");
assert(css.includes("a.arena-x"), "header X link is styled");
assert(css.includes(".header-offers { grid-area: buy"), "narrow screens keep X beside Buy $LIAR");

const X = "https://x.com/LiarsDiceArc";
for (const name of ["index.html", "agents.html", "leaderboard.html", "how.html", "landing.html"]) {
  const page = fs.readFileSync(path.join(root, name), "utf8");
  const offers = page.indexOf('class="nav-offers"');
  assert(offers !== -1, name + " groups Buy $LIAR with X");
  const chunk = page.slice(offers, page.indexOf("</li>", offers));
  assert(chunk.includes('class="buy"') && chunk.indexOf('class="buy"') < chunk.indexOf('class="nav-x"'), name + " places X after Buy $LIAR");
  const xPart = chunk.slice(chunk.indexOf('class="nav-x"') - 80);
  assert(xPart.includes('href="' + X + '"'), name + " links the official X account");
  assert(xPart.includes('target="_blank"') && xPart.includes('rel="noopener"'), name + " opens X safely");
}
assert(fs.readFileSync(path.join(root, "landing.html"), "utf8").includes('class="btn token-x"'), "landing token card keeps X beside Buy $LIAR");

console.log("liartoken ok");
