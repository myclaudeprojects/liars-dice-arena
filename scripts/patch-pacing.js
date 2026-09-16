// One-off patch: server-side pacing actually waits; forced challenges reveal; no illegal bids; phase banner. Idempotent.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const rw = (f, fn) => { const p = path.join(root, f); const a = fs.readFileSync(p, "utf8"); const b = fn(a); fs.writeFileSync(p, b); console.log(f, a === b ? "(no change)" : "patched"); };
const rep = (s, from, to) => { if (s.includes(to)) return s; if (!s.includes(from)) throw new Error("anchor missing: " + from.slice(0, 70)); return s.replace(from, to); };

rw("src/arena.js", (s) => {
  // every onEvent must be awaited so the server's pacing sleeps actually happen
  s = s.replace(/(^|\n)(\s*)onEvent\(/g, (m, a, ind) => `${a}${ind}await onEvent(`);
  s = s.replace(/const emitDeal = \(\) => await onEvent\(/, "const emitDeal = () => onEvent(");
  s = rep(s, `  emitDeal();
`, `  await emitDeal();
`);
  s = rep(s, `      if (!res.matchOver) emitDeal();`, `      if (!res.matchOver) await emitDeal();`);
  // forced challenge after an illegal move must still produce a reveal (and maybe end the match)
  s = rep(s, `      await onEvent({ type: "illegal", agentId: actor.id, error: res.error, action });
      match.applyAction({ type: "challenge" });
      continue;`, `      await onEvent({ type: "illegal", agentId: actor.id, error: res.error, action });
      const forced = match.applyAction({ type: "challenge" });
      if (forced.ok && forced.resolved) {
        await onEvent({ type: "reveal", ...forced.resolved,
          bidderName: byId[forced.resolved.bidderId].name,
          challengerName: byId[forced.resolved.challengerId].name,
          loserName: byId[forced.resolved.loserId].name });
        if (!forced.matchOver) await emitDeal();
      }
      continue;`);
  return s;
});

rw("src/agents.js", (s) => {
  s = rep(s, `const { DICE_SIDES } = require("./engine");`, `const { DICE_SIDES, isHigherBid } = require("./engine");`);
  // MockAgent: if the capped bid isn't a legal raise, challenge instead of bidding illegally
  s = rep(s, `    targetCount = Math.min(targetCount, totalDice);
    const bluffing = targetCount > bestHeld + exp + 0.5;`, `    targetCount = Math.min(targetCount, totalDice);
    if (currentBid && !isHigherBid(currentBid, { count: targetCount, face: bestFace })) {
      return { action: { type: "challenge" }, thought: \`Can't go higher than \${currentBid.count}×\${currentBid.face} with \${totalDice} dice on the table. Liar.\` };
    }
    const bluffing = targetCount > bestHeld + exp + 0.5;`);
  // LLM/remote replies: a bid must actually beat the current one
  s = rep(s, `    if (count < 1 || count > view.totalDice) return null;
    return { action: { type: "bid", count, face }, thought };`, `    if (count < 1 || count > view.totalDice) return null;
    if (!isHigherBid(view.currentBid, { count, face })) return null;
    return { action: { type: "bid", count, face }, thought };`);
  return s;
});

rw("public/index.html", (s) => {
  // phase banner across the top of the felt
  s = rep(s, `  .status{position:absolute;left:0;right:0;bottom:22px;`, `  .banner{position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:4;background:rgba(0,0,0,.35);color:var(--ivory);border-radius:999px;padding:8px 18px;font:600 13px/1 var(--sans);letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.3)}
  .banner b{color:var(--gold);font:600 15px/1 var(--serif);letter-spacing:0;text-transform:none;margin-left:8px}
  .banner.bet{background:var(--gold);color:var(--ink)} .banner.bet b{color:var(--ink)}
  .banner.play{background:rgba(255,255,255,.12)}
  .banner.win{background:var(--felt-deep);box-shadow:0 0 0 2px var(--gold)}
  .banner.pause{background:var(--red)}
  @media (max-width:900px){.banner{position:static;transform:none;margin:12px auto 0;width:max-content}}
  .status{position:absolute;left:0;right:0;bottom:22px;`);
  s = rep(s, `    <section class="table" id="table" aria-live="polite">
      <div id="seats"></div>`, `    <section class="table" id="table" aria-live="polite">
      <div class="banner" id="banner">Connecting</div>
      <div id="seats"></div>`);
  s = rep(s, `function setChip(html,cls){`, `let handNo=0;
function setBanner(text,cls,sub){ const b=$('#banner'); b.className='banner '+(cls||''); b.innerHTML=text+(sub?'<b>'+sub+'</b>':''); }
function setChip(html,cls){`);
  // betting phase: the visible switch waits until the previous match has finished animating
  s = rep(s, `    case 'phase': applyState(ev);
      if(phase==='betting') enqueue(async()=>{ counts={};alive={};`, `    case 'phase':
      if(ev.phase==='betting'){ enqueue(async()=>{ applyState(ev); setBanner('Betting open','bet','30s'); }); } else applyState(ev);
      if(phase==='betting'||ev.phase==='betting') enqueue(async()=>{ counts={};alive={};`);
  s = rep(s, `      if(phase==='playing') enqueue(async()=>{ $('#status').innerHTML='Bets closed. Agents are anteing…'; });`,
           `      if(ev.phase==='playing') enqueue(async()=>{ setBanner('Bets closed','play','anteing'); $('#status').innerHTML='Bets closed. Agents are anteing…'; });`);
  s = rep(s, `      if(phase==='paused') enqueue(async()=>{`, `      if(ev.phase==='paused') enqueue(async()=>{ setBanner('Table paused','pause');`);
  // banner text during play / deal / settle
  s = rep(s, `  setChip(\`<span class="who">hand \${ev.hand} — dice are rolling</span>\`,'q');`, `  handNo=ev.hand; setBanner('Hand '+ev.hand+' in play','play','dealing');
  setChip(\`<span class="who">hand \${ev.hand} — dice are rolling</span>\`,'q');`);
  s = rep(s, `  setChip(\`<span class="who">\${seats.find(s=>s.id===ev.first)?.name} opens the bidding</span>\`,'q');`, `  setChip(\`<span class="who">\${seats.find(s=>s.id===ev.first)?.name} opens the bidding</span>\`,'q');
  setBanner('Hand '+ev.hand+' in play','play',(seats.find(s=>s.id===ev.first)?.name||'')+' to open');`);
  s = rep(s, `  setActive(ev.agentId); setThought(ev.agentId,'',true);`, `  setActive(ev.agentId); setThought(ev.agentId,'',true); setBanner('Hand '+handNo+' in play','play',ev.name+' is thinking');`);
  s = rep(s, `  setActive(null); $('#tally').textContent='';
  setChip(\`<span>\${ev.name} wins</span><span class="who">\${ev.amount} USDC</span>\`);`, `  setActive(null); $('#tally').textContent=''; setBanner('Settled','win',ev.name+' wins '+ev.amount+' USDC');
  setChip(\`<span>\${ev.name} wins</span><span class="who">\${ev.amount} USDC</span>\`);`);
  // live countdown inside the banner
  s = rep(s, `setInterval(()=>{ if(phase==='betting'&&betCloseAt){const s=Math.max(0,Math.ceil((betCloseAt-(Date.now()+clockOffset))/1000));$('#clock').textContent=s+'s';} else $('#clock').textContent=''; },250);`,
           `setInterval(()=>{ if(phase==='betting'&&betCloseAt){const s=Math.max(0,Math.ceil((betCloseAt-(Date.now()+clockOffset))/1000));$('#clock').textContent=s+'s'; if($('#banner').classList.contains('bet')) $('#banner').innerHTML='Betting open<b>'+s+'s</b>';} else $('#clock').textContent=''; },250);`);
  return s;
});
console.log("done");
