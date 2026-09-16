// wallet.js — The ONLY place that touches money. Everything else is chain-agnostic.
//
// The game needs four operations:
//   createSeatWallet(name)        -> { walletId, address }
//   getBalance(walletId)          -> number (USDC)
//   ante(fromWallet, potWallet, amt)   -> txHash  (agent pays into the pot)
//   settle(potWallet, winnerWallet, amt) -> txHash  (pot pays the winner)
// Wallets are always passed as objects { walletId, address }: Circle
// transactions are *sent from* a walletId but *sent to* an address.
//
// MockWallet implements these in memory so you can watch full matches with no
// keys. CircleArcWallet is the real adapter — the marked TODO block is the only
// code you finish against Circle's LIVE docs/MCP (method signatures + the Arc
// chain id / USDC token address change too often to hardcode blindly).

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
  // fromW / toW are wallet objects: { walletId, address }
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
    this.balances.set(toW.walletId, (this.balances.get(toW.walletId) ?? 0) + pay);
    return "0xmocktx_settle_" + Math.random().toString(16).slice(2, 10);
  }
  explorerUrl(txHash) { return `mock://tx/${txHash}`; }
}

// ---- CircleArcWallet (real) ---------------------------------------------
// Uses Circle Developer Controlled Wallets. Fill the TODO block against live
// docs: https://developers.circle.com/  (and Circle's MCP server for exact
// current method names, the Arc chain identifier, and the USDC token id).
class CircleArcWallet {
  constructor({ apiKey, entitySecret, blockchain = "ARC-TESTNET" }) {
    if (!apiKey || !entitySecret) throw new Error("Circle apiKey + entitySecret required");
    this.kind = "circle";
    this.blockchain = blockchain;
    this.apiKey = apiKey;
    this.entitySecret = entitySecret;

    // TODO(circle): initialize the SDK client. As of writing:
    //   const { initiateDeveloperControlledWalletsClient } =
    //     require("@circle-fin/developer-controlled-wallets");
    //   this.client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
    // Verify the package name + init signature in the live docs before relying on it.
    this.client = null;
    this._walletSetId = null;
  }

  async _ensureWalletSet() {
    // TODO(circle): create (once) a wallet set to group the arena's wallets.
    //   const r = await this.client.createWalletSet({ name: "liars-dice-arena" });
    //   this._walletSetId = r.data.walletSet.id;
    throw new Error("CircleArcWallet not wired yet — finish the TODO blocks against live docs.");
  }

  async createSeatWallet(name) {
    // TODO(circle): create one developer-controlled wallet on Arc.
    //   await this._ensureWalletSet();
    //   const r = await this.client.createWallets({
    //     walletSetId: this._walletSetId,
    //     blockchains: [this.blockchain],   // confirm Arc identifier via MCP
    //     count: 1, accountType: "SCA",
    //   });
    //   const w = r.data.wallets[0];
    //   return { walletId: w.id, address: w.address, name };
    throw new Error("TODO: createSeatWallet");
  }

  async createPot() {
    // Same as createSeatWallet — the pot is just another wallet the arena controls.
    throw new Error("TODO: createPot");
  }

  async getBalance(walletId) {
    // TODO(circle): read USDC balance.
    //   const r = await this.client.getWalletTokenBalance({ id: walletId });
    //   find the USDC entry (match the Arc USDC token id from MCP) and return Number(amount).
    throw new Error("TODO: getBalance");
  }

  async ante(fromW, potW, amt) {
    // TODO(circle): transfer `amt` USDC from fromW.walletId -> potW.address.
    //   const r = await this.client.createTransaction({
    //     walletId: fromW.walletId,
    //     tokenId: ARC_USDC_TOKEN_ID,      // from MCP / live docs
    //     destinationAddress: potW.address,
    //     amounts: [String(amt)],
    //     fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    //   });
    //   return r.data.id; // then poll for the on-chain tx hash
    throw new Error("TODO: ante");
  }

  async settle(potW, winnerW, amt) {
    // TODO(circle): transfer from potW.walletId -> winnerW.address (same call shape as ante).
    throw new Error("TODO: settle");
  }

  explorerUrl(txHash) {
    // Arcscan explorer. Confirm the exact host for testnet vs mainnet.
    return `https://testnet.arcscan.app/tx/${txHash}`;
  }
}

function makeWallet(cfg = {}) {
  if (cfg.provider === "circle") return new CircleArcWallet(cfg);
  return new MockWallet(cfg);
}

module.exports = { MockWallet, CircleArcWallet, makeWallet };
