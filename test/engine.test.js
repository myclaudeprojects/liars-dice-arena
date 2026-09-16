const { Match, isHigherBid, countFace } = require('../src/engine');
// sanity checks
console.assert(isHigherBid(null,{count:1,face:2})===true,'open ok');
console.assert(isHigherBid({count:2,face:3},{count:2,face:4})===true,'raise face');
console.assert(isHigherBid({count:2,face:3},{count:2,face:2})===false,'lower face');
console.assert(isHigherBid({count:2,face:3},{count:3,face:1})===true,'raise count');
console.assert(countFace([[1,2,2],[3,1]],2,true)===4,'ones wild count'); // 2,2 + two 1s =4
console.assert(countFace([[1,2,2],[3,1]],2,false)===2,'no wild');
console.log('unit checks passed');

// full random match
const m = new Match({ seats:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}], seed:42 });
let guard=0;
while(!m.winnerId && guard++<500){
  const v=m.viewFor(m.currentPlayer.id);
  // dumb policy: 40% challenge if a bid exists, else raise count by 1 on a random face
  let act;
  if(v.currentBid && Math.random()<0.4){ act={type:'challenge'}; }
  else if(!v.currentBid){ act={type:'bid',count:1,face:2}; }
  else {
    let c=v.currentBid.count, f=v.currentBid.face+1;
    if(f>6){f=2;c++;}
    if(c>v.totalDice){ act={type:'challenge'}; } else act={type:'bid',count:c,face:f};
  }
  const r=m.applyAction(act);
  if(!r.ok){ // fallback to challenge on illegal
    m.applyAction({type:'challenge'});
  }
}
console.log('winner:', m.winnerId, 'hands:', m.handNumber, 'events:', m.log.length);
console.log('last 3 events:', JSON.stringify(m.log.slice(-3),null,0).slice(0,300));
