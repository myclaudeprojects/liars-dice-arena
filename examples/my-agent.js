// my-agent.js — A complete Liar's Dice agent you can run right now.
//   node examples/my-agent.js            → listens on http://localhost:4001/
// Then register it on the arena's /agents page as an "endpoint" agent.
// Replace `decide()` with your own strategy (or call an LLM inside it).
//
// PROTOCOL
//   The arena POSTs JSON each turn:
//     { agentId, view: { you:{id,name,dice:[...]}, table:[{id,name,diceCount,alive}],
//                       totalDice, currentBid:{count,face,byId}|null, onesWild, whoseTurn } }
//   Headers: x-arena-agent (your id), x-arena-signature (HMAC-SHA256 hex of the raw body, keyed by your agent key)
//   Reply within 6 seconds with JSON:
//     { "thought": "one line of table talk", "action": {"type":"bid","count":N,"face":F} }
//     { "thought": "...",                    "action": {"type":"challenge"} }
//   Illegal or late replies are replaced with a safe move; 5 in a row benches you.

const http = require("http");
const crypto = require("crypto");

const PORT = process.env.PORT || 4001;
const AGENT_KEY = process.env.AGENT_KEY || ""; // paste the key you got when registering, to verify calls

function count(dice, face, onesWild) {
  return dice.filter((d) => d === face || (onesWild && d === 1 && face !== 1)).length;
}

// A sane baseline strategy: bid what you hold plus what's statistically likely, challenge stretches.
function decide(view) {
  const { you, currentBid, totalDice, onesWild } = view;
  const unknown = totalDice - you.dice.length;
  const p = (face) => (face === 1 || !onesWild ? 1 / 6 : 2 / 6);

  if (currentBid) {
    const need = currentBid.count - count(you.dice, currentBid.face, onesWild);
    const expected = unknown * p(currentBid.face);
    if (need > expected + 1.5) return { thought: `Need ${need} more from ${unknown} unknown. Not buying it.`, action: { type: "challenge" } };
  }

  // Strongest face in hand
  let face = 2, held = -1;
  for (let f = 2; f <= 6; f++) { const h = count(you.dice, f, onesWild); if (h > held) { held = h; face = f; } }
  let c = Math.max(1, Math.round(held + unknown * p(face)));

  if (currentBid) {
    // must strictly beat the current bid
    if (c < currentBid.count || (c === currentBid.count && face <= currentBid.face)) {
      if (currentBid.face < 6) { c = currentBid.count; face = currentBid.face + 1; }
      else { c = currentBid.count + 1; face = 2; }
    }
    if (c > totalDice) return { thought: "Nowhere left to go. Liar.", action: { type: "challenge" } };
  }
  return { thought: `Holding ${held} ${face}s. ${c}×${face}.`, action: { type: "bid", count: c, face } };
}

http.createServer((req, res) => {
  if (req.method !== "POST") { res.writeHead(200); return res.end("Liar's Dice agent is up. POST a view to play."); }
  let body = ""; req.on("data", (ch) => (body += ch));
  req.on("end", () => {
    try {
      if (AGENT_KEY) {
        const sig = crypto.createHmac("sha256", AGENT_KEY).update(body).digest("hex");
        if (sig !== req.headers["x-arena-signature"]) { res.writeHead(401); return res.end("bad signature"); }
      }
      const { view } = JSON.parse(body);
      const reply = decide(view);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply));
    } catch (e) { res.writeHead(400); res.end(String(e.message)); }
  });
}).listen(PORT, () => console.log(`agent listening on http://localhost:${PORT}/`));
