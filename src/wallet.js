// wallet.js — The ONLY place that touches money. Everything else is chain-agnostic.
//
// The game needs these operations:
//   createSeatWallet(label)              -> { walletId, address }
//   createPot()                          -> { walletId, address }
//   getBalance(walletId)                 -> number (USDC)
//   ante(fromWallet, potWallet, amt)     -> txHash  (agent pays into the pot)
//   settle(potWallet, winnerWallet, amt) -> txHash  (pot pays the winner)
//   ensureFunded(wallet, amt)            -> txHash|null (house tops up its own seats)
// Wallets are always passed as objects { walletId, address }.
//
// MockWallet   — in memory, auto-funded, zero keys. Used for local play.
// EvmWallet    — real: one hot key on Arc; every other wallet derived from it.
// CircleArcWallet — placeholder for Circle developer-controlled wallets.

// ---- MockWallet ----------------------------------------------------------
class MockWallet {
  constructor({ startingBalance = 100 } = {}) {
    this.kind = "mock";
    this.balances = new Map();
    this.n = 0;
    this.startingBalance = startingBalance;
  }
  async createSeatWallet(name) {
    const walletId = `mock_wal_${++this.n}`;
    const address = "0x" + (this.n.toString(16).padStart(40, "0"));
    this.balances.set(walletId, this.startingBalance);
    return { walletId, address, name };
  }
  async createPot() {
    const walletId = `mock_pot_${++this.n}`;
    const address = "0xpot" + (this.n.toString(16).padStart(37, "0"));
    this.balances.set(walletId, 0);
    return { walletId, address };
  }
  async getBalance(walletId) { return this.balances.get(walletId) ?? 0; }
  async ante(fromW, toW, amt) {
    const b = this.balances.get(fromW.walletId) ?? 0;
    if (b < amt) throw new Error("insufficient_balance");
    this.balances.set(fromW.walletId, b - amt);
    this.balances.set(toW.walletId, (this.balances.get(toW.walletId) ?? 0) + amt);
    return "0xmocktx_ante_" + Math.random().toString(16).slice(2, 10);
  }
  async settle(potW, toW, amt) {
    const b = this.balances.get(potW.walletId) ?? 0;
    const pay = Math.min(b, amt);
    this.balances.set(potW.walletId, b - pay);
    this.balances.set(toW.walletId || toW.address, (this.balances.get(toW.walletId || toW.address) ?? 0) + pay);
    return "0xmocktx_settle_" + Math.random().toString(16).slice(2, 10);
  }
  async ensureFunded() { return null; }
  explorerUrl(txHash) { return `mock://tx/${txHash}`; }
  addressUrl(addr) { return `mock://address/${addr}`; }
}

// ---- CircleArcWallet (placeholder) ----------------------------------------
// Circle developer-controlled wallets are the intended custodial path (see
// scripts/circle-setup.js) but the live arena currently runs self-custodied
// via EvmWallet (HOUSE_PRIVATE_KEY). This class must not throw in the
// constructor: a CIRCLE_API_KEY in the environment should not crash boot.
//
// Wire these methods against *current* Circle docs before enabling
// provider:"circle" in production. Signatures change; confirm via
// developers.circle.com (initiateDeveloperControlledWalletsClient,
// createWalletSet, createWallets, createTransaction, getWalletTokenBalance).
class CircleArcWallet {
  constructor({ apiKey, entitySecret, blockchain = "ARC-TESTNET", walletSetId, usdcTokenId } = {}) {
    this.kind = "circle";
    this.apiKey = apiKey;
    this.entitySecret = entitySecret;
    this.blockchain = blockchain || "ARC-TESTNET";
    this.walletSetId = walletSetId || process.env.CIRCLE_WALLET_SET_ID || null;
    this.usdcTokenId = usdcTokenId || process.env.CIRCLE_USDC_TOKEN_ID || null;
    this.wired = false;
  }
  _todo(op) {
    throw new Error(
      `TODO(circle): CircleArcWallet.${op} is not wired. Set HOUSE_PRIVATE_KEY to use EvmWallet, or implement this method against live Circle Developer-Controlled Wallets docs ` +
      `(initiateDeveloperControlledWalletsClient, createWallets({ walletSetId, blockchains:[blockchain], count:1, accountType:"EOA"|"SCA" }), createTransaction with the current USDC token id). ` +
      `Do not hard-code token ids or chain identifiers — pull them from the Circle console / MCP. blockchain=${this.blockchain}`
    );
  }
  async createSeatWallet() { this._todo("createSeatWallet"); }
  async createPot() { this._todo("createPot"); }
  async getBalance() { this._todo("getBalance"); }
  async ante() { this._todo("ante"); }
  async settle() { this._todo("settle"); }
  async ensureFunded() { this._todo("ensureFunded"); }
  explorerUrl(txHash) { return `https://developers.circle.com/tx/${txHash || ""}`; }
  addressUrl(addr) { return `https://developers.circle.com/address/${addr || ""}`; }
}

