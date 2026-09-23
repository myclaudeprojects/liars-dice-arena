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
  const tone = hue == null ? 40 : hue;
  return `<div class="mark" style="border-color:hsl(${tone} 42% 58%)">${letter}</div>`;
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
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
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
  creditsEl.textContent = me ? `${Math.round(me.credits)} test` : "—";
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
  return `<section class="empty"><div class="kicker">${esc(kicker)}</div><h1 class="page">${esc(title)}</h1><p>${esc(body)}</p></section>`;
}

function linkBanner() {
  if (tab !== "arena" && tab !== "watch") return "";
  if (!live()) return "";
  const text = presence().statusCopy(showState.link);
  if (!text) return "";
  return `<p class="link" role="status">${esc(text)}</p>`;
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
    ? "The next pairing opens in a moment. You haven't picked a winner yet. One tap when the window opens. Test credits only."
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
  return `
    <div class="kicker"><span class="dot"></span> ${open ? "Live now" : m.phase === "settled" ? "Final" : "Live now"}${eye}</div>
    <article class="live-card${intro}">
      <div class="vs">
        <div class="who">${mark(a.name, a.hue)}<b>${esc(a.name)}</b><span>${esc(a.record)}</span></div>
        <div class="x">VS</div>
        <div class="who">${mark(b.name, b.hue)}<b>${esc(b.name)}</b><span>${esc(b.record)}</span></div>
      </div>
      <div class="status">${m.phase === "live" ? `Round ${m.round || 1}` : m.phase === "settled" ? esc(m.story && m.story.title || "Settled") : "Picks are open"}</div>
      <button class="cta" type="button" data-go="watch">${open ? "Watch & pick" : m.phase === "settled" ? "See the result" : "Watch"}</button>
      ${noPicksYet() ? `<p class="first-run">No picks yet. One tap. 50 test credits, and they are not cash.</p>` : ""}
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
        <div class="fine">${["Next", "Soon", "Later", "Last"][i] || "After"}</div>
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
  const intro = frameBeats.some((b) => b.type === "intro") ? " intro" : "";
  return `
    <div class="picker${intro}">
      <div class="kicker">One tap</div>
      <h1>Who's got this?</h1>
      <button class="giant" type="button" data-pick="${esc(a.id)}">${mark(a.name, a.hue)}<span><b>${esc(a.name)}</b><span>${esc(a.record)} · ${esc(a.archetype)}</span></span></button>
      <button class="giant" type="button" data-pick="${esc(b.id)}">${mark(b.name, b.hue)}<span><b>${esc(b.name)}</b><span>${esc(b.record)} · ${esc(b.archetype)}</span></span></button>
      <p class="fine">50 test credits. No cash value. You can be wrong. That's the point.</p>
      <div class="err">${esc(err)}</div>
    </div>`;
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
  const bidBeat = beats.find((b) => b.type === "bid");
  const loss = beats.find((b) => b.type === "lose-die" && b.id === seat.id);
  let hot = false;
  let marked = false;
  let cool = false;
  if (calling) {
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

function diceFor(seat, m, beats) {
  const loss = beats.find((b) => b.type === "lose-die" && b.id === seat.id);
  const reveal = m.reveal && m.reveal.find((r) => r.id === seat.id);
  const rolling = beats.some((b) => b.type === "roll" || b.type === "start" || b.type === "call");
  const revealing = beats.some((b) => b.type === "reveal");
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
  const price = m.market && m.market.price;
  if (!price || !m.seats) return "";
  const pulse = beats.some((b) => b.type === "price") ? " pulse" : "";
  const bits = m.seats.map((s) => `<span><b>${esc(s.name)}</b> ${Math.round((price[s.id] || 0) * 100)}</span>`).join("");
  return `<div class="book${pulse}" aria-label="Test-credit book">${bits}</div>`;
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
  const delta = pos && Math.abs(pos.unrealized) >= 0.5
    ? ` <span class="${pos.unrealized >= 0 ? "good" : "bad"}">${money(pos.unrealized)}</span>`
    : "";
  const you = pos
    ? `<div class="you${pulse}">You picked <b>${esc(seatName(pos.agentId))}</b> · worth <b>${Math.round(pos.value)}</b> test credits${delta}</div>`
    : `<div class="you">Watching. Picks are closed for this one.</div>`;
  return you + spark(pos && pos.trail);
}

function seatBlock(seat, m, beats) {
  const diceLabel = seat.alive === false ? "out" : `${seat.dice} dice`;
  const rolling = beats.some((b) => b.type === "roll" || b.type === "start" || b.type === "call");
  return `<div class="${seatClass(seat, m, beats)}">${mark(seat.name, seat.hue)}<b>${esc(seat.name)}</b><span>${diceLabel}</span><div class="dice-row${rolling ? " shake" : ""}">${diceFor(seat, m, beats)}</div></div>`;
}

function tableView(m, beats, opts) {
  if (!m || !m.seats || m.seats.length < 2) return `<p class="fine">No match yet.</p>`;
  const [a, b] = m.seats;
  const n = m.narrative || {};
  const showYou = !opts || opts.you !== false;
  const sting = beats.some((b) => b.type === "reveal" || b.type === "call" || b.type === "settle");
  const emph = n.pace === "critical" || n.pace === "call" || n.pace === "reveal" || n.pace === "result";
  const headCls = ["headline", emph ? "critical" : "", sting && n.headline ? "stinger" : ""].filter(Boolean).join(" ");
  const head = n.headline ? `<div class="${headCls}">${esc(n.headline)}</div>` : "";
  const flash = beats.some((b) => b.type === "call") ? `<div class="slam-flash" aria-hidden="true"></div>` : "";
  const liveSting = beats.some((b) => b.type === "start") ? `<div class="live-sting">LIVE</div>` : "";
  return `
    <div class="table">
      ${flash}
      ${liveSting}
      <div class="vs">
        ${seatBlock(a, m, beats)}
        <div class="x">${m.phase === "settled" ? "FINAL" : "R" + (m.round || 1)}</div>
        ${seatBlock(b, m, beats)}
      </div>
      ${bookBar(m, beats)}
      ${bidChip(m, beats)}
      ${head}
      <div class="line" aria-live="polite">${esc(n.line || "")}</div>
      ${n.aside ? `<div class="aside">${esc(n.aside)}</div>` : ""}
      ${tallyBlock(m, beats)}
      ${showYou ? youBlock(m, beats) : ""}
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
  return `
    <div class="payoff${settle ? " sting" : ""}">
      ${won && settle ? `<div class="confetti" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>` : ""}
      <div class="verdict ${tone}">${verdict}</div>
      <div class="headline">${esc(story.title || m.narrative?.line || "Settled")}</div>
      <p>${esc(story.dek || "")}</p>
      ${pos ? `<p>${won ? `<b class="good">You called it.</b>` : `<b>You missed this one.</b>`} Your pick: <b>${esc(picked)}</b>.</p>` : `<p class="fine">You watched this one without a pick.</p>`}
      ${lesson ? `<p class="fine">${esc(lesson)}</p>` : ""}
      ${pos ? `<p class="delta ${won ? "good" : "bad"}">${money(pos.pnl)} test</p><p class="fine">Balance ${Math.round(bankroll())}</p>` : ""}
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
  if (flash) return `<div class="flash"><div class="kicker">Locked in</div><h1>You picked ${esc(flash)}</h1><p class="fine">Dice are coming.</p></div>`;
  if (m.phase === "settled") return payoff();
  if (m.phase === "pick" && !position) return picker();
  return watchTable();
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
    <button class="rowbtn" type="button" data-match="${esc(h.matchId)}">
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
  const stage = frame ? tableView({
    matchId: m.matchId,
    phase: "live",
    round: frame.round,
    seats: frame.seats,
    bid: frame.bid,
    reveal: frame.reveal,
    narrative: frame.narrative,
  }, reducedMotion() ? [] : (frame.beats || []), { you: false }) : "";
  const beats = events.filter((e) => e.type === "bid" || e.type === "challenge" || e.type === "match_over").map((e) => {
    if (e.type === "bid") return `<li>${esc(e.name)} bids ${e.count} ${esc(faceWord(e.face))}.</li>`;
    if (e.type === "challenge") return `<li><b>${esc(e.bidWasTrue ? "Telling the truth." : "Bluffing.")}</b> Call on ${e.bid.count} ${esc(faceWord(e.bid.face))}.</li>`;
    return `<li><b>${esc(e.name)} wins.</b></li>`;
  }).join("");
  const at = frames.length ? `${index + 1} / ${frames.length}` : "";
  return `
    <button class="ghost" type="button" data-back="history">All stories</button>
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
      <div><b>${me.accuracy || 0}%</b><span>Correct</span></div>
      <div><b>${me.picks || 0}</b><span>Picks</span></div>
      <div><b>${money(me.pnl || 0)}</b><span>Test PnL</span></div>
      <div><b>${me.streak || 0}</b><span>Streak</span></div>
    </div>
    <p class="fine" style="margin-top:12px">${Math.round(me.credits)} test credits. They are not dollars, tokens, or a claim on anything.</p>
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
  if (key === tallySeen || reducedMotion()) {
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
  const settle = frameBeats.some((b) => b.type === "settle");
  const nextCredits = me ? `${Math.round(me.credits)} test` : "—";
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
  const m = live();
  const errInPicker = tab === "watch" && m && m.phase === "pick" && !position && !flash;
  const html = linkBanner() + body + (!errInPicker && err ? `<div class="err">${esc(err)}</div>` : "");
  if (html === painted && !arriving) return;
  painted = html;
  view.classList.toggle("enter", !!arriving);
  view.innerHTML = html;
  kickTally();
  paintShareCards();
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
    try { await loadReplay(matchBtn.dataset.match); }
    catch (ex) { err = ex.message; render(); }
    return;
  }
  const ahead = e.target.closest("[data-ahead]");
  if (ahead) return doAhead(ahead.dataset.ahead, ahead.dataset.aheadAgent);
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
      <button class="ghost" type="button" data-share>Share the call</button>
      <button class="ghost" type="button" data-save-card>Save card</button>
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
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === "history"));
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
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === "history"));
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
