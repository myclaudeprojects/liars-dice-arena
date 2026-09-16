const { LLMAgent, MockAgent } = require('../src/agents');
const { makeWallet } = require('../src/wallet');
const { runMatch } = require('../src/arena');

// Fake "model": sometimes valid JSON, sometimes fenced, sometimes garbage, sometimes illegal.
let i=0;
const fakeComplete = async ({user}) => {
  i++;
  const total = Number(/Total dice in play: (\d+)/.exec(user)[1]);
  const cb = /Current bid: (\d+) × face (\d+)/.exec(user);
  if (i%7===0) return "lol i dunno";                                   // garbage -> fallback
  if (i%5===0) return JSON.stringify({thought:"yolo",action:{type:"bid",count:99,face:9}}); // illegal -> fallback
  if (cb) {
    const c=Number(cb[1]), f=Number(cb[2]);
    if (c>=Math.ceil(total*0.5)) return '```json\n'+JSON.stringify({thought:"Nah, liar.",action:{type:"challenge"}})+'\n```';
    return JSON.stringify({thought:"raise it",action:{type:"bid",count:c+1,face:f}});
  }
  return JSON.stringify({thought:"open",action:{type:"bid",count:2,face:3}});
};

(async()=>{
  const agents=[
    new LLMAgent({id:'a',name:'FakeLLM-A',persona:'x',complete:fakeComplete}),
    new LLMAgent({id:'b',name:'FakeLLM-B',persona:'y',complete:fakeComplete}),
    new MockAgent({id:'c',name:'Mock-C',aggression:0.5}),
  ];
  let fallbacks=0, illegal=0, turns=0;
  const r=await runMatch({agents,wallet:makeWallet(),ante:2,seed:3,onEvent:e=>{
    if(e.type==='turn'){turns++; if(/^\(/.test(e.thought))fallbacks++;}
    if(e.type==='illegal')illegal++;
  }});
  console.log({winner:r.winnerName,turns,fallbacks,illegalReachedEngine:illegal,balances:r.balances});
})();
