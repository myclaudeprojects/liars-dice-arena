const FACE = { 1: "ones", 2: "twos", 3: "threes", 4: "fours", 5: "fives", 6: "sixes" };
const PIPS = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 28], [72, 28], [28, 50], [72, 50], [28, 72], [72, 72]],
};
const view = document.querySelector("#view");
const creditsEl = document.querySelector("#credits");
let tab = "arena";
let snap = null;
let me = null;
let position = null;
let focusAgent = null;
let focusMatch = null;
let agents = [];
let history = [];
let leaders = [];
let err = "";
let flash = null;
let pollGen = 0;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function predictorId() {
  let v = localStorage.getItem("ldaPredictor") || "";
  if (!/^[a-z0-9]{8,40}$/.test(v)) {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    v = "p";
    for (let i = 0; i < 10; i++) v += alphabet[Math.floor(Math.random() * alphabet.length)];
    localStorage.setItem("ldaPredictor", v);
  }
  return v;
}
async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || "Something went wrong.");
  return j;
}
function faceWord(face) { return FACE[face] || "dice"; }
function mark(name, hue) {
  const letter = esc((name || "?").replace(/^The /, "")[0] || "?");
  return `<div class="mark" style="box-shadow:inset 0 0 0 2px hsl(${hue || 40} 42% 58%)">${letter}</div>`;
}
function die(n) {
  const pips = (PIPS[n] || []).map(([x, y]) => `<i class="pip" style="left:calc(${x}% - 2.5px);top:calc(${y}% - 2.5px)"></i>`).join("");
  return `<span class="die">${pips}</span>`;
}
function backs(count) {
  return Array.from({ length: Math.max(0, count) }, () => `<span class="die back"></span>`).join("");
}
function money(n) {
  const v = Math.round(Number(n) || 0);
  return (v > 0 ? "+" : "") + v;
}

function setTab(next) {
  tab = next;
  focusAgent = null;
  focusMatch = null;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  render();
}
document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) setTab(b.dataset.tab);
});

function live() { return snap && snap.live; }

function bankroll() {
  if (snap && snap.you && snap.you.credits != null) return snap.you.credits;
  return me ? me.credits : 0;
}

function renderCredits() {
  creditsEl.textContent = me ? `${Math.round(me.credits)} test` : "—";
}

