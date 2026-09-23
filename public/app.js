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
let shareNote = "";
let pollGen = 0;
let heardLive = null;
let audioCtx = null;
let motionState = { sig: "", until: 0, beats: [] };
let motionTimer = 0;
let frameBeats = [];
let stageFrame = null;
let stageState = "LOADING";
let director = null;
let directorKey = "";
let directorMatch = "";
let directorSig = "";
let directorRaf = 0;
let feedMatch = "";
let feedLines = [];
let enterView = true;
let seenSnap = false;
let painted = "";
let tallySeen = "";
let replay = null;

const SOUND_KEY = "ldaSound";
let soundMem = null;
let showState = { snap: null, link: "boot", holdUntil: 0 };
let listsReady = false;
let listsError = "";
let tradeSheet = null;

function presence() {
  return window.ldaPresence || {
    foldShow: (state, incoming) => ({
      snap: incoming && !incoming.failed && !incoming.starting ? incoming.snap : (state && state.snap) || null,
      link: "up",
      holdUntil: 0,
      apply: !!(incoming && !incoming.failed && !incoming.starting),
    }),
    statusCopy: () => "",
    soundOn: (stored) => stored === "1",
    replayIndex: (n, reduced) => (reduced && n ? n - 1 : 0),
    replayPlays: (reduced) => !reduced,
  };
}

function soundEnabled() {
  if (soundMem != null) return soundMem;
  let stored = null;
  try { stored = localStorage.getItem(SOUND_KEY); } catch { stored = null; }
  return presence().soundOn(stored);
}

function setSound(on) {
  soundMem = !!on;
  try { localStorage.setItem(SOUND_KEY, on ? "1" : "0"); } catch { /* the button still toggles */ }
  paintSound();
}

function paintSound() {
  const btn = document.querySelector("#sound");
  if (!btn) return;
  const on = soundEnabled();
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.textContent = on ? "Mute" : "Unmute";
  btn.setAttribute("aria-label", on ? "Mute sound" : "Unmute sound");
}

function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  return audioCtx;
}

function unlockAudio() {
  const ctx = audio();
  if (ctx && ctx.state === "suspended") ctx.resume();
  return ctx;
}

function blip(ctx, t, freq, dur, gain, type, slide) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type || "sine";
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t + dur);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

const CUES = {
  "pick-open": (ctx, t) => {
    blip(ctx, t, 440, 0.09, 0.04);
    blip(ctx, t + 0.1, 660, 0.12, 0.035);
  },
  "pick-locked": (ctx, t) => blip(ctx, t, 330, 0.14, 0.045, "triangle", 220),
  bid: (ctx, t) => blip(ctx, t, 540, 0.05, 0.028, "square"),
  call: (ctx, t) => {
    blip(ctx, t, 150, 0.16, 0.05, "sawtooth", 90);
    blip(ctx, t + 0.04, 460, 0.07, 0.028, "square");
  },
  reveal: (ctx, t) => {
    blip(ctx, t, 392, 0.08, 0.038);
    blip(ctx, t + 0.09, 523, 0.11, 0.036);
  },
  "settle-win": (ctx, t) => {
    blip(ctx, t, 523, 0.1, 0.04);
    blip(ctx, t + 0.11, 659, 0.1, 0.038);
    blip(ctx, t + 0.22, 784, 0.16, 0.042);
  },
  "settle-miss": (ctx, t) => blip(ctx, t, 294, 0.16, 0.04, "triangle", 180),
};

function playCues(names) {
  if (!soundEnabled() || !names || !names.length) return;
  const ctx = audio();
  if (!ctx || ctx.state !== "running") return;
  names.forEach((name, i) => {
    const fn = CUES[name];
    if (fn) fn(ctx, ctx.currentTime + i * 0.14);
  });
}

function hear(live) {
  if (!live) return;
  if (heardLive && window.ldaSoundCues) playCues(window.ldaSoundCues.soundCues(heardLive, live));
  heardLive = live;
}

function motionApi() {
  return window.ldaMotion || {
    motionBeats: () => [],
    countShown: () => 0,
    frameKey: () => "",
    replayFrames: () => [],
  };
}

function presentApi() {
  return window.ldaPresentation || null;
}

function noteFeed(m) {
  if (!m || !m.matchId) return;
  if (m.matchId !== feedMatch) {
    feedMatch = m.matchId;
    feedLines = [];
  }
  const line = (m.narrative && m.narrative.line) || "";
  if (!line || feedLines[0] === line) return;
  feedLines = [line, ...feedLines].slice(0, 4);
}

function directorSignature(frame) {
  if (!frame) return "";
  return [
    frame.label,
    frame.done ? 1 : 0,
    frame.showLiar ? 1 : 0,
    frame.showCount ? 1 : 0,
    frame.showVerdict ? 1 : 0,
    frame.showResult ? 1 : 0,
    frame.tumble ? 1 : 0,
    frame.showThink ? 1 : 0,
    frame.camera || "",
  ].join(":");
}

function startDirectorLoop() {
  if (directorRaf) cancelAnimationFrame(directorRaf);
  if (!director) return;
  const gen = director.generation;
  const step = () => {
    if (!director || director.generation !== gen) return;
    const frame = director.frame();
    if (!frame) return;
    const sig = directorSignature(frame);
    if (sig !== directorSig) {
      directorSig = sig;
      if (tab === "watch") render();
    }
    if (!frame.done) directorRaf = requestAnimationFrame(step);
  };
  directorRaf = requestAnimationFrame(step);
}

function syncDirector(m, beats) {
  const api = presentApi();
  if (!api || !m) return null;
  if (!director) director = new api.AnimationDirector({ now: () => performance.now(), reduced: reducedMotion() });
  director.reduced = reducedMotion();
  if ((m.matchId || "") !== directorMatch) {
    directorMatch = m.matchId || "";
    stageState = "LOADING";
  }
  const pres = api.presentationOf(m);
  const cmd = api.commandFor(m, pres);
  const key = (m.matchId || "") + ":" + api.commandKey(cmd);
  const move = api.transition(stageState, pres.state, { fastForward: true });
  const animate = !reducedMotion() && !!(beats && beats.length) && move.ok;
  if (key !== directorKey) {
    directorKey = key;
    director.play(cmd);
    if (!animate || move.skipped) director.fastForward();
    directorSig = directorSignature(director.frame());
    startDirectorLoop();
  }
  stageState = pres.state;
  return director.frame();
}

function reducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function beatHold(beats) {
  if (beats.some((b) => b.type === "reveal")) return 1700;
  if (beats.some((b) => b.type === "settle")) return 1500;
  if (beats.some((b) => b.type === "lose-die")) return 980;
  if (beats.some((b) => b.type === "call")) return 880;
  if (beats.some((b) => b.type === "start") || beats.some((b) => b.type === "roll")) return 820;
  if (beats.some((b) => b.type === "bid")) return 720;
  return 640;
}

function applyMotion(prev, live) {
  const beats = motionApi().motionBeats(prev, live);
  if (!beats.length) return;
  clearTimeout(motionTimer);
  if (reducedMotion()) {
    motionState = { sig: "", until: 0, beats: [] };
    return;
  }
  const ms = beatHold(beats);
  motionState = { sig: motionApi().frameKey(live), until: performance.now() + ms, beats };
  motionTimer = setTimeout(() => {
    if (focusMatch || focusAgent) return;
    render();
  }, ms + 40);
}

function activeMotion(m) {
  if (!m || !motionState.beats.length) return [];
  if (performance.now() > motionState.until) return [];
  if (motionState.sig !== motionApi().frameKey(m)) return [];
  return motionState.beats;
}

