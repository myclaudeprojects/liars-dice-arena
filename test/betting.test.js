const { computePayouts, impliedMultipliers, BettingPool } = require('../src/betting');
const { makeWallet } = require('../src/wallet');
const eq=(a,b,m)=>{ if(Math.abs(a-b)>1e-6) throw new Error(m+`: ${a} != ${b}`); };

// pari-mutuel math
let r=computePayouts([{bettorId:'x',agentId:'A',amount:10},{bettorId:'y',agentId:'B',amount:30}],'A',0);
eq(r.payouts[0].amount,40,'sole winner takes pool');
r=computePayouts([{bettorId:'x',agentId:'A',amount:10},{bettorId:'z',agentId:'A',amount:30},{bettorId:'y',agentId:'B',amount:60}],'A',200);
eq(r.houseCut,1.2,'2% of the 60 losing'); eq(r.payouts.find(p=>p.bettorId==='x').amount,24.7,'x gets 1/4 of 98.8'); eq(r.payouts.find(p=>p.bettorId==='z').amount,74.1,'z gets 3/4');
r=computePayouts([{bettorId:'solo',agentId:'A',amount:1}],'A',200);
eq(r.houseCut,0,'no losers, no rake'); eq(r.payouts[0].amount,1,'sole winner gets 1.00x back');
r=computePayouts([{bettorId:'x',agentId:'A',amount:10}],'B',200);
if(!r.refunded||r.payouts[0].amount!==10) throw new Error('refund path');
// dust: 3 winners splitting 100 -> 33.333333 each, must sum exactly
r=computePayouts([1,2,3].map(i=>({bettorId:'w'+i,agentId:'A',amount:1})).concat([{bettorId:'l',agentId:'B',amount:97}]),'A',0);
eq(r.payouts.reduce((s,p)=>s+p.amount,0),100,'dust fixed');
const m=impliedMultipliers([{bettorId:'x',agentId:'A',amount:10},{bettorId:'y',agentId:'B',amount:30}],['A','B','C'],0);
eq(m.A,4,'A pays 4x'); eq(m.B,4/3,'B pays 1.33x'); if(m.C!==null) throw new Error('unbacked = null');
const m2=impliedMultipliers([{bettorId:'x',agentId:'A',amount:1}],['A'],200); eq(m2.A,1,'sole backer shows 1.00x, never below');
console.log('betting math ok');

// end-to-end with mock wallet
(async()=>{
  const w=makeWallet({startingBalance:50});
  const pool=new BettingPool({wallet:w,houseFeeBps:200}); await pool.init();
  const alice=await w.createSeatWallet('alice'), bob=await w.createSeatWallet('bob'), house=await w.createSeatWallet('house');
  await pool.placeBet({bettorId:'alice',bettorWallet:alice,agentId:'claude',amount:20});
  await pool.placeBet({bettorId:'bob',bettorWallet:bob,agentId:'gpt',amount:30});
  pool.close();
  const s=await pool.settle('claude',house);
  console.log({alice:await w.getBalance(alice.walletId), bob:await w.getBalance(bob.walletId), house:await w.getBalance(house.walletId)-50, poolLeft:await w.getBalance(pool.poolWallet.walletId)});
})();
