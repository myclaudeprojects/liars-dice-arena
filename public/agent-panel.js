// Agent mini-panel: click a name to inspect / buy that agent's Argus token.
// Match view keeps running — this is a dismissible overlay, not a navigation.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

  let root = null;
  let currentId = null;

  function ensure() {
    if (root) return root;
    root = document.createElement("div");
    root.id = "agent-sheet";
    root.hidden = true;
    root.innerHTML = `
      <div class="agent-sheet-card" role="dialog" aria-modal="true" aria-labelledby="as-name">
        <div class="agent-sheet-handle" aria-hidden="true"></div>
        <button type="button" class="agent-sheet-x" data-as-close aria-label="Close">Close</button>
        <h2 id="as-name">Agent</h2>
        <p class="agent-sheet-meta" id="as-meta"></p>
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
    return root;
  }

  function close() {
    if (!root) return;
    root.hidden = true;
    currentId = null;
    document.body.classList.remove("sheet-open");
  }

  function renderLoading() {
    ensure();
    root.querySelector("#as-name").textContent = "Loading…";
    root.querySelector("#as-meta").textContent = "";
    root.querySelector("#as-token").innerHTML = "";
    root.querySelector("#as-msg").textContent = "";
    root.querySelector("#as-hint").textContent = "";
    root.querySelector("#as-cta").disabled = true;
  }

  function render(j) {
    const a = j.agent || {};
    const buy = j.buy || a.buy || {};
    root.querySelector("#as-name").textContent = a.name || buy.name || "Agent";
    const owner = a.house ? "house" : (a.owner || "");
    const creator = buy.creator || a.ownerAddress;
    const tables = (j.tables || a.seatedAt || []).map((t) => t.id || t).filter(Boolean);
    root.querySelector("#as-meta").innerHTML =
      `${esc(a.id || "")}${owner ? " · by " + esc(owner) : ""}${a.type ? " · " + esc(a.type) : ""}` +
      (creator ? ` · creator ${esc(creator.slice(0, 6) + "…" + creator.slice(-4))}` : "") +
      (tables.length ? ` · at ${tables.map((id) => `<a href="/arena?table=${esc(id)}">${esc(id)}</a>`).join(", ")}` : "");

    const ca = buy.address ? `<code>${esc(buy.address)}</code>` : "<span>no contract yet</span>";
    const link = buy.argusUrl
      ? `<a href="${esc(buy.argusUrl)}" target="_blank" rel="noopener">Open on Argus</a>`
      : "";
    const econ = buy.economics;
    const split = econ
      ? `Tax after protocol cut: creator ${(econ.creatorFunds || 0) * 100}% · holders ${(econ.holderDividends || 0) * 100}% · seat ${(econ.arenaSeatBankroll || 0) * 100}% · burn ${(econ.buybackBurn || 0) * 100}% · LP tax ${(econ.liquidityOngoing || 0) * 100}%`
      : "";
    const watch = buy.website || (a.id ? "/agent/" + encodeURIComponent(a.id) : "");
    const lda = watch ? `<a href="${esc(watch)}">Watch &amp; bet</a>` : "";
    const desc = buy.description ? `<p>${esc(buy.description)}</p>` : "";
    root.querySelector("#as-token").innerHTML =
      `<div><b>${esc(buy.symbol ? "$" + buy.symbol : "Token")}</b> · ${esc(buy.status || buy.kind || "—")}</div>` +
      `<div class="agent-sheet-ca">${ca} ${link}${lda ? " · " + lda : ""}</div>` +
      desc +
      (split ? `<p>${esc(split)}</p>` : "");

    const mock = !j.live && buy.kind !== "house";
    const cta = root.querySelector("#as-cta");
    cta.disabled = buy.kind === "house";
    cta.textContent = mock ? "Mock buy" : (buy.address ? "Buy on Argus" : "Open Argus");
    root.querySelector("#as-hint").textContent = buy.message || "";
    if (mock && (j.mockPurchases || []).length) {
      const last = j.mockPurchases[j.mockPurchases.length - 1];
      root.querySelector("#as-msg").textContent = `Last mock buy: ${last.usdcIn} USDC → ${last.tokensOut} ${last.symbol}`;
    }
  }

  async function open(id) {
    if (!id) return;
    currentId = id;
    ensure();
    root.hidden = false;
    document.body.classList.add("sheet-open");
    renderLoading();
    const closeBtn = root.querySelector("[data-as-close]");
    if (closeBtn) closeBtn.focus();
    try {
      const r = await fetch("/api/agents/" + encodeURIComponent(id));
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
    if (!currentId) return;
    const amt = Number(root.querySelector("#as-amt").value);
    const msg = root.querySelector("#as-msg");
    msg.textContent = "Working…";
    try {
      const r = await fetch("/api/agents/" + encodeURIComponent(currentId) + "/buy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: amt, buyer: localStorage.getItem("bettorId") || "spectator" }),
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

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-agent-open]");
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    open(el.getAttribute("data-agent-open"));
  }, true);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root && !root.hidden) { close(); return; }
    if (e.key !== "Enter" && e.key !== " ") return;
    if (!e.target || !e.target.closest) return;
    if (e.target.closest("#agent-sheet, input, textarea, a, .pick, button:not([data-agent-open])")) return;
    const el = e.target.closest("[data-agent-open]");
    if (!el) return;
    e.preventDefault();
    open(el.getAttribute("data-agent-open"));
  });

  window.LDAAgentPanel = { open, close };
})();