function spark(values) {
  if (!values || values.length < 2) return "";
  const w = 168;
  const h = 36;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - 2 - ((v - min) / span) * (h - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" /></svg>`;
}

function arena() {
  const m = live();
  if (!m) return `<p class="fine">The arena is warming up.</p>`;
  const [a, b] = m.seats;
  const open = m.phase === "pick";
  const hot = snap.hot;
  const rival = (snap.rivalries || [])[0];
  const fresh = (snap.fresh || [])[0];
  const reads = snap.yourReads || [];
  const watching = Number(snap.watching) || 0;
  const eye = watching > 0 ? ` · ${watching} watching` : "";
  return `
    <div class="kicker"><span class="dot"></span> ${open ? "Live now" : m.phase === "settled" ? "Final" : "Live now"}${eye}</div>
    <article class="live-card">
      <div class="vs">
        <div class="who">${mark(a.name, a.hue)}<b>${esc(a.name)}</b><span>${esc(a.record)}</span></div>
        <div class="x">VS</div>
        <div class="who">${mark(b.name, b.hue)}<b>${esc(b.name)}</b><span>${esc(b.record)}</span></div>
      </div>
      <div class="status">${m.phase === "live" ? `Round ${m.round || 1}` : m.phase === "settled" ? esc(m.story && m.story.title || "Settled") : "Picks are open"}</div>
      <button class="cta" type="button" data-go="watch">${open ? "Watch & pick" : m.phase === "settled" ? "See the result" : "Watch"}</button>
    </article>
    ${upcomingBlock()}
    ${hot ? `<section class="section"><h2>Hot</h2><div class="rowbtn"><b>${esc(hot.text)}</b><div class="fine">Can anyone stop ${esc(hot.name)}?</div></div></section>` : ""}
    ${rival ? `<section class="section"><h2>Rivalries</h2><button class="rowbtn" type="button" data-agent="${esc(rival.a.id)}"><b>${esc(rival.text)}</b><div class="fine">Series ${esc(rival.series)} · ${rival.meetings} meetings</div></button></section>` : ""}
    ${fresh ? `<section class="section"><h2>New</h2><button class="rowbtn" type="button" data-agent="${esc(fresh.id)}"><b>Meet ${esc(fresh.name)}</b><div class="fine">${esc(fresh.archetype)}. First match is this one.</div></button></section>` : ""}
    ${reads.length ? `<section class="section"><h2>Your reads</h2>${reads.map((r) => `<button class="rowbtn" type="button" data-agent="${esc(r.id)}"><b>${esc(r.name)}</b><div class="fine">${r.correct} / ${r.picks} picks right</div></button>`).join("")}</section>` : ""}
    <p class="fine" style="margin-top:18px">Test credits have no cash value. No wallet. The agents play. You pick.</p>`;
}

function pct(price, id) {
  const n = price && price[id];
  if (n == null) return "";
  return `${Math.round(n * 100)}`;
}

function upcomingBlock() {
  const rows = (snap && snap.upcoming) || [];
  if (!rows.length) return "";
  const cards = rows.map((u, i) => {
    const [a, b] = u.seats;
    const you = u.you;
    const picked = you ? `You picked ${esc(seatNameFrom(u, you.agentId))}.` : "Pick ahead.";
    const buttons = you ? "" : `
      <div class="ahead">
        <button type="button" data-ahead="${esc(u.matchId)}" data-ahead-agent="${esc(a.id)}">${esc(a.name)} · ${pct(u.price, a.id)}</button>
        <button type="button" data-ahead="${esc(u.matchId)}" data-ahead-agent="${esc(b.id)}">${esc(b.name)} · ${pct(u.price, b.id)}</button>
      </div>`;
    return `
      <article class="upcard">
        <div class="fine">${i === 0 ? "Next" : "Later"}</div>
        <div class="vs">
          <div class="who">${mark(a.name, a.hue)}<b>${esc(a.name)}</b><span>${esc(a.record)}</span></div>
          <div class="x">VS</div>
          <div class="who">${mark(b.name, b.hue)}<b>${esc(b.name)}</b><span>${esc(b.record)}</span></div>
        </div>
        <p class="fine">${picked}</p>
        ${buttons}
      </article>`;
  }).join("");
  return `<section class="section"><h2>Coming up</h2><div class="slate">${cards}</div></section>`;
}

function seatNameFrom(card, id) {
  const s = card && card.seats && card.seats.find((x) => x.id === id);
  return s ? s.name : id;
}

function picker() {
  const m = live();
  const [a, b] = m.seats;
  return `
    <div class="picker">
      <div class="kicker">One tap</div>
      <h1>Who's got this?</h1>
      <button class="giant" type="button" data-pick="${esc(a.id)}">${mark(a.name, a.hue)}<span><b>${esc(a.name)}</b><span>${esc(a.record)} · ${esc(a.archetype)}</span></span></button>
      <button class="giant" type="button" data-pick="${esc(b.id)}">${mark(b.name, b.hue)}<span><b>${esc(b.name)}</b><span>${esc(b.record)} · ${esc(b.archetype)}</span></span></button>
      <p class="fine">50 test credits. No cash value. You can be wrong. That's the point.</p>
      <div class="err">${esc(err)}</div>
    </div>`;
}

function watchTable() {
  const m = live();
  const [a, b] = m.seats;
  const reveal = m.reveal;
  const diceFor = (seat) => {
    if (reveal) {
      const hand = reveal.find((r) => r.id === seat.id);
      if (hand) return hand.dice.map(die).join("");
    }
    return backs(seat.alive ? seat.dice : 0);
  };
  const n = m.narrative || {};
  const head = n.headline ? `<div class="headline ${n.pace === "critical" ? "critical" : ""}">${esc(n.headline)}</div>` : "";
  const pos = position;
  const delta = pos && Math.abs(pos.unrealized) >= 0.5
    ? ` <span class="${pos.unrealized >= 0 ? "good" : "bad"}">${money(pos.unrealized)}</span>`
    : "";
  const you = pos
    ? `<div class="you">You picked <b>${esc(seatName(pos.agentId))}</b> · worth <b>${Math.round(pos.value)}</b> test credits${delta}</div>`
    : `<div class="you">Watching. Picks are closed for this one.</div>`;
  return `
    <div class="table">
      <div class="vs">
        <div class="who">${mark(a.name, a.hue)}<b>${esc(a.name)}</b><span>${a.dice} dice</span><div class="dice-row">${diceFor(a)}</div></div>
        <div class="x">${m.phase === "settled" ? "FINAL" : "R" + (m.round || 1)}</div>
        <div class="who">${mark(b.name, b.hue)}<b>${esc(b.name)}</b><span>${b.dice} dice</span><div class="dice-row">${diceFor(b)}</div></div>
      </div>
      ${head}
      <div class="line">${esc(n.line || "")}</div>
      ${n.aside ? `<div class="aside">${esc(n.aside)}</div>` : ""}
      ${m.bid && m.phase === "live" && !n.headline ? `<div class="fine">${esc(m.bid.name || "")} · ${m.bid.count} ${esc(faceWord(m.bid.face))}</div>` : ""}
      ${you}
      ${spark(pos && pos.trail)}
    </div>`;
}

function payoff() {
  const m = live();
  const story = m.story || {};
  const pos = position;
  const picked = pos ? seatName(pos.agentId) : null;
  const won = pos && pos.won;
  const lesson = story.lesson || "";
  return `
    <div class="payoff">
      <div class="headline">${esc(story.title || m.narrative?.line || "Settled")}</div>
      <p>${esc(story.dek || "")}</p>
      ${pos ? `<p>${won ? `<b class="good">You called it.</b>` : `<b>You missed this one.</b>`} Your pick: <b>${esc(picked)}</b>.</p>` : `<p class="fine">You watched this one without a pick.</p>`}
      ${lesson ? `<p class="fine">${esc(lesson)}</p>` : ""}
      ${pos ? `<p>Test credits ${money(pos.pnl)} · balance ${Math.round(bankroll())}</p>` : ""}
      ${m.share ? `<div class="share">${esc(m.share.text)}</div><button class="ghost" type="button" data-share>Share the call</button>` : ""}
    </div>`;
}

function seatName(id) {
  const m = live();
  const s = m && m.seats.find((x) => x.id === id);
  return s ? s.name : id;
}

function watch() {
  const m = live();
  if (!m) return `<p class="fine">No match yet.</p>`;
  if (flash) return `<div class="flash"><div class="kicker">Locked in</div><h1>You picked ${esc(flash)}</h1><p class="fine">Dice are coming.</p></div>`;
  if (m.phase === "settled") return payoff();
  if (m.phase === "pick" && !position) return picker();
  return watchTable();
}

function agentsView() {
  if (focusAgent) return agentDetail(focusAgent);
  return `<h1 class="page">Agents</h1><p class="fine">Characters, not algorithms with a hat on. Records are from matches they actually played.</p>` +
    agents.map((a) => `<button class="agent-row" type="button" data-agent="${esc(a.id)}">${mark(a.name, a.hue)}<b>${esc(a.name)}</b><div class="fine">${esc(a.archetype)} · ${esc(a.record)}${a.streak ? ` · streak ${a.streak}` : ""}${a.knownFor ? ` · known for ${esc(a.knownFor)}` : ""}</div></button>`).join("");
}

function agentDetail(a) {
  const mine = (me && me.theories && me.theories[a.id]) || [];
  const tags = ["Aggressive", "Conservative", "Bluffer", "Risk-taker", "Pressure player", "Unpredictable"];
  const rivals = (a.rivals || []).map((r) => `<div class="rowbtn"><b>${esc(r.name)}</b><div class="fine">${esc(r.series)} in ${r.meetings}</div></div>`).join("");
  const moments = (a.moments || []).map((m) => `<div class="rowbtn"><b>${esc(m.title)}</b><div class="fine">${esc(m.dek || "")}</div></div>`).join("");
  return `
    <button class="ghost" type="button" data-back="agents">All agents</button>
    <h1 class="page">${esc(a.name)}</h1>
    <p class="fine">${esc(a.archetype)}</p>
    <div class="statgrid">
      <div><b>${esc(a.record)}</b><span>Record</span></div>
      <div><b>${a.streak || 0}</b><span>Streak</span></div>
      <div><b>${a.winRate || 0}%</b><span>Win rate</span></div>
      <div><b>${a.played || 0}</b><span>Played</span></div>
    </div>
    <section class="section"><h2>Style</h2><p>${esc(a.line)}</p><p class="fine">Strength: ${esc(a.strength)} Weakness: ${esc(a.weakness)}</p>${a.knownFor ? `<p class="fine">From the matches: ${esc(a.knownFor)}.</p>` : ""}</section>
    <section class="section"><h2>Recent form</h2><div class="form">${(a.form || []).map((x) => `<i class="${x === "W" ? "w" : "l"}">${esc(x)}</i>`).join("") || "—"}</div></section>
    ${rivals ? `<section class="section"><h2>Rivals</h2>${rivals}</section>` : ""}
    ${moments ? `<section class="section"><h2>Recent moments</h2>${moments}</section>` : ""}
    <section class="section"><h2>My read</h2><p class="fine">Your notes. Not an official label.</p><div class="tags">${tags.map((t) => `<button type="button" data-tag="${esc(t)}" class="${mine.includes(t) ? "on" : ""}">${esc(t)}</button>`).join("")}</div></section>`;
}

function historyView() {
  if (focusMatch) return matchReplay(focusMatch);
  if (!history.length) return `<h1 class="page">History</h1><p class="fine">Stories show up after matches finish.</p>`;
  return `<h1 class="page">History</h1>` + history.map((h) => `
    <button class="rowbtn" type="button" data-match="${esc(h.matchId)}">
      <b>${esc(h.title || h.winnerName)}</b>
      <div class="fine">${esc((h.seats || []).map((s) => s.name).join(" vs "))} · ${esc(h.dek || "")}</div>
    </button>`).join("");
}

function matchReplay(m) {
  const events = m.events || [];
  const beats = events.filter((e) => e.type === "bid" || e.type === "challenge" || e.type === "match_over").map((e) => {
    if (e.type === "bid") return `<li>${esc(e.name)} bids ${e.count} ${esc(faceWord(e.face))}.</li>`;
    if (e.type === "challenge") return `<li><b>${esc(e.bidWasTrue ? "Telling the truth." : "Bluffing.")}</b> Call on ${e.bid.count} ${esc(faceWord(e.bid.face))}.</li>`;
    return `<li><b>${esc(e.name)} wins.</b></li>`;
  }).join("");
  return `
    <button class="ghost" type="button" data-back="history">All stories</button>
    <h1 class="page">${esc(m.story && m.story.title || "Match")}</h1>
    <p>${esc(m.story && m.story.dek || "")}</p>
    ${m.share ? `<div class="share">${esc(m.share.text)}</div>` : ""}
    <ol class="log">${beats}</ol>`;
}

function profile() {
  if (!me) return `<p class="fine">Setting up your test-credit book…</p>`;
  return `
    <h1 class="page">Your record</h1>
    <div class="statgrid">
      <div><b>${me.accuracy || 0}%</b><span>Correct</span></div>
      <div><b>${me.picks || 0}</b><span>Picks</span></div>
      <div><b>${money(me.pnl || 0)}</b><span>Test PnL</span></div>
      <div><b>${me.streak || 0}</b><span>Streak</span></div>
    </div>
    <p class="fine" style="margin-top:12px">${Math.round(me.credits)} test credits. They are not dollars, tokens, or a claim on anything.</p>
    ${me.bestRead ? `<section class="section"><h2>Best read</h2><div class="rowbtn"><b>${esc((agents.find((a) => a.id === me.bestRead.agentId) || {}).name || me.bestRead.agentId)}</b><div class="fine">${me.bestRead.accuracy}% over ${me.bestRead.picks} picks</div></div></section>` : ""}
    <section class="section"><h2>Leaderboard</h2>
      ${(leaders.length ? leaders : [{ id: "you", accuracy: me.accuracy, pnl: me.pnl, picks: me.picks }]).slice(0, 8).map((p, i) => `<div class="rowbtn"><b>${i + 1}. ${esc(p.id === me.id ? "You" : p.id)}</b><div class="fine">${p.accuracy || 0}% · ${money(p.pnl || 0)} test</div></div>`).join("")}
    </section>`;
}

function render() {
  renderCredits();
  const body = tab === "arena" ? arena()
    : tab === "watch" ? watch()
    : tab === "agents" ? agentsView()
    : tab === "history" ? historyView()
    : profile();
  view.innerHTML = body + (tab !== "watch" && err ? `<div class="err">${esc(err)}</div>` : "");
}

view.addEventListener("click", async (e) => {
  const go = e.target.closest("[data-go]");
  if (go) { setTab(go.dataset.go); return; }
  const back = e.target.closest("[data-back]");
  if (back) { focusAgent = null; focusMatch = null; setTab(back.dataset.back); return; }
  const agentBtn = e.target.closest("[data-agent]");
  if (agentBtn && !e.target.closest("[data-pick]")) {
    try {
      const j = await api("/api/show/agents/" + encodeURIComponent(agentBtn.dataset.agent));
      focusAgent = j.agent;
      tab = "agents";
      document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === "agents"));
      render();
    } catch (ex) { err = ex.message; render(); }
    return;
  }
  const matchBtn = e.target.closest("[data-match]");
  if (matchBtn) {
    try {
      const j = await api("/api/show/matches/" + encodeURIComponent(matchBtn.dataset.match) + "/replay");
      focusMatch = j;
      render();
    } catch (ex) { err = ex.message; render(); }
    return;
  }
  const ahead = e.target.closest("[data-ahead]");
  if (ahead) return doAhead(ahead.dataset.ahead, ahead.dataset.aheadAgent);
  const pick = e.target.closest("[data-pick]");
  if (pick) return doPick(pick.dataset.pick);
  const tag = e.target.closest("[data-tag]");
  if (tag && focusAgent) return toggleTag(tag.dataset.tag);
  const share = e.target.closest("[data-share]");
  if (share) return doShare();
});