function clearReplay() {
  if (replay && replay.timer) clearTimeout(replay.timer);
  replay = null;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function ui() {
  return window.ldaUi || null;
}
function paintTabs() {
  document.querySelectorAll(".tabs button").forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("on", on);
    if (on) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
}
function pnlTone(n) {
  const v = Number(n) || 0;
  if (v > 0) return "win";
  if (v < 0) return "loss";
  return "";
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
function mark(name, hue, id) {
  if (ui()) return ui().avatar(name, hue, id);
  const letter = esc((name || "?").replace(/^The /, "")[0] || "?");
  const tone = hue == null ? 40 : hue;
  return `<div class="mark lda-avatar" style="--agent-accent:hsl(${tone} 42% 58%)">${letter}</div>`;
}
function die(n, extra) {
  const pips = (PIPS[n] || []).map(([x, y]) => `<i class="pip" style="left:calc(${x}% - 2px);top:calc(${y}% - 2px)"></i>`).join("");
  const cls = ["die", extra && extra.cls].filter(Boolean).join(" ");
  const style = extra && extra.style ? ` style="${extra.style}"` : "";
  return `<span class="${cls}"${style}>${pips}</span>`;
}
function money(n) {
  const v = Math.round(Number(n) || 0);
  return (v > 0 ? "+" : "") + v;
}

function replayIdFromLocation() {
  const q = new URLSearchParams(location.search).get("match");
  if (q) return q;
  const m = /^#replay=(.*)$/.exec(location.hash || "");
  if (!m || !m[1]) return "";
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

function clearReplayHash() {
  const hasQuery = new URLSearchParams(location.search).has("match");
  const hasHash = /^#replay=/.test(location.hash || "");
  if (!hasQuery && !hasHash) return;
  window.history.replaceState(null, "", location.pathname);
}

function setTab(next) {
  tab = next;
  focusAgent = null;
  focusMatch = null;
  shareNote = "";
  clearReplay();
  clearReplayHash();
  enterView = true;
  painted = "";
  paintTabs();
  render();
  if (next === "agents" || next === "history" || next === "profile") {
    refreshLists().then(() => {
      if (tab !== next || focusAgent || focusMatch) return;
      render();
    });
  }
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
  creditsEl.textContent = me ? `AC ${Math.round(me.credits).toLocaleString("en-US")}` : "—";
}

function spark(values, tone) {
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
  const toneClass = tone === "good" || tone === "bad" ? " " + tone : "";
  return `<svg class="spark${toneClass}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" /></svg>`;
}

function careerBlock(person, opts = {}) {
  if (window.ldaCareer) return window.ldaCareer.careerMarkup(person, opts);
  const series = (person && person.series) || [];
  if (!series.length) return opts.quiet ? "" : `<p class="fine">No settled picks yet. Your line starts at zero after the first one.</p>`;
  const last = series[series.length - 1];
  const tone = Number(last.cum) >= 0 ? "good" : "bad";
  const origin = Math.abs(Number(series[0].cum) - Number(series[0].pnl)) < 0.0001;
  const values = origin ? [0, ...series.map((s) => Number(s.cum) || 0)] : series.map((s) => Number(s.cum) || 0);
  return `<div class="career" data-points="${series.length}">${spark(values, tone)}<p class="fine">${series.length} settled · ${money(last.cum)} test</p></div>`;
}

function emptyState(kicker, title, body) {
  return `<section class="empty lda-empty" data-state="empty"><div class="kicker">${esc(kicker)}</div><h1 class="page">${esc(title)}</h1><p>${esc(body)}</p></section>`;
}

function linkBanner() {
  if (tab !== "arena" && tab !== "watch") return "";
  if (!live()) return "";
  const text = presence().statusCopy(showState.link);
  if (!text) return "";
  return `<p class="link lda-badge lda-badge-stale" role="status">${esc(text)}</p>`;
}

function noPicksYet() {
  return !!(me && !(Number(me.picks) > 0));
}

function arenaIdle() {
  const waiting = showState.link === "boot";
  const dropped = showState.link === "down";
  const fresh = noPicksYet();
  if (waiting) {
    return emptyState("Connecting", "The show is coming up", "Picks open when the table answers. Test credits only. Nothing here is cash.");
  }
  if (dropped) {
    return emptyState("Reconnecting", "The arena will be right back", "Still reaching the show. When a match was already up, that frame stays on Watch.");
  }
    const body = fresh
    ? "The next pairing opens in a moment. You haven't taken a test position yet. Confirm a trade on Watch. Arena Credits only."
    : "The next pairing opens in a moment. You can wait here or look through Agents.";
  return emptyState("Between matches", "Nothing is live right now", body) + upcomingBlock();
}

function arena() {
  const m = live();
  if (!m) return arenaIdle();
  const [a, b] = m.seats;
  const open = m.phase === "pick";
  const hot = snap.hot;
  const rival = (snap.rivalries || [])[0];
  const fresh = (snap.fresh || [])[0];
  const reads = snap.yourReads || [];
  const watching = Number(snap.watching) || 0;
  const eye = watching > 0 ? ` · ${watching} watching` : "";
  const intro = frameBeats.some((b) => b.type === "intro" || b.type === "start") ? " intro" : "";
  const final = m.phase === "settled";
  const liveLabel = (final ? "Final" : "Live now") + eye;
  const badge = ui() ? ui().liveBadge(liveLabel, { final }) : `<div class="kicker"><span class="dot"></span> ${esc(liveLabel)}</div>`;
  const card = ui() ? ui().cardClass("match") : "lda-card lda-match";
  const cta = ui()
    ? ui().button({ text: open ? "Watch & pick" : final ? "See the result" : "Watch", extra: "cta", data: { go: "watch" } })
    : `<button class="cta" type="button" data-go="watch">${open ? "Watch & pick" : final ? "See the result" : "Watch"}</button>`;
  return `
    ${badge}
    <article class="live-card ${card}${intro}">
      <div class="vs">
        <div class="who">${mark(a.name, a.hue, a.id)}<b>${esc(a.name)}</b><span>${esc(a.record)}</span></div>
        <div class="x">VS</div>
        <div class="who">${mark(b.name, b.hue, b.id)}<b>${esc(b.name)}</b><span>${esc(b.record)}</span></div>
      </div>
      <div class="status">${m.phase === "live" ? `Round ${m.round || 1}` : final ? esc(m.story && m.story.title || "Settled") : "Picks are open"}</div>
      ${cta}
      ${noPicksYet() ? `<p class="first-run">No test position yet. YES or NO, in Arena Credits. They are not cash.</p>` : ""}
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

function centsLabel(n) {
  const v = Math.round(Number(n) * 100);
  if (!Number.isFinite(v)) return "—";
  return `${v}¢`;
}

const TEST_BADGE = "TEST MARKET — Arena Credits have no monetary value.";

function testBadge() {
  return ui() ? ui().marketBadge(TEST_BADGE) : `<p class="test-badge">${esc(TEST_BADGE)}</p>`;
}

function tradeAttrs(data) {
  return Object.keys(data || {}).map((key) => {
    const val = data[key];
    if (val == null || val === false) return "";
    return ` data-${key}="${esc(val)}"`;
  }).join("");
}

function choiceButtons(yes, no, matchId, detailYes, detailNo, blocked, trade) {
  const busy = !!tradeBusy;
  const disabled = busy || !!blocked;
  const yesTrade = (trade && trade.yes) || {};
  const noTrade = (trade && trade.no) || {};
  if (!ui()) {
    const dis = disabled ? " disabled" : "";
    const id = matchId ? ` data-match="${esc(matchId)}"` : "";
    return `<button class="giant" type="button" data-pick-side="yes"${id}${tradeAttrs(yesTrade)}${dis}>YES ${esc(yes)}</button><button class="giant" type="button" data-pick-side="no"${id}${tradeAttrs(noTrade)}${dis}>NO ${esc(no)}</button>`;
  }
  const data = Object.assign({ "pick-side": "yes" }, yesTrade);
  const dataNo = Object.assign({ "pick-side": "no" }, noTrade);
  if (matchId) { data.match = matchId; dataNo.match = matchId; }
  const extra = matchId ? "lda-choice-compact" : "giant";
  return ui().choice({ side: "yes", price: yes, detail: detailYes || "", extra, loading: busy, disabled, data, ariaLabel: `YES ${yes}. ${detailYes || ""}`.trim() })
    + ui().choice({ side: "no", price: no, detail: detailNo || "", extra, loading: busy, disabled, data: dataNo, ariaLabel: `NO ${no}. ${detailNo || ""}`.trim() });
}

function upcomingPropButtons(u) {
  return (u.props || []).map((prop) => {
    const held = !!prop.you;
    const yesData = { "trade-prop": prop.id, side: "yes", match: u.matchId, "trade-price": prop.yesPrice, "trade-title": prop.title };
    const noData = { "trade-prop": prop.id, side: "no", match: u.matchId, "trade-price": prop.noPrice, "trade-title": prop.title };
    if (!ui()) {
      return `<div class="ahead prop-ahead"><span class="fine">${esc(prop.title)}</span>
        <button type="button" data-trade-prop="${esc(prop.id)}" data-side="yes" data-match="${esc(u.matchId)}" data-trade-price="${prop.yesPrice}" data-trade-title="${esc(prop.title)}" ${held ? "disabled" : ""}>YES ${centsLabel(prop.yesPrice)}</button>
        <button type="button" data-trade-prop="${esc(prop.id)}" data-side="no" data-match="${esc(u.matchId)}" data-trade-price="${prop.noPrice}" data-trade-title="${esc(prop.title)}" ${held ? "disabled" : ""}>NO ${centsLabel(prop.noPrice)}</button>
      </div>`;
    }
    return `<div class="ahead prop-ahead"><span class="fine">${esc(prop.title)}</span>
      ${ui().choice({ side: "yes", price: centsLabel(prop.yesPrice), extra: "lda-choice-compact", disabled: held, selected: held && prop.you.side === "yes", data: yesData })}
      ${ui().choice({ side: "no", price: centsLabel(prop.noPrice), extra: "lda-choice-compact", disabled: held, selected: held && prop.you.side === "no", data: noData })}
    </div>`;
  }).join("");
}

function upcomingBlock() {
  const rows = (snap && snap.upcoming) || [];
  if (!rows.length) return "";
  const cards = rows.map((u, i) => {
    const [a, b] = u.seats;
    const you = u.you;
    const target = (u.seats || []).find((s) => s.id === u.targetAgentId) || a;
    const yes = u.yesCents != null ? `${u.yesCents}¢` : centsLabel(u.yesPrice != null ? u.yesPrice : (u.price && u.price[target.id]));
    const no = u.noCents != null ? `${u.noCents}¢` : centsLabel(u.noPrice != null ? u.noPrice : (u.yesPrice != null ? 1 - u.yesPrice : null));
    const picked = you ? `You hold ${esc(you.outcome || (you.side === "no" ? "NO" : "YES"))}. Test position, not cash.` : (u.question || "Pick ahead.");
    const question = u.question || `Will ${target.name} win?`;
    const trade = {
      yes: { agent: target.id, "trade-price": u.yesPrice != null ? u.yesPrice : "", "trade-title": question },
      no: { agent: target.id, "trade-price": u.noPrice != null ? u.noPrice : "", "trade-title": question },
    };
    const buttons = you || snap.testMarkets === false ? "" : `
      ${testBadge()}
      <div class="ahead">
        ${choiceButtons(yes, no, u.matchId, `${target.name} wins`, `${target.name} does not win`, false, trade)}
      </div>
      ${upcomingPropButtons(u)}`;
    const card = ui() ? ui().cardClass("match") : "lda-card lda-match";
    return `
      <article class="upcard ${card}">
        <div class="fine">${["Next", "Soon", "Later", "Last"][i] || "After"}</div>
        <div class="vs">
          <div class="who">${mark(a.name, a.hue, a.id)}<b>${esc(a.name)}</b><span>${esc(a.record)}</span></div>
          <div class="x">VS</div>
          <div class="who">${mark(b.name, b.hue, b.id)}<b>${esc(b.name)}</b><span>${esc(b.record)}</span></div>
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

function marketPositionLine(pos) {
  if (!pos) return "";
  const contracts = Math.round(pos.contracts || pos.shares || 0);
  const side = String(pos.side || (pos.outcome === "NO" ? "no" : "yes")).toUpperCase();
  if (pos.settled) {
    const pnl = pos.testPnl != null ? pos.testPnl : pos.pnl;
    return `<div class="market-position ${pos.won ? "won" : "lost"}"><b>${pos.won ? "WON" : "LOST"}</b><span>${side} · ${contracts} contracts · Test P&L ${money(pnl)} AC</span></div>`;
  }
  const pnl = pos.testPnl != null ? pos.testPnl : pos.unrealized;
  return `<div class="market-position"><b>YOUR POSITION</b><span>${side} @ ${centsLabel(pos.price)} · ${contracts} contracts · Test P&L ${money(pnl)} AC</span></div>`;
}

function outcomeButton({ label, price, attrs = "", disabled = false, picked = false }) {
  return `<button type="button" class="outcome-btn${picked ? " picked" : ""}" ${attrs}${disabled ? " disabled" : ""}><span>${esc(label)}</span><b>${centsLabel(price)}</b></button>`;
}

function outcomePair(yesPrice, noPrice, yesData, noData, state) {
  const disabled = !!(state && state.disabled);
  const yesPicked = !!(state && state.yesPicked);
  const noPicked = !!(state && state.noPicked);
  if (!ui()) {
    return `${outcomeButton({ label: "YES", price: yesPrice, attrs: tradeAttrs(yesData), disabled, picked: yesPicked })}${outcomeButton({ label: "NO", price: noPrice, attrs: tradeAttrs(noData), disabled, picked: noPicked })}`;
  }
  return ui().choice({
    side: "yes",
    price: centsLabel(yesPrice),
    extra: "lda-choice-compact",
    disabled,
    selected: yesPicked,
    data: yesData,
  }) + ui().choice({
    side: "no",
    price: centsLabel(noPrice),
    extra: "lda-choice-compact",
    disabled,
    selected: noPicked,
    data: noData,
  });
}

function marketPanel(m, opts = {}) {
  if (!m || !m.market || !m.seats || m.seats.length < 2) return "";
  if (snap && snap.testMarkets === false) return "";
  const market = m.market;
  const open = market.status === "open";
  const [a, b] = m.seats;
  const target = (m.seats || []).find((s) => s.id === market.targetAgentId) || a;
  const winnerYou = market.you || null;
  const question = market.question || `Will ${target.name} win?`;
  const yes = market.yesPrice;
  const no = market.noPrice;
  const shell = ui() ? ui().cardClass() : "lda-card";
  const winnerButtons = outcomePair(yes, no, {
    "pick-side": "yes", match: m.matchId, agent: target.id, "trade-price": yes, "trade-title": question,
  }, {
    "pick-side": "no", match: m.matchId, agent: target.id, "trade-price": no, "trade-title": question,
  }, {
    disabled: !open || !!winnerYou,
    yesPicked: !!winnerYou && winnerYou.side !== "no" && winnerYou.outcome !== "NO",
    noPicked: !!winnerYou && (winnerYou.side === "no" || winnerYou.outcome === "NO"),
  });
  const props = (market.props || []).map((prop) => {
    const settled = prop.status === "settled";
    const canTrade = open && prop.status === "open" && !prop.you;
    const result = settled
      ? `<span class="prop-result ${prop.result === "yes" ? "yes" : "no"}">${String(prop.result || "").toUpperCase()}</span>`
      : prop.status === "locked"
        ? `<span class="prop-result">LOCKED</span>`
        : "";
    const buttons = outcomePair(prop.yesPrice, prop.noPrice, {
      "trade-prop": prop.id, side: "yes", match: m.matchId, "trade-price": prop.yesPrice, "trade-title": prop.title,
    }, {
      "trade-prop": prop.id, side: "no", match: m.matchId, "trade-price": prop.noPrice, "trade-title": prop.title,
    }, {
      disabled: !canTrade,
      yesPicked: !!prop.you && prop.you.side === "yes",
      noPicked: !!prop.you && prop.you.side === "no",
    });
    return `<article class="prop-card ${shell}${settled ? " settled" : ""}">
      <div class="prop-head"><span>${esc(prop.eyebrow || "Match prop")}</span>${result}</div>
      <h3>${esc(prop.title)}</h3>
      <div class="outcomes">${buttons}</div>
      ${marketPositionLine(prop.you)}
    </article>`;
  }).join("");
  const stateCopy = open ? "Markets lock when the match starts" : market.status === "settled" ? "Settled from the official match result" : market.status === "voided" ? "Voided. Open stakes were returned" : "Markets locked · watch the match";
  const winnerResult = market.status === "settled" && market.winningOutcome
    ? `<span class="prop-result ${market.winningOutcome === "YES" ? "yes" : "no"}">${esc(market.winningOutcome)}</span>`
    : market.status === "locked" || market.status === "awaiting_result"
      ? `<span class="prop-result">LOCKED</span>`
      : "";
  const sell = open && winnerYou && winnerYou.shares > 0
    ? (ui()
      ? ui().button({ variant: "ghost", text: "Sell shares", data: { sell: true }, extra: "market-sell" })
      : `<button class="ghost lda-btn lda-btn-ghost" type="button" data-sell>Sell shares</button>`)
    : "";
  return `<section class="market-zone ${shell} ${opts.compact ? "compact" : ""}">
    <div class="market-zone-head">
      <div>${testBadge()}<h2>Prediction markets</h2></div>
      <div class="market-balance"><span>Balance</span><b>${Math.round(bankroll())} AC</b></div>
    </div>
    <p class="market-disclosure">Arena Credits only · no cash value · ${esc(stateCopy)}</p>
    <article class="winner-market ${shell}">
      <div class="prop-head"><span>Match winner</span>${winnerResult}</div>
      <h3>${esc(question)}</h3>
      <div class="outcomes winner-outcomes">${winnerButtons}</div>
      ${marketPositionLine(winnerYou)}
      ${sell}
    </article>
    <div class="props-grid">${props}</div>
  </section>`;
}

function tradeSheetMarkup() {
  if (!tradeSheet) return "";
  const stake = Number(tradeSheet.stake) || 50;
  const price = Number(tradeSheet.price) || 0;
  const contracts = price > 0 ? stake / price : 0;
  const payout = contracts;
  const stakes = [10, 25, 50, 100, 250];
  const chips = stakes.map((n) => {
    if (!ui()) return `<button type="button" data-trade-stake="${n}" class="${stake === n ? "on" : ""}">${n}</button>`;
    return ui().button({
      variant: stake === n ? "primary" : "ghost",
      text: String(n),
      selected: stake === n,
      block: false,
      data: { "trade-stake": String(n) },
      extra: "stake-chip",
    });
  }).join("");
  const close = ui()
    ? ui().button({ variant: "ghost", text: "×", block: false, data: { "close-trade": "1" }, extra: "trade-x", ariaLabel: "Close" })
    : `<button type="button" class="trade-x" data-close-trade="1" aria-label="Close">×</button>`;
  const confirm = ui()
    ? ui().button({ variant: "primary", text: `Open ${tradeSheet.outcome} position`, data: { "confirm-trade": "1" }, extra: "confirm-trade" })
    : `<button type="button" class="confirm-trade lda-btn lda-btn-primary" data-confirm-trade="1">Open ${esc(tradeSheet.outcome)} position</button>`;
  const tone = tradeSheet.side === "no" ? "is-no" : "is-yes";
  return `<div class="trade-backdrop" data-close-trade="1">
    <section class="trade-sheet lda-card" role="dialog" aria-modal="true" aria-label="Test market trade" data-trade-dialog="1">
      <div class="trade-grab" aria-hidden="true"></div>
      <div class="prop-head"><span>TEST MARKET</span>${close}</div>
      <h2>${esc(tradeSheet.title)}</h2>
      <div class="trade-side ${tone}"><span>${esc(tradeSheet.outcome)}</span><b>${centsLabel(price)}</b></div>
      <div class="trade-summary"><div><span>Stake</span><b>${stake} AC</b></div><div><span>Est. contracts</span><b>${contracts.toFixed(1)}</b></div><div><span>Max payout</span><b>${payout.toFixed(1)} AC</b></div></div>
      <div class="stake-grid">${chips}</div>
      ${confirm}
      <p class="market-disclosure">Simulated Arena Credits. No deposits, withdrawals, prizes, or cash value.</p>
    </section>
  </div>`;
}

function picker() {
  const m = live();
  const book = m.market || {};
  const target = (m.seats || []).find((s) => s.id === book.targetAgentId) || m.seats[0];
  const intro = frameBeats.some((beat) => beat.type === "intro") ? " intro" : "";
  if (snap && snap.testMarkets === false) {
    return `
      <div class="picker${intro}">
        <div class="kicker lda-kicker-predict">Who wins?</div>
        <h1>${esc(target.name)} vs ${esc(m.seats[1].name)}</h1>
        <p class="fine">Test markets are off. The match still runs.</p>
      </div>`;
  }
  return `
    <div class="picker market-picker${intro}">
      <div class="kicker lda-kicker-predict">Test market</div>
      <h1>What happens next?</h1>
      <p class="fine">Trade the winner or a match prop before the dice hit the table. Every position uses Arena Credits. They are not cash.</p>
    </div>${marketPanel(m)}`;
}

function bidderOf(bid) {
  if (!bid) return "";
  return bid.agentId || bid.byId || "";
}

function challengerOf(m) {
  const bid = m && m.bid;
  if (!bid) return "";
  if (bid.callerId) return bid.callerId;
  if (!bid.name) return "";
  const bidder = bidderOf(bid);
  const seat = (m.seats || []).find((s) => s.name === bid.name && s.id !== bidder);
  return seat ? seat.id : "";
}

function seatClass(seat, m, beats) {
  const bid = m.bid;
  const bidder = bidderOf(bid);
  const calling = m.narrative && m.narrative.headline === "LIAR.";
  const thinkingId = m.thinking && m.thinking.agentId;
  const bidBeat = beats.find((b) => b.type === "bid");
  const loss = beats.find((b) => b.type === "lose-die" && b.id === seat.id);
  let hot = false;
  let marked = false;
  let cool = false;
  if (thinkingId && !(m.reveal && m.reveal.length)) {
    hot = seat.id === thinkingId;
  } else if (calling) {
    hot = seat.id === challengerOf(m);
    marked = seat.id === bidder;
  } else if (bid && seat.id === bidder) hot = true;
  if (bidBeat && bidBeat.prevBid) {
    const prevId = bidBeat.prevBid.agentId || bidBeat.prevBid.byId;
    if (prevId && seat.id === prevId && seat.id !== bidder) cool = true;
  }
  const out = seat.alive === false;
  return ["who", "seat", hot && "hot", marked && "marked", cool && "cool", out && "out", loss && "hit"].filter(Boolean).join(" ");
}

function diceFor(seat, m, beats, frame) {
  const loss = beats.find((b) => b.type === "lose-die" && b.id === seat.id);
  const reveal = m.reveal && m.reveal.find((r) => r.id === seat.id);
  // The felt owns the faces once the cups are open. Seats keep the count.
  if (reveal && reveal.dice && reveal.dice.length) return "";
  const rolling = frame ? !!frame.roll : beats.some((b) => b.type === "roll" || b.type === "start" || b.type === "call");
  const revealing = frame ? !!frame.tumble : beats.some((b) => b.type === "reveal");
  const face = m.bid && m.bid.face;
  if (reveal && reveal.dice && reveal.dice.length && (seat.alive !== false || loss)) {
    return reveal.dice.map((n, i) => {
      const wild = !!(face && n === 1 && face !== 1);
      const match = !!(face && (n === face || wild));
      const classes = [];
      if (revealing) classes.push("tumble");
      if (match) classes.push("hit");
      if (wild) classes.push("wild");
      if (loss && loss.eliminated) classes.push("out");
      const style = `--d:${i * 70}ms`;
      return die(n, { cls: classes.join(" "), style });
    }).join("");
  }
  if (seat.alive === false && !loss) return "";
  const count = seat.alive === false ? 0 : (seat.dice || 0);
  const ghosts = loss ? Math.max(0, (loss.from || 0) - count) : 0;
  let html = "";
  for (let i = 0; i < count; i++) {
    html += `<span class="die back${rolling ? " shake" : ""}" style="--d:${i * 40}ms"></span>`;
  }
  for (let g = 0; g < ghosts; g++) html += `<span class="die back out"></span>`;
  return html;
}

function bookBar(m, beats) {
  const book = m.market;
  if (!book || !m.seats) return "";
  const pulse = beats.some((b) => b.type === "price") ? " pulse" : "";
  const yes = book.yesCents != null ? `${book.yesCents}¢` : centsLabel(book.yesPrice);
  const no = book.noCents != null ? `${book.noCents}¢` : centsLabel(book.noPrice);
  const held = position && (position.side === "no" ? "no" : position.side === "yes" ? "yes" : "");
  const yesMark = held === "yes" ? `<i class="lda-yours">Your side</i>` : "";
  const noMark = held === "no" ? `<i class="lda-yours">Your side</i>` : "";
  return `<div class="book${pulse} lda-book" aria-label="Test market">${testBadge()}<span class="lda-quote${held === "yes" ? " is-selected" : ""}"><b>YES</b> ${esc(yes)}${yesMark}</span><span class="lda-quote${held === "no" ? " is-selected" : ""}"><b>NO</b> ${esc(no)}${noMark}</span></div>`;
}

function bidChip(m, beats) {
  if (!m.bid) return `<div class="bid-slot"></div>`;
  const calling = m.narrative && m.narrative.headline === "LIAR.";
  const bidBeat = beats.find((b) => b.type === "bid");
  const callBeat = beats.some((b) => b.type === "call");
  const cls = ["bidchip", bidBeat && "pop", calling && "liar", callBeat && "slam"].filter(Boolean).join(" ");
  const prev = bidBeat && bidBeat.prevBid;
  const prevHtml = prev ? `<span class="prev">${prev.count} ${esc(faceWord(prev.face))}</span>` : "";
  if (calling) {
    return `<div class="${cls}"><span class="qty">LIAR</span><span class="by">on ${m.bid.count} ${esc(faceWord(m.bid.face))}</span></div>`;
  }
  return `<div class="${cls}">${prevHtml}<span class="qty">${m.bid.count}</span><span class="face">${esc(faceWord(m.bid.face))}</span><span class="by">${esc(m.bid.name || "")}</span></div>`;
}

function tallyBlock(m, beats) {
  if (!m.reveal || !m.bid || !m.bid.face) return "";
  const face = m.bid.face;
  const actual = motionApi().countShown(m.reveal, face);
  const key = (m.matchId || "replay") + ":" + motionApi().frameKey(m);
  const done = tallySeen === key || reducedMotion();
  const shown = done ? actual : 0;
  const truth = m.narrative && m.narrative.headline === "HE WAS TELLING THE TRUTH.";
  const bluff = m.narrative && m.narrative.headline === "HE WAS BLUFFING.";
  const note = truth ? "The bid stands. Challenger loses a die." : bluff ? "Caught. Bidder loses a die." : "";
  const on = beats.some((b) => b.type === "reveal") ? " on" : "";
  return `<div class="tally${on}" data-tally="${actual}" data-tally-key="${esc(key)}" aria-label="${actual} ${esc(faceWord(face))} showing, ${m.bid.count} bid">counting ${esc(faceWord(face))}… <b>${shown}</b> of ${m.bid.count}</div>${note ? `<div class="verdict-line ${truth ? "good" : "bad"}">${note}</div>` : ""}`;
}

function youBlock(m, beats) {
  const pos = position;
  const pulse = beats.some((b) => b.type === "price") ? " pulse" : "";
  const openPnl = pos ? (pos.testPnl != null ? pos.testPnl : pos.unrealized) : 0;
  const sell = m.phase === "pick" && pos && pos.shares > 0
    ? (ui()
      ? ui().button({ variant: "ghost", text: "Sell shares", extra: "ghost", block: false, loading: tradeBusy, data: { sell: true } })
      : `<button class="ghost" type="button" data-sell>Sell shares</button>`)
    : "";
  const you = pos
    ? `<div class="you${pulse}">${esc(pos.outcome || (pos.side === "no" ? "NO" : "YES"))} · <b>${Math.round(pos.shares || pos.contracts || 0)}</b> shares · worth <b>AC ${Math.round(pos.value)}</b> <span class="${openPnl >= 0 ? "good" : "bad"}">Test P&L ${money(openPnl)}</span>${sell}<p class="fine">${esc(TEST_BADGE)}</p></div>`
    : `<div class="you">Watching. This test market is not open for a new trade.</div>`;
  return you + spark(pos && pos.trail);
}

function seatBlock(seat, m, beats, frame) {
  const diceLabel = seat.alive === false ? "out" : `${seat.dice} dice`;
  const api = presentApi();
  let react = api ? (api.reactionsOf(m)[seat.id] || "neutral") : "neutral";
  const earlyReveal = frame && !frame.done && m.reveal && m.reveal.length && !frame.showReaction;
  if (earlyReveal && m.bid) {
    const caller = m.bid.callerId;
    const bidder = m.bid.byId || m.bid.agentId;
    react = seat.id === caller || seat.id === bidder ? "confident" : "neutral";
  }
  const label = api ? (api.REACTION_LABEL[react] || "") : "";
  const rolling = frame ? !!frame.roll : beats.some((b) => b.type === "roll" || b.type === "start");
  return `<div class="${seatClass(seat, m, beats)} arena-seat" data-react="${esc(react)}">${mark(seat.name, seat.hue, seat.id)}<div class="seat-copy"><b>${esc(seat.name)}</b><span>${diceLabel}</span>${label ? `<i class="react">${esc(label)}</i>` : ""}</div><div class="dice-row${rolling ? " shake" : ""}">${diceFor(seat, m, beats, frame)}</div></div>`;
}

function stageModel(m, beats, frame) {
  const api = presentApi();
  const pres = api ? api.presentationOf(m) : { state: m && m.reveal && m.reveal.length ? "ROUND_RESULT" : "BIDDING", intensity: (m && m.narrative && m.narrative.intensity) || 1, actorId: null, focus: "bid" };
  const cinematic = !!(frame && !frame.done && !reducedMotion());
  const showLiar = pres.state === "CALL" && (!cinematic || !!frame.showLiar);
  const showCount = !!(m && m.reveal && m.reveal.length) && (!cinematic || !!frame.showCount);
  const showVerdict = showCount && (!cinematic || !!frame.showVerdict);
  const showResult = showVerdict && (!cinematic || !!frame.showResult);
  const shownState = showResult ? "ROUND_RESULT" : (m && m.reveal && m.reveal.length && cinematic ? "REVEAL" : pres.state);
  return { api, pres, cinematic, showLiar, showCount, showVerdict, showResult, shownState };
}

function centerDice(m, beats, frame) {
  if (!m.reveal || !m.reveal.length) {
    const rolling = frame ? !!frame.roll : beats.some((b) => b.type === "roll" || b.type === "start");
    if (!rolling && !(m.phase === "live" && !m.bid)) return "";
    const total = Math.min(10, (m.seats || []).reduce((sum, seat) => sum + (seat.alive === false ? 0 : (seat.dice || 0)), 0));
    let html = "";
    for (let i = 0; i < total; i++) html += `<span class="die back lg${rolling ? " shake" : ""}" style="--d:${i * 40}ms"></span>`;
    return html ? `<div class="cups" aria-hidden="true">${html}</div>` : "";
  }
  const face = m.bid && m.bid.face;
  const tumbling = frame ? !!frame.tumble : beats.some((b) => b.type === "reveal");
  const hands = m.reveal.map((hand) => {
    const dice = (hand.dice || []).map((n, i) => {
      const wild = !!(face && n === 1 && face !== 1);
      const match = !!(face && (n === face || wild));
      const classes = ["lg"];
      if (tumbling) classes.push("tumble");
      if (match) classes.push("hit");
      if (wild) classes.push("wild");
      return die(n, { cls: classes.join(" "), style: `--d:${i * 70}ms` });
    }).join("");
    const seat = (m.seats || []).find((s) => s.id === hand.id);
    const name = seat ? seat.name : (hand.name || "");
    return `<div class="hand"><span class="hand-name">${esc(name)}</span>${dice}</div>`;
  }).join("");
  return `<div class="cups">${hands}</div>`;
}

function tableView(m, beats, opts) {
  if (!m || !m.seats || m.seats.length < 2) return `<p class="fine">No match yet.</p>`;
  const frame = opts && Object.prototype.hasOwnProperty.call(opts, "frame") ? opts.frame : stageFrame;
  const [a, b] = m.seats;
  const n = m.narrative || {};
  const showYou = !opts || opts.you !== false;
  const view = stageModel(m, beats, frame);
  const { api, pres, cinematic, showLiar, showCount, showVerdict, showResult, shownState } = view;
  const callFacts = api ? api.roundCall(m) : null;
  const intensity = pres.intensity || 1;
  const pressure = api ? api.pressureLabel(intensity, shownState) : "";
  const hint = api ? api.nextHint(shownState) : "";
  const camera = frame && frame.camera && !reducedMotion() ? frame.camera : "wide";
  const dim = !!(frame && frame.dim) || (pres.state === "CALL" && showLiar);
  const words = m.bid ? (api ? api.bidWords(m.bid.count, m.bid.face) : `${m.bid.count} ${faceWord(m.bid.face)}`.toUpperCase()) : "";
  const bidBeat = beats.find((b) => b.type === "bid");
  let sub = "";
  if (pres.state === "THINKING" && m.bid && m.bid.name) sub = `${m.bid.name}'s bid`;
  else if (pres.state === "CALL") sub = `${(m.bid && (m.bid.callerName || m.bid.name)) || "Caller"} calls`;
  else if (m.reveal && m.reveal.length && m.bid && m.bid.name) sub = `${m.bid.name}'s bid`;
  else if (m.bid && m.bid.name) sub = `${m.bid.name} ${bidBeat && bidBeat.prevBid ? "raises" : "bids"}`;
  const quietBid = pres.state === "THINKING" || showLiar;
  const punch = frame ? !!frame.punch : !!bidBeat;
  const pips = [1, 2, 3, 4, 5].map((level) => `<i class="${level <= intensity ? "on" : ""}${level <= intensity && intensity >= 4 ? " hot" : ""}"></i>`).join("");
  const score = `${a.alive === false ? 0 : a.dice}–${b.alive === false ? 0 : b.dice}`;
  const whoNow = pres.state === "THINKING" && m.thinking
    ? `<b>${esc(m.thinking.name)}</b> to act`
    : pres.state === "CALL" && m.bid && m.bid.callerName
      ? `<b>${esc(m.bid.callerName)}</b> calls`
      : pres.state === "BIDDING" && m.bid && m.bid.name
        ? `<b>${esc(m.bid.name)}</b> bid`
        : shownState === "REVEAL" || shownState === "ROUND_RESULT"
          ? "Dice are up"
          : "Cups down";
  const flash = showLiar && !reducedMotion() ? `<div class="slam-flash" aria-hidden="true"></div>` : "";
  const liveSting = beats.some((b) => b.type === "start") ? `<div class="live-sting">LIVE</div>` : "";
  const skip = cinematic && intensity >= 4 && (pres.state === "CALL" || (m.reveal && m.reveal.length))
    ? `<button class="skip" type="button" data-skip>Skip</button>`
    : "";
  const countReady = reducedMotion() || !!(frame && frame.done);
  const countHtml = showCount && callFacts
    ? `<div class="tally on" data-tally="${callFacts.actual}" data-tally-done="${countReady ? "1" : "0"}" data-tally-key="${esc((m.matchId || "replay") + ":" + callFacts.actual)}" aria-label="${callFacts.actual} ${esc(faceWord(callFacts.face))} showing, ${callFacts.count} bid"><b>${countReady ? callFacts.actual : 0}</b> ${esc(callFacts.words)}</div>`
    : (m.reveal && m.reveal.length && !showCount ? `<div class="tally">Opening the cups</div>` : "");
  const verdictHtml = showVerdict && callFacts
    ? `<div class="verdict-hit ${callFacts.truth ? "good" : "bad"}">${callFacts.verdict}</div><div class="verdict-line">${callFacts.truth ? "The bid stands." : "The bid was short."} Bid was ${esc(callFacts.bidWords)}.</div>`
    : "";
  const resultHtml = showResult && callFacts && callFacts.result
    ? `<div class="round-result lda-result-inline">${esc(callFacts.result)}</div>`
    : "";
  const visibleFeed = (cinematic && m.reveal && m.reveal.length && !showVerdict)
    ? feedLines.filter((line) => line !== (n.line || ""))
    : feedLines;
  const feed = visibleFeed.map((line) => `<li>${esc(line)}</li>`).join("");
  return `
    <div class="table stage${dim ? " dim" : ""}" data-state="${esc(shownState)}" data-camera="${esc(camera)}" data-intensity="${intensity}">
      ${flash}
      ${liveSting}
      <div class="stage-bar">
        ${ui() ? ui().liveBadge(m.phase === "settled" ? "Final" : "Live", { final: m.phase === "settled" }) : `<span class="kicker"><i class="dot"></i> ${m.phase === "settled" ? "Final" : "Live"}</span>`}
        <span>R${m.round || 1}</span>
        <span class="score">${score}</span>
        <span class="pressure" aria-label="Intensity ${intensity} of 5${pressure ? ", " + esc(pressure) : ""}"><span class="pips">${pips}</span> ${esc(pressure)}</span>
      </div>
      <div class="who-now">${whoNow}</div>
      ${seatBlock(a, m, beats, frame)}
      <div class="felt" data-primary="${esc((frame && frame.primary) || pres.focus || "bid")}">
        ${showLiar ? `<div class="liar-type">LIAR</div>` : ""}
        ${pres.state === "THINKING" && m.thinking ? `<div class="think-line">${esc(m.thinking.name)} is thinking…</div>` : ""}
        ${words ? `<div class="bid-banner${quietBid ? " quiet" : ""}${punch ? " pop" : ""}"><div class="bid-words">${esc(words)}</div>${sub ? `<div class="bid-by">${esc(sub)}</div>` : ""}</div>` : `<div class="bid-banner quiet"><div class="bid-words">CUPS DOWN</div></div>`}
        ${centerDice(m, beats, frame)}
        ${countHtml}
        ${verdictHtml}
        ${resultHtml}
        ${n.aside ? `<div class="aside">${esc(n.aside)}</div>` : ""}
      </div>
      ${seatBlock(b, m, beats, frame)}
      ${hint ? `<div class="next-hint">${esc(hint)}</div>` : ""}
      <div class="line sr" aria-live="polite">${esc(n.line || "")}</div>
      ${feed ? `<ol class="feed">${feed}</ol>` : ""}
      ${bookBar(m, beats)}
      ${showYou ? youBlock(m, beats) : ""}
      ${skip}
    </div>`;
}

function watchTable() {
  return tableView(live(), frameBeats);
}

function payoff() {
  const m = live();
  const story = m.story || {};
  const pos = position;
  const picked = pos ? seatName(pos.agentId) : null;
  const won = pos && pos.won;
  const lesson = story.lesson || "";
  const settle = frameBeats.some((b) => b.type === "settle");
  const verdict = !pos ? "FINAL" : won ? "YES" : "NO";
  const tone = !pos ? "final" : won ? "yes" : "no";
  const api = presentApi();
  const reactions = api ? api.reactionsOf(m) : {};
  const faces = (m.seats || []).map((seat) => {
    const react = reactions[seat.id] || "neutral";
    const label = api ? (api.REACTION_LABEL[react] || "") : "";
    return `<div class="arena-seat" data-react="${esc(react)}">${mark(seat.name, seat.hue, seat.id)}<div class="seat-copy"><b>${esc(seat.name)}</b>${label ? `<i class="react">${esc(label)}</i>` : ""}</div></div>`;
  }).join("");
  return `
    <div class="payoff ${ui() ? ui().cardClass("result") : "lda-card lda-result"}${settle ? " sting" : ""}">
      ${won && settle ? `<div class="confetti" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>` : ""}
      <div class="verdict ${tone}">${verdict}</div>
      <div class="result-seats">${faces}</div>
      <div class="headline">${esc(story.title || m.narrative?.line || "Settled")}</div>
      <p>${esc(story.dek || "")}</p>
      ${pos ? `<p>${won ? `<b class="good">You called it.</b>` : `<b>You missed this one.</b>`} Your test side: <b>${esc(pos.outcome || picked)}</b>.</p>` : `<p class="fine">You watched this one without a test position.</p>`}
      ${lesson ? `<p class="fine">${esc(lesson)}</p>` : ""}
      ${pos ? `<p class="delta ${won ? "good" : "bad"}">Test P&L ${money(pos.testPnl != null ? pos.testPnl : pos.pnl)} AC</p><p class="fine">Not real earnings. Balance AC ${Math.round(bankroll()).toLocaleString("en-US")}. ${esc(TEST_BADGE)}</p>` : ""}
      ${careerBlock(me, { quiet: true, compact: true })}
      ${m.share ? shareBlock({ ...m.share, matchId: m.matchId }) : ""}
    </div>`;
}

function seatName(id) {
  const m = live();
  const s = m && m.seats.find((x) => x.id === id);
  return s ? s.name : id;
}

function watch() {
  const m = live();
  if (!m) {
    if (showState.link === "boot") return emptyState("Connecting", "Taking you to the table", "The dice show up here as soon as the show answers.");
    if (showState.link === "down") return emptyState("Reconnecting", "The table will be right back", "Still reaching the show. Your last frame stays up when we have one.");
    return emptyState("Between matches", "Nothing on the table", "The next match opens in a moment. Arena lists what's coming.");
  }
  if (flash) return `<div class="flash lda-success" role="status"><div class="kicker">Locked in</div><h1>You picked ${esc(flash)}</h1><p class="fine">Dice are coming.</p></div>`;
  if (m.phase === "settled") return payoff() + marketPanel(m, { compact: true });
  if (m.phase === "pick") return picker();
  return watchTable() + marketPanel(m, { compact: true });
}

function agentsView() {
  if (focusAgent) return agentDetail(focusAgent);
  if (!agents.length && !listsReady) {
    const title = listsError ? "The cast didn't load" : "The cast is on its way";
    const body = listsError
      ? "The connection blinked. This tab will try again."
      : "Records show up when the show answers.";
    return `<h1 class="page">Agents</h1>${emptyState(listsError ? "Still trying" : "Loading", title, body)}`;
  }
  if (!agents.length) return `<h1 class="page">Agents</h1>${emptyState("No cast yet", "Nobody is seated", "Characters appear here once the show has them.")}`;
  return `<h1 class="page">Agents</h1><p class="fine">Characters, not algorithms with a hat on. Records are from matches they actually played.</p>` +
    agents.map((a) => `<button class="agent-row" type="button" data-agent="${esc(a.id)}">${mark(a.name, a.hue, a.id)}<b>${esc(a.name)}</b><div class="fine">${esc(a.archetype)} · ${esc(a.record)}${a.streak ? ` · streak ${a.streak}` : ""}${a.knownFor ? ` · known for ${esc(a.knownFor)}` : ""}</div></button>`).join("");
}

function agentDetail(a) {
  const mine = (me && me.theories && me.theories[a.id]) || [];
  const tags = ["Aggressive", "Conservative", "Bluffer", "Risk-taker", "Pressure player", "Unpredictable"];
  const rivals = (a.rivals || []).map((r) => `<div class="rowbtn"><b>${esc(r.name)}</b><div class="fine">${esc(r.series)} in ${r.meetings}</div></div>`).join("");
  const moments = (a.moments || []).map((m) => `<div class="rowbtn"><b>${esc(m.title)}</b><div class="fine">${esc(m.dek || "")}</div></div>`).join("");
  return `
    <button class="ghost lda-btn lda-btn-ghost lda-btn-block" type="button" data-back="agents">All agents</button>
    <h1 class="page">${esc(a.name)}</h1>
    <p class="fine">${esc(a.archetype)}</p>
    <div class="statgrid">
      ${ui() ? ui().statPill(a.record, "Record") + ui().statPill(String(a.streak || 0), "Streak") + ui().statPill(`${a.winRate || 0}%`, "Win rate") + ui().statPill(String(a.played || 0), "Played") : `<div><b>${esc(a.record)}</b><span>Record</span></div><div><b>${a.streak || 0}</b><span>Streak</span></div><div><b>${a.winRate || 0}%</b><span>Win rate</span></div><div><b>${a.played || 0}</b><span>Played</span></div>`}
    </div>
    <section class="section"><h2>Style</h2><p>${esc(a.line)}</p><p class="fine">Strength: ${esc(a.strength)} Weakness: ${esc(a.weakness)}</p>${a.knownFor ? `<p class="fine">From the matches: ${esc(a.knownFor)}.</p>` : ""}${a.bluffLine ? `<p class="fine">${esc(a.bluffLine)}.</p>` : ""}${a.callLine ? `<p class="fine">${esc(a.callLine)}.</p>` : ""}</section>
    <section class="section"><h2>Recent form</h2><div class="form">${(a.form || []).map((x) => `<i class="${x === "W" ? "w" : "l"}">${esc(x)}</i>`).join("") || "—"}</div></section>
    ${rivals ? `<section class="section"><h2>Rivals</h2>${rivals}</section>` : ""}
    ${moments ? `<section class="section"><h2>Recent moments</h2>${moments}</section>` : ""}
    <section class="section"><h2>My read</h2><p class="fine">Your notes. Not an official label.</p><div class="tags">${tags.map((t) => `<button type="button" data-tag="${esc(t)}" class="${mine.includes(t) ? "on" : ""}">${esc(t)}</button>`).join("")}</div></section>`;
}

function historyView() {
  if (focusMatch) return matchReplay(focusMatch);
  const line = `<section class="section"><h2>Your line</h2>${careerBlock(me)}</section>`;
  if (!listsReady) {
    const title = listsError ? "Stories didn't load" : "Fetching stories";
    const body = listsError
      ? "The connection blinked. This tab will try again."
      : "Finished matches will show here in a moment.";
    return `<h1 class="page">History</h1>${line}${emptyState(listsError ? "Still trying" : "Loading", title, body)}`;
  }
  if (!history.length) return `<h1 class="page">History</h1>${line}${emptyState("No stories yet", "Nothing has finished", "When a match settles, the story and the replay land here. Your line above stays at zero until you pick a winner.")}`;
  return `<h1 class="page">History</h1>${line}` + history.map((h) => `
    <button class="rowbtn lda-card lda-match" type="button" data-match="${esc(h.matchId)}">
      <b>${esc(h.title || h.winnerName)}</b>
      <div class="fine">${esc((h.seats || []).map((s) => s.name).join(" vs "))} · ${esc(h.dek || "")}</div>
    </button>`).join("");
}

const REPLAY_HOLD = { roll: 780, bid: 860, call: 820, reveal: 1680, out: 980, settle: 2200 };

function armReplay() {
  if (!replay || !presence().replayPlays(reducedMotion())) return;
  if (replay.timer) clearTimeout(replay.timer);
  if (replay.index >= replay.frames.length - 1) return;
  const frame = replay.frames[replay.index];
  const ms = reducedMotion() ? 480 : (REPLAY_HOLD[frame.kind] || 800);
  replay.timer = setTimeout(() => {
    if (!replay || tab !== "history" || !focusMatch) return;
    replay.index += 1;
    render();
    armReplay();
  }, ms);
}

function restartReplay() {
  if (!replay || !replay.frames.length) return;
  if (replay.timer) clearTimeout(replay.timer);
  replay.index = presence().replayIndex(replay.frames.length, reducedMotion());
  tallySeen = "";
  render();
  armReplay();
}

function matchReplay(m) {
  const events = m.events || [];
  const frames = replay && replay.id === m.matchId ? replay.frames : motionApi().replayFrames(events);
  const index = replay && replay.id === m.matchId ? replay.index : Math.max(0, frames.length - 1);
  const frame = frames[index];
  const synthetic = frame ? {
    matchId: m.matchId,
    phase: frame.kind === "settle" ? "settled" : "live",
    round: frame.round,
    seats: frame.seats,
    bid: frame.bid,
    reveal: frame.reveal,
    narrative: frame.narrative,
    winnerId: frame.winnerId || null,
    oracle: frame.winnerId ? { winnerId: frame.winnerId } : null,
  } : null;
  let shot = null;
  const api = presentApi();
  if (api && synthetic) shot = api.direct(api.commandFor(synthetic, api.presentationOf(synthetic)), { reduced: true }).frameAt(0);
  const stage = synthetic ? tableView(synthetic, reducedMotion() ? [] : (frame.beats || []), { you: false, frame: shot }) : "";
  const beats = events.filter((e) => e.type === "bid" || e.type === "challenge" || e.type === "match_over").map((e) => {
    if (e.type === "bid") return `<li>${esc(e.name)} bids ${e.count} ${esc(faceWord(e.face))}.</li>`;
    if (e.type === "challenge") return `<li><b>${esc(e.bidWasTrue ? "Telling the truth." : "Bluffing.")}</b> Call on ${e.bid.count} ${esc(faceWord(e.bid.face))}.</li>`;
    return `<li><b>${esc(e.name)} wins.</b></li>`;
  }).join("");
  const at = frames.length ? `${index + 1} / ${frames.length}` : "";
  return `
    <button class="ghost lda-btn lda-btn-ghost lda-btn-block" type="button" data-back="history">All stories</button>
    <h1 class="page">${esc(m.story && m.story.title || "Match")}</h1>
    <p>${esc(m.story && m.story.dek || "")}</p>
    ${stage}
    <div class="replay-meta"><span class="fine">${at}</span><button class="ghost" type="button" data-replay>Play again</button></div>
    ${m.share ? shareBlock({ ...m.share, matchId: m.matchId }) : ""}
    <ol class="log">${beats}</ol>`;
}

function profile() {
  if (!me) return `<p class="fine">Setting up your test-credit book…</p>`;
  return `
    <h1 class="page">Your record</h1>
    <section class="section"><h2>Career</h2>${careerBlock(me)}</section>
    <div class="statgrid">
      ${ui()
        ? ui().statPill(`${me.accuracy || 0}%`, "Correct") + ui().statPill(String(me.picks || 0), "Picks") + ui().statPill(money(me.pnl || 0), "Test PnL", pnlTone(me.pnl)) + ui().statPill(String(me.streak || 0), "Streak")
        : `<div><b>${me.accuracy || 0}%</b><span>Correct</span></div><div><b>${me.picks || 0}</b><span>Picks</span></div><div><b>${money(me.pnl || 0)}</b><span>Test PnL</span></div><div><b>${me.streak || 0}</b><span>Streak</span></div>`}
    </div>
    <p class="fine" style="margin-top:12px">AC ${Math.round(me.credits).toLocaleString("en-US")}. Arena Credits have no monetary value. Test P&L is not earnings.</p>
    ${me.bestRead ? `<section class="section"><h2>Best read</h2><div class="rowbtn"><b>${esc((agents.find((a) => a.id === me.bestRead.agentId) || {}).name || me.bestRead.agentId)}</b><div class="fine">${me.bestRead.accuracy}% over ${me.bestRead.picks} picks</div></div></section>` : ""}
    <section class="section"><h2>Leaderboard</h2>
      ${(leaders.length ? leaders : [{ id: me.id, accuracy: me.accuracy, pnl: me.pnl, picks: me.picks }]).slice(0, 8).map((p, i) => `<div class="rowbtn"><b>${i + 1}. ${esc(p.id === me.id ? "You" : p.id)}</b><div class="fine">${p.accuracy || 0}% · ${money(p.pnl || 0)} test</div></div>`).join("")}
    </section>`;
}

function kickTally() {
  const el = view.querySelector("[data-tally]");
  if (!el) return;
  const key = el.dataset.tallyKey;
  const target = Number(el.dataset.tally);
  const num = el.querySelector("b");
  if (!num || !Number.isFinite(target)) return;
  if (key === tallySeen || reducedMotion() || el.dataset.tallyDone === "1") {
    num.textContent = String(target);
    tallySeen = key;
    return;
  }
  tallySeen = key;
  const t0 = performance.now();
  const dur = 720;
  const step = (now) => {
    if (!num.isConnected) return;
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    num.textContent = String(Math.round(target * eased));
    if (p < 1) requestAnimationFrame(step);
    else num.textContent = String(target);
  };
  requestAnimationFrame(step);
}

function render() {
  frameBeats = activeMotion(live());
  const watching = live();
  if (watching) noteFeed(watching);
  stageFrame = null;
  if (tab === "watch" && watching && watching.phase === "live") stageFrame = syncDirector(watching, frameBeats);
  const settle = frameBeats.some((b) => b.type === "settle");
  const nextCredits = me ? `AC ${Math.round(me.credits).toLocaleString("en-US")}` : "—";
  const creditChanged = creditsEl.textContent && creditsEl.textContent !== "—" && creditsEl.textContent !== nextCredits;
  creditsEl.textContent = nextCredits;
  creditsEl.classList.toggle("bump", !!(settle && creditChanged) || (settle && creditsEl.classList.contains("bump")));
  if (!settle) creditsEl.classList.remove("bump");
  const arriving = enterView || (!seenSnap && !!snap);
  if (snap) seenSnap = true;
  enterView = false;
  const body = tab === "arena" ? arena()
    : tab === "watch" ? watch()
    : tab === "agents" ? agentsView()
    : tab === "history" ? historyView()
    : profile();
  const html = linkBanner() + body + (err ? `<div class="err lda-error" role="alert">${esc(err)}</div>` : "") + tradeSheetMarkup();
  if (html === painted && !arriving) return;
  painted = html;
  view.classList.toggle("enter", !!arriving);
  view.innerHTML = html;
  kickTally();
  paintShareCards();
}

function openWinnerSheet(btn) {
  const m = live();
  const matchId = btn.dataset.match || (m && m.matchId);
  if (!matchId || !me) return;
  const side = btn.dataset.pickSide === "no" ? "no" : "yes";
  const agentId = btn.dataset.agent || targetFor(matchId);
  const title = btn.dataset.tradeTitle || (m && m.market && m.market.question) || "Match winner";
  tradeSheet = {
    kind: "winner",
    matchId,
    agentId,
    side,
    title,
    outcome: side.toUpperCase(),
    price: Number(btn.dataset.tradePrice),
    stake: (snap && snap.defaultStake) || 50,
  };
  err = "";
  render();
}

function openPropSheet(btn) {
  const m = live();
  const matchId = btn.dataset.match || (m && m.matchId);
  const propId = btn.dataset.tradeProp;
  if (!matchId || !propId || !me) return;
  const side = btn.dataset.side === "no" ? "no" : "yes";
  tradeSheet = {
    kind: "prop",
    matchId,
    propId,
    side,
    title: btn.dataset.tradeTitle || "Match prop",
    outcome: side.toUpperCase(),
    price: Number(btn.dataset.tradePrice),
    stake: (snap && snap.defaultStake) || 50,
  };
  err = "";
  render();
}

view.addEventListener("click", async (e) => {
  const stakeBtn = e.target.closest("[data-trade-stake]");
  if (stakeBtn && tradeSheet) {
    tradeSheet.stake = Number(stakeBtn.dataset.tradeStake) || 50;
    render();
    return;
  }
  const closeTrade = e.target.closest("[data-close-trade]");
  if (closeTrade && (!e.target.closest("[data-trade-dialog]") || e.target.closest(".trade-x"))) {
    tradeSheet = null;
    render();
    return;
  }
  const confirm = e.target.closest("[data-confirm-trade]");
  if (confirm && tradeSheet) {
    await executeTradeSheet();
    return;
  }
  const propTrade = e.target.closest("[data-trade-prop]");
  if (propTrade) {
    openPropSheet(propTrade);
    return;
  }
  const sideBtn = e.target.closest("[data-pick-side]");
  if (sideBtn) {
    openWinnerSheet(sideBtn);
    return;
  }
  const skip = e.target.closest("[data-skip]");
  if (skip) {
    if (director) {
      director.fastForward();
      directorSig = directorSignature(director.frame());
    }
    render();
    return;
  }
  const go = e.target.closest("[data-go]");
  if (go) { setTab(go.dataset.go); return; }
  const back = e.target.closest("[data-back]");
  if (back) { focusAgent = null; focusMatch = null; setTab(back.dataset.back); return; }
  const agentBtn = e.target.closest("[data-agent]");
  if (agentBtn && !e.target.closest("[data-pick]") && !e.target.closest("[data-pick-side]") && !e.target.closest("[data-trade-prop]")) {
    try {
      const j = await api("/api/show/agents/" + encodeURIComponent(agentBtn.dataset.agent));
      focusAgent = j.agent;
      tab = "agents";
      paintTabs();
      render();
    } catch (ex) { err = ex.message; render(); }
    return;
  }
  const matchBtn = e.target.closest("[data-match]");
  if (matchBtn && !matchBtn.closest("[data-pick-side]") && !matchBtn.closest("[data-trade-prop]")) {
    try { await loadReplay(matchBtn.dataset.match); }
    catch (ex) { err = ex.message; render(); }
    return;
  }
  const ahead = e.target.closest("[data-ahead]");
  if (ahead) return doAhead(ahead.dataset.ahead, ahead.dataset.aheadAgent);
  const sellBtn = e.target.closest("[data-sell]");
  if (sellBtn) return doSell();
  const pick = e.target.closest("[data-pick]");
  if (pick) return doPick(pick.dataset.pick);
  const tag = e.target.closest("[data-tag]");
  if (tag && focusAgent) return toggleTag(tag.dataset.tag);
  const save = e.target.closest("[data-save-card]");
  if (save) return saveCard();
  const share = e.target.closest("[data-share]");
  if (share) return doShare();
  const again = e.target.closest("[data-replay]");
  if (again) return restartReplay();
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

let tradeBusy = false;

function targetFor(matchId) {
  if (matchId) {
    const row = (snap.upcoming || []).find((u) => u.matchId === matchId);
    if (row && row.targetAgentId) return row.targetAgentId;
    if (row && row.seats && row.seats[0]) return row.seats[0].id;
  }
  const m = live();
  if (!m) return "";
  if (m.market && m.market.targetAgentId) return m.market.targetAgentId;
  return m.seats && m.seats[0] ? m.seats[0].id : "";
}

async function executeTradeSheet() {
  const t = tradeSheet;
  if (!t || !me || tradeBusy) return;
  tradeBusy = true;
  err = "";
  const clientRequestId = `${me.id}-${t.kind}-${t.side}-${Date.now().toString(36)}`;
  try {
    let j;
    if (t.kind === "prop") {
      j = await api("/api/show/markets/" + encodeURIComponent(t.matchId) + "/props/" + encodeURIComponent(t.propId) + "/buy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          predictorId: me.id,
          side: t.side,
          stake: t.stake,
          expectedPrice: t.price,
          clientRequestId,
        }),
      });
    } else {
      j = await api("/api/show/markets/" + encodeURIComponent(t.matchId) + "/buy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          predictorId: me.id,
          agentId: t.agentId,
          side: t.side,
          stake: t.stake,
          expectedPrice: t.price,
          clientRequestId,
        }),
      });
      if (live() && t.matchId === live().matchId) position = j.position;
    }
    me = { ...me, credits: j.credits };
    tradeSheet = null;
    await poll();
  } catch (ex) {
    err = ex.message;
    tradeSheet = null;
    render();
  } finally {
    tradeBusy = false;
  }
}

