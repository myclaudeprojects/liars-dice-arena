// One-off patch: house cut comes from LOSING stakes only; a sole backer of the winner gets 1.00x. Idempotent.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const rw = (f, fn) => { const p = path.join(root, f); const a = fs.readFileSync(p, "utf8"); const b = fn(a); fs.writeFileSync(p, b); console.log(f, a === b ? "(no change)" : "patched"); };
const rep = (s, from, to) => { if (s.includes(to)) return s; if (!s.includes(from)) throw new Error("anchor missing: " + from.slice(0, 70)); return s.replace(from, to); };

rw("src/betting.js", (s) => {
  s = rep(s, `  const houseCut = round6((pool * houseFeeBps) / 10_000);
  const distributable = pool - houseCut;`, `  // Rake comes out of the LOSING side's stakes only. A winner never pays fee on their own money,
  // so a sole backer of the winner gets exactly 1.00x back.
  const losingStake = pool - winnerStake;
  const houseCut = round6((losingStake * houseFeeBps) / 10_000);
  const distributable = pool - houseCut;`);
  s = rep(s, `    const stake = bets.filter((b) => b.agentId === id).reduce((s, b) => s + b.amount, 0);
    out[id] = stake > 0 ? round6((pool * (1 - houseFeeBps / 10_000)) / stake) : null;`, `    const stake = bets.filter((b) => b.agentId === id).reduce((s, b) => s + b.amount, 0);
    out[id] = stake > 0 ? round6((stake + (pool - stake) * (1 - houseFeeBps / 10_000)) / stake) : null;`);
  s = rep(s, `// After the match, backers of the winner split the ENTIRE pool pro-rata to
// their stake (optionally minus a house fee in bps). Losers get nothing.`, `// After the match, backers of the winner get their own stakes back plus the
// losers' stakes pro-rata, minus a house fee (bps) taken from the losers' money
// only. Losers get nothing.`);
  return s;
});

rw("test/betting.test.js", (s) => {
  s = rep(s, `r=computePayouts([{bettorId:'x',agentId:'A',amount:10},{bettorId:'z',agentId:'A',amount:30},{bettorId:'y',agentId:'B',amount:60}],'A',200);
eq(r.houseCut,2,'2% fee'); eq(r.payouts.find(p=>p.bettorId==='x').amount,24.5,'x gets 1/4 of 98'); eq(r.payouts.find(p=>p.bettorId==='z').amount,73.5,'z gets 3/4');`,
`r=computePayouts([{bettorId:'x',agentId:'A',amount:10},{bettorId:'z',agentId:'A',amount:30},{bettorId:'y',agentId:'B',amount:60}],'A',200);
eq(r.houseCut,1.2,'2% of the 60 losing'); eq(r.payouts.find(p=>p.bettorId==='x').amount,24.7,'x gets 1/4 of 98.8'); eq(r.payouts.find(p=>p.bettorId==='z').amount,74.1,'z gets 3/4');
r=computePayouts([{bettorId:'solo',agentId:'A',amount:1}],'A',200);
eq(r.houseCut,0,'no losers, no rake'); eq(r.payouts[0].amount,1,'sole winner gets 1.00x back');`);
  s = rep(s, `const m=impliedMultipliers([{bettorId:'x',agentId:'A',amount:10},{bettorId:'y',agentId:'B',amount:30}],['A','B','C'],0);
eq(m.A,4,'A pays 4x'); eq(m.B,4/3,'B pays 1.33x'); if(m.C!==null) throw new Error('unbacked = null');`,
`const m=impliedMultipliers([{bettorId:'x',agentId:'A',amount:10},{bettorId:'y',agentId:'B',amount:30}],['A','B','C'],0);
eq(m.A,4,'A pays 4x'); eq(m.B,4/3,'B pays 1.33x'); if(m.C!==null) throw new Error('unbacked = null');
const m2=impliedMultipliers([{bettorId:'x',agentId:'A',amount:1}],['A'],200); eq(m2.A,1,'sole backer shows 1.00x, never below');`);
  return s;
});

rw("public/index.html", (s) => {
  s = rep(s, `<div class="m">\${m?\`pays <b>\${m.toFixed(2)}×</b> if it wins\`:'no backers yet — first in sets the line'}</div>`,
           `<div class="m">\${m?(m>1?\`pays <b>\${m.toFixed(2)}×</b> if it wins\`:'<b>1.00×</b> — only backer so far; stake returned if it wins'):'no backers yet — first in sets the line'}</div>`);
  s = rep(s, `Pari-mutuel: everyone who backed the winner splits the whole pool in proportion to their stake, minus a 2% house cut. If nobody backed the winner, all stakes are refunded.`,
           `Pari-mutuel: backers of the winner get their stake back plus the losing stakes, split in proportion to what they put in, after a 2% house cut taken from the losing side only. You never pay a fee on your own stake. If nobody backed the winner, everyone is refunded.`);
  return s;
});

rw("public/how.html", (s) => {
  s = rep(s, `Backers of the winning agent split the entire pool in proportion to what they staked, after a 2% house cut. Backers of losing agents get nothing. If nobody backed the winner, everyone is refunded in full and no cut is taken.`,
           `Backers of the winning agent get their own stake back plus the losing side's stakes, split in proportion to what they put in, after a 2% house cut taken from the losing money only — you never pay a fee on your own stake, so if you're the only one who backed the winner you simply get it back. Backers of losing agents get nothing. If nobody backed the winner, everyone is refunded in full.`);
  s = rep(s, `          <tr><td>alice</td><td>The Shark</td><td class="num">10</td><td class="num">24.50</td></tr>
          <tr><td>zed</td><td>The Shark</td><td class="num">30</td><td class="num">73.50</td></tr>
          <tr><td>bob</td><td>Degen</td><td class="num">60</td><td class="num">0</td></tr>
          <tr><td colspan="2">Pool 100 · house 2% = 2 · 98 split 1:3 between the winning backers</td><td class="num">100</td><td class="num">98</td></tr>`,
           `          <tr><td>alice</td><td>The Shark</td><td class="num">10</td><td class="num">24.70</td></tr>
          <tr><td>zed</td><td>The Shark</td><td class="num">30</td><td class="num">74.10</td></tr>
          <tr><td>bob</td><td>Degen</td><td class="num">60</td><td class="num">0</td></tr>
          <tr><td colspan="2">Losing side 60 · house 2% of that = 1.20 · 98.80 split 1:3 between the winning backers</td><td class="num">100</td><td class="num">98.80</td></tr>`);
  return s;
});
console.log("done");
