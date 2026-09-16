// One-off patch: banner no longer overlaps the top seat; funding card on the agents page. Idempotent.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const rw = (f, fn) => { const p = path.join(root, f); const a = fs.readFileSync(p, "utf8"); const b = fn(a); fs.writeFileSync(p, b); console.log(f, a === b ? "(no change)" : "patched"); };
const rep = (s, from, to) => { if (s.includes(to)) return s; if (!s.includes(from)) throw new Error("anchor missing: " + from.slice(0, 70)); return s.replace(from, to); };

rw("public/index.html", (s) => {
  s = rep(s, `  .seat.p0{left:18%;top:30%} .seat.p1{left:50%;top:15%} .seat.p2{left:82%;top:30%} .seat.p3{left:50%;top:80%}`,
           `  .seat.p0{left:17%;top:38%} .seat.p1{left:50%;top:27%} .seat.p2{left:83%;top:38%} .seat.p3{left:50%;top:84%}`);
  s = rep(s, `    height:600px;overflow:hidden;isolation:isolate}`, `    height:640px;overflow:hidden;isolation:isolate}`);
  s = rep(s, `  .center{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);text-align:center;color:var(--ivory);width:360px}`,
           `  .center{position:absolute;left:50%;top:64%;transform:translate(-50%,-50%);text-align:center;color:var(--ivory);width:360px}`);
  s = rep(s, `  .status{position:absolute;left:0;right:0;bottom:22px;`, `  .status{position:absolute;left:0;right:0;bottom:14px;`);
  s = rep(s, `  .burst{position:absolute;left:50%;top:44%;`, `  .burst{position:absolute;left:50%;top:50%;`);
  return s;
});

rw("public/agents.html", (s) => {
  s = rep(s, `        <div class="warn">Save the key now — it is shown once.`, `        <div class="fund" id="cFund" hidden>
          <div class="fh">Fund this address to get seated</div>
          <div class="fa"><code id="cAddr2"></code></div>
          <div class="fb">Send at least <b id="cNeed"></b> USDC <b>on the Arc network</b>. Your agent antes from this wallet each match and its winnings land here. It is only seated while the balance covers an ante; top it up any time.</div>
        </div>
        <div class="warn">Save the key now — it is shown once.`);
  s = rep(s, `  .testout{margin-top:12px;`, `  .fund{margin-top:14px;background:var(--gold);color:var(--ink);border-radius:12px;padding:14px 16px}
  .fund .fh{font:600 18px/1.2 var(--serif)}
  .fund .fa code{display:block;background:rgba(0,0,0,.12);border-radius:8px;padding:8px 10px;margin:8px 0;font-size:13px;word-break:break-all;user-select:all}
  .fund .fb{font-size:13px;line-height:1.5}
  .testout{margin-top:12px;`);
  s = rep(s, `  $('#cTest').hidden=j.agent.type!=='endpoint'; $('#testout').hidden=true;`,
           `  $('#cTest').hidden=j.agent.type!=='endpoint'; $('#testout').hidden=true;
  const live=meta.walletKind && meta.walletKind!=='mock'; $('#cFund').hidden=!live; if(live){ $('#cAddr2').textContent=j.fundingAddress; $('#cNeed').textContent=(Math.ceil((meta.ante+0.02)*100)/100).toFixed(2); }`);
  return s;
});

rw("server.js", (s) => {
  s = rep(s, `return json(res, 200, { agents: registry.list().map(decorate), ante: ANTE, tableSize: TABLE_SIZE, promptAgentsEnabled: !!llmComplete, allowLocal: registry.allowLocal });`,
           `return json(res, 200, { agents: registry.list().map(decorate), ante: ANTE, tableSize: TABLE_SIZE, promptAgentsEnabled: !!llmComplete, allowLocal: registry.allowLocal, walletKind: wallet.kind });`);
  return s;
});
console.log("done");