async function doAhead(matchId, agentId) {
  err = "";
  if (!matchId || !agentId || !me) return;
  try {
    await api("/api/show/markets/" + encodeURIComponent(matchId) + "/buy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ predictorId: me.id, agentId, side: "yes", stake: snap.defaultStake || 50 }),
    });
    await poll();
  } catch (ex) {
    err = ex.message;
    render();
  }
}

async function doPick(agentId) {
  err = "";
  const m = live();
  if (!m) return;
  pollGen++;
  try {
    const j = await api("/api/show/markets/" + encodeURIComponent(m.matchId) + "/buy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ predictorId: me.id, agentId, side: "yes", stake: snap.defaultStake || 50 }),
    });
    position = j.position;
    me = { ...me, credits: j.credits };
    const seat = m.seats.find((s) => s.id === agentId);
    flash = seat ? seat.name : agentId;
    render();
    setTimeout(() => { flash = null; if (tab === "watch") render(); }, 1800);
    poll();
  } catch (ex) {
    err = ex.message;
    render();
  }
}

async function toggleTag(tag) {
  const mine = new Set((me.theories && me.theories[focusAgent.id]) || []);
  if (mine.has(tag)) mine.delete(tag); else mine.add(tag);
  try {
    const j = await api("/api/show/predictors/" + me.id + "/theory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: focusAgent.id, tags: [...mine] }),
    });
    me = j.predictor;
    render();
  } catch (ex) { err = ex.message; render(); }
}

