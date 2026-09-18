// Persistent Connect wallet + create-agent conversion.
// Injected EIP-1193 (MetaMask / Rabby / in-app browsers). Mock demo when the
// arena is not on chain. WalletConnect is NOT wired — we do not fake a session.
(function () {
  const KEY = "ldaWallet";
  const MOCK_KEY = "ldaCreatorMock";
  let account = null;
  let mock = false;
  let live = null; // null unknown, true Arc, false demo
  let meta = null;

  const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
  const hasInjected = () => typeof window.ethereum?.request === "function";

  function persist() {
    if (account) localStorage.setItem(KEY, JSON.stringify({ account, mock }));
    else localStorage.removeItem(KEY);
  }

  function emit() {
    document.dispatchEvent(new CustomEvent("lda-wallet", { detail: state() }));
    paintNav();
    paintSlots();
  }

  function state() {
    return {
      account, short: short(account), mock, live: !!live,
      injected: hasInjected(),
      walletConnect: false,
    };
  }

  function toast(msg, kind) {
    let el = document.getElementById("lda-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "lda-toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.className = kind || "";
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 5200);
  }

  function metamaskDappLink() {
    return "https://metamask.app.link/dapp/" + location.host + location.pathname + location.search;
  }

  async function probe() {
    if (meta) return meta;
    try {
      meta = await fetch("/api/agents").then((r) => r.json());
      live = !!meta.live;
    } catch {
      meta = {};
    }
    return meta;
  }

  function restore() {
    try {
      const j = JSON.parse(localStorage.getItem(KEY) || "null");
      if (j && /^0x[0-9a-fA-F]{40}$/.test(j.account)) {
        account = j.account;
        mock = !!j.mock;
      }
    } catch { /* ignore */ }
  }

  async function hydrate() {
    await probe();
    if (hasInjected()) {
      try {
        const accts = await window.ethereum.request({ method: "eth_accounts" });
        if (accts && accts[0]) {
          account = accts[0];
          mock = false;
          persist();
        }
      } catch { /* ignore */ }
    } else if (live && account && !mock) {
      // Stored an injected address but this browser has no wallet — require a fresh connect.
      account = null;
      persist();
    }
    emit();
  }

  async function connect() {
    await probe();
    if (hasInjected()) {
      const accts = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (!accts || !accts[0]) throw new Error("Wallet returned no account.");
      account = accts[0];
      mock = false;
      persist();
      emit();
      return state();
    }
    if (live) {
      const err = new Error("No injected wallet in this browser. Open this site in MetaMask or Rabby (in-app browser), or install one. WalletConnect is not wired yet.");
      err.code = "NO_INJECTED";
      err.metamaskUrl = metamaskDappLink();
      throw err;
    }
    let demo = localStorage.getItem(MOCK_KEY);
    if (!demo) {
      demo = "0x" + [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(MOCK_KEY, demo);
    }
    account = demo;
    mock = true;
    persist();
    emit();
    return state();
  }

  function myAgents() {
    try { return JSON.parse(localStorage.getItem("ldaMyAgents") || "[]"); } catch { return []; }
  }

  function paintNav() {
    const ul = document.querySelector("nav.top ul");
    if (!ul) return;
    let li = ul.querySelector(".nav-wallet");
    if (!li) {
      li = document.createElement("li");
      li.className = "nav-wallet";
      const cta = ul.querySelector("a.cta") && ul.querySelector("a.cta").parentElement;
      ul.insertBefore(li, cta || null);
    }
    if (account) {
      const mine = myAgents();
      const create = mine.length
        ? `<a class="nav-create" href="/agents">My agents</a>`
        : `<a class="nav-create" href="/agents#create">Create agent</a>`;
      li.innerHTML = `<button type="button" class="nav-connect on" id="nav-connect" title="${account}">${short(account)}</button>${create}`;
      li.querySelector("#nav-connect").addEventListener("click", () => { location.href = "/agents#create"; });
    } else {
      li.innerHTML = `<button type="button" class="nav-connect" id="nav-connect">Connect wallet</button>`;
      li.querySelector("#nav-connect").addEventListener("click", onNavConnect);
    }
  }

  async function onNavConnect() {
    try {
      await connect();
    } catch (e) {
      const extra = e.metamaskUrl ? ` Open in MetaMask: ${e.metamaskUrl}` : "";
      toast((e.message || "Could not connect.") + extra, "err");
    }
  }

  function paintSlots() {
    document.querySelectorAll("[data-wallet-cta]").forEach((el) => {
      const mode = el.getAttribute("data-wallet-cta");
      if (account) {
        if (mode === "hero") {
          el.innerHTML = `<a class="btn primary" href="/agents#create">Create an agent</a><a class="btn ghost" href="/tables">Watch tables</a>`;
        } else if (mode === "empty") {
          el.innerHTML = `<a class="chip felt" href="/agents#create">Create an agent</a>`;
        }
      } else {
        if (mode === "hero") {
          el.innerHTML = `<button type="button" class="btn primary" data-lda-connect>Connect wallet</button><a class="btn ghost" href="/tables">Watch live tables</a>`;
        } else if (mode === "empty") {
          el.innerHTML = `<button type="button" class="chip felt" data-lda-connect>Connect wallet</button><a class="chip" href="/agents#create">Create an agent</a>`;
        }
      }
    });
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-lda-connect]");
    if (!b) return;
    e.preventDefault();
    onNavConnect();
  });

  window.LDAWallet = {
    connect, hydrate, probe, toast, short, metamaskDappLink,
    account: () => account,
    isMock: () => mock,
    isLive: () => !!live,
    state, refresh: () => { paintNav(); paintSlots(); },
    on: (fn) => document.addEventListener("lda-wallet", fn),
  };

  restore();
  const boot = () => {
    paintNav();
    paintSlots();
    hydrate();
    if (hasInjected()) {
      window.ethereum.on?.("accountsChanged", (a) => {
        account = (a && a[0]) || null;
        mock = false;
        persist();
        emit();
      });
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
