// One-off patch: connected-wallet betting on server/wallet/betting. Idempotent.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const rw = (f, fn) => { const p = path.join(root, f); const a = fs.readFileSync(p, "utf8"); const b = fn(a); fs.writeFileSync(p, b); console.log(f, a === b ? "(no change)" : "patched"); };
const rep = (s, from, to) => { if (s.includes(to)) return s; if (!s.includes(from)) throw new Error("anchor missing: " + from.slice(0, 60)); return s.replace(from, to); };

rw("src/wallet.js", (s) => {
  s = rep(s, `    this.provider = new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    this.house = new ethers.Wallet(privateKey, this.provider);`, `    this.provider = new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    this.provider.pollingInterval = 500;      // Arc blocks every ~0.5s; default 4s polling made confirms feel slow
    this.chainId = chainId; this.rpcUrl = rpcUrl;
    this.house = new ethers.Wallet(privateKey, this.provider);`);
  s = rep(s, `  async createPot() { return this.createSeatWallet("pot"); }
  async getBalance(walletId)`, `  async createPot(label = "pot") { return this.createSeatWallet(label); }
  async getBalance(walletId)`);
  s = rep(s, `  async houseBalance() { return this.getBalance("house"); }`, `  async houseBalance() { return this.getBalance("house"); }
  // Verify a spectator's own on-chain transfer into an arena address. Returns {from, amount, timestamp} or throws.
  async verifyDeposit(txHash, expectedTo) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || "")) throw new Error("bad_tx_hash");
    let rc = null;
    for (let i = 0; i < 20 && !rc; i++) { rc = await this.provider.getTransactionReceipt(txHash); if (!rc) await new Promise((r) => setTimeout(r, 500)); }
    if (!rc) throw new Error("tx_not_found_yet");
    if (rc.status !== 1) throw new Error("tx_failed");
    const tx = await this.provider.getTransaction(txHash);
    if (!tx || (tx.to || "").toLowerCase() !== expectedTo.toLowerCase()) throw new Error("tx_wrong_recipient");
    const block = await this.provider.getBlock(rc.blockNumber);
    return { from: tx.from, amount: this._fromWei(tx.value), timestamp: block.timestamp * 1000, blockNumber: rc.blockNumber };
  }
  // What the browser needs to add Arc + pay the pool.
  chainInfo() { return { chainId: this.chainId, chainIdHex: "0x" + this.chainId.toString(16), rpcUrl: this.rpcUrl, explorer: this.explorer, name: this.chainId === 5042 ? "Arc" : "Arc Testnet" }; }`);
  return s;
});

rw("src/betting.js", (s) => {
  s = rep(s, `    this.bettorWallets = {}; // bettorId -> { walletId, address }
    this.poolWallet = null;
    this.open = true;
  }`, `    this.bettorWallets = {}; // bettorId -> { walletId, address }
    this.poolWallet = null;
    this.open = true;
    this.closeAt = null;
    this.usedTx = new Set();
  }

  // A bet whose USDC already arrived on-chain from the bettor's own wallet.
  // Payout goes straight back to that address.
  recordExternal({ bettorId, address, agentId, amount, txHash }) {
    if (this.usedTx.has(txHash)) throw new Error("tx_already_used");
    this.usedTx.add(txHash);
    this.bettorWallets[bettorId] = { walletId: null, address };
    this.bets.push({ bettorId, agentId, amount, txHash });
  }`);
  s = rep(s, `    this.poolWallet = await this.wallet.createPot();`, `    this.poolWallet = await this.wallet.createPot("pool"); // separate from the agents' pot`);
  return s;
});

rw("server.js", (s) => {
  s = rep(s, `const ANTE = envNum("ANTE", 5);`, `const ANTE = envNum("ANTE", 5);
const MIN_STAKE = envNum("MIN_STAKE", 0.05);`);
  s = rep(s, `    state.betCloseAt = Date.now() + BET_WINDOW_MS;`, `    state.betCloseAt = Date.now() + BET_WINDOW_MS; pool.closeAt = state.betCloseAt;`);
  s = rep(s, `    const settlement = await pool.settle(result.winnerId, houseWallet);`, `    pool.settledAt = Date.now();
    const settlement = await pool.settle(result.winnerId, houseWallet);`);
  s = rep(s, `  if (url.startsWith("/api/agents")) return agentsApi(req, res, url);
`, `  if (url.startsWith("/api/agents")) return agentsApi(req, res, url);
  if (url === "/api/pool") return json(res, 200, { walletKind: wallet.kind, poolAddress: pool?.poolWallet?.address || null, open: !!(pool && pool.open), closeAt: state.betCloseAt, matchNo: state.matchNo, chain: wallet.chainInfo ? wallet.chainInfo() : null, minStake: MIN_STAKE });
`);
  s = rep(s, `        const { bettorId, agentId, amount } = JSON.parse(body);
        if (!pool || !pool.open) throw new Error("Betting is closed — wait for the next match.");
        if (!state.seats.find((s) => s.id === agentId)) throw new Error("Unknown seat.");
        const amt = Number(amount);
        if (!(amt > 0) || amt > 1000) throw new Error("Stake must be between 0 and 1000 USDC.");`, `        const { bettorId, agentId, amount, txHash, address } = JSON.parse(body);
        if (!state.seats.find((s) => s.id === agentId)) throw new Error("Unknown seat.");
        const amt = Number(amount);
        if (!(amt >= MIN_STAKE) || amt > 1000) throw new Error(\`Stake must be between \${MIN_STAKE} and 1000 USDC.\`);

        // Connected-wallet path: the stake already moved on-chain from the bettor's own wallet.
        if (txHash && wallet.verifyDeposit) {
          if (!pool) throw new Error("No match is open.");
          const dep = await wallet.verifyDeposit(txHash, pool.poolWallet.address);
          if (Math.abs(dep.amount - amt) > 0.000001) throw new Error(\`Transfer was \${dep.amount} USDC, not \${amt}.\`);
          if (address && dep.from.toLowerCase() !== String(address).toLowerCase()) throw new Error("Transfer came from a different wallet.");
          if (!pool.open && !(dep.timestamp <= (pool.closeAt || 0) + 3000 && state.phase === "playing" && !pool.settledAt)) {
            // Landed too late for this match: refund straight back to the sender.
            const rtx = await wallet.settle(pool.poolWallet, { address: dep.from }, dep.amount);
            throw new Error(\`Betting had closed — refunded \${dep.amount} USDC to your wallet (tx \${rtx.slice(0, 10)}…).\`);
          }
          pool.recordExternal({ bettorId: dep.from, address: dep.from, agentId, amount: amt, txHash });
          state.bets = pool.bets;
          state.multipliers = impliedMultipliers(pool.bets, state.seats.map((s) => s.id), pool.houseFeeBps);
          broadcast({ type: "bet", bettorId: dep.from, agentId, amount: amt, tx: txHash, explorer: wallet.explorerUrl(txHash), ...publicState() });
          return json(res, 200, { ok: true, tx: txHash, explorer: wallet.explorerUrl(txHash), payoutTo: dep.from });
        }

        if (!pool || !pool.open) throw new Error("Betting is closed — wait for the next match.");`);
  return s;
});
console.log("done");