// ---- EvmWallet (real, self-custodied) ---------------------------------------
// One hot key (HOUSE_PRIVATE_KEY) funds everything. Every other wallet the arena
// needs — seats, pot, pool, spectator deposit wallets — is DERIVED from that key
// and a label, so there is exactly one secret to protect and any wallet can be
// re-created from (key, label). USDC is Arc's native currency (18 decimals on
// the native side), so transfers are plain value transfers: no ERC-20 approvals.
class EvmWallet {
  constructor({ privateKey, rpcUrl = "https://rpc.mainnet.arc.io", chainId = 5042, explorer = "https://explorer.arc.io", gasReserve = 0.02 }) {
    if (!privateKey) throw new Error("HOUSE_PRIVATE_KEY required");
    const ethers = require("ethers");
    this.ethers = ethers;
    this.kind = "evm";
    this.provider = new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    this.provider.pollingInterval = 500;      // Arc blocks every ~0.5s; default 4s polling made confirms feel slow
    this.chainId = chainId; this.rpcUrl = rpcUrl;
    // Read-only fallbacks used to look for receipts the primary node hasn't seen yet.
    this.altProviders = (chainId === 5042 ? ["https://rpc.drpc.mainnet.arc.io", "https://rpc.quicknode.mainnet.arc.io", "https://rpc.blockdaemon.mainnet.arc.io"] : [])
      .filter((u) => u !== rpcUrl).map((u) => new ethers.JsonRpcProvider(u, chainId, { staticNetwork: true }));
    this.house = new ethers.Wallet(privateKey, this.provider);
    this.explorer = explorer;
    this.gasReserve = gasReserve;            // USDC each sender keeps back for gas
    this.signers = new Map([["house", this.house]]);
  }
  _derive(label) {
    if (this.signers.has(label)) return this.signers.get(label);
    const { keccak256, toUtf8Bytes, concat, Wallet } = this.ethers;
    const pk = keccak256(concat([this.house.privateKey, toUtf8Bytes("liars-dice-arena:" + label)]));
    const w = new Wallet(pk, this.provider); this.signers.set(label, w); return w;
  }
  // Retry transient RPC failures (rate limits, timeouts, brief outages) with backoff.
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
        console.warn(`rpc transient (${label}) attempt ${i + 1}: ${msg.slice(0, 120)} — retrying in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw last;
  }
  _toWei(amt) { return this.ethers.parseUnits(Number(amt).toFixed(6), 18); }
  _fromWei(w) { return Math.floor(Number(this.ethers.formatUnits(w, 18)) * 1e6) / 1e6; }

  // walletId IS the label; address is derived. "house" maps to the key itself.
  async createSeatWallet(label) { const w = this._derive(String(label)); return { walletId: String(label), address: w.address, name: String(label) }; }
  async createPot(label = "pot") { return this.createSeatWallet(label); }
  async getBalance(walletId) { return this._retry(async () => this._fromWei(await this.provider.getBalance(this._derive(walletId).address)), "getBalance"); }

  async _send(fromLabel, toAddress, amt) {
    const from = this._derive(fromLabel);
    const value = this._toWei(amt);
    const bal = await this.provider.getBalance(from.address);
    if (bal < value + this._toWei(this.gasReserve)) throw new Error(`insufficient_balance: ${fromLabel} has ${this._fromWei(bal)} USDC, needs ${amt} + gas`);
    // Price with headroom so a gas-price tick right after sending doesn't strand the tx.
    const nonce = await this._retry(() => this.provider.getTransactionCount(from.address, "pending"), "nonce");
    const fee = await this._retry(() => this.provider.getFeeData(), "fee");
    let mult = 15n; // 1.5x
    const priced = () => fee.maxFeePerGas ? { maxFeePerGas: fee.maxFeePerGas * mult / 10n, maxPriorityFeePerGas: (fee.maxPriorityFeePerGas || 0n) * mult / 10n } : { gasPrice: (fee.gasPrice || 0n) * mult / 10n };
    let tx = await this._retry(() => from.sendTransaction({ to: toAddress, value, nonce, ...priced() }), "send");
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const rc = await tx.wait(1, 30_000);
        if (!rc || rc.status !== 1) throw new Error(`tx_failed: ${tx.hash}`);
        return tx.hash;
      } catch (e) {
        if (e?.code !== "TIMEOUT") throw e;
        // Maybe it mined and our node is lagging: ask the other RPCs.
        for (const alt of this.altProviders) {
          try { const rc = await alt.getTransactionReceipt(tx.hash); if (rc) { if (rc.status !== 1) throw new Error(`tx_failed: ${tx.hash}`); return tx.hash; } } catch {}
        }
        if (attempt === 2) throw new Error(`tx_stuck: ${tx.hash} not mined after replacements`);
        // Replace with the SAME nonce at a higher fee — only one of them can ever land.
        mult += 10n;
        console.warn(`tx ${tx.hash.slice(0, 12)} not mined in 30s — replacing nonce ${nonce} at ${Number(mult) / 10}x fee`);
        tx = await this._retry(() => from.sendTransaction({ to: toAddress, value, nonce, ...priced() }), "replace");
      }
    }
  }
  async ante(fromW, toW, amt) { return this._send(fromW.walletId, toW.address, amt); }
  async settle(potW, toW, amt) {
    // pay out what the pot actually holds (minus gas), never more than owed
    const bal = this._fromWei(await this.provider.getBalance(this._derive(potW.walletId).address));
    const pay = Math.min(amt, Math.max(0, bal - this.gasReserve));
    if (pay <= 0) throw new Error(`pot_empty: ${potW.walletId} holds ${bal} USDC`);
    return this._send(potW.walletId, toW.address, pay);
  }
  // House tops up one of its own seats so it can ante (community seats are funded by their owners).
  async ensureFunded(w, needed) {
    const bal = await this.getBalance(w.walletId);
    const target = needed * 3 + this.gasReserve * 2;
    if (bal >= needed + this.gasReserve) return null;
    return this._send("house", w.address, Math.max(target - bal, needed));
  }
  async houseBalance() { return this.getBalance("house"); }
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
  chainInfo() { return { chainId: this.chainId, chainIdHex: "0x" + this.chainId.toString(16), rpcUrl: this.rpcUrl, explorer: this.explorer, name: this.chainId === 5042 ? "Arc" : "Arc Testnet" }; }
  explorerUrl(txHash) { return `${this.explorer}/tx/${txHash}`; }
  addressUrl(addr) { return `${this.explorer}/address/${addr}`; }
}

function makeWallet(cfg = {}) {
  if (cfg.provider === "evm") return new EvmWallet(cfg);
  if (cfg.provider === "circle") return new CircleArcWallet(cfg);
  return new MockWallet(cfg);
}

module.exports = { MockWallet, CircleArcWallet, EvmWallet, makeWallet };
