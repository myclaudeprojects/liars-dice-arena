// One-off patch: stuck-tx handling (fee headroom, cross-RPC receipt check, same-nonce replacement) + clearer "bets closed" UX. Idempotent.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const rw = (f, fn) => { const p = path.join(root, f); const a = fs.readFileSync(p, "utf8"); const b = fn(a); fs.writeFileSync(p, b); console.log(f, a === b ? "(no change)" : "patched"); };
const rep = (s, from, to) => { if (s.includes(to)) return s; if (!s.includes(from)) throw new Error("anchor missing: " + from.slice(0, 70)); return s.replace(from, to); };

rw("src/wallet.js", (s) => {
  s = rep(s, `    this.chainId = chainId; this.rpcUrl = rpcUrl;`, `    this.chainId = chainId; this.rpcUrl = rpcUrl;
    // Read-only fallbacks used to look for receipts the primary node hasn't seen yet.
    this.altProviders = (chainId === 5042 ? ["https://rpc.drpc.mainnet.arc.io", "https://rpc.quicknode.mainnet.arc.io", "https://rpc.blockdaemon.mainnet.arc.io"] : [])
      .filter((u) => u !== rpcUrl).map((u) => new ethers.JsonRpcProvider(u, chainId, { staticNetwork: true }));`);
  s = rep(s, `    const tx = await this._retry(() => from.sendTransaction({ to: toAddress, value }), "send");
    const rc = await this._retry(() => tx.wait(1, 60_000), "wait");   // Arc: sub-second finality
    if (!rc || rc.status !== 1) throw new Error(\`tx_failed: \${tx.hash}\`);
    return tx.hash;`, `    // Price with headroom so a gas-price tick right after sending doesn't strand the tx.
    const nonce = await this._retry(() => this.provider.getTransactionCount(from.address, "pending"), "nonce");
    const fee = await this._retry(() => this.provider.getFeeData(), "fee");
    let mult = 15n; // 1.5x
    const priced = () => fee.maxFeePerGas ? { maxFeePerGas: fee.maxFeePerGas * mult / 10n, maxPriorityFeePerGas: (fee.maxPriorityFeePerGas || 0n) * mult / 10n } : { gasPrice: (fee.gasPrice || 0n) * mult / 10n };
    let tx = await this._retry(() => from.sendTransaction({ to: toAddress, value, nonce, ...priced() }), "send");
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const rc = await tx.wait(1, 30_000);
        if (!rc || rc.status !== 1) throw new Error(\`tx_failed: \${tx.hash}\`);
        return tx.hash;
      } catch (e) {
        if (e?.code !== "TIMEOUT") throw e;
        // Maybe it mined and our node is lagging: ask the other RPCs.
        for (const alt of this.altProviders) {
          try { const rc = await alt.getTransactionReceipt(tx.hash); if (rc) { if (rc.status !== 1) throw new Error(\`tx_failed: \${tx.hash}\`); return tx.hash; } } catch {}
        }
        if (attempt === 2) throw new Error(\`tx_stuck: \${tx.hash} not mined after replacements\`);
        // Replace with the SAME nonce at a higher fee — only one of them can ever land.
        mult += 10n;
        console.warn(\`tx \${tx.hash.slice(0, 12)} not mined in 30s — replacing nonce \${nonce} at \${Number(mult) / 10}x fee\`);
        tx = await this._retry(() => from.sendTransaction({ to: toAddress, value, nonce, ...priced() }), "replace");
      }
    }`);
  return s;
});

rw("public/index.html", (s) => {
  s = rep(s, `  $('#railtitle').textContent=phase==='betting'?\`Back an agent — match #\${ev.matchNo}\`:phase==='playing'?\`Match #\${ev.matchNo} in play — bets closed\`:\`Match #\${ev.matchNo} settled\`;`,
           `  $('#railtitle').textContent=phase==='betting'?\`Back an agent — match #\${ev.matchNo}\`:phase==='playing'?\`Match #\${ev.matchNo} in play — bets closed\`:phase==='paused'?'Table paused — betting reopens with the next deal':\`Match #\${ev.matchNo} settled\`;
  const closedNote=$('#closednote'); if(closedNote){ closedNote.hidden=phase==='betting'; closedNote.textContent=phase==='playing'?'Bets reopen for 30 seconds as soon as this match settles — usually 1–3 minutes. Keep this tab open; the countdown will appear here and the agent buttons will light up.':phase==='settled'?'Next betting window opens in a few seconds.':'Betting opens with the next deal.'; }`);
  s = rep(s, `    <div class="picks" id="picks"></div>`, `    <div class="hint" id="closednote" style="font-size:13px;color:#5c5a52;margin:6px 0 10px" hidden></div>
    <div class="picks" id="picks"></div>`);
  return s;
});
console.log("done");
