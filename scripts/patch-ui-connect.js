// One-off patch: adds connect-wallet betting to public/index.html. Idempotent.
const fs = require("fs"), path = require("path");
const p = path.join(__dirname, "..", "public", "index.html");
let s = fs.readFileSync(p, "utf8");
if (s.includes("id=\"connect\"")) { console.log("already patched"); process.exit(0); }

// 1) rail markup: connect button + status line
s = s.replace(
`    <div class="place">
      <input id="stake" type="number" min="1" max="1000" step="1" value="10" aria-label="Stake in USDC" />
      <span>USDC on <b id="picked">—</b></span>
      <button id="betbtn" disabled>Place bet</button>
      <span class="me" id="me"></span>
    </div>`,
`    <div class="place">
      <button id="connect" class="btn ghost" style="padding:12px 16px" hidden>Connect wallet</button>
      <input id="stake" type="number" min="0.05" max="1000" step="0.05" value="1" aria-label="Stake in USDC" />
      <span>USDC on <b id="picked">—</b></span>
      <button id="betbtn" disabled>Place bet</button>
      <span class="me" id="me"></span>
    </div>`);

// 2) replace refreshMe (deposit model) with wallet-aware version
s = s.replace(/async function refreshMe\(\)\{[\s\S]*?\}\nrefreshMe\(\); setInterval\(refreshMe,15000\);/,
`let poolInfo=null, account=null;
const short=(a)=>a?a.slice(0,6)+'…'+a.slice(-4):'';
async function refreshMe(){
  try{
    poolInfo=await fetch('/api/pool').then(r=>r.json());
    if(poolInfo.walletKind!=='evm'){ const j=await fetch('/api/balance/'+encodeURIComponent(bettorId)).then(r=>r.json()); $('#me').innerHTML=\`you: \${bettorId} · balance \${j.balance} USDC (mock)\`; return; }
    $('#connect').hidden=!!account;
    if(!window.ethereum){ $('#me').innerHTML='No wallet found — install <a href="https://metamask.io/download/" target="_blank" rel="noopener">MetaMask</a> or Rabby to bet.'; return; }
    if(account){ const hex=await window.ethereum.request({method:'eth_getBalance',params:[account,'latest']}); const bal=Number(BigInt(hex))/1e18; $('#me').innerHTML=\`<b>\${short(account)}</b> · \${bal.toFixed(4)} USDC on Arc\`; }
    else $('#me').textContent='Connect a wallet to bet. Payouts go straight back to it.';
  }catch{}
}
refreshMe(); setInterval(refreshMe,15000);

async function ensureArc(){
  const c=poolInfo.chain; const hex=c.chainIdHex;
  try{ await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:hex}]}); }
  catch(e){ if(e.code===4902||/Unrecognized|not added/i.test(e.message||'')){ await window.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:hex,chainName:c.name,nativeCurrency:{name:'USDC',symbol:'USDC',decimals:18},rpcUrls:[c.rpcUrl],blockExplorerUrls:[c.explorer]}]}); } else throw e; }
}
$('#connect').onclick=async()=>{
  try{ $('#msg').className='msg'; $('#msg').textContent='Opening your wallet…';
    const accts=await window.ethereum.request({method:'eth_requestAccounts'}); account=accts[0]; bettorId=account;
    await ensureArc(); $('#msg').textContent=''; $('#betbtn').disabled=!(phase==='betting'&&picked); refreshMe();
  }catch(e){ $('#msg').className='msg err'; $('#msg').textContent=e.message||'Wallet connection failed.'; }
};
if(window.ethereum){ window.ethereum.on?.('accountsChanged',(a)=>{account=a[0]||null; if(account) bettorId=account; refreshMe();}); }`);

// 3) bet handler: send from the connected wallet when live, else the mock path
s = s.replace(/\$\('#betbtn'\)\.onclick=async\(\)=>\{[\s\S]*?\n\};/,
`$('#betbtn').onclick=async()=>{
  const amount=Number($('#stake').value); $('#msg').className='msg';
  if(poolInfo&&poolInfo.walletKind==='evm'){
    if(!account){ $('#msg').className='msg err'; $('#msg').textContent='Connect your wallet first.'; return; }
    if(!poolInfo.poolAddress||!poolInfo.open){ $('#msg').className='msg err'; $('#msg').textContent='Betting is closed — wait for the next window.'; return; }
    try{
      await ensureArc();
      $('#msg').textContent=\`Confirm \${amount} USDC in your wallet…\`;
      const value='0x'+(BigInt(Math.round(amount*1e6))*1000000000000n).toString(16);
      const txHash=await window.ethereum.request({method:'eth_sendTransaction',params:[{from:account,to:poolInfo.poolAddress,value}]});
      $('#msg').innerHTML=\`Sent. Waiting for Arc to confirm… <a href="\${poolInfo.chain.explorer}/tx/\${txHash}" target="_blank" rel="noopener">view</a>\`;
      let j=null;
      for(let i=0;i<20;i++){ const r=await fetch('/api/bet',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bettorId:account,address:account,agentId:picked,amount,txHash})}); j=await r.json(); if(j.ok||!/not_found_yet/.test(j.error||'')) break; await sleep(700); }
      if(j.ok){ $('#msg').className='msg ok'; $('#msg').innerHTML=\`Bet placed on \${seats.find(s=>s.id===picked)?.name}. Winnings pay to \${short(j.payoutTo)}. <a href="\${j.explorer}" target="_blank" rel="noopener">view tx</a>\`; }
      else { $('#msg').className='msg err'; $('#msg').textContent=j.error; }
      refreshMe();
    }catch(e){ $('#msg').className='msg err'; $('#msg').textContent=e.code===4001?'Transaction rejected in wallet.':(e.message||'Failed to send.'); }
    return;
  }
  $('#msg').textContent='Sending USDC to the pool…';
  const r=await fetch('/api/bet',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bettorId,agentId:picked,amount})}); const j=await r.json();
  if(j.ok){$('#msg').className='msg ok';$('#msg').innerHTML=\`Bet placed. Your balance: \${j.balance} USDC. <a href="\${j.explorer}" target="_blank" rel="noopener">view tx</a>\`; refreshMe();}
  else{$('#msg').className='msg err';$('#msg').textContent=j.error;}
};`);

// 4) copy: bets go from your own wallet now
s = s.replace(/<div class="howto"><b>Your arena balance<\/b>[\s\S]*?Pari-mutuel:/,
`<div class="howto"><b>Bet from your own wallet.</b> Connect MetaMask or Rabby, and each stake is a USDC transfer on Arc from you to this match's pool address; winnings are paid straight back to your wallet when the match settles. Pari-mutuel:`);

// 5) bet button enabled state must also require a connected account in live mode
s = s.replace(`$('#betbtn').disabled=!(phase==='betting'&&picked);
  const total=ev.poolTotal||0;`, `$('#betbtn').disabled=!(phase==='betting'&&picked&&(walletKind!=='evm'||account));
  const total=ev.poolTotal||0;`);
s = s.replace(`renderPicks();$('#betbtn').disabled=phase!=='betting';});`, `renderPicks();$('#betbtn').disabled=!(phase==='betting'&&(walletKind!=='evm'||account));});`);

const checks=["id=\"connect\"","ensureArc","eth_sendTransaction","recordExternal"];
fs.writeFileSync(p, s);
console.log("patched:", checks.slice(0,3).map(c=>c+"="+s.includes(c)).join(" "));