async function doShare() {
  const text = live() && live().share && live().share.text;
  if (!text) return;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); err = ""; flash = null; }
  } catch { /* dismissed */ }
}

async function refreshLists() {
  try {
    const [a, h, l] = await Promise.all([
      api("/api/show/agents"),
      api("/api/show/history"),
      api("/api/show/leaderboard"),
    ]);
    agents = a.agents || [];
    history = h.matches || [];
    leaders = l.leaders || [];
  } catch { /* next poll */ }
}

async function poll() {
  const gen = ++pollGen;
  try {
    const j = await api("/api/show?predictor=" + encodeURIComponent(me.id));
    if (gen !== pollGen || j.starting) return;
    snap = j;
    if (j.you) me = j.you;
    // A missing position means this match has no pick. Keeping the previous
    // match's position would show the wrong name once the next one is live.
    if (j.live && j.live.market && j.live.market.you) position = j.live.market.you;
    else position = null;
    if (tab === "agents" || tab === "history" || tab === "profile") await refreshLists();
    if (gen !== pollGen) return;
    if (!focusAgent && !focusMatch) render();
    else renderCredits();
  } catch { /* keep last frame */ }
}

async function boot() {
  render();
  const opened = await api("/api/show/predictors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: predictorId() }),
  });
  me = opened.predictor;
  renderCredits();
  await poll();
  setInterval(poll, 2000);
  try {
    const es = new EventSource("/api/show/events");
    es.onmessage = () => { poll(); };
  } catch { /* poll is enough */ }
}
boot().catch((e) => { err = e.message; render(); });
