// One-off patch: after registering an agent, prompt the creator to fund it straight from their wallet. Idempotent.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const rw = (f, fn) => { const p = path.join(root, f); const a = fs.readFileSync(p, "utf8"); const b = fn(a); fs.writeFileSync(p, b); console.log(f, a === b ? "(no change)" : "patched"); };
const rep = (s, from, to) => { if (s.includes(to)) return s; if (!s.includes(from)) throw new Error("anchor missing: " + from.slice(0, 70)); return s.replace(from, to); };

rw("public/agents.html", (s) => {
  s = rep(s, `          <div class="fb">Send at least <b id="cNeed"></b> USDC <b>on the Arc network</b>. Your agent antes from this wallet each match and its winnings land here. It is only seated while the balance covers an ante; top it up any time.</div>
        </div>`,
`          <div class="fb">Your agent antes from this wallet each match and its winnings land here. It is only seated while the balance covers an ante (<b id="cNeed"></b> USDC minimum); top it up any time.</div>
          <div class="frow">
            <button class="btn primary" id="cFundBtn">Fund 0.50 USDC from my wallet</button>
            <span class="fstat" id="cFundStat">Balance: checking…</span>
          </div>
          <div class="fb" style="margin-top:8px;opacity:.85">No wallet? Send USDC <b>on the Arc network</b> to the address above from any exchange or wallet.</div>
        </div>`);
  s = rep(s, `  .fund .fb{font-size:13px;line-height:1.5}`, `  .fund .fb{font-size:13px;line-height:1.5}
  .fund .frow{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px}
  .fund .fstat{font-size:13px;font-weight:600}
  .fund .btn.primary{background:var(--felt);color:var(--ivory)}`);
  s = rep(s, `  const live=meta.walletKind && meta.walletKind!=='mock'; $('#cFund').hidden=!live; if(live){ $('#cAddr2').textContent=j.fundingAddress; $('#cNeed').textContent=(Math.ceil((meta.ante+0.02)*100)/100).toFixed(2); }`,
`  const live=meta.walletKind && meta.walletKind!=='mock'; $('#cFund').hidden=!live; if(live){ $('#cAddr2').textContent=j.fundingAddress; $('#cNeed').textContent=(Math.ceil((meta.ante+0.02)*100)/100).toFixed(2); $('#cFundBtn').hidden=!window.ethereum; watchBalance(j.agent.id); }`);
  s = rep(s, `let mine=null;`, `let mine=null, chain=null, balTimer=null;
fetch('/api/pool').then(r=>r.json()).then(p=>{chain=p.chain;}).catch(()=>{});
async function ensureArc(){
  const hex=chain.chainIdHex;
  try{ await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:hex}]}); }
  catch(e){ if(e.code===4902||/Unrecognized|not added/i.test(e.message||'')){ await window.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:hex,chainName:chain.name,nativeCurrency:{name:'USDC',symbol:'USDC',decimals:18},rpcUrls:[chain.rpcUrl],blockExplorerUrls:[chain.explorer]}]}); } else throw e; }
}
function watchBalance(id){
  clearInterval(balTimer);
  const need=meta.ante+0.02;
  const tick=async()=>{ try{ const j=await fetch('/api/agents/'+id).then(r=>r.json()); const b=Number(j.balance||0);
    $('#cFundStat').innerHTML = b>=need ? \`Balance: <span style="color:#1f6b3a">\${b.toFixed(4)} USDC — seated at the next table</span>\` : \`Balance: \${b.toFixed(4)} USDC — needs \${need.toFixed(2)} to play\`; }catch{} };
  tick(); balTimer=setInterval(tick,5000);
}
$('#cFundBtn').onclick=async()=>{
  if(!mine||!chain) return;
  const st=$('#cFundStat');
  try{
    st.textContent='Opening your wallet…';
    const accts=await window.ethereum.request({method:'eth_requestAccounts'}); await ensureArc();
    st.textContent='Confirm 0.50 USDC in your wallet…';
    const value='0x'+(500000000000000000n).toString(16); // 0.50 USDC (18-decimal native)
    const tx=await window.ethereum.request({method:'eth_sendTransaction',params:[{from:accts[0],to:mine.fundingAddress,value}]});
    st.innerHTML=\`Sent — waiting for Arc… <a href="\${chain.explorer}/tx/\${tx}" target="_blank" rel="noopener" style="color:inherit">view</a>\`;
  }catch(e){ st.textContent=e.code===4001?'Cancelled in wallet.':(e.message||'Failed to send.'); }
};`);
  return s;
});
console.log("done");
