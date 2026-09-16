// One-off patch: "Buy $LIAR" in the nav on every page + token card on the landing page. Idempotent.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const CA = "0x47c3d4490c1e8b9ed71464e333ad9d5ce7d20790";
const BUY = "https://gmgn.ai/arc/token/" + CA;
const EXP = "https://explorer.arc.io/token/" + CA;
const rw = (f, fn) => { const p = path.join(root, f); const a = fs.readFileSync(p, "utf8"); const b = fn(a); fs.writeFileSync(p, b); console.log(f, a === b ? "(no change)" : "patched"); };

for (const f of ["public/landing.html", "public/index.html", "public/leaderboard.html", "public/how.html", "public/agents.html"]) {
  rw(f, (s) => {
    if (s.includes('class="buy"')) return s;
    // insert a Buy $LIAR item right before the Watch live / Live table CTA
    return s.replace(/(\s*)<li><a href="\/arena" class="(cta|on)">/, `$1<li><a href="${BUY}" class="buy" target="_blank" rel="noopener">Buy $LIAR</a></li>$1<li><a href="/arena" class="$2">`);
  });
}

rw("public/site.css", (s) => {
  if (s.includes("nav.top li a.buy")) return s;
  return s.replace(`nav.top li a.cta{background:var(--gold);color:var(--ink);font-weight:600}`,
`nav.top li a.cta{background:var(--gold);color:var(--ink);font-weight:600}
nav.top li a.buy{background:var(--felt);color:var(--ivory);font-weight:600}
nav.top li a.buy:hover{background:var(--felt-deep)}`);
});

rw("public/landing.html", (s) => {
  if (s.includes('id="token"')) return s;
  s = s.replace(`  .quote{margin:56px 0 0;`, `  .token{margin:56px 0 0;display:grid;grid-template-columns:160px 1fr auto;gap:26px;align-items:center;background:#fff9ee;border:1px solid #d9cfb8;border-radius:14px;padding:26px 30px}
  @media (max-width:820px){.token{grid-template-columns:1fr;text-align:center}.token img{margin:0 auto}}
  .token img{width:160px;height:160px;border-radius:50%;display:block;box-shadow:0 12px 30px rgba(30,20,10,.25)}
  .token h2{font-size:30px;font-weight:600;margin-bottom:8px}
  .token p{margin:0;color:#3f3d35;line-height:1.55;max-width:560px}
  .token .ca{margin-top:12px;font-size:13px;color:#5c5a52}
  .token .ca code{display:inline-block;background:#f3ebd9;border-radius:8px;padding:6px 10px;font-size:12px;user-select:all;word-break:break-all}
  .token .btns{display:flex;flex-direction:column;gap:10px}
  .quote{margin:56px 0 0;`);
  s = s.replace(`  <div class="quote">`, `  <section class="token" id="token">
    <img src="/static/liar-token.png" alt="$LIAR token" width="160" height="160" />
    <div>
      <h2>$LIAR — the arena's token</h2>
      <p>Live on Arc. Buybacks and burns are funded by the arena's house cut on a published schedule, with every burn posted on-chain.</p>
      <div class="ca">Contract <code>${CA}</code></div>
    </div>
    <div class="btns">
      <a class="btn primary" href="${BUY}" target="_blank" rel="noopener">Buy $LIAR</a>
      <a class="btn ghost" href="${EXP}" target="_blank" rel="noopener">View on explorer</a>
    </div>
  </section>

  <div class="quote">`);
  return s;
});
console.log("done");
