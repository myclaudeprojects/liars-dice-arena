// Browser-signed Argus Portal #7 launches.
//
// There is no REST create API. Portal #7 (not the bundle's top-level
// addresses.portal, which is Portal #6) exposes launch(params, meta, salt, hookSalt).
// The hook address must be mined so its low 14 bits equal 0x2044 before the
// wallet sends the transaction. The creator wallet is msg.sender.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("ethers"));
  else root.ArgusLaunch = factory(root.ethers);
})(typeof globalThis !== "undefined" ? globalThis : this, function (ethers) {
  const PORTAL7 = "0xB021Be536808f551b31789422Fd28a6c9c6e97Da";
  const PORTAL6 = "0xA5628A11c412596E1f63b75a2C0284F843C549d6";
  const QUOTE_ASSET = "0x3600000000000000000000000000000000000000";
  const CHAIN_ID = 5042;
  const CHAIN_ID_HEX = "0x13b2";
  const HOOK_FLAGS = 0x2044n;
  const HOOK_MASK = (1n << 14n) - 1n;
  const BUNDLE_SHA256 = "94f7e126fd2f0a9fe34f1c4b82d7f8082eef9757a5822895f3c0a6d1c9d3da1f";
  const BUNDLE_URL = "https://arguspad.io/argus-v4.json";
  const IMAGE_URI_MAX_BYTES = 512;
  const INT128_MAX = 170141183460469231731687303715884105727n;
  const ARC_CHAIN = {
    chainId: CHAIN_ID_HEX,
    chainName: "Arc",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: ["https://rpc.mainnet.arc.io", "https://rpc.drpc.mainnet.arc.io"],
    blockExplorerUrls: ["https://explorer.arc.io"],
  };

  let cachedAbi = null;

  function fail(code, message, status) {
    const err = new Error(message);
    err.code = code;
    err.publicMessage = message;
    if (status) err.status = status;
    return err;
  }

  function loadAbi() {
    if (cachedAbi) return cachedAbi;
    if (typeof require === "function") {
      cachedAbi = require("./portal7.abi.json");
      return cachedAbi;
    }
    throw fail("abi_missing", "Portal #7 ABI is not loaded.");
  }

  function setAbi(abi) {
    if (!Array.isArray(abi) || !abi.length) throw fail("abi_missing", "Portal #7 ABI is not loaded.");
    cachedAbi = abi;
    return cachedAbi;
  }

  function byteLength(value) {
    return new TextEncoder().encode(String(value || "")).length;
  }

  function addr(value) {
    try { return ethers.getAddress(value); }
    catch { throw fail("bad_address", "That address is not valid."); }
  }

  function hex32(value) {
    let hex;
    try { hex = ethers.hexlify(value); }
    catch { throw fail("bad_hash", "Expected a 32-byte hex value."); }
    if (!ethers.isHexString(hex, 32)) throw fail("bad_hash", "Expected a 32-byte hex value.");
    return hex.toLowerCase();
  }

  function tickerStem(name) {
    const words = String(name || "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    let stem = words.length >= 2 ? words.map((word) => word[0]).join("") : "";
    if (stem.length < 2) stem = words.join("");
    stem = stem.replace(/[^A-Z0-9]/g, "").slice(0, 10);
    return stem.length >= 2 ? stem : "AG";
  }

  function deriveTicker(name, taken) {
    const used = new Set((taken || []).map((row) => String(row || "").toUpperCase()).filter(Boolean));
    const stem = tickerStem(name);
    if (!used.has(stem)) return stem;
    for (let n = 2; n < 10000; n++) {
      const suffix = String(n);
      const candidate = stem.slice(0, 10 - suffix.length) + suffix;
      if (candidate.length >= 2 && candidate.length <= 10 && !used.has(candidate)) return candidate;
    }
    throw fail("ticker", "Could not find an unused ticker.");
  }

  function validateAllocation(parts) {
    const keys = ["creatorBps", "burnBps", "dividendBps", "liquidityBps"];
    const out = {};
    let sum = 0;
    for (const key of keys) {
      const n = Number(parts[key]);
      if (!Number.isInteger(n) || n < 0 || n > 10000) {
        throw fail("allocation", "Allocation shares must be whole basis points from 0 to 10000.");
      }
      out[key] = n;
      sum += n;
    }
    if (sum !== 10000) throw fail("allocation", "Creator, burn, dividends, and liquidity must total 100%.");
    return out;
  }

  function validateTaxes(buyTaxBps, sellTaxBps) {
    const buy = Number(buyTaxBps);
    const sell = Number(sellTaxBps);
    if (!Number.isInteger(buy) || !Number.isInteger(sell) || buy < 100 || sell < 100 || buy > 1000 || sell > 1000) {
      throw fail("tax", "Buy and sell tax must each be from 1% to 10%.");
    }
    return { buyTaxBps: buy, sellTaxBps: sell };
  }

  function fitImageUri(candidates, fallback) {
    const list = [...(candidates || []), fallback].filter(Boolean);
    for (const url of list) {
      if (byteLength(url) <= IMAGE_URI_MAX_BYTES && /^https:\/\//i.test(url)) return url;
    }
    for (const url of list) {
      if (byteLength(url) <= IMAGE_URI_MAX_BYTES && /^https?:\/\//i.test(url)) return url;
    }
    return fallback || "";
  }

  function cleanText(value, max) {
    return String(value || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function hasForm(input, key) {
    return input && Object.prototype.hasOwnProperty.call(input, key) && input[key] != null && String(input[key]).trim() !== "";
  }

  function percentBps(input, formKey, bpsKey) {
    if (hasForm(input, formKey)) return Math.round(Number(input[formKey]) * 100);
    return Number(input[bpsKey]);
  }

  function usdc6(human, label) {
    const text = String(human == null ? "" : human).trim();
    if (!/^\d+(\.\d{1,6})?$/.test(text)) throw fail("amount", label + " must be a USDC amount.");
    const [whole, frac = ""] = text.split(".");
    return BigInt(whole + frac.padEnd(6, "0"));
  }

  function tokens18(human) {
    const text = String(human == null ? "" : human).trim();
    if (!/^\d+$/.test(text) || text === "0") throw fail("supply", "Supply must be a whole number of tokens.");
    return BigInt(text) * (10n ** 18n);
  }

  function suggestLaunch(input) {
    const body = input || {};
    const base = String(body.publicBase || "https://liars-dice-arena.onrender.com").replace(/\/$/, "");
    const agentId = encodeURIComponent(body.agentId || "");
    const fallback = base + "/api/show/agents/" + agentId + "/pfp.svg";
    const candidates = [];
    if (body.canonicalPfp) {
      const raw = String(body.canonicalPfp);
      candidates.push(/^https?:\/\//i.test(raw) ? raw : base + (raw.startsWith("/") ? raw : "/" + raw));
    }
    if (body.imageUrl) candidates.push(String(body.imageUrl));
    return {
      launchName: cleanText(body.name, 32),
      launchTicker: deriveTicker(body.name, body.takenTickers),
      launchImage: fitImageUri(candidates, fallback),
      launchWebsite: base + "/",
      launchDescription: cleanText(body.description, 280),
      launchX: "",
      launchTelegram: "",
      launchBuy: "5",
      launchSell: "5",
      launchCreator: "100",
      launchBurn: "0",
      launchDividends: "0",
      launchLiquidity: "0",
      launchDevBuy: "0",
      launchStartFdv: "2500",
      launchBondFdv: "45000",
      launchSupply: "1000000000",
    };
  }

  function prepareLaunch(input) {
    const body = input || {};
    const name = cleanText(hasForm(body, "launchName") ? body.launchName : body.name, 32);
    if (name.length < 2 || name.length > 32) throw fail("name", "Token name must be 2–32 characters.");
    const symbol = String(hasForm(body, "launchTicker") ? body.launchTicker : body.symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw fail("ticker", "Ticker must be 2–10 letters or numbers.");
    const taxes = validateTaxes(
      percentBps(body, "launchBuy", "buyTaxBps"),
      percentBps(body, "launchSell", "sellTaxBps"),
    );
    const allocation = validateAllocation({
      creatorBps: percentBps(body, "launchCreator", "creatorBps"),
      burnBps: percentBps(body, "launchBurn", "burnBps"),
      dividendBps: percentBps(body, "launchDividends", "dividendBps"),
      liquidityBps: percentBps(body, "launchLiquidity", "liquidityBps"),
    });
    const imageURI = String(hasForm(body, "launchImage") ? body.launchImage : body.imageURI || "").trim();
    if (!/^https?:\/\//i.test(imageURI) || byteLength(imageURI) > IMAGE_URI_MAX_BYTES) {
      throw fail("image", "Image must be an http(s) URL of at most 512 bytes.");
    }
    const website = String(hasForm(body, "launchWebsite") ? body.launchWebsite : body.website || "").trim();
    if (!/^https?:\/\//i.test(website) || website.length > 200) {
      throw fail("website", "Website must be an http(s) URL.");
    }
    const description = cleanText(hasForm(body, "launchDescription") ? body.launchDescription : body.description, 280);
    const twitter = cleanText(hasForm(body, "launchX") ? body.launchX : body.twitter, 120);
    const telegram = cleanText(hasForm(body, "launchTelegram") ? body.launchTelegram : body.telegram, 120);
    const devBuyQuote = hasForm(body, "launchDevBuy") || body.devBuyQuote == null
      ? usdc6(hasForm(body, "launchDevBuy") ? body.launchDevBuy : "0", "Dev buy")
      : BigInt(body.devBuyQuote);
    if (devBuyQuote < 0n || devBuyQuote > 1000000n * 1000000n) throw fail("dev_buy", "Dev buy must be from 0 to 1,000,000 USDC.");
    const startFdvUsdc6 = hasForm(body, "launchStartFdv")
      ? usdc6(body.launchStartFdv, "Opening FDV")
      : BigInt(body.startFdvUsdc6);
    const bondFdvUsdc6 = hasForm(body, "launchBondFdv")
      ? usdc6(body.launchBondFdv, "Bond FDV")
      : BigInt(body.bondFdvUsdc6);
    if (startFdvUsdc6 <= 0n || bondFdvUsdc6 <= startFdvUsdc6) {
      throw fail("fdv", "Bond value must be above the opening value.");
    }
    const totalSupply = hasForm(body, "launchSupply")
      ? tokens18(body.launchSupply)
      : BigInt(body.totalSupply);
    if (totalSupply <= 0n || totalSupply > INT128_MAX) throw fail("supply", "Supply is outside the range Portal #7 can launch.");
    const expectConvert = body.expectConvert == null ? 1 : Number(body.expectConvert);
    if (![0, 1, 2].includes(expectConvert)) throw fail("payout", "Payout choice must be 0, 1, or 2.");
    const quoteAsset = addr(body.quoteAsset || QUOTE_ASSET);
    if (quoteAsset !== addr(QUOTE_ASSET)) throw fail("quote", "This launch pairs with Arc USDC.");
    const salt = body.salt ? hex32(body.salt) : ethers.hexlify(ethers.randomBytes(32)).toLowerCase();
    return {
      name,
      symbol,
      ...taxes,
      ...allocation,
      imageURI,
      website,
      twitter,
      telegram,
      description,
      devBuyQuote,
      startFdvUsdc6,
      bondFdvUsdc6,
      totalSupply,
      expectConvert,
      quoteAsset,
      salt,
    };
  }

  function encodeCall(abi, name, args) {
    const iface = new ethers.Interface(abi || loadAbi());
    return iface.encodeFunctionData(name, args);
  }

function encodeLaunch(abi, prepared) {
  const row = prepared || {};
  if (!row.hookSalt) throw fail("hook_salt", "Hook salt is missing.");
  return encodeCall(abi, "launch", [
      {
        name: row.name,
        symbol: row.symbol,
        totalSupply: row.totalSupply,
        startFdvUsdc6: row.startFdvUsdc6,
        bondFdvUsdc6: row.bondFdvUsdc6,
        buyTaxBps: row.buyTaxBps,
        sellTaxBps: row.sellTaxBps,
        creatorBps: row.creatorBps,
        burnBps: row.burnBps,
        dividendBps: row.dividendBps,
        liquidityBps: row.liquidityBps,
        devBuyQuote: row.devBuyQuote,
        quoteAsset: row.quoteAsset,
        expectConvert: row.expectConvert,
      },
      {
        imageURI: row.imageURI,
        website: row.website,
        twitter: row.twitter || "",
        telegram: row.telegram || "",
        description: row.description || "",
      },
      row.salt,
      hex32(row.hookSalt),
    ]);
  }

  function receiptOk(status) {
    if (typeof status === "bigint") return status === 1n;
    if (typeof status === "number") return status === 1;
    const text = String(status == null ? "" : status).toLowerCase();
    return text === "0x1" || text === "0x01" || text === "1";
  }

  function decodeLaunchReceipt(receipt, portal) {
    if (!receipt || typeof receipt !== "object") throw fail("no_receipt", "No transaction receipt.");
    if (!receiptOk(receipt.status)) throw fail("tx_failed", "The launch transaction reverted.");
    const portalAddr = addr(portal || PORTAL7);
    if (portalAddr === addr(PORTAL6)) throw fail("wrong_portal", "Portal #6 cannot be used for new launches.");
    if (receipt.to && addr(receipt.to) !== portalAddr) throw fail("wrong_portal", "That transaction was not sent to Portal #7.");
    const iface = new ethers.Interface(loadAbi());
    let created = null;
    let parts = null;
    for (const log of receipt.logs || []) {
      if (!log || !log.address) continue;
      let logAddr;
      try { logAddr = addr(log.address); } catch { continue; }
      if (logAddr !== portalAddr) continue;
      let parsed;
      try { parsed = iface.parseLog(log); } catch { continue; }
      if (!parsed) continue;
      if (parsed.name === "TokenCreated") created = parsed;
      if (parsed.name === "PartsDeployed") parts = parsed;
    }
    if (!created) throw fail("no_token_created", "The receipt has no Portal #7 TokenCreated event.");
    if (!parts) throw fail("no_parts", "The receipt has no Portal #7 PartsDeployed event.");
    const token = addr(created.args.token);
    if (addr(parts.args.token) !== token) throw fail("parts_mismatch", "TokenCreated and PartsDeployed name different tokens.");
    const creator = addr(created.args.creator);
    if (receipt.from && addr(receipt.from) !== creator) {
      throw fail("creator_mismatch", "The transaction sender is not the token creator.");
    }
    return {
      status: "minted",
      tokenAddress: token,
      poolId: hex32(created.args.poolId),
      hook: addr(parts.args.hook),
      locker: addr(parts.args.locker),
      splitter: addr(parts.args.splitter),
      portal: portalAddr,
      argusUrl: "https://argus.world/token/" + token,
      txHash: hex32(receipt.transactionHash),
      blockHash: receipt.blockHash ? hex32(receipt.blockHash) : null,
      creatorWallet: creator,
      name: String(created.args.name || ""),
      symbol: String(created.args.symbol || ""),
    };
  }

  function hookCreate2Salt(creator, hookSalt) {
    return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes32"],
      [addr(creator), hex32(hookSalt)],
    ));
  }

  function mineHookSalt(opts) {
    const body = opts || {};
    const limit = body.maxTries || 250000;
    const deployer = addr(body.portal || PORTAL7);
    const who = addr(body.creator);
    const initCodeHash = hex32(body.initCodeHash);
    for (let i = 0; i < limit; i++) {
      const hookSalt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      const salt = hookCreate2Salt(who, hookSalt);
      const hook = ethers.getCreate2Address(deployer, salt, initCodeHash);
      if ((BigInt(hook) & HOOK_MASK) === HOOK_FLAGS) {
        return { hookSalt: hookSalt.toLowerCase(), hook: addr(hook), tries: i + 1 };
      }
    }
    throw fail("hook_salt", "Could not find a hook address. Try the launch again.");
  }

  function decodeSingle(types, data) {
    if (!data || data === "0x") throw fail("eth_call", "Portal #7 did not answer that read.");
    return ethers.AbiCoder.defaultAbiCoder().decode(types, data);
  }

  async function connectWallet(provider) {
    if (!provider || typeof provider.request !== "function") {
      throw fail("no_wallet", "Install MetaMask or another injected wallet, then try again.");
    }
    let accounts;
    try {
      accounts = await provider.request({ method: "eth_requestAccounts" });
    } catch (e) {
      if (e && e.code === 4001) throw fail("wallet_rejected", "The wallet request was declined. The agent is still saved.");
      throw e;
    }
    if (!accounts || !accounts[0]) throw fail("no_wallet", "The wallet did not return an account.");
    await ensureArc(provider);
    return addr(accounts[0]);
  }

  async function ensureArc(provider) {
    const current = String(await provider.request({ method: "eth_chainId" }) || "").toLowerCase();
    if (current === CHAIN_ID_HEX) return;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
    } catch (e) {
      const missing = e && (e.code === 4902 || /unrecognized|not added|unknown chain/i.test(String(e.message || "")));
      if (e && e.code === 4001) throw fail("wallet_rejected", "The wallet request was declined. The agent is still saved.");
      if (!missing) throw e;
      await provider.request({ method: "wallet_addEthereumChain", params: [ARC_CHAIN] });
    }
    const after = String(await provider.request({ method: "eth_chainId" }) || "").toLowerCase();
    if (after !== CHAIN_ID_HEX) throw fail("wrong_chain", "Switch the wallet to Arc mainnet (chain id 5042).");
  }

  async function waitForReceipt(provider, txHash, opts) {
    const body = opts || {};
    const tries = body.tries || 40;
    const delay = body.delayMs == null ? 500 : body.delayMs;
    for (let i = 0; i < tries; i++) {
      const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [txHash] });
      if (receipt) return receipt;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    }
    throw fail("receipt_timeout", "The transaction was sent. A receipt has not arrived yet.");
  }

  const ERC20_ABI = [
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
  ];

  async function ensureQuoteAllowance(provider, from, portal, quote, amount) {
    if (amount === 0n) return;
    const erc20 = new ethers.Interface(ERC20_ABI);
    const allowanceData = erc20.encodeFunctionData("allowance", [from, portal]);
    const raw = await provider.request({ method: "eth_call", params: [{ to: quote, data: allowanceData }, "latest"] });
    const current = decodeSingle(["uint256"], raw)[0];
    if (current >= amount) return;
    const approveData = erc20.encodeFunctionData("approve", [portal, amount]);
    const txHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{ from, to: quote, data: approveData }],
    });
    const receipt = await waitForReceipt(provider, txHash, { delayMs: 0, tries: 20 });
    if (!receiptOk(receipt.status)) throw fail("approve_failed", "USDC approval did not confirm. The agent is still saved.");
  }

  async function runLaunch(provider, opts) {
    const body = opts || {};
    if (body.abi) setAbi(body.abi);
    const abi = loadAbi();
    const portal = addr(body.portal || PORTAL7);
    if (portal === addr(PORTAL6)) throw fail("wrong_portal", "Portal #6 cannot be used for new launches.");
    const status = typeof body.onStatus === "function" ? body.onStatus : function () {};
    status("Connecting wallet…");
    const creator = await connectWallet(provider);
    const prepared = prepareLaunch(body.params || {});
    status("Reading Portal #7…");
    const splitterRaw = await provider.request({
      method: "eth_call",
      params: [{ to: portal, data: encodeCall(abi, "predictSplitter", [creator, prepared.salt]) }, "latest"],
    });
    const splitter = addr(decodeSingle(["address"], splitterRaw)[0]);
    const hashRaw = await provider.request({
      method: "eth_call",
      params: [{
        to: portal,
        data: encodeCall(abi, "hookInitCodeHash", [splitter, prepared.buyTaxBps, prepared.sellTaxBps, prepared.quoteAsset]),
      }, "latest"],
    });
    const initCodeHash = hex32(decodeSingle(["bytes32"], hashRaw)[0]);
    status("Finding a hook address…");
    const mined = mineHookSalt({ portal, creator, initCodeHash });
    if (prepared.devBuyQuote > 0n) {
      status("Approving USDC for the dev buy…");
      await ensureQuoteAllowance(provider, creator, portal, prepared.quoteAsset, prepared.devBuyQuote);
    }
    status("Confirm the launch in your wallet…");
    let txHash;
    try {
      txHash = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: creator, to: portal, data: encodeLaunch(abi, { ...prepared, hookSalt: mined.hookSalt }), value: "0x0" }],
      });
    } catch (e) {
      if (e && e.code === 4001) throw fail("wallet_rejected", "The wallet request was declined. The agent is still saved.");
      throw e;
    }
    status("Waiting for the Arc receipt…");
    let receipt;
    try {
      receipt = await waitForReceipt(provider, txHash, { delayMs: body.receiptDelayMs == null ? 500 : body.receiptDelayMs });
    } catch (e) {
      if (e && !e.txHash) e.txHash = txHash;
      throw e;
    }
    const decoded = decodeLaunchReceipt(receipt, portal);
    return { txHash: decoded.txHash, creator, hook: mined.hook, decoded, prepared };
  }

  function publicArgus(raw) {
    if (!raw || raw.status !== "minted" || !raw.tokenAddress || !raw.txHash) return null;
    return {
      status: "minted",
      tokenAddress: raw.tokenAddress,
      poolId: raw.poolId || null,
      hook: raw.hook || null,
      locker: raw.locker || null,
      splitter: raw.splitter || null,
      portal: raw.portal || null,
      argusUrl: raw.argusUrl || ("https://argus.world/token/" + raw.tokenAddress),
      txHash: raw.txHash,
      creatorWallet: raw.creatorWallet || null,
      symbol: raw.symbol || null,
      mintedAt: raw.mintedAt || null,
    };
  }

  function portal7FromBundle(bundle) {
    const section = bundle && bundle.portal7;
    if (!section) throw fail("bundle", "argus-v4.json has no portal7 section.");
    const raw = typeof section === "string"
      ? section
      : (section.address || section.portal || (section.addresses && section.addresses.portal));
    const portal = addr(raw);
    if (portal === addr(PORTAL6)) throw fail("bundle", "Portal #7 section resolved to Portal #6.");
    const top = bundle.addresses && bundle.addresses.portal;
    if (top && addr(top) === portal) throw fail("bundle", "Refusing the top-level portal address. Use the portal7 section.");
    return portal;
  }

  function pinnedBundle() {
    if (typeof require !== "function") return null;
    try {
      const fs = require("fs");
      const path = require("path");
      const file = path.join(__dirname, "argus-v4.json");
      if (!fs.existsSync(file)) return null;
      const buf = fs.readFileSync(file);
      const hash = require("crypto").createHash("sha256").update(buf).digest("hex");
      if (hash !== BUNDLE_SHA256) throw fail("bundle_hash", "Pinned argus-v4.json hash does not match the integration pin.");
      return JSON.parse(buf.toString("utf8"));
    } catch (e) {
      if (e && (e.code === "bundle_hash" || e.code === "bundle")) throw e;
      return null;
    }
  }

  function activePortal() {
    const bundle = pinnedBundle();
    if (bundle) return portal7FromBundle(bundle);
    return addr(PORTAL7);
  }

  return {
    PORTAL7,
    PORTAL6,
    QUOTE_ASSET,
    CHAIN_ID,
    CHAIN_ID_HEX,
    HOOK_FLAGS,
    BUNDLE_SHA256,
    BUNDLE_URL,
    IMAGE_URI_MAX_BYTES,
    ARC_CHAIN,
    loadAbi,
    setAbi,
    byteLength,
    deriveTicker,
    validateAllocation,
    validateTaxes,
    fitImageUri,
    suggestLaunch,
    prepareLaunch,
    encodeCall,
    encodeLaunch,
    decodeLaunchReceipt,
    hookCreate2Salt,
    mineHookSalt,
    connectWallet,
    runLaunch,
    publicArgus,
    portal7FromBundle,
    pinnedBundle,
    activePortal,
    fail,
  };
});