async function doPickSide(side, matchId) {
  err = "";
  if (tradeBusy || !me || (side !== "yes" && side !== "no")) return;
  const id = matchId || (live() && live().matchId);
  const agentId = targetFor(id);
  if (!id || !agentId) return;
  tradeBusy = true;
  const clientRequestId = `${me.id}-${side}-${Date.now().toString(36)}`;
  render();
  try {
    const j = await api("/api/show/markets/" + encodeURIComponent(id) + "/buy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        predictorId: me.id,
        agentId,
        side,
        stake: snap.defaultStake || 50,
        clientRequestId,
      }),
    });
    if (!matchId) {
      position = j.position;
      me = { ...me, credits: j.credits };
      const m = live();
      const seat = m && m.seats.find((s) => s.id === (j.position && j.position.agentId));
      flash = (j.position && j.position.outcome) || (seat ? seat.name : side.toUpperCase());
      render();
      setTimeout(() => { flash = null; if (tab === "watch") render(); }, 1800);
    }
    await poll();
  } catch (ex) {
    err = ex.message;
  } finally {
    tradeBusy = false;
    render();
  }
}

async function doSell() {
  err = "";
  const m = live();
  if (tradeBusy || !m || !position || !me || !(position.shares > 0)) return;
  tradeBusy = true;
  const clientRequestId = `${me.id}-sell-${Date.now().toString(36)}`;
  render();
  try {
    const j = await api("/api/show/markets/" + encodeURIComponent(m.matchId) + "/sell", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        predictorId: me.id,
        outcomeId: position.outcome,
        agentId: position.agentId,
        side: position.side,
        shares: position.shares,
        clientRequestId,
      }),
    });
    position = j.position;
    me = { ...me, credits: j.credits };
    await poll();
  } catch (ex) {
    err = ex.message;
  } finally {
    tradeBusy = false;
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

function shareBlock(card) {
  if (!card) return "";
  return `
    <canvas class="share-card" width="720" height="960" aria-label="Share card"></canvas>
    <div class="share-actions">
      <button class="ghost lda-btn lda-btn-ghost" type="button" data-share>Share the call</button>
      <button class="ghost lda-btn lda-btn-ghost" type="button" data-save-card>Save card</button>
    </div>
    ${shareNote ? `<p class="fine">${esc(shareNote)}</p>` : ""}`;
}

function activeShare() {
  if (focusMatch && focusMatch.share) return { ...focusMatch.share, matchId: focusMatch.matchId };
  const m = live();
  if (m && m.share) return { ...m.share, matchId: m.matchId };
  return null;
}

function cardHref(card) {
  if (card && card.href) return card.href;
  if (card && card.matchId) return "#replay=" + encodeURIComponent(card.matchId);
  return "";
}

function replayUrl(card) {
  const href = cardHref(card);
  if (!href) return location.href;
  return new URL(href, location.href).toString();
}

function wrapLines(ctx, text, maxWidth) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function traceRound(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawShareCard(card, canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#0e0d0b";
  g.fillRect(0, 0, w, h);
  traceRound(g, 36, 36, w - 72, h - 72, 28);
  g.fillStyle = "#171511";
  g.fill();
  g.strokeStyle = "rgba(228,194,122,0.45)";
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = "#e4c27a";
  g.fillRect(72, 96, 72, 6);
  g.font = "600 22px Outfit, sans-serif";
  g.fillText("LIAR'S DICE ARENA", 72, 156);
  g.font = "680 52px Fraunces, Georgia, serif";
  g.fillStyle = "#f4efe6";
  let y = 240;
  for (const line of wrapLines(g, card.title || "Settled", w - 144).slice(0, 4)) {
    g.fillText(line, 72, y);
    y += 62;
  }
  y += 8;
  g.font = "420 28px Outfit, sans-serif";
  g.fillStyle = "#a39b8d";
  for (const line of wrapLines(g, String(card.body || "").replace(/\n/g, " "), w - 144).slice(0, 5)) {
    g.fillText(line, 72, y);
    y += 38;
  }
  if (Number(card.streak) >= 3) {
    g.fillStyle = "#9ddeaf";
    g.font = "650 26px Outfit, sans-serif";
    g.fillText("WIN STREAK " + card.streak, 72, h - 196);
  }
  g.fillStyle = "#e4c27a";
  g.font = "560 26px Outfit, sans-serif";
  g.fillText("Watch the final call", 72, h - 148);
  g.fillStyle = "#a39b8d";
  g.font = "420 22px Outfit, sans-serif";
  g.fillText("Test credits. Not real money.", 72, h - 108);
}

function paintShareCards() {
  const card = activeShare();
  if (!card) return;
  document.querySelectorAll("canvas.share-card").forEach((c) => drawShareCard(card, c));
}

function canvasBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

async function cardImage(card) {
  const shown = document.querySelector("canvas.share-card");
  const canvas = shown || document.createElement("canvas");
  if (!shown) { canvas.width = 720; canvas.height = 960; }
  drawShareCard(card, canvas);
  const blob = await canvasBlob(canvas);
  if (!blob) throw new Error("Could not draw the card.");
  return blob;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function shareMessage(card) {
  const url = replayUrl(card);
  const text = [card.text, url].filter(Boolean).join("\n");
  return { title: card.title || "Liar's Dice Arena", text, url };
}

async function saveCard() {
  const card = activeShare();
  if (!card) return;
  try {
    const blob = await cardImage(card);
    downloadBlob(blob, `liars-dice-${card.matchId || "match"}.png`);
    shareNote = "Card saved on this device.";
    render();
  } catch (ex) {
    shareNote = ex.message || "Couldn't save that card.";
    render();
  }
}

async function doShare() {
  const card = activeShare();
  if (!card) return;
  const payload = shareMessage(card);
  try {
    const blob = await cardImage(card);
    const file = new File([blob], `liars-dice-${card.matchId || "match"}.png`, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ ...payload, files: [file] });
      return;
    }
    if (navigator.share) {
      await navigator.share(payload);
      return;
    }
    downloadBlob(blob, file.name);
    if (navigator.clipboard) await navigator.clipboard.writeText(payload.text);
    shareNote = "Card saved. Link copied.";
    render();
  } catch (ex) {
    if (ex && ex.name === "AbortError") return;
    shareNote = ex.message || "Couldn't share that card.";
    render();
  }
}

async function loadReplay(id) {
  err = "";
  shareNote = "";
  const j = await api("/api/show/matches/" + encodeURIComponent(id) + "/replay");
  if (!agents.length) await refreshLists();
  focusAgent = null;
  focusMatch = j;
  clearReplay();
  const frames = motionApi().replayFrames(j.events || [], {
    hueOf: (agentId) => {
      const found = agents.find((a) => a.id === agentId);
      return found ? found.hue : 40;
    },
  });
  replay = { id: j.matchId || id, frames, index: presence().replayIndex(frames.length, reducedMotion()), timer: 0 };
  tab = "history";
  enterView = true;
  painted = "";
  tallySeen = "";
  paintTabs();
  const href = cardHref({ ...j.share, matchId: j.matchId || id });
  const next = location.pathname + href;
  if (location.pathname + location.search + location.hash !== next) window.history.replaceState(null, "", next);
  render();
  armReplay();
}

async function openLinkedReplay() {
  const id = replayIdFromLocation();
  if (!id) return;
  if (focusMatch && focusMatch.matchId === id && tab === "history") return;
  try { await loadReplay(id); }
  catch (ex) {
    focusMatch = null;
    tab = "history";
    shareNote = "";
    paintTabs();
    err = ex.message || "That story isn't in the book.";
    render();
  }
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
    listsReady = true;
    listsError = "";
  } catch (ex) {
    if (!listsReady) listsError = ex.message || "Couldn't load that list.";
  }
}

