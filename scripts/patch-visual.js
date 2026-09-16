// One-off patch: big center "now" caption + tighter animations to match 1.0s turns / 3s reveals. Idempotent.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const rw = (f, fn) => { const p = path.join(root, f); const a = fs.readFileSync(p, "utf8"); const b = fn(a); fs.writeFileSync(p, b); console.log(f, a === b ? "(no change)" : "patched"); };
const rep = (s, from, to) => { if (s.includes(to)) return s; if (!s.includes(from)) throw new Error("anchor missing: " + from.slice(0, 70)); return s.replace(from, to); };

rw("public/index.html", (s) => {
  // markup: caption above the bid chip
  s = rep(s, `        <div class="bidchip" id="bidchip"><span class="who">waiting for the deal</span></div>`,
`        <div class="now" id="now"><div class="nowtext" id="nowtext">&nbsp;</div><div class="nowbar"><i id="nowbar"></i></div></div>
        <div class="bidchip" id="bidchip"><span class="who">waiting for the deal</span></div>`);
  // styles
  s = rep(s, `  .bidchip{display:inline-flex;`, `  .now{margin:0 auto 12px;max-width:420px;min-height:64px}
  .nowtext{font:600 19px/1.25 var(--serif);font-variation-settings:"SOFT" 60;color:var(--ivory);text-shadow:0 2px 8px rgba(0,0,0,.4)}
  .nowtext .q{display:block;font:italic 400 14px/1.35 var(--sans);color:#dfe8e1;margin-top:4px}
  .nowtext.liar{color:#ffb0a6}
  .nowbar{height:4px;border-radius:2px;background:rgba(255,255,255,.14);margin:8px auto 0;width:180px;overflow:hidden}
  .nowbar i{display:block;height:100%;width:0;background:var(--gold);transition:width .05s linear}
  .bidchip{display:inline-flex;`);
  // helpers
  s = rep(s, `let handNo=0;`, `let handNo=0;
function setNow(html,cls){ const t=$('#nowtext'); t.className='nowtext '+(cls||''); t.innerHTML=html||'&nbsp;'; }
let barAnim=null;
function fillBar(ms){ const b=$('#nowbar'); if(barAnim) barAnim.cancel(); b.style.width='0'; if(reduced){b.style.width='0';return;} barAnim=b.animate([{width:'0%'},{width:'100%'}],{duration:ms,easing:'linear',fill:'forwards'}); }
function clearBar(){ if(barAnim) barAnim.cancel(); $('#nowbar').style.width='0'; }`);
  // deal: shorter tumble
  s = rep(s, `  const flick=setInterval(()=>document.querySelectorAll('.die.rolling .f').forEach(f=>f.innerHTML=face(rnd())),90);
  await sleep(800); clearInterval(flick);
  const all=[...document.querySelectorAll('.die.rolling')]; all.forEach((d,i)=>setTimeout(()=>{d.classList.remove('rolling');d.style.animationDelay='';d.classList.add('down');},i*35));
  await sleep(all.length*35+450);`,
`  setNow('Rolling the dice');
  const flick=setInterval(()=>document.querySelectorAll('.die.rolling .f').forEach(f=>f.innerHTML=face(rnd())),90);
  await sleep(550); clearInterval(flick);
  const all=[...document.querySelectorAll('.die.rolling')]; all.forEach((d,i)=>setTimeout(()=>{d.classList.remove('rolling');d.style.animationDelay='';d.classList.add('down');},i*20));
  await sleep(all.length*20+250);`);
  s = rep(s, `  setBanner('Hand '+ev.hand+' in play','play',(seats.find(s=>s.id===ev.first)?.name||'')+' to open');`,
           `  setBanner('Hand '+ev.hand+' in play','play',(seats.find(s=>s.id===ev.first)?.name||'')+' to open'); setNow((seats.find(s=>s.id===ev.first)?.name||'')+' opens the bidding');`);
  // turn: thinking caption with bar, then the move in big text
  s = rep(s, `  setActive(ev.agentId); setThought(ev.agentId,'',true); setBanner('Hand '+handNo+' in play','play',ev.name+' is thinking');
  await sleep(reduced?0:650);
  setThought(ev.agentId,ev.thought,false);`,
`  setActive(ev.agentId); setThought(ev.agentId,'',true); setBanner('Hand '+handNo+' in play','play',ev.name+' is thinking');
  setNow(ev.name+' is thinking…'); fillBar(420);
  await sleep(reduced?0:420); clearBar();
  setThought(ev.agentId,ev.thought,false);`);
  s = rep(s, `    burst('LIAR!');
    setChip(`, `    burst('LIAR!'); setNow(ev.name+' calls LIAR on '+ev.bidBefore.count+' × '+ev.bidBefore.face+(ev.thought?'<span class="q">“'+ev.thought+'”</span>':''),'liar');
    setChip(`);
  s = rep(s, `    await flyChip(seatEl(ev.agentId), $('#bidchip'));
    setChip(`, `    setNow(ev.name+' bids '+ev.action.count+' × '+ev.action.face+(ev.thought?'<span class="q">“'+ev.thought+'”</span>':''));
    await flyChip(seatEl(ev.agentId), $('#bidchip'),{dur:380});
    setChip(`);
  // reveal: faster flips, caption
  s = rep(s, `  tally.innerHTML=\`counting \${f}s… <b>0</b> of \${ev.bid.count} needed\`;`, `  tally.innerHTML=\`counting \${f}s… <b>0</b> of \${ev.bid.count} needed\`; setNow('Showdown — counting the '+f+'s');`);
  s = rep(s, `    await sleep(reduced?0:130);
  }
  await sleep(reduced?0:350);`, `    await sleep(reduced?0:85);
  }
  await sleep(reduced?0:250);`);
  s = rep(s, `  await sleep(reduced?0:700);
  const ls=seatEl(ev.loserId);`, `  setNow(ev.bidWasTrue?ev.loserName+' called wrong — loses a die':ev.loserName+' got caught bluffing — loses a die',ev.bidWasTrue?'':'liar');
  await sleep(reduced?0:450);
  const ls=seatEl(ev.loserId);`);
  s = rep(s, `  if(lastDie){ lastDie.classList.add('drop'); await sleep(reduced?0:800); }`, `  if(lastDie){ lastDie.classList.add('drop'); await sleep(reduced?0:550); }`);
  // settle caption
  s = rep(s, `  setActive(null); $('#tally').textContent=''; setBanner('Settled','win',ev.name+' wins '+ev.amount+' USDC');`,
           `  setActive(null); $('#tally').textContent=''; setBanner('Settled','win',ev.name+' wins '+ev.amount+' USDC'); setNow(ev.name+' takes the pot — '+ev.amount+' USDC');`);
  // betting phase reset
  s = rep(s, `setChip('<span class="who">betting open — deal in a moment</span>','q');`, `setChip('<span class="who">betting open — deal in a moment</span>','q'); setNow('Back an agent below before the deal'); clearBar();`);
  // seat thought slightly bigger
  s = rep(s, `  .seat .thought{font-size:13px;color:#dfe8e1;min-height:40px;`, `  .seat .thought{font-size:13.5px;color:#dfe8e1;min-height:40px;`);
  return s;
});
console.log("done");
