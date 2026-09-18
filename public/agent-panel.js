// Agent panel: stats + holdings + token. Buy lives here and on /agent/:id —
// never as a control on the live table felt.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

  let root = null;
  let currentId = null;
  let allowBuy = true;
  let tableId = null;

  function ensure() {
    if (root) return root;
    root = document.createElement("div");
    root.id = "agent-sheet";
    root.hidden = true;
    root.innerHTML = `
      <div class="agent-sheet-card" role="dialog" aria-modal="true" aria-labelledby="as-name">
        <div class="agent-sheet-handle" aria-hidden="true"></div>
        <button type="button" class="agent-sheet-x" data-as-close aria-label="Close">Close</button>
        <div class="ava-row" style="margin:4px 0 8px;padding-right:72px">
          <img class="avatar lg" id="as-ava" alt="" width="72" height="72" />
          <h2 id="as-name" style="padding-right:0">Agent</h2>
        </div>
        <p class="agent-sheet-meta" id="as-meta"></p>
        <div class="agent-sheet-stats" id="as-stats"></div>
        <div class="agent-sheet-hold" id="as-hold"></div>
        <form class="agent-sheet-tip" id="as-tip">
          <p class="agent-sheet-tip-lede" id="as-tip-lede">Pick <b>one</b> influence. 100% of the USDC is a gift to the persona creator (crowd / pre-lock only). You are never entitled to winnings. Spectators cannot stake into a win pool.</p>
          <div class="influence-picks" id="as-inf" role="radiogroup" aria-label="Pick one influence">
            <button type="button" class="inf" data-inf="aggressive" aria-pressed="false"><b>Aggressive</b><span>Bluff more, challenge more</span></button>
            <button type="button" class="inf" data-inf="calculated" aria-pressed="false"><b>Calculated</b><span>Play tighter / probability-focused</span></button>
            <button type="button" class="inf" data-inf="chaos" aria-pressed="false"><b>Chaos</b><span>More unpredictable</span></button>
            <button type="button" class="inf" data-inf="defensive" aria-pressed="false"><b>Defensive</b><span>Protect position / avoid marginal challenges</span></button>
          </div>
          <input type="hidden" id="as-inf-val" value="" />
          <p class="agent-sheet-live" id="as-inf-live"></p>
          <label for="as-tip-amt">Amount (USDC)</label>
          <div class="agent-sheet-row">
            <input id="as-tip-amt" type="number" inputmode="decimal" min="0.05" max="1000" step="0.05" value="1" />
            <button type="submit" class="btn primary" id="as-tip-cta" disabled>Pick an influence</button>
          </div>
          <p class="agent-sheet-msg" id="as-tip-msg"></p>
        </form>
        <div class="agent-sheet-token" id="as-token"></div>
        <form class="agent-sheet-buy" id="as-form">
          <label for="as-amt">Amount (USDC)</label>
          <div class="agent-sheet-row">
            <input id="as-amt" type="number" inputmode="decimal" min="0.05" max="1000" step="0.05" value="1" />
            <button type="submit" class="btn primary" id="as-cta">Buy token</button>
          </div>
          <p class="agent-sheet-msg" id="as-msg"></p>
        </form>
        <p class="agent-sheet-hint" id="as-hint"></p>
      </div>`;
    document.body.appendChild(root);
    root.addEventListener("click", (e) => { if (e.target === root) close(); });
    root.querySelector("[data-as-close]").addEventListener("click", close);
    root.querySelector("#as-form").addEventListener("submit", onBuy);
    root.querySelector("#as-tip").addEventListener("submit", onTip);
    root.querySelector("#as-inf").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-inf]");
      if (!btn || !root.contains(btn)) return;
      pickInfluence(btn.getAttribute("data-inf"));
    });
    return root;
  }

  function pickInfluence(id) {
    if (!root) return;
    const val = String(id || "").toLowerCase();
    root.querySelector("#as-inf-val").value = val;
    root.querySelectorAll("#as-inf [data-inf]").forEach((b) => {
      const on = b.getAttribute("data-inf") === val;
      b.classList.toggle("sel", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const cta = root.querySelector("#as-tip-cta");
    if (cta && !cta.dataset.locked) {
      const labels = { aggressive: "Aggressive", calculated: "Calculated", chaos: "Chaos", defensive: "Defensive" };
      cta.disabled = !labels[val];
      cta.textContent = labels[val] ? "Tip · " + labels[val] : "Pick an influence";
    }
  }

  function close() {
    if (!root) return;
    root.hidden = true;
    currentId = null;
    document.body.classList.remove("sheet-open");
  }

  function avaSrc(id, extra) {
    const url = extra && extra.url;
    if (url) return url;
    const q = extra && extra.updatedAt ? "?v=" + extra.updatedAt : "";
    return "/api/agents/" + encodeURIComponent(id) + "/avatar" + q;
  }
  function img(id, cls, extra) {
    return `<img class="avatar${cls ? " " + cls : ""}" src="${esc(avaSrc(id, extra))}" alt="" width="40" height="40" decoding="async" />`;
  }

  function renderLoading() {
    ensure();
    root.querySelector("#as-name").textContent = "Loading…";
    const av = root.querySelector("#as-ava");
    if (av) { av.removeAttribute("src"); av.alt = ""; }
    root.querySelector("#as-meta").textContent = "";
    root.querySelector("#as-stats").innerHTML = "";
    root.querySelector("#as-hold").innerHTML = "";
    root.querySelector("#as-token").innerHTML = "";
    root.querySelector("#as-msg").textContent = "";
    root.querySelector("#as-tip-msg").textContent = "";
    root.querySelector("#as-hint").textContent = "";
    root.querySelector("#as-cta").disabled = true;
    const tipCta = root.querySelector("#as-tip-cta");
    if (tipCta) { tipCta.disabled = true; delete tipCta.dataset.locked; tipCta.textContent = "Pick an influence"; }
    pickInfluence("");
  }

  function cell(val, label) {
    return `<div><b>${esc(val)}</b><span>${esc(label)}</span></div>`;
  }

  function render(j) {
    const a = j.agent || {};
    const buy = j.buy || a.buy || {};
    const h = j.holdings || {};
    root.querySelector("#as-name").textContent = a.name || buy.name || "Agent";
    const avEl = root.querySelector("#as-ava");
    if (avEl && a.id) {
      avEl.src = a.imageUrl || avaSrc(a.id, a.avatar);
      avEl.alt = a.name || "Agent";
    }
    const owner = a.house ? "house" : (a.owner || "");
    const creator = buy.creator || a.ownerAddress || h.creatorAddress;
    const tables = (j.tables || a.seatedAt || []).map((t) => t.id || t).filter(Boolean);
    const tag = a.personaTag ? ` · ${esc(a.personaTag)}` : "";
    root.querySelector("#as-meta").innerHTML =
      `${esc(a.id || "")}${owner ? " · by " + esc(owner) : ""}${a.type ? " · " + esc(a.type) : ""}${tag}` +
      (a.status ? ` · ${esc(a.status)}` : "") +
      (creator ? ` · creator ${esc(String(creator).slice(0, 6) + "…" + String(creator).slice(-4))}` : "") +
      (tables.length ? ` · at ${tables.map((id) => `<a href="/arena?table=${esc(id)}">${esc(id)}</a>`).join(", ")}` : "");

    const formLine = (a.form || []).map((x) => `<i class="${x === "W" ? "w" : "l"}">${esc(x)}</i>`).join("") || "—";
    root.querySelector("#as-stats").innerHTML =
      cell(`${a.won ?? 0}–${Math.max(0, (a.matches ?? a.played ?? 0) - (a.won ?? 0))}`, "record") +
      cell((a.net != null ? a.net + " credits" : "—"), "net credits") +
      `<div><b class="form">${formLine}</b><span>form</span></div>`;

    const cred = h.credits != null ? Number(h.credits) + " credits" : (a.credits != null ? Number(a.credits) + " credits" : "—");
    root.querySelector("#as-hold").innerHTML =
      cell(cred, "Arena Credits") +
      cell(String(h.ante ?? 1) + " " + (h.unit || "credits"), "ante") +
      cell(h.creatorAddress ? String(h.creatorAddress).slice(0, 6) + "…" + String(h.creatorAddress).slice(-4) : "—", "creator");

    const tip = j.tip || {};
    const tipForm = root.querySelector("#as-tip");
    const tipCta = root.querySelector("#as-tip-cta");
    const tipMsg = root.querySelector("#as-tip-msg");
    const liveEl = root.querySelector("#as-inf-live");
    const tipsOpen = tip.tipsOpen !== false;
    if (tipForm) {
      tipForm.hidden = false;
      if (tipCta) {
        if (!tipsOpen) {
          tipCta.disabled = true;
          tipCta.dataset.locked = "1";
          tipCta.textContent = "Tips locked";
        } else {
          delete tipCta.dataset.locked;
          const chosen = root.querySelector("#as-inf-val").value;
          tipCta.disabled = !chosen;
          tipCta.textContent = chosen ? "Tip · " + chosen.charAt(0).toUpperCase() + chosen.slice(1) : "Pick an influence";
        }
      }
      if (tipMsg) {
        tipMsg.textContent = tipsOpen
          ? "100% to the persona creator. You are never entitled to winnings."
          : "Tips are pre-lock only. After lock, WHO WINS is on the table — LDA is not the exchange.";
      }
      const cur = tip.current || j.influence;
      if (liveEl) {
        liveEl.textContent = !tipsOpen
          ? "Crowd closed — influence is frozen for this match."
          : (cur && cur.dominant
            ? `Lean: ${cur.label} — ${cur.blurb}. Weighted by tip size.`
            : "No influence yet — your tip shifts how this seat plays.");
      }
      const choices = tip.choices;
      if (choices && choices.length) {
        choices.forEach((c) => {
          const b = root.querySelector(`#as-inf [data-inf="${c.id}"]`);
          if (!b) return;
          const span = b.querySelector("span");
          const bold = b.querySelector("b");
          if (bold) bold.textContent = c.label;
          if (span) span.textContent = c.blurb;
          b.disabled = !tipsOpen;
        });
      }
      root.querySelectorAll("#as-inf [data-inf]").forEach((b) => { b.disabled = !tipsOpen; });
    }

    const mEl = root.querySelector("#as-market");
    if (mEl) { mEl.hidden = true; mEl.innerHTML = ""; }

    const ca = buy.address ? `<code>${esc(buy.address)}</code>` : "<span>no contract yet</span>";
    const link = buy.argusUrl
      ? `<a href="${esc(buy.argusUrl)}" target="_blank" rel="noopener">Open on Argus</a>`
      : "";
    const profile = a.id ? `<a href="/agent/${encodeURIComponent(a.id)}">Agent page</a>` : "";
    const econ = buy.economics;
    const split = buy.taxLabel
      ? buy.taxLabel
      : (econ
        ? `Creator ${(econ.creatorFunds || 0) * 100}% → fee router 50/50. Dividends ${(econ.holderDividends || 0) * 100}%. Buyback ${(econ.buybackBurn || 0) * 100}%. LP tax ${(econ.liquidityOngoing || 0) * 100}%.`
        : "");
    const desc = buy.description ? `<p>${esc(buy.description)}</p>` : "";
    root.querySelector("#as-token").innerHTML =
      `<div><b>${esc(buy.symbol ? "$" + buy.symbol : "Token")}</b> · ${esc(buy.status || buy.kind || "—")}</div>` +
      `<div class="agent-sheet-ca">${ca} ${link}${profile ? " · " + profile : ""}</div>` +
      desc +
      (split ? `<p>${esc(split)}</p>` : "");

    const form = root.querySelector("#as-form");
    const cta = root.querySelector("#as-cta");
    if (buy.kind === "house") {
      form.hidden = true;
      root.querySelector("#as-hint").textContent = buy.message || "House agents have no personal token.";
    } else {
      form.hidden = false;
      const mock = !j.live && buy.kind !== "house";
      cta.disabled = false;
      cta.textContent = mock ? "Mock buy" : (buy.address ? "Buy on Argus" : "Open Argus");
      root.querySelector("#as-hint").textContent = buy.message || "Token buy lives in this panel — not on the felt.";
      if (mock && (j.mockPurchases || []).length) {
        const last = j.mockPurchases[j.mockPurchases.length - 1];
        root.querySelector("#as-msg").textContent = `Last mock buy: ${last.usdcIn} USDC → ${last.tokensOut} ${last.symbol}`;
      }
    }
  }

  async function open(id, opts) {
    if (!id) return;
    allowBuy = opts && opts.allowBuy === false ? false : true;
    tableId = (opts && opts.tableId) || null;
    currentId = id;
    ensure();
    root.hidden = false;
    document.body.classList.add("sheet-open");
    renderLoading();
    const closeBtn = root.querySelector("[data-as-close]");
    if (closeBtn) closeBtn.focus();
    try {
      const r = await fetch("/api/agents/" + encodeURIComponent(id) + (tableId ? ("?table=" + encodeURIComponent(tableId)) : ""));
      const j = await r.json();
      if (currentId !== id) return;
      if (!j.ok && !j.agent) throw new Error(j.error || "No such agent.");
      render(j);
    } catch (e) {
      if (currentId !== id) return;
      root.querySelector("#as-name").textContent = "Couldn't load agent";
      root.querySelector("#as-msg").textContent = e.message || "Failed.";
    }
  }

  async function onBuy(e) {
    e.preventDefault();
    if (!currentId || !allowBuy) return;
    const amt = Number(root.querySelector("#as-amt").value);
    const msg = root.querySelector("#as-msg");
    msg.textContent = "Working…";
    try {
      const r = await fetch("/api/agents/" + encodeURIComponent(currentId) + "/buy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: amt, buyer: localStorage.getItem("tipperId") || localStorage.getItem("bettorId") || "spectator" }),
      });
      const j = await r.json();
      if (j.mock && j.ok) {
        msg.textContent = `Mock fill: ${j.purchase.usdcIn} USDC → ${j.purchase.tokensOut} ${j.purchase.symbol} (demo rate, not on chain).`;
        return;
      }
      if (j.delegated && j.buy?.argusUrl) {
        msg.textContent = j.message || "Opening Argus…";
        window.open(j.buy.argusUrl, "_blank", "noopener");
        return;
      }
      msg.textContent = j.error || j.message || "Could not buy.";
    } catch (err) {
      msg.textContent = err.message || "Failed.";
    }
  }

  async function onTip(e) {
    e.preventDefault();
    if (!currentId) return;
    const amt = Number(root.querySelector("#as-tip-amt").value);
    const inf = root.querySelector("#as-inf-val").value;
    const msg = root.querySelector("#as-tip-msg");
    if (!inf) { msg.textContent = "Pick one influence: Aggressive, Calculated, Chaos, or Defensive."; return; }
    msg.textContent = "Working…";
    try {
      const cfg = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
      const live = !!cfg.live;
      const agent = await fetch("/api/agents/" + encodeURIComponent(currentId) + (tableId ? ("?table=" + encodeURIComponent(tableId)) : "")).then((r) => r.json());
      const dest = (agent.tip && (agent.tip.creatorAddress || agent.tip.fundingAddress)) || (agent.holdings && agent.holdings.creatorAddress);
      const from = (window.LDAWallet && LDAWallet.account()) || localStorage.getItem("tipperId") || localStorage.getItem("bettorId") || "spectator";
      if (agent.tip && agent.tip.tipsOpen === false) {
        msg.textContent = "Tips are pre-lock only. After lock, WHO WINS is on the table — LDA is not the exchange.";
        return;
      }
      if (live) {
        if (!window.ethereum) throw new Error("Connect a wallet to tip on Arc.");
        const st = await LDAWallet.connect();
        const account = st.account;
        if (!account) throw new Error("Connect a wallet to tip.");
        if (!dest) throw new Error("This agent has no persona creator wallet to tip.");
        const chain = cfg.chain;
        if (chain && chain.chainIdHex) {
          try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainIdHex }] }); }
          catch (err) {
            if (err.code === 4902 || /Unrecognized|not added/i.test(err.message || "")) {
              await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: chain.chainIdHex, chainName: chain.name, nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: [chain.rpcUrl], blockExplorerUrls: [chain.explorer] }] });
            } else throw err;
          }
        }
        msg.textContent = `Confirm ${amt} USDC in your wallet…`;
        const value = "0x" + (BigInt(Math.round(amt * 1e6)) * 1000000000000n).toString(16);
        const txHash = await window.ethereum.request({ method: "eth_sendTransaction", params: [{ from: account, to: dest, value }] });
        msg.textContent = "Sent. Waiting for Arc to confirm…";
        let j = null;
        for (let i = 0; i < 20; i++) {
          const r = await fetch("/api/agents/" + encodeURIComponent(currentId) + "/tip", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ amount: amt, txHash, address: account, from: account, tableId, influence: inf }),
          });
          j = await r.json();
          if (j.ok || !/not_found_yet/.test(j.error || "")) break;
          await new Promise((res) => setTimeout(res, 700));
        }
        if (j && j.ok) msg.textContent = `Gift recorded: ${j.amount} USDC → persona creator (100%), influence ${j.influence}. Never entitled to winnings.`;
        else msg.textContent = (j && j.error) || "Could not record tip.";
        return;
      }
      const r = await fetch("/api/agents/" + encodeURIComponent(currentId) + "/tip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: amt, from, tableId, influence: inf }),
      });
      const j = await r.json();
      if (j.ok) msg.textContent = `Gift recorded: ${j.amount} USDC → persona creator (100%), ${j.influence}. ${j.mock ? "Demo wallets, not on chain. " : ""}You are never entitled to winnings.`;
      else msg.textContent = j.error || "Could not tip.";
    } catch (err) {
      msg.textContent = err.message || "Failed.";
    }
  }

  function flagsFromEl(el) {
    return { allowBuy: true, tableId: el.getAttribute("data-table") || null };
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-agent-open]");
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    open(el.getAttribute("data-agent-open"), flagsFromEl(el));
  }, true);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root && !root.hidden) { close(); return; }
    if (e.key !== "Enter" && e.key !== " ") return;
    if (!e.target || !e.target.closest) return;
    if (e.target.closest("#agent-sheet, input, textarea, a, .pick, button:not([data-agent-open])")) return;
    const el = e.target.closest("[data-agent-open]");
    if (!el) return;
    e.preventDefault();
    open(el.getAttribute("data-agent-open"), flagsFromEl(el));
  });

  window.LDAAgentPanel = { open, close, img, avaSrc };
})();