function notePresence(folded) {
  const linkChanged = folded.link !== showState.link;
  showState = { snap: folded.snap, link: folded.link, holdUntil: folded.holdUntil };
  snap = folded.snap;
  return linkChanged;
}

async function poll() {
  const gen = ++pollGen;
  let incoming;
  try {
    const j = await api("/api/show?predictor=" + encodeURIComponent(me.id));
    if (gen !== pollGen) return;
    incoming = { failed: false, starting: !!j.starting, snap: j };
  } catch {
    if (gen !== pollGen) return;
    incoming = { failed: true };
  }
  const folded = presence().foldShow(showState, incoming, Date.now());
  const linkChanged = notePresence(folded);
  if (!folded.apply) {
    if (linkChanged && !focusAgent && !focusMatch) render();
    else if (linkChanged) renderCredits();
    return;
  }
  const j = folded.snap || {};
  if (j.you) me = j.you;
  // A missing position means this match has no pick. Keeping the previous
  // match's position would show the wrong name once the next one is live.
  if (j.live && j.live.market && j.live.market.you) position = j.live.market.you;
  else position = null;
  const prevLive = heardLive;
  hear(j.live);
  applyMotion(prevLive, j.live);
  if (tab === "agents" || tab === "history" || tab === "profile") await refreshLists();
  if (gen !== pollGen) return;
  if (!focusAgent && !focusMatch) render();
  else renderCredits();
}

document.querySelector("#sound").addEventListener("click", async () => {
  const next = !soundEnabled();
  setSound(next);
  if (!next) return;
  const ctx = unlockAudio();
  if (ctx && ctx.resume) await ctx.resume();
  if (ctx && ctx.state === "running") CUES["pick-open"](ctx, ctx.currentTime);
});
document.addEventListener("pointerdown", () => {
  if (soundEnabled()) unlockAudio();
}, { passive: true });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden || !director) return;
  director.fastForward();
  directorSig = directorSignature(director.frame());
  if (tab === "watch") render();
});

async function boot() {
  paintSound();
  render();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (document.querySelector("canvas.share-card")) paintShareCards();
    }).catch(() => {});
  }
  const opened = await api("/api/show/predictors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: predictorId() }),
  });
  me = opened.predictor;
  renderCredits();
  await poll();
  await openLinkedReplay();
  setInterval(poll, 2000);
  window.addEventListener("hashchange", () => { openLinkedReplay().catch(() => {}); });
  try {
    const es = new EventSource("/api/show/events");
    es.onmessage = () => { poll(); };
  } catch { /* poll is enough */ }
}
boot().catch((e) => { err = e.message; render(); });
