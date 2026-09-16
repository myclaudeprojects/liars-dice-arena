// One-off patch: never let a failed match kill the process; retry transient RPC errors. Idempotent.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const rw = (f, fn) => { const p = path.join(root, f); const a = fs.readFileSync(p, "utf8"); const b = fn(a); fs.writeFileSync(p, b); console.log(f, a === b ? "(no change)" : "patched"); };
const rep = (s, from, to) => { if (s.includes(to)) return s; if (!s.includes(from)) throw new Error("anchor missing: " + from.slice(0, 70)); return s.replace(from, to); };

rw("src/wallet.js", (s) => {
  s = rep(s, `  _toWei(amt) { return this.ethers.parseUnits(Number(amt).toFixed(6), 18); }`,
`  // Retry transient RPC failures (rate limits, timeouts, brief outages) with backoff.
  async _retry(fn, label) {
    let last;
    for (let i = 0; i < 5; i++) {
      try { return await fn(); }
      catch (e) {
        last = e;
        const msg = String(e?.message || e); const code = e?.code || e?.status;
        const transient = /429|rate|timeout|ETIMEDOUT|ECONNRESET|503|502|SERVER_ERROR|NETWORK_ERROR|failed to detect|Too Many/i.test(msg) || [429, 502, 503, "TIMEOUT", "SERVER_ERROR", "NETWORK_ERROR"].includes(code);
        if (!transient) throw e;
        const wait = 600 * 2 ** i;
        console.warn(\`rpc transient (\${label}) attempt \${i + 1}: \${msg.slice(0, 120)} — retrying in \${wait}ms\`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw last;
  }
  _toWei(amt) { return this.ethers.parseUnits(Number(amt).toFixed(6), 18); }`);
  s = rep(s, `  async getBalance(walletId) { return this._fromWei(await this.provider.getBalance(this._derive(walletId).address)); }`,
`  async getBalance(walletId) { return this._retry(async () => this._fromWei(await this.provider.getBalance(this._derive(walletId).address)), "getBalance"); }`);
  s = rep(s, `    const tx = await from.sendTransaction({ to: toAddress, value });
    const rc = await tx.wait();                   // Arc: sub-second finality
    if (!rc || rc.status !== 1) throw new Error(\`tx_failed: \${tx.hash}\`);
    return tx.hash;`,
`    const tx = await this._retry(() => from.sendTransaction({ to: toAddress, value }), "send");
    const rc = await this._retry(() => tx.wait(1, 60_000), "wait");   // Arc: sub-second finality
    if (!rc || rc.status !== 1) throw new Error(\`tx_failed: \${tx.hash}\`);
    return tx.hash;`);
  return s;
});

rw("server.js", (s) => {
  s = rep(s, `async function cycle() {
  if (!houseWallet) houseWallet = await wallet.createSeatWallet("house");
  while (true) {
    const agents = await buildAgents();`,
`let lastError = null;
async function cycle() {
  if (!houseWallet) houseWallet = await wallet.createSeatWallet("house");
  while (true) {
    try { await oneMatch(); lastError = null; }
    catch (e) {
      // A failed match must never take the site down. Log, tell viewers, pause, move on.
      lastError = { at: Date.now(), message: String(e?.message || e).slice(0, 300) };
      console.error(\`match #\${state.matchNo} failed:\`, e?.stack || e);
      state.phase = "paused";
      broadcast({ type: "phase", ...publicState(), error: lastError.message });
      await sleep(15000);
    }
  }
}

async function oneMatch() {
  {
    const agents = await buildAgents();`);
  s = rep(s, `    broadcast({ type: "pool_settled", winnerId: result.winnerId, winnerName: result.winnerName, ...settlement, ...publicState() });
    await sleep(8000);
  }
}`, `    broadcast({ type: "pool_settled", winnerId: result.winnerId, winnerName: result.winnerName, ...settlement, ...publicState() });
    await sleep(8000);
  }
}`);
  s = rep(s, `return res.end(JSON.stringify({ ok: true, phase: state.phase, matchNo: state.matchNo, wallet: wallet.kind, clients: clients.size, house: wallet.houseBalance ? await wallet.houseBalance().catch(() => null) : null }));`,
`return res.end(JSON.stringify({ ok: true, phase: state.phase, matchNo: state.matchNo, wallet: wallet.kind, clients: clients.size, house: wallet.houseBalance ? await wallet.houseBalance().catch(() => null) : null, lastError }));`);
  s = rep(s, `  cycle().catch((e) => { console.error("cycle crashed:", e); process.exit(1); });`,
`  cycle().catch((e) => { console.error("cycle crashed (unrecoverable):", e); });
  process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
  process.on("uncaughtException", (e) => console.error("uncaughtException:", e));`);
  return s;
});

rw("public/index.html", (s) => {
  s = rep(s, `      if(phase==='playing') enqueue(async()=>{ $('#status').innerHTML='Bets closed. Agents are anteing…'; });`,
`      if(phase==='playing') enqueue(async()=>{ $('#status').innerHTML='Bets closed. Agents are anteing…'; });
      if(phase==='paused') enqueue(async()=>{ $('#status').innerHTML='Table paused after an error — next deal shortly.'; log('Table paused: '+(ev.error||'error')+'. Resuming shortly.','red'); });`);
  return s;
});
console.log("done");
