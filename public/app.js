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
const matchEl = document.querySelector("#match");
const introEl = document.querySelector("#match-intro");
const marketEl = document.querySelector("#market");
const sheetEl = document.querySelector("#sheet");
const liveLineEl = document.querySelector("#live-line");
const creditsEl = document.querySelector("#credits");
let tab = "arena";
let snap = null;
let me = null;
let position = null;
let focusAgent = null;
let creator = null;
let portraitEdit = null;
let creatorBeat = null;
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
let pinScroll = true;
let paintedMatch = "";
let paintedMarket = "";
let paintedSheet = "";
let tallySeen = "";
let replay = null;
let introTimer = 0;
let introKey = "";
const introStarted = new Map();

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
  ambience: (ctx, t) => {
    blip(ctx, t, 110, 0.22, 0.02, "sine", 90);
    blip(ctx, t + 0.05, 164, 0.18, 0.012, "triangle");
  },
  roll: (ctx, t) => {
    blip(ctx, t, 180, 0.04, 0.03, "square", 90);
    blip(ctx, t + 0.06, 240, 0.05, 0.025, "triangle", 120);
    blip(ctx, t + 0.12, 320, 0.04, 0.02, "square");
  },
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
  if (beats.some((b) => b.type === "reveal")) return 2800;
  if (beats.some((b) => b.type === "settle")) return 2200;
  if (beats.some((b) => b.type === "lose-die")) return 1400;
  if (beats.some((b) => b.type === "call")) return 1600;
  if (beats.some((b) => b.type === "start") || beats.some((b) => b.type === "roll")) return 1200;
  if (beats.some((b) => b.type === "bid")) return 1100;
  if (beats.some((b) => b.type === "thinking")) return 900;
  return 800;
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
    // A live beat must not rebuild the create wizard. Replacing that HTML
    // drops the focused field, so the next keystrokes never land.
    if (focusMatch || focusAgent || creatorSession()) return;
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
  if (!r.ok || j.ok === false) {
    const err = new Error(j.error || "Something went wrong.");
    err.code = j.code;
    if (j.txHash) err.txHash = j.txHash;
    throw err;
  }
  return j;
}
function faceWord(face) { return FACE[face] || "dice"; }
function brandFor(person) {
  if (!person) return null;
  if (person.brand && person.brand.title) return person.brand;
  const id = person.id || person.agentId;
  if (focusMatch && focusMatch.brands && id && focusMatch.brands[id]) return focusMatch.brands[id];
  if (snap && snap.brands && id && snap.brands[id]) return snap.brands[id];
  const known = agents.find((a) => a.id === id);
  return (known && known.brand) || null;
}
function personTitle(person) {
  const brand = brandFor(person);
  return (brand && brand.title) || (person && person.archetype) || "";
}
// Accept only our own portrait route. Query may carry size=, v= (brand version) and
// s= (style stamp) in any order; anything else is refused and the letter fallback shows.
// ui.js portraitUrl must allow the same keys, or the shell still paints a letter.
function pfpPath(url) {
  const text = String(url || "");
  if (/^\/assets\/portraits\/[a-z0-9_.-]+\.(?:webp|png|jpg)(?:\?(?:[a-z]+=[a-z0-9]+)(?:&[a-z]+=[a-z0-9]+)*)?$/i.test(text)) return text;
  const m = text.match(/^(\/api\/show\/agents\/[a-z0-9_%.-]+\/pfp\.svg)(?:\?(.*))?$/i);
  if (!m) return "";
  if (!m[2]) return text;
  const ok = m[2].split("&").every((kv) => /^size=(?:48|96|160|256|320|512|1024)$/.test(kv) || /^v=\d+$/.test(kv) || /^s=\d+$/.test(kv));
  return ok ? text : "";
}
function pfpSrc(brand, size) {
  if (!brand) return "";
  const sized = brand.avatarSizes && (brand.avatarSizes[size] || brand.avatarSizes[String(size)]);
  return pfpPath(sized || brand.pfpUrl || "");
}
function pfpRuntime() {
  return window.ldaAnimatedPfp || null;
}
function pfpMotion(person) {
  const brand = brandFor(person);
  const named = brand && brand.animatedPfp && brand.animatedPfp.motionProfile;
  if (named) return named;
  const api = pfpRuntime();
  if (api) return api.profileForBrand(brand || person || {});
  return "NEON_COMPETITIVE";
}
function animatedPortrait(inner, person, context, state) {
  const brand = brandFor(person);
  const src = pfpSrc(brand, 320) || pfpSrc(brand, 256) || pfpSrc(brand, 160);
  if (context !== "reveal" && !src) return inner;
  const motion = pfpMotion(person);
  const id = (person && (person.id || person.agentId)) || "";
  const srcAttr = context === "reveal" || !src ? ` data-inline="1"` : ` data-pfp-src="${esc(src)}"`;
  const cls = context === "profile" ? "animated-pfp agent-pfp" : "animated-pfp";
  return `<span class="${cls}" data-context="${esc(context)}" data-state="${esc(state || "idle")}" data-style="neon-competitive" data-motion="${esc(motion)}" data-agent="${esc(id)}"${srcAttr}>${inner}</span>`;
}
function bindAnimatedPfps(root) {
  const api = pfpRuntime();
  if (!api || !root || !api.scan) return;
  api.scan(root);
}
function mark(name, hue, id, brand) {
  const resolved = brand || brandFor({ id });
  const cast = id ? ` data-cast="${esc(id)}"` : "";
  const src = pfpSrc(resolved, 96);
  const avatar = src && ui()
    ? ui().avatar(name, hue, id, { src, size: 96 })
    : ui()
      ? ui().avatar(name, hue, id)
      : (() => {
        const letter = esc((name || "?").replace(/^The /, "")[0] || "?");
        const tone = hue == null ? 40 : hue;
        return `<div class="mark lda-avatar"${cast} style="--agent-accent:hsl(${tone} 42% 58%)">${letter}</div>`;
      })();
  if (!resolved || !resolved.emblemUrl || !ui()) return avatar;
  return `<span class="brand-lockup"${cast}>${ui().emblem()}${avatar}</span>`;
}
function facePlate(person, px, opts) {
  const who = person || {};
  const brand = brandFor(who);
  const size = [48, 96, 160, 256, 320, 512, 1024].includes(px) ? px : 160;
  const src = pfpSrc(brand, size) || pfpSrc(brand, 160) || pfpSrc(brand, 96);
  const named = size >= 320 ? "xl" : size >= 160 ? "lg" : size >= 96 ? "md" : "sm";
  const plate = ui() && ui().agentAvatar
    ? ui().agentAvatar({
      name: who.name,
      hue: who.hue,
      id: who.id || who.agentId,
      brand,
    }, { src, size: named })
    : mark(who.name, who.hue, who.id || who.agentId, brand);
  if (!opts || !opts.animate) return plate;
  return animatedPortrait(plate, who, opts.context || "watch", opts.state || "idle");
}
function heroFace(person) {
  return facePlate(person, 320);
}
function heroColors(person) {
  const brand = brandFor(person);
  return {
    primary: hexColor(brand && brand.primaryColor),
    accent: hexColor(brand && brand.accentColor),
  };
}
function heroThemeAttr(a, b) {
  const left = heroColors(a).primary;
  const right = heroColors(b).primary;
  const bits = [];
  if (left) bits.push("--hero-a:" + left);
  if (right) bits.push("--hero-b:" + right);
  return bits.length ? ` style="${bits.join(";")}"` : "";
}
function matchupSide(person, side, plate, state) {
  const kind = plate || "hero";
  const px = kind === "hero" ? 320 : kind === "rival" ? 160 : 160;
  const record = person && person.record ? `<small class="matchup-agent__record">${esc(person.record)}</small>` : "";
  const face = kind === "hero"
    ? facePlate(person, px, { animate: true, context: "hero", state: state || "idle" })
    : facePlate(person, px);
  return `<div class="matchup-agent matchup-agent--${side} who hero-agent" data-cast="${esc((person && (person.id || person.agentId)) || "")}"${brandStyle(person)}>
    <div class="portrait-plate portrait-plate--${kind}">${face}</div>
    ${titleLine(person)}
    <b class="matchup-name">${esc((person && person.name) || "")}</b>
    ${record}
  </div>`;
}
function titleLine(person) {
  const title = personTitle(person);
  return title ? `<span class="brand-title">${esc(title)}</span>` : "";
}
function paletteLine(person) {
  const brand = brandFor(person);
  if (!brand || !ui()) return "";
  return ui().palette(brand.agentId || person.id);
}
const HOUSE_CAST = new Set([
  "dracula", "caesar", "reaper", "athena", "shark", "oracle",
  "fox", "brutus", "monk", "siren", "miser", "jester",
]);
function hexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? String(value) : "";
}
function agentPortrait(agent) {
  const brand = brandFor(agent);
  const large = pfpSrc(brand, 320);
  if (!large) return mark(agent.name, agent.hue, agent.id, brand);
  const small = pfpSrc(brand, 48);
  const mid = pfpSrc(brand, 96);
  const hero = animatedPortrait(`<img src="${esc(large)}" alt="" width="320" height="320">`, agent, "profile", "idle");
  return `${hero}
    <span class="pfp-sizes" aria-label="Avatar sizes">${small ? `<img class="pfp-mini" src="${esc(small)}" alt="" width="48" height="48">` : ""}${mid ? `<img class="pfp-mini is-96" src="${esc(mid)}" alt="" width="96" height="96">` : ""}</span>`;
}
function pfpFrame(svg) {
  const art = safeSvg(svg);
  if (!art) return "";
  return `<span class="pfp-frame">${art}</span>`;
}
// A concept's art: a generated library image when it has one, else its SVG.
function conceptArt(c) {
  if (c && c.pfpUrl && pfpPath(c.pfpUrl)) return `<span class="pfp-frame"><img src="${esc(c.pfpUrl)}" alt="" loading="lazy"></span>`;
  return pfpFrame(c && c.pfpSvg);
}
function pfpMini(svg, size) {
  const art = safeSvg(svg);
  if (!art) return "";
  const uri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(art);
  return `<img class="pfp-mini${size === 96 ? " is-96" : ""}" src="${uri}" alt="" width="${size}" height="${size}">`;
}
function conceptPortrait(c) {
  const visual = c.visualIdentity || {};
  const on = c.id === creator.selectedId;
  const accent = hexColor(visual.accentColor) || "#4AD7FF";
  return `<button class="concept-card pfp-concept lda-card${on ? " is-selected" : ""}" type="button" data-concept="${esc(c.id)}" aria-pressed="${on ? "true" : "false"}" aria-label="Select portrait option ${esc(String((c.conceptNumber || 0)))}" style="--agent-accent:${esc(accent)}">
    <span class="pfp-concept__image-wrap">${conceptArt(c)}<span class="pfp-concept__ring"></span></span>
    <span class="concept-copy">
      <span class="concept-name"><b>${esc(creator.form.name)}</b><span class="concept-emblem" style="color:${esc(hexColor(visual.accentColor) || "#e4c27a")}">${safeSvg(c.emblemSvg)}</span></span>
      <span class="brand-title">${esc(c.title)}</span>
      <span class="concept-tag">${esc(c.tagline)}</span>
    </span>
    <span class="swatches" aria-hidden="true"><i class="swatch" style="background:${esc(hexColor(visual.primaryColor))}"></i><i class="swatch" style="background:${esc(hexColor(visual.secondaryColor))}"></i><i class="swatch" style="background:${esc(hexColor(visual.accentColor))}"></i></span>
    <span class="pfp-select pfp-concept__label">${on ? "Selected" : "Option " + esc(String(c.conceptNumber || ""))}</span>
  </button>`;
}
function emblemPath(url) {
  const text = String(url || "");
  if (/^\/static\/emblems\/[a-z0-9_-]+\.svg$/i.test(text)) return text;
  if (/^\/api\/show\/agents\/[a-z0-9_%.-]+\/emblem\.svg$/i.test(text)) return text;
  return "";
}
function brandStyle(person) {
  const brand = brandFor(person);
  if (!brand || !person || HOUSE_CAST.has(person.id)) return "";
  const primary = hexColor(brand.primaryColor);
  const secondary = hexColor(brand.secondaryColor);
  const accent = hexColor(brand.accentColor);
  const emblem = emblemPath(brand.emblemUrl);
  const bits = [];
  if (accent) bits.push("--agent-accent:" + accent);
  if (primary) bits.push("--swatch-primary:" + primary);
  if (secondary) bits.push("--swatch-secondary:" + secondary);
  if (accent) bits.push("--swatch-accent:" + accent);
  if (emblem) bits.push('--emblem-url:url("' + emblem + '")');
  return bits.length ? ` style="${bits.join(";")}"` : "";
}
function marketIdentity(person) {
  if (!person) return "";
  const brand = brandFor(person);
  return `<div class="market-identity market-outcome" data-cast="${esc(person.id)}">${mark(person.name, person.hue, person.id, brand)}<div class="nameplate market-outcome__identity"><b>${esc(person.name)}</b>${titleLine(person)}</div></div>`;
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
  clearPainted();
  paintTabs();
  pinScroll = false;
  render();
  window.scrollTo(0, 0);
  pinScroll = true;
  if (next === "agents" || next === "history" || next === "profile") {
    refreshLists().then(() => {
      if (tab !== next || focusAgent || focusMatch || creatorSession()) return;
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

function storyMarkup(row) {
  const api = presentApi();
  const src = api && api.storySource ? api.storySource(row) : {
    title: (row && row.title) || "",
    dek: (row && row.dek) || "",
    winnerName: (row && row.winnerName) || "",
    loserName: (row && row.loserName) || "",
  };
  if (!src.title && !src.dek) return "";
  const kicker = api && api.storyKicker ? api.storyKicker(src) : "";
  const lines = api && api.storyLines ? api.storyLines(src) : [src.dek].filter(Boolean);
  const who = src.winnerName && src.loserName
    ? `${src.winnerName} won · ${src.loserName} lost`
    : (src.winnerName ? `${src.winnerName} won` : "");
  return `
    ${kicker ? `<div class="story-kicker">${esc(kicker)}</div>` : ""}
    ${src.title ? `<b>${esc(src.title)}</b>` : ""}
    ${who ? `<div class="fine">${esc(who)}</div>` : ""}
    ${lines.map((line) => `<div class="fine">${esc(line)}</div>`).join("")}`;
}

function castLine(seats) {
  if (!seats || !seats.length) return "";
  return `<div class="history-cast">${seats.map((s) => `<span class="history-seat" data-cast="${esc(s.id)}">${mark(s.name, s.hue, s.id, brandFor(s))}<span><b>${esc(s.name)}</b>${titleLine(s)}</span></span>`).join(`<span class="x">vs</span>`)}</div>`;
}

function missedBlock(liveId) {
  const row = snap && snap.missed;
  if (!row || !row.matchId || row.matchId === liveId) return "";
  if (!row.title && !row.dek) return "";
  return `<section class="section"><h2>You missed this</h2><button class="rowbtn lda-card lda-match story-card" type="button" data-match="${esc(row.matchId)}">${castLine(row.seats)}${storyMarkup(row)}</button></section>`;
}

function lastWinnerName(aId, bId) {
  for (const row of history) {
    const ids = (row.seats || []).map((s) => s.id);
    if (ids.includes(aId) && ids.includes(bId) && row.winnerName) return row.winnerName;
  }
  return "";
}

function rivalryBlock(rows) {
  const rival = rows && rows[0];
  if (!rival || !rival.a || !rival.b) return "";
  const last = lastWinnerName(rival.a.id, rival.b.id);
  return `<section class="section"><h2>Rivalry</h2>
    <button class="rivalry-card rowbtn" type="button" data-agent="${esc(rival.a.id)}" aria-label="${esc(rival.a.name)} versus ${esc(rival.b.name)}. Series ${esc(rival.series)}. ${rival.meetings} meetings.">
      <span class="rivalry-card__body">
        ${matchupSide(rival.a, "left", "rival")}
        <span class="x matchup-hero__vs"><span>VS</span></span>
        ${matchupSide(rival.b, "right", "rival")}
      </span>
      <span class="rivalry-card__score">${esc(rival.series || "")}</span>
      <span class="kicker">Head to head</span>
      <span class="fine">${rival.meetings} meetings${last ? ` · Last winner: ${esc(last)}` : ""}</span>
    </button>
  </section>`;
}

function momentRows() {
  const rows = [];
  const seen = new Set();
  const push = (row) => {
    if (!row || !row.title || !row.matchId || seen.has(row.matchId)) return;
    seen.add(row.matchId);
    rows.push(row);
  };
  for (const row of history) push(row);
  if (snap && snap.missed) push(snap.missed);
  return rows.slice(0, 3);
}

function momentsBlock() {
  const rows = momentRows();
  if (!rows.length) return "";
  const cards = rows.map((row) => `<button class="moment-card rowbtn lda-card" type="button" data-match="${esc(row.matchId)}">
      ${castLine(row.seats)}
      <b class="moment-card__headline">${esc(row.title)}</b>
      ${row.dek ? `<div class="fine">${esc(row.dek)}</div>` : ""}
      <span class="moment-card__watch">Watch replay</span>
    </button>`).join("");
  return `<section class="section"><h2>Recent moments</h2>${cards}</section>`;
}

function trendingBlock(hot) {
  if (!hot || !hot.agentId) return "";
  const known = agents.find((a) => a.id === hot.agentId);
  const person = { id: hot.agentId, name: hot.name, brand: hot.brand, record: known && known.record };
  return `<section class="section"><h2>Trending</h2>
    <button class="rowbtn trending-card" type="button" data-agent="${esc(hot.agentId)}" data-cast="${esc(hot.agentId)}"${brandStyle(person)}>
      <span class="portrait-plate portrait-plate--roster">${facePlate(person, 96)}</span>
      <span><b>${esc(hot.name)}</b>${titleLine(person)}</span>
      <div class="fine">${esc(hot.text || "")}${person.record ? ` · ${esc(person.record)}` : ""}</div>
    </button>
  </section>`;
}

function arena() {
  const m = live();
  if (!m) return arenaIdle() + momentsBlock() + rivalryBlock(snap && snap.rivalries) + missedBlock(null);
  const [a, b] = m.seats;
  const open = m.phase === "pick";
  const hot = snap.hot;
  const fresh = (snap.fresh || [])[0];
  const reads = snap.yourReads || [];
  const watching = Number(snap.watching) || 0;
  const eye = watching > 0 ? ` · ${watching} watching` : "";
  const intro = frameBeats.some((beat) => beat.type === "intro" || beat.type === "start") ? " intro" : "";
  const final = m.phase === "settled";
  const liveLabel = (final ? "Final" : open ? "Up next" : "Live now") + eye;
  const card = ui() ? ui().cardClass("match") : "lda-card lda-match";
  const watchLabel = open ? "Watch & pick" : final ? "See the result" : "Watch live";
  const cta = ui()
    ? ui().button({ text: watchLabel, extra: "cta matchup-hero__watch", data: { go: "watch" } })
    : `<button class="cta matchup-hero__watch" type="button" data-go="watch">${watchLabel}</button>`;
  const narrativeLine = (m.narrative && m.narrative.line) || "";
  const prompt = open ? (narrativeLine || "Who's got this?") : "";
  const nowLine = !open && narrativeLine ? narrativeLine : "";
  const stateLabel = m.phase === "live" ? `Round ${m.round || 1}` : final ? "Final" : "Picks are open";
  const status = final ? "Final" : open ? "● Up next" : "● Live";
  const winnerId = final && m.oracle && m.oracle.winnerId ? m.oracle.winnerId : "";
  const heroState = (person) => (!winnerId || !person ? "idle" : (person.id === winnerId ? "winner" : "loser"));
  return `
    <article class="live-card hero-match-card matchup-hero ${card}${intro}" aria-label="${esc(`${liveLabel}. ${a.name} versus ${b.name}. ${prompt || nowLine || stateLabel}`)}"${heroThemeAttr(a, b)}>
      <div class="matchup-hero__status hero-match-card__status">${esc(status)}</div>
      <div class="matchup-hero__body vs hero-match-card__agents">
        ${matchupSide(a, "left", "hero", heroState(a))}
        <div class="x matchup-hero__vs hero-match-card__vs"><span>VS</span></div>
        ${matchupSide(b, "right", "hero", heroState(b))}
      </div>
      ${prompt ? `<h1 class="arena-prompt">${esc(prompt)}</h1>` : ""}
      ${nowLine ? `<p class="arena-now">${esc(nowLine)}</p>` : ""}
      <div class="status">${esc(stateLabel)}</div>
      ${cta}
      ${noPicksYet() ? `<p class="first-run">No test position yet. YES or NO, in Arena Credits. They are not cash.</p>` : ""}
    </article>
    ${upcomingBlock()}
    ${trendingBlock(hot)}
    ${momentsBlock()}
    ${rivalryBlock(snap.rivalries)}
    ${missedBlock(m.matchId)}
    ${fresh ? `<section class="section"><h2>New</h2><button class="rowbtn" type="button" data-agent="${esc(fresh.id)}" data-cast="${esc(fresh.id)}">${mark(fresh.name, null, fresh.id, fresh.brand)}<span><b>Meet ${esc(fresh.name)}</b>${titleLine(fresh)}</span><div class="fine">${esc(personTitle(fresh) || fresh.archetype)}. First match is this one.</div></button></section>` : ""}
    ${reads.length ? `<section class="section"><h2>Your reads</h2>${reads.map((r) => `<button class="rowbtn" type="button" data-agent="${esc(r.id)}" data-cast="${esc(r.id)}">${mark(r.name, null, r.id, r.brand)}<span><b>${esc(r.name)}</b>${titleLine(r)}</span><div class="fine">${r.correct} / ${r.picks} picks right</div></button>`).join("")}</section>` : ""}
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
        <div class="vs matchup-hero__body">
          ${matchupSide(a, "left", "next")}
          <div class="x matchup-hero__vs"><span>VS</span></div>
          ${matchupSide(b, "right", "next")}
        </div>
        <p class="fine">${picked}</p>
        ${buttons}
      </article>`;
  }).join("");
  return `<section class="section"><h2>Up next</h2><div class="slate">${cards}</div></section>`;
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
    const propAgent = (m.seats || []).find((s) => s.id === prop.targetAgentId) || null;
    return `<article class="prop-card ${shell}${settled ? " settled" : ""}"${propAgent ? ` data-cast="${esc(propAgent.id)}"` : ""}>
      <div class="prop-head"><span>${esc(prop.eyebrow || "Match prop")}</span>${result}</div>
      ${marketIdentity(propAgent)}
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
    <article class="winner-market ${shell}" data-cast="${esc(target.id)}">
      <div class="prop-head"><span>Match winner</span>${winnerResult}</div>
      ${marketIdentity(target)}
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
      <section class="trade-sheet lda-card" role="dialog" aria-modal="true" aria-label="Test market trade" data-trade-dialog="1" tabindex="-1">
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
  const faces = `<div class="picker-matchup" ${heroThemeAttr(m.seats[0], m.seats[1])}>${matchupSide(m.seats[0], "left", "next")}<div class="x matchup-hero__vs"><span>VS</span></div>${matchupSide(m.seats[1], "right", "next")}</div>`;
  if (snap && snap.testMarkets === false) {
    return `
      <div class="picker${intro}">
        ${faces}
        <div class="kicker lda-kicker-predict">Who wins?</div>
        <h1>${esc(target.name)} vs ${esc(m.seats[1].name)}</h1>
        <p class="fine">Test markets are off. The match still runs.</p>
      </div>`;
  }
  return `
    <div class="picker market-picker${intro}">
      ${faces}
      <div class="kicker lda-kicker-predict">Test market</div>
      <p class="fine">Trade the winner or a match prop before the dice hit the table. Every position uses Arena Credits. They are not cash.</p>
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

function seatClass(seat, m, beats, stage, activeId) {
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
  const active = !!(activeId && seat.id === activeId);
  const stageCls = active && stage ? `stage-${stage}` : "";
  const turn = activeId ? ((active || hot) ? "is-active" : "is-inactive") : "";
  return ["who", "seat", "watch-agent", hot && "hot", marked && "marked", cool && "cool", out && "out", loss && "hit", active && "active", turn, stageCls].filter(Boolean).join(" ");
}

function stageLabel(seat, stage, activeId) {
  if (!activeId || activeId !== seat.id) return seat.alive === false ? "ELIMINATED" : "IN THE ARENA";
  if (stage === "roll") return "ROLLING";
  if (stage === "thinking") return "THINKING";
  if (stage === "announce") return "ANNOUNCING";
  if (stage === "call") return "CALLS LIAR";
  if (stage === "reveal") return "REVEAL";
  if (stage === "result") return "WINNER";
  return "ACTIVE";
}

function stageIcon(stage) {
  if (stage === "roll") return "◈";
  if (stage === "thinking") return "···";
  if (stage === "call") return "!";
  if (stage === "reveal") return "✦";
  return "";
}

function stageReadout(stage, m) {
  const active = (m.seats || []).find((seat) => seat.id === (m.activeAgentId || (m.thinking && m.thinking.agentId)));
  if (stage === "roll") return "ROLLING DICE";
  if (stage === "thinking" && active) return `${active.name.toUpperCase()} THINKING`;
  if (stage === "announce") return "BID ANNOUNCED";
  if (stage === "call") return "CHALLENGE";
  if (stage === "reveal") return "DICE REVEAL";
  if (stage === "result") return "FINAL";
  return "LIVE MATCH";
}

function diceFor(seat, m, beats, frame) {
  const loss = beats.find((b) => b.type === "lose-die" && b.id === seat.id);
  const reveal = m.reveal && m.reveal.find((r) => r.id === seat.id);
  // Hidden trays show counts. Faces appear only after the engine reveal.
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

function seatBlock(seat, m, beats, frame, stage, activeId, animatePfp) {
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
  const rolling = stage === "roll" || (frame ? !!frame.roll : beats.some((b) => b.type === "roll" || b.type === "start"));
  const thinking = stage === "thinking" && activeId === seat.id;
  const status = stageLabel(seat, stage, activeId);
  const brand = brandFor(seat);
  const mood = thinking || react === "thinking"
    ? "is-thinking"
    : react === "victory"
      ? "is-winner"
      : (react === "confident" || react === "successful-bluff" || react === "successful-call")
        ? "is-confident"
        : (react === "failed-bluff" || react === "failed-call" || react === "defeat")
          ? "is-under-pressure"
          : "";
  const motion = brand && brand.motionLanguage ? ` data-motion="${esc(brand.motionLanguage)}"` : "";
  const hue = Number(seat.hue);
  const tone = Number.isFinite(hue) ? hue : 40;
  const accent = HOUSE_CAST.has(seat.id) ? "" : ` style="--agent-accent:hsl(${tone} 42% 58%)"`;
  const seated = seatClass(seat, m, beats, frame, stage, activeId).split(" ");
  const onTurn = seated.includes("active") || seated.includes("hot");
  const pfpState = react === "victory" ? "winner"
    : (react === "defeat" || seat.alive === false) ? "loser"
      : thinking ? "thinking"
        : (onTurn ? "activeTurn" : "idle");
  const portrait = animatePfp
    ? facePlate(seat, 320, { animate: true, context: "watch", state: pfpState })
    : facePlate(seat, 320);
  return `<div class="${seated.join(" ")} arena-seat" data-react="${esc(react)}" data-cast="${esc(seat.id)}"${motion}${accent}>
    <div class="agent-portrait-wrap watch-agent__pfp agent-face ${mood}">
      <div class="agent-aura" aria-hidden="true"></div>
      ${portrait}
      ${thinking ? `<div class="thought-orbit" aria-hidden="true"><i></i><i></i><i></i></div>` : ""}
    </div>
    <div class="agent-copy seat-copy">
      <b>${esc(seat.name)}</b>
      ${titleLine(seat)}
      ${seat.record ? `<span class="seat-record">${esc(seat.record)}</span>` : ""}
      <span class="agent-status">${esc(status)}</span>
      <span class="dice-count">${esc(diceLabel)}</span>
      ${label ? `<i class="react">${esc(label)}</i>` : ""}
    </div>
    <div class="dice-tray${rolling ? " rolling" : ""}">
      <div class="dice-row${rolling ? " shake" : ""}">${diceFor(seat, m, beats, frame)}</div>
    </div>
  </div>`;
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
  if (!m.reveal || !m.reveal.length) return "";
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
  const animateSeats = !opts || opts.animatePfp !== false;
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
  const stage = api && api.broadcastStage ? api.broadcastStage(shownState) : (shownState === "THINKING" ? "thinking" : shownState === "CALL" ? "call" : shownState === "ROLLING" ? "roll" : "live");
  const activeId = m.activeAgentId || pres.actorId || (m.thinking && m.thinking.agentId) || null;
  const whoNow = pres.state === "THINKING" && m.thinking
    ? `<b>${esc(m.thinking.name)}</b> to act`
    : pres.state === "CALL" && m.bid && m.bid.callerName
      ? `<b>${esc(m.bid.callerName)}</b> calls`
      : pres.state === "BIDDING" && m.bid && m.bid.name
        ? `<b>${esc(m.bid.name)}</b> bid`
        : shownState === "REVEAL" || shownState === "ROUND_RESULT"
          ? "Dice are up"
          : "Cups down";
  const reduced = reducedMotion();
  const flash = showLiar && !reduced ? `<div class="slam-flash" aria-hidden="true"></div>` : "";
  const liveSting = beats.some((b) => b.type === "start") ? `<div class="live-sting">LIVE</div>` : "";
  const skip = cinematic && intensity >= 4 && (pres.state === "CALL" || (m.reveal && m.reveal.length))
    ? `<button class="skip" type="button" data-skip aria-keyshortcuts="Escape">Skip</button>`
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
  const liar = showLiar ? `<div class="cinematic-overlay liar-overlay" aria-hidden="true"><div class="liar-type">LIAR</div></div>` : "";
  return `
    <section class="arena-shell table stage stage-${esc(stage)}${dim ? " dim" : ""}${showLiar ? " is-liar-event" : ""}" data-state="${esc(shownState)}" data-stage="${esc(stage)}" data-camera="${esc(camera)}" data-intensity="${intensity}" data-reduced="${reduced ? "1" : "0"}">
      ${flash}
      ${liar}
      <div class="broadcast-strip stage-bar">
        ${ui() ? ui().liveBadge(m.phase === "settled" ? "Final" : "Live", { final: m.phase === "settled" }) : `<span class="live-pill kicker"><i class="dot"></i> ${m.phase === "settled" ? "Final" : "Live"}</span>`}
        <span>Round ${m.round || 1} · ${score}</span>
        <span class="stage-readout">${esc(stageReadout(stage, m))}</span>
        ${skip}
      </div>
      <div class="arena-surface">
        ${liveSting}
        <div class="who-now">${whoNow}</div>
        <div class="vs arena-seats">
          ${seatBlock(a, m, beats, frame, stage, activeId, animateSeats)}
          <div class="center-table">
            <div class="round-orb"><span>${m.phase === "settled" ? "FINAL" : "R" + (m.round || 1)}</span><small>${stageIcon(stage)}</small></div>
            <div class="table-ring" aria-hidden="true"></div>
          </div>
          ${seatBlock(b, m, beats, frame, stage, activeId, animateSeats)}
        </div>
        <div class="center-action felt" data-primary="${esc((frame && frame.primary) || pres.focus || "bid")}">
          <span class="pressure" aria-label="Intensity ${intensity} of 5${pressure ? ", " + esc(pressure) : ""}"><span class="pips">${pips}</span> ${esc(pressure)}</span>
          ${pres.state === "THINKING" && m.thinking ? `<div class="think-line">${esc(m.thinking.name)} is thinking…</div>` : ""}
          ${words ? `<div class="bid-banner bidchip${quietBid ? " quiet" : ""}${punch ? " pop" : ""}${showLiar ? " liar slam" : ""}"><div class="bid-words qty">${esc(showLiar ? "LIAR" : words)}</div>${sub ? `<div class="bid-by by">${esc(sub)}</div>` : ""}</div>` : `<div class="bid-banner bidchip quiet"><div class="bid-words qty">CUPS DOWN</div></div>`}
          ${centerDice(m, beats, frame)}
          ${countHtml}
          ${verdictHtml}
          ${resultHtml}
          ${n.aside ? `<div class="aside">${esc(n.aside)}</div>` : ""}
          <div class="line${showVerdict && n.line && n.line === n.headline ? " sr" : ""}" aria-live="polite">${esc(n.line || "")}</div>
        </div>
        ${hint ? `<div class="next-hint">${esc(hint)}</div>` : ""}
        ${feed ? `<ol class="feed">${feed}</ol>` : ""}
        ${bookBar(m, beats)}
        ${showYou ? youBlock(m, beats) : ""}
      </div>
    </section>`;
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
    const brand = brandFor(seat);
    return `<div class="arena-seat" data-react="${esc(react)}" data-cast="${esc(seat.id)}">${mark(seat.name, seat.hue, seat.id, brand)}<div class="seat-copy"><b>${esc(seat.name)}</b>${titleLine(seat)}${label ? `<i class="react">${esc(label)}</i>` : ""}</div></div>`;
  }).join("");
  return `
    <div class="payoff stage-result ${ui() ? ui().cardClass("result") : "lda-card lda-result"}${settle ? " sting" : ""}" data-stage="result">
      <div class="broadcast-strip"><span>Final</span><span>Result</span><span class="stage-readout">MATCH RESULT</span></div>
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

function watchStage() {
  const m = live();
  if (!m) {
    if (showState.link === "boot") return emptyState("Connecting", "Taking you to the table", "The dice show up here as soon as the show answers.");
    if (showState.link === "down") return emptyState("Reconnecting", "The table will be right back", "Still reaching the show. Your last frame stays up when we have one.");
    return emptyState("Between matches", "Nothing on the table", "The next match opens in a moment. Arena lists what's coming.");
  }
  if (flash) return `<div class="flash lda-success" role="status"><div class="kicker">Locked in</div><h1>You picked ${esc(flash)}</h1><p class="fine">Dice are coming.</p></div>`;
  if (m.phase === "settled") return payoff();
  if (m.phase === "pick") return picker();
  return watchTable();
}

function watchMarket() {
  const m = live();
  if (!m || flash) return "";
  if (snap && snap.testMarkets === false) return "";
  if (m.phase === "pick" || m.phase === "live" || m.phase === "settled") return marketPanel(m, { compact: m.phase !== "pick" });
  return "";
}

const CREATOR_ARCHETYPES = [
  "GAMBLER", "STRATEGIST", "EMPEROR", "TRICKSTER", "REAPER", "ORACLE",
  "BEAST", "MACHINE", "DUELIST", "WARLORD", "NOBLE", "MADMAN", "JUDGE",
  "PHANTOM", "ALCHEMIST", "ASSASSIN", "MONK", "PIRATE", "SORCERER", "COMMANDER",
];

function archetypeLabel(id) {
  const text = String(id || "").toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

const CREATOR_BEATS = [
  "Building personality...",
  "Choosing visual DNA...",
  "Designing silhouette...",
  "Creating your portraits...",
  "Checking roster uniqueness...",
];

function creatorSession() {
  return !!(creator && tab === "agents");
}

function sameArchetypeList(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || (a[i].label || "") !== (b[i].label || "")) return false;
  }
  return true;
}

function stopCreatorBeat() {
  if (creatorBeat) clearInterval(creatorBeat);
  creatorBeat = null;
  if (creator) creator.statusLabel = "";
}

function startCreatorBeat() {
  stopCreatorBeat();
  let i = 0;
  if (creator) creator.statusLabel = CREATOR_BEATS[0];
  creatorBeat = setInterval(() => {
    if (!creator || !creator.busy) return stopCreatorBeat();
    i = (i + 1) % CREATOR_BEATS.length;
    creator.statusLabel = CREATOR_BEATS[i];
    painted = "";
    render();
  }, 700);
}

function blankCreator() {
  return {
    step: 1,
    busy: false,
    error: "",
    statusLabel: "",
    moreTraits: false,
    reveal: null,
    archetypes: CREATOR_ARCHETYPES.map((id) => ({ id, label: archetypeLabel(id) })),
    form: {
      name: "",
      shortDescription: "",
      archetype: "GAMBLER",
      aggression: 0.55,
      bluffing: 0.5,
      discipline: 0.5,
      chaos: 0.35,
      confidence: 0.6,
      patience: 0.5,
      showmanship: 0.5,
      calculation: 0.55,
      riskTolerance: 0.5,
      adaptability: 0.5,
      visualDirection: "",
      refine: "",
    },
    draft: null,
    concepts: [],
    selectedId: null,
    selections: defaultVisualSelections(),
  };
}

const VISUAL_GROUPS = [
  ["archetype", "Archetype", ["executive", "street", "athlete", "celebrity", "tech", "criminal", "antihero", "comedian", "animal", "primal", "robot_ai", "experimental"]],
  ["bodyType", "Body type", ["male_lean", "male_muscular", "female_lean", "female_athletic", "androgynous", "heavy_set", "elder", "young_adult", "non_human", "full_robot", "skeletal_synthetic"]],
  ["expression", "Expression", ["calm", "confident", "aggressive", "playful", "mysterious", "intense", "intellectual", "laid_back", "cocky", "serious", "unhinged"]],
  ["attire", "Attire", ["formal", "casual", "streetwear", "sports", "tactical", "luxury", "business", "hood_mask", "performance_costume", "cyber_gear", "minimal"]],
  ["colorPalette", "Color palette", ["red", "blue", "purple", "pink", "green", "orange", "gold", "cyan", "yellow", "monochrome", "multi"]],
  ["background", "Background", ["city_night", "underground", "club", "casino", "studio", "tech_lab", "vault", "arena", "space", "abstract", "custom"]],
  ["accessories", "Accessories", ["glasses", "hat_cap", "mask", "headphones", "smoke", "jewelry", "scar_tattoo", "pet", "prop", "unique_fx", "none"]],
];

function defaultVisualSelections() {
  return {
    archetype: "executive",
    bodyType: "male_lean",
    expression: "confident",
    attire: "formal",
    colorPalette: "cyan",
    background: "abstract",
    accessories: "none",
    skinTone: "auto",
    hairStyle: "auto",
    hairColor: "auto",
    eyes: "auto",
    facialHair: "auto",
    headwear: "auto",
    pose: "auto",
    fx: "none",
  };
}

// Live option catalogue from the server (falls back to VISUAL_GROUPS until it loads).
let liveVisualGroups = null;   // [{ id, label, section, options:[{id,label,preview}] }]
let liveVisualSections = null; // [{ id, label, groups:[...] }]
async function loadVisualOptions() {
  try {
    const j = await api("/api/show/agents/brand/options");
    if (j && Array.isArray(j.visualOptions) && j.visualOptions.length) { liveVisualGroups = j.visualOptions; liveVisualSections = Array.isArray(j.visualSections) ? j.visualSections : null; }
  } catch { /* keep fallback */ }
}
loadVisualOptions();

function optionLabel(id) {
  return String(id || "").replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function visualGroupList() {
  if (liveVisualGroups) return liveVisualGroups.map((g) => [g.id, g.label, g.options.map((o) => o.id), g.section || "identity"]);
  return VISUAL_GROUPS.map(([id, label, ids]) => [id, label, ids, "identity"]);
}

function visualGroupHtml(group, label, ids, current) {
  return `<section class="visual-group">
      <h2>${esc(label)}</h2>
      <div class="agent-visual-options">${ids.map((id) => {
        const on = (current[group] || (id === "auto" || id === "none" ? id : "")) === id;
        const src = `/assets/agent-creation-previews/${group}/${id}.svg`;
        return `<button class="option-card${on ? " is-selected" : ""}" type="button" data-opt-group="${esc(group)}" data-opt-id="${esc(id)}" aria-pressed="${on ? "true" : "false"}">
          <img src="${esc(src)}" alt="" width="96" height="96" loading="lazy">
          <span>${esc(optionLabel(id))}</span>
        </button>`;
      }).join("")}</div>
    </section>`;
}

function visualOptionGrids(selections) {
  const current = { ...defaultVisualSelections(), ...(selections || {}) };
  const groups = visualGroupList();
  const sections = liveVisualSections || [{ id: "identity", label: "Identity", groups: groups.map((g) => g[0]) }];
  const byId = Object.fromEntries(groups.map((g) => [g[0], g]));
  const placed = new Set();
  const html = sections.map((sec, i) => {
    const inner = (sec.groups || []).map((gid) => { const g = byId[gid]; if (!g) return ""; placed.add(gid); return visualGroupHtml(g[0], g[1], g[2], current); }).join("");
    if (!inner) return "";
    const chosen = (sec.groups || []).filter((gid) => current[gid] && current[gid] !== "auto" && current[gid] !== "none" && byId[gid]).length;
    return `<details class="visual-section"${i < 2 ? " open" : ""}><summary><b>${esc(sec.label)}</b> <span class="fine">${chosen ? chosen + " set" : "defaults"}</span></summary>${inner}</details>`;
  }).join("");
  const rest = groups.filter((g) => !placed.has(g[0])).map((g) => visualGroupHtml(g[0], g[1], g[2], current)).join("");
  return html + rest;
}

function createAgentButton() {
  return `<button class="cta lda-btn lda-btn-primary lda-btn-block" type="button" data-create-agent="1">Create agent</button>`;
}

function sliderField(key, label) {
  const value = Math.round(Number(creator.form[key] || 0) * 100);
  return `<label>${esc(label)} <output>${value}</output><input type="range" name="${esc(key)}" min="0" max="100" value="${value}"></label>`;
}

function safeSvg(svg) {
  const text = String(svg || "");
  if (!/^<svg\b/i.test(text) || /script|foreignObject|on\w+=/i.test(text)) return "";
  return text;
}

let argusOffer = { enabled: false };

function syncLaunchFromDom() {
  if (!creator || !creator.launch) return;
  const root = matchEl && matchEl.querySelector(".creator");
  if (!root) return;
  root.querySelectorAll("[data-launch]").forEach((el) => {
    creator.launch[el.name] = el.value;
  });
}

function takenArgusTickers() {
  return (agents || []).map((row) => row.argus && row.argus.symbol).filter(Boolean);
}

function argusAgentId() {
  return (creator.reveal && creator.reveal.agentId) || (creator.draft && creator.draft.agent && creator.draft.agent.id) || "";
}

async function loadArgusConfig() {
  if (!creator) return;
  try {
    const cfg = await api("/api/show/argus/config");
    if (!creator) return;
    creator.argusConfig = cfg && cfg.enabled ? cfg : { enabled: false, publicBase: (cfg && cfg.publicBase) || "" };
    argusOffer = cfg || argusOffer;
  } catch {
    if (creator) creator.argusConfig = { enabled: false };
  }
  if (!creator || creator.launch) return;
  const tools = window.ArgusLaunch;
  const cfg = creator.argusConfig || {};
  const canonical = creator.reveal && creator.reveal.canonicalPfp;
  try {
    if (tools && tools.suggestLaunch) {
      creator.launch = tools.suggestLaunch({
        name: creator.form.name,
        description: creator.form.shortDescription,
        agentId: argusAgentId(),
        publicBase: cfg.publicBase,
        takenTickers: takenArgusTickers(),
        canonicalPfp: canonical,
      });
    } else {
      creator.launch = { launchName: creator.form.name || "" };
    }
  } catch {
    if (creator && !creator.launch) creator.launch = { launchName: creator.form.name || "" };
  }
}

function argusField(name, label, value, extra) {
  const type = (extra && extra.type) || "text";
  const attrs = extra && extra.attrs ? extra.attrs : "";
  return `<label>${esc(label)}<input data-launch="1" type="${esc(type)}" name="${esc(name)}" value="${esc(value || "")}" ${attrs}></label>`;
}

function argusWalletReady(form) {
  return !!((form && form.wallet) || (window.ArgusMint && window.ArgusMint.hasWallet && window.ArgusMint.hasWallet()));
}

function argusLaunchButtons(cfg, form) {
  const busy = creator.busy ? " disabled" : "";
  const walletReady = argusWalletReady(form);
  const signing = creator.busy && creator.launchMode === "wallet";
  const sponsoring = creator.busy && creator.launchMode === "sponsor";
  const connect = `<button class="ghost lda-btn lda-btn-ghost lda-btn-block" type="button" data-argus-connect="1"${busy}>Connect wallet</button>`;
  const signClass = !cfg.sponsored || walletReady ? "cta lda-btn lda-btn-primary lda-btn-block" : "ghost lda-btn lda-btn-ghost lda-btn-block";
  const sign = `<button class="${signClass}" type="button" data-argus-launch="1"${busy}>${signing ? "Launching…" : "Sign create on Arc"}</button>`;
  if (!cfg.sponsored) return connect + sign;
  const sponsorClass = walletReady ? "ghost lda-btn lda-btn-ghost lda-btn-block" : "cta lda-btn lda-btn-primary lda-btn-block";
  const sponsor = `<button class="${sponsorClass}" type="button" data-argus-sponsor="1"${busy}>${sponsoring ? "Launching…" : "Launch with server mint"}</button>`;
  return walletReady ? connect + sign + sponsor : sponsor + connect + sign;
}

function argusPanel() {
  if (!creator) return "";
  const cfg = creator.argusConfig || { enabled: false };
  const minted = creator.launch && creator.launch.minted;
  if (minted && minted.argusUrl) {
    return `<section class="argus-launch">
      <h2>Launched on Argus</h2>
      <p class="fine">${esc(minted.symbol || "Token")} · ${esc(minted.tokenAddress || "")}</p>
      ${minted.creatorWallet ? `<p class="fine">On-chain creator ${esc(minted.creatorWallet)}</p>` : ""}
      <a class="cta lda-btn lda-btn-primary lda-btn-block" href="${esc(minted.argusUrl)}" target="_blank" rel="noopener">Buy on Argus</a>
      <p class="fine">Opens argus.world. This app does not swap.</p>
    </section>`;
  }
  if (!cfg.enabled) {
    return `<section class="argus-launch">
      <h2>Launch on Argus</h2>
      <p class="fine">Coming soon. This agent is saved and can play without a token.</p>
    </section>`;
  }
  const f = creator.launch || {};
  const wallet = f.wallet ? `Connected ${f.wallet.slice(0, 6)}…${f.wallet.slice(-4)}` : "Wallet not connected";
  const sponsorNote = cfg.sponsored && cfg.mintWallet
    ? `No wallet? Launch with server mint submits this same Portal #7 transaction. The on-chain creator will be ${cfg.mintWallet}, the server mint wallet. The creator share (100% with the defaults) accrues to that address, not to your spectator profile. This app does not hold your funds.`
    : (cfg.sponsoredMessage || "");
  const pending = f.pendingTx ? `<p class="fine">Submitted ${esc(f.pendingTx)}. If the wallet already shows that transaction, check again before creating another token.</p>
      <button class="ghost lda-btn lda-btn-ghost lda-btn-block" type="button" data-argus-check="1"${creator.busy ? " disabled" : ""}>Check again</button>` : "";
  return `<section class="argus-launch">
    <h2>Launch on Argus</h2>
    <p class="fine">Portal #7 on Arc (chain 5042). A connected wallet is preferred: you sign the create, and that wallet is the on-chain creator. Defaults: 5% buy tax, 5% sell tax, 100% to the creator, no dev buy, 2,500 USDC opening value, 45,000 USDC bond, 1 billion supply. If the launch fails, this agent still plays.</p>
    ${sponsorNote ? `<p class="fine">${esc(sponsorNote)}</p>` : ""}
    <p class="fine">${esc(wallet)}</p>
    ${f.status ? `<p class="fine" role="status">${esc(f.status)}</p>` : ""}
    ${argusField("launchName", "Token name", f.launchName, { attrs: 'maxlength="32" autocomplete="off"' })}
    ${argusField("launchTicker", "Ticker", f.launchTicker, { attrs: 'maxlength="10" autocapitalize="characters" autocomplete="off"' })}
    ${argusField("launchImage", "Image URL", f.launchImage, { type: "url" })}
    ${argusField("launchWebsite", "Website", f.launchWebsite, { type: "url" })}
    <label>Description<textarea data-launch="1" name="launchDescription" maxlength="280">${esc(f.launchDescription || "")}</textarea></label>
    <div class="argus-split">
      ${argusField("launchX", "X", f.launchX)}
      ${argusField("launchTelegram", "Telegram", f.launchTelegram)}
    </div>
    <details class="advanced-config">
      <summary>Tax, allocation, and value</summary>
      <div class="advanced-config__body">
        <div class="argus-split">
          ${argusField("launchBuy", "Buy tax %", f.launchBuy, { type: "number", attrs: 'min="1" max="10" step="1"' })}
          ${argusField("launchSell", "Sell tax %", f.launchSell, { type: "number", attrs: 'min="1" max="10" step="1"' })}
        </div>
        <div class="argus-split">
          ${argusField("launchCreator", "Creator %", f.launchCreator, { type: "number", attrs: 'min="0" max="100" step="1"' })}
          ${argusField("launchBurn", "Burn %", f.launchBurn, { type: "number", attrs: 'min="0" max="100" step="1"' })}
          ${argusField("launchDividends", "Dividends %", f.launchDividends, { type: "number", attrs: 'min="0" max="100" step="1"' })}
          ${argusField("launchLiquidity", "Liquidity %", f.launchLiquidity, { type: "number", attrs: 'min="0" max="100" step="1"' })}
        </div>
        ${argusField("launchDevBuy", "Dev buy (USDC)", f.launchDevBuy, { type: "number", attrs: 'min="0" max="1000000" step="any"' })}
        <div class="argus-split">
          ${argusField("launchStartFdv", "Opening FDV (USDC)", f.launchStartFdv, { type: "number", attrs: 'min="1" step="1"' })}
          ${argusField("launchBondFdv", "Bond FDV (USDC)", f.launchBondFdv, { type: "number", attrs: 'min="1" step="1"' })}
        </div>
        ${argusField("launchSupply", "Supply (tokens)", f.launchSupply, { type: "number", attrs: 'min="1" step="1"' })}
        <p class="fine">Taxes and the allocation are permanent. The four allocation fields must total 100%. A dev buy above zero spends USDC from the creator wallet. Server mint only submits a dev buy of zero.</p>
      </div>
    </details>
    ${pending}
    ${argusLaunchButtons(cfg, f)}
  </section>`;
}

function argusDetail(agent) {
  if (!agent || agent.roster !== "user") return "";
  if (agent.argus && agent.argus.argusUrl) {
    return `<section class="argus-launch">
      <h2>Argus token</h2>
      <p class="fine">${esc(agent.argus.symbol || "Token")} · ${esc(agent.argus.tokenAddress || "")}</p>
      ${agent.argus.creatorWallet ? `<p class="fine">On-chain creator ${esc(agent.argus.creatorWallet)}</p>` : ""}
      <a class="cta lda-btn lda-btn-primary lda-btn-block" href="${esc(agent.argus.argusUrl)}" target="_blank" rel="noopener">Buy on Argus</a>
      <p class="fine">Opens argus.world. This app does not swap.</p>
    </section>`;
  }
  if (!argusOffer.enabled || !agent.playable) return "";
  const offer = argusOffer.sponsored
    ? "This agent has no token yet. A connected wallet is preferred. Server mint is there if you have no wallet, and that mint wallet is the on-chain creator. Launching does not change how they play."
    : "This agent has no token yet. Launching is a wallet signature on Arc and does not change how they play.";
  return `<section class="argus-launch">
    <h2>Launch on Argus</h2>
    <p class="fine">${esc(offer)}</p>
    ${argusOffer.sponsoredMessage ? `<p class="fine">${esc(argusOffer.sponsoredMessage)}</p>` : ""}
    <button class="cta lda-btn lda-btn-primary lda-btn-block" type="button" data-argus-for="1">Launch on Argus</button>
  </section>`;
}

async function connectArgus() {
  if (!creator || creator.busy) return;
  syncLaunchFromDom();
  creator.busy = true;
  creator.launchMode = "connect";
  creator.error = "";
  painted = "";
  render();
  try {
    if (!window.ArgusMint) throw new Error("Launch tools did not load. The agent is still saved.");
    const wallet = await window.ArgusMint.connect();
    if (creator && creator.launch) creator.launch.wallet = wallet;
  } catch (ex) {
    if (creator) creator.error = ex.publicMessage || ex.message || "Could not connect the wallet. The agent is still saved.";
  } finally {
    if (creator) {
      creator.busy = false;
      creator.launchMode = "";
      painted = "";
      render();
    }
  }
}

async function saveArgusTx(id, txHash) {
  const saved = await api("/api/show/agents/" + encodeURIComponent(id) + "/argus", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txHash }),
  });
  if (creator && creator.launch) {
    creator.launch.minted = saved.argus;
    creator.launch.pendingTx = "";
    creator.launch.status = "";
  }
  await refreshLists();
  return saved;
}

async function launchArgus() {
  if (!creator || creator.busy) return;
  syncLaunchFromDom();
  const cfg = creator.argusConfig || {};
  const id = argusAgentId();
  if (!cfg.enabled || !id) {
    creator.error = "Launch is not available for this agent. They can still play.";
    painted = "";
    render();
    return;
  }
  creator.busy = true;
  creator.launchMode = "wallet";
  creator.error = "";
  painted = "";
  render();
  try {
    if (!window.ArgusMint) throw new Error("Launch tools did not load. The agent is still saved.");
    const result = await window.ArgusMint.launch({
      abi: cfg.abi,
      portal: cfg.portal,
      params: creator.launch,
      receiptDelayMs: 750,
      onStatus: (text) => {
        if (!creator || !creator.launch) return;
        creator.launch.status = text;
        creator.statusLabel = text;
        painted = "";
        render();
      },
    });
    if (creator && creator.launch) creator.launch.pendingTx = result.txHash;
    try {
      await saveArgusTx(id, result.txHash);
    } catch (ex) {
      if (creator) creator.error = (ex.message || "The launch was sent, but the agent record did not update.") + " Use Check again.";
    }
  } catch (ex) {
    if (creator) {
      if (creator.launch && ex.txHash) creator.launch.pendingTx = ex.txHash;
      if (creator.launch) creator.launch.status = "";
      creator.error = ex.publicMessage || ex.message || "Launch did not finish. The agent is still saved.";
    }
  } finally {
    if (creator) {
      creator.busy = false;
      creator.launchMode = "";
      creator.statusLabel = "";
      painted = "";
      render();
    }
  }
}

async function sponsorArgus() {
  if (!creator || creator.busy) return;
  syncLaunchFromDom();
  const cfg = creator.argusConfig || {};
  const id = argusAgentId();
  if (!cfg.enabled || !id) {
    creator.error = "Launch is not available for this agent. They can still play.";
    painted = "";
    render();
    return;
  }
  if (!cfg.sponsored) {
    creator.error = cfg.sponsoredMessage || "Server mint is not set up. Connect a wallet, or leave this agent playable.";
    painted = "";
    render();
    return;
  }
  creator.busy = true;
  creator.launchMode = "sponsor";
  creator.error = "";
  if (creator.launch) creator.launch.status = "Submitting the server mint…";
  painted = "";
  render();
  try {
    const payload = Object.assign({}, creator.launch, { predictor: predictorId() });
    delete payload.minted;
    delete payload.wallet;
    delete payload.pendingTx;
    delete payload.status;
    const saved = await api("/api/show/agents/" + encodeURIComponent(id) + "/argus/sponsor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (creator && creator.launch) {
      creator.launch.minted = saved.argus;
      creator.launch.pendingTx = "";
      creator.launch.status = "";
    }
    await refreshLists();
  } catch (ex) {
    if (creator) {
      if (creator.launch && ex.txHash) creator.launch.pendingTx = ex.txHash;
      if (creator.launch) creator.launch.status = "";
      creator.error = ex.message || "Server mint did not finish. This agent can still play.";
    }
  } finally {
    if (creator) {
      creator.busy = false;
      creator.launchMode = "";
      creator.statusLabel = "";
      painted = "";
      render();
    }
  }
}

async function checkArgus() {
  if (!creator || creator.busy || !creator.launch || !creator.launch.pendingTx) return;
  const id = argusAgentId();
  creator.busy = true;
  creator.error = "";
  painted = "";
  render();
  try {
    await saveArgusTx(id, creator.launch.pendingTx);
  } catch (ex) {
    if (creator) creator.error = ex.message || "Still waiting on Arc. The agent is still saved.";
  } finally {
    if (creator) {
      creator.busy = false;
      painted = "";
      render();
    }
  }
}

function openArgusLaunch(agent) {
  if (!agent || !agent.id) return;
  creator = blankCreator();
  creator.form.name = agent.name || "";
  creator.form.shortDescription = agent.shortDescription || agent.line || "";
  creator.draft = { agent: { id: agent.id, name: agent.name, status: agent.status } };
  creator.reveal = {
    name: agent.name,
    title: agent.brand && agent.brand.title,
    tagline: agent.brand && agent.brand.tagline,
    canonicalPfp: agent.brand && (agent.brand.canonicalPfp || (agent.brand.assets && agent.brand.assets.canonicalPfp)),
    agentId: agent.id,
  };
  creator.step = 3;
  creator.argusConfig = argusOffer && argusOffer.enabled ? argusOffer : { enabled: false, publicBase: (argusOffer && argusOffer.publicBase) || "" };
  if (window.ArgusLaunch && window.ArgusLaunch.suggestLaunch) {
    creator.launch = window.ArgusLaunch.suggestLaunch({
      name: creator.form.name,
      description: creator.form.shortDescription,
      agentId: agent.id,
      publicBase: creator.argusConfig.publicBase,
      takenTickers: takenArgusTickers().filter((symbol) => symbol !== (agent.argus && agent.argus.symbol)),
      canonicalPfp: creator.reveal.canonicalPfp,
    });
  }
  focusAgent = null;
  tab = "agents";
  painted = "";
  paintTabs();
  render();
}

function creatorPayload() {
  const f = creator.form;
  return {
    name: f.name,
    shortDescription: f.shortDescription,
    archetype: f.archetype,
    visualDirection: f.visualDirection,
    creationSelections: creator.selections || defaultVisualSelections(),
    personality: {
      aggression: f.aggression,
      bluffing: f.bluffing,
      discipline: f.discipline,
      chaos: f.chaos,
      confidence: f.confidence,
      patience: f.patience,
      showmanship: f.showmanship,
      calculation: f.calculation,
      riskTolerance: f.riskTolerance,
      adaptability: f.adaptability,
    },
  };
}

function selectedConcept() {
  return (creator.concepts || []).find((c) => c.id === creator.selectedId) || creator.concepts[0] || null;
}

function creatorView() {
  const step = creator.step;
  const f = creator.form;
  const titles = ["Name and personality", "Choose their look", "Reveal"];
  const kicker = `Step ${step} of 3 · ${titles[step - 1] || "Create"}`;
  let body = "";
  if (step === 1) {
    const options = creator.archetypes.map((row) => `<option value="${esc(row.id)}"${row.id === f.archetype ? " selected" : ""}>${esc(row.label || archetypeLabel(row.id))}</option>`).join("");
    body = `
      <label>Name<input type="text" name="name" maxlength="32" value="${esc(f.name)}" autocomplete="off" placeholder="Dracula"></label>
      <label>Archetype<select name="archetype">${options}</select></label>
      <p class="fine">Persona play. The show seats them. You watch and predict with Arena Credits.</p>
      ${sliderField("aggression", "Aggression")}
      ${sliderField("bluffing", "Bluffing")}
      ${sliderField("discipline", "Discipline")}
      ${sliderField("chaos", "Chaos")}
      <label>Visual direction<textarea name="visualDirection" maxlength="160" placeholder="Elegant gothic gambler, crimson rim light.">${esc(f.visualDirection)}</textarea></label>
      <details class="advanced-config">
        <summary>Advanced / Developer Options</summary>
        <div class="advanced-config__body">
          <label>Short description<textarea name="shortDescription" maxlength="240" placeholder="A quiet closer who spends one lie and waits.">${esc(f.shortDescription)}</textarea></label>
          <button class="ghost" type="button" data-more-traits="1">${creator.moreTraits ? "Hide extra traits" : "More traits"}</button>
          ${creator.moreTraits ? `
            ${sliderField("confidence", "Confidence")}
            ${sliderField("patience", "Patience")}
            ${sliderField("showmanship", "Showmanship")}
            ${sliderField("calculation", "Calculation")}
            ${sliderField("riskTolerance", "Risk")}
            ${sliderField("adaptability", "Adaptability")}
          ` : ""}
          <p class="fine">No endpoint, API key, wallet, or funding on this flow. Custom brains and real-money seats are not part of the spectator arena.</p>
        </div>
      </details>`;
  } else if (step === 2) {
    body = `<section class="brand-options">
      <div class="brand-concepts__header">
        <span class="kicker">Character options</span>
        <h2>One portrait. These choices build it.</h2>
        <p class="fine">Previews are examples. Generate agent locks one neon-competitive identity.</p>
      </div>
      ${visualOptionGrids(creator.selections)}
      <label>Refine<textarea name="refine" maxlength="160" placeholder="Optional note. The options above decide the portrait.">${esc(f.refine)}</textarea></label>
    </section>`;
  } else {
    const reveal = creator.reveal || {};
    const c = selectedConcept();
    const visual = (c && c.visualIdentity) || {};
    const accent = hexColor(reveal.accent || visual.accentColor) || "#4AD7FF";
    const primary = hexColor(reveal.primary || visual.primaryColor) || "#101216";
    const emblem = safeSvg(reveal.emblem || (c && c.emblemSvg));
    const revealMotion = pfpRuntime()
      ? pfpRuntime().profileForBrand({
        archetype: f.archetype,
        visualIdentity: visual,
        personality: { chaos: f.chaos, showmanship: f.showmanship },
      })
      : "NEON_COMPETITIVE";
    const revealId = (creator.draft && creator.draft.agent && creator.draft.agent.id) || "";
    body = `<section class="agent-reveal" style="--agent-accent:${esc(accent)};--agent-primary:${esc(primary)}">
      <div class="agent-reveal__aura agent-reveal__glow" aria-hidden="true"></div>
      ${emblem ? `<div class="agent-reveal__emblem" aria-hidden="true">${emblem}</div>` : ""}
      <div class="agent-reveal__pfp animated-pfp" data-inline="1" data-context="reveal" data-state="reveal" data-style="neon-competitive" data-motion="${esc(revealMotion)}" data-agent="${esc(revealId)}">${(c && c.pfpUrl) ? conceptArt(c) : pfpFrame(reveal.svg || (c && c.pfpSvg))}</div>
      <div class="agent-reveal__identity agent-reveal__copy">
        <span class="agent-reveal__title">${esc(reveal.title || (c && c.title) || "")}</span>
        <h1>${esc(reveal.name || f.name)}</h1>
        <p>${esc(reveal.tagline || (c && c.tagline) || "")}</p>
      </div>
      <span class="pfp-sizes" aria-label="Small-size check">${pfpMini(reveal.svg || (c && c.pfpSvg), 48)}${pfpMini(reveal.svg || (c && c.pfpSvg), 96)}</span>
      ${argusPanel()}
      <button class="cta lda-btn lda-btn-primary lda-btn-block agent-reveal__enter" type="button" data-enter-arena="1"${creator.busy ? " disabled" : ""}>Enter the Arena</button>
      ${pfpDebugPanel({
        id: revealId,
        creationSelections: reveal.selections || creator.selections,
        brand: { version: reveal.version, styleId: "neon-competitive", assets: { canonicalPfp: reveal.canonicalPfp || "" }, animatedPfp: { manifestUrl: "" } },
        visualDirty: false,
      })}
    </section>`;
  }
  const nextLabel = step === 1 ? "Choose look" : step === 2 ? "Generate agent" : "Enter the Arena";
  const nextAttr = step === 1 ? "data-creator-next" : step === 2 ? "data-creator-generate" : "data-enter-arena";
  const working = creator.statusLabel || "Working.";
  return `<div class="creator">
    <p class="kicker">${esc(kicker)}</p>
    <h1 class="page">Create agent</h1>
    ${body}
    ${creator.busy ? `<p class="fine creator-status" role="status">${esc(working)}</p>` : ""}
    ${creator.error ? `<div class="err lda-error" role="alert">${esc(creator.error)}</div>` : ""}
    ${step === 3 ? "" : `<div class="creator-actions">
      <button class="cta lda-btn lda-btn-primary lda-btn-block" type="button" ${nextAttr}="1"${creator.busy ? " disabled" : ""}>${creator.busy ? esc(working) : nextLabel}</button>
      <button class="ghost lda-btn lda-btn-ghost lda-btn-block" type="button" data-creator-back="1"${creator.busy ? " disabled" : ""}>${step === 1 ? "Back to agents" : "Back"}</button>
    </div>`}
  </div>`;
}

async function openCreator() {
  creator = blankCreator();
  focusAgent = null;
  focusMatch = null;
  tab = "agents";
  err = "";
  painted = "";
  paintTabs();
  render();
  try {
    const j = await api("/api/show/agents/brand/options");
    if (!creator) return;
    if (Array.isArray(j.archetypes) && j.archetypes.length && !sameArchetypeList(creator.archetypes, j.archetypes)) {
      creator.archetypes = j.archetypes;
      render();
    }
  } catch { /* the fallback list still submits */ }
}

function resumeCreator(agent) {
  creator = blankCreator();
  creator.form.name = agent.name || "";
  creator.form.shortDescription = agent.shortDescription || agent.note || "";
  creator.form.archetype = agent.archetypeId || "GAMBLER";
  creator.form.visualDirection = agent.visualDirection || "";
  const personality = agent.personality || {};
  for (const key of Object.keys(creator.form)) {
    if (typeof personality[key] === "number") creator.form[key] = personality[key];
  }
  creator.draft = { agent: { id: agent.id, name: agent.name, status: agent.status } };
  creator.concepts = agent.concepts || [];
  creator.selectedId = agent.selectedConceptId || (creator.concepts[0] && creator.concepts[0].id) || null;
  creator.selections = Object.assign(defaultVisualSelections(), agent.creationSelections || {});
  creator.step = agent.status === "READY" ? 1 : 2;
  focusAgent = null;
  tab = "agents";
  painted = "";
  paintTabs();
  render();
}

function chooseLook() {
  if (!creator || creator.busy) return;
  syncCreatorFromDom();
  if (creator.form.name.trim().length < 2 || creator.form.shortDescription.trim().length < 8) {
    creator.error = "Add a name, and a short description of at least 8 characters under Advanced.";
    painted = "";
    render();
    return;
  }
  creator.error = "";
  creator.step = 2;
  painted = "";
  render();
}

async function generateAgent() {
  if (!creator || creator.busy) return;
  syncCreatorFromDom();
  if (creator.form.name.trim().length < 2 || creator.form.shortDescription.trim().length < 8) {
    creator.error = "Add a name, and a short description of at least 8 characters under Advanced.";
    creator.step = 1;
    painted = "";
    render();
    return;
  }
  creator.busy = true;
  creator.error = "";
  startCreatorBeat();
  painted = "";
  render();
  try {
    if (!creator.draft) {
      const created = await api("/api/show/agents/brand/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(creatorPayload()),
      });
      creator.draft = created;
    }
    const id = creator.draft.agent.id;
    const generated = await api("/api/show/agents/" + encodeURIComponent(id) + "/brand/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creationSelections: creator.selections || defaultVisualSelections() }),
    });
    const brand = generated.brand || {};
    const visual = brand.visualIdentity || {};
    creator.reveal = {
      name: creator.form.name,
      title: brand.title,
      tagline: brand.tagline,
      svg: generated.svg,
      emblem: "",
      accent: visual.accentColor,
      primary: visual.primaryColor,
      version: brand.version,
      canonicalPfp: brand.assets && brand.assets.canonicalPfp,
      selections: generated.creationSelections || creator.selections,
      agentId: id,
    };
    creator.step = 3;
    await refreshLists();
    await loadArgusConfig();
  } catch (ex) {
    if (creator) {
      creator.error = creator.draft
        ? "Portrait generation failed. The last portrait was kept."
        : (ex.message || "Could not generate that portrait.");
      creator.step = 2;
    }
  } finally {
    stopCreatorBeat();
    if (creator) {
      creator.busy = false;
      painted = "";
      render();
    }
  }
}

async function runConcepts(vary) {
  if (!creator || creator.busy) return;
  if (!creator.draft && (creator.form.name.trim().length < 2 || creator.form.shortDescription.trim().length < 8)) {
    creator.error = "Add a name, and a short description of at least 8 characters under Advanced.";
    painted = "";
    render();
    return;
  }
  creator.busy = true;
  creator.error = "";
  startCreatorBeat();
  painted = "";
  render();
  try {
    if (!creator.draft) {
      const created = await api("/api/show/agents/brand/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(creatorPayload()),
      });
      creator.draft = created;
    }
    const id = creator.draft.agent.id;
    const body = { count: 4, vary: vary || "all" };
    if (vary && vary !== "all" && creator.selectedId) body.anchorConceptId = creator.selectedId;
    if (creator.form.refine) body.refine = creator.form.refine;
    const concepts = await api("/api/show/agents/" + encodeURIComponent(id) + "/brand/pfp-concepts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    creator.concepts = concepts.concepts || [];
    creator.selectedId = (creator.concepts[0] && creator.concepts[0].id) || null;
    creator.form.refine = "";
    creator.step = 2;
  } catch (ex) {
    creator.error = creator.draft
      ? "Your agent is safe. The portrait generation failed."
      : (ex.message || "Could not generate concepts.");
  } finally {
    stopCreatorBeat();
    if (creator) {
      creator.busy = false;
      painted = "";
      render();
    }
  }
}

async function confirmConcept() {
  if (!creator || creator.busy) return;
  const chosen = selectedConcept();
  if (!creator.draft || !chosen) {
    creator.error = "Pick a concept first.";
    painted = "";
    render();
    return;
  }
  creator.busy = true;
  creator.error = "";
  startCreatorBeat();
  painted = "";
  render();
  const id = creator.draft.agent.id;
  try {
    await api("/api/show/agents/" + encodeURIComponent(id) + "/brand/pfp-select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conceptId: chosen.id }),
    });
    const visual = chosen.visualIdentity || {};
    creator.reveal = {
      name: creator.form.name,
      title: chosen.title,
      tagline: chosen.tagline,
      svg: chosen.pfpSvg,
      emblem: chosen.emblemSvg,
      accent: visual.accentColor,
      primary: visual.primaryColor,
      agentId: id,
    };
    creator.step = 3;
    await refreshLists();
    await loadArgusConfig();
  } catch (ex) {
    if (creator) creator.error = ex.message || "Could not lock that brand.";
  } finally {
    stopCreatorBeat();
    if (creator) {
      creator.busy = false;
      painted = "";
      render();
    }
  }
}

function agentsView() {
  if (creator) return creatorView();
  if (focusAgent) return agentDetail(focusAgent);
  if (!agents.length && !listsReady) {
    const title = listsError ? "The cast didn't load" : "The cast is on its way";
    const body = listsError
      ? "The connection blinked. This tab will try again."
      : "Records show up when the show answers.";
    return `<h1 class="page">Agents</h1>${createAgentButton()}${emptyState(listsError ? "Still trying" : "Loading", title, body)}`;
  }
  if (!agents.length) return `<h1 class="page">Agents</h1>${createAgentButton()}${emptyState("No cast yet", "Nobody is seated", "Characters appear here once the show has them.")}`;
  return `<h1 class="page">Agents</h1><p class="fine">Characters, not algorithms with a hat on. Records are from matches they actually played.</p>${createAgentButton()}<div class="agent-roster">` +
    agents.map((a) => {
      const roster = a.roster === "user" ? (a.status === "READY" ? "Your competitor" : "Brand in progress") : "";
      return `<button class="agent-card" type="button" data-agent="${esc(a.id)}" data-cast="${esc(a.id)}"${brandStyle(a)}>
        <span class="agent-card__portrait">${facePlate(a, 320)}</span>
        <span class="agent-card__identity">
          ${titleLine(a)}
          <b class="agent-card__name">${esc(a.name)}</b>
          <span class="agent-card__stats"><span>${esc(a.record || "0–0")}</span>${a.streak ? `<span>Streak ${a.streak}</span>` : ""}</span>
          ${roster || a.knownFor ? `<span class="fine">${esc([roster, a.knownFor ? `Known for ${a.knownFor}` : ""].filter(Boolean).join(" · "))}</span>` : ""}
        </span>
      </button>`;
    }).join("") + `</div>`;
}

async function confirmRegenConcept(id) {
  if (!portraitEdit || portraitEdit.id !== id || portraitEdit.busy) return;
  if (!portraitEdit.selectedId) { portraitEdit.error = "Pick a concept first."; painted = ""; render(); return; }
  portraitEdit.busy = true;
  portraitEdit.error = "";
  painted = "";
  render();
  try {
    const saved = await api("/api/show/agents/" + encodeURIComponent(id) + "/brand/pfp-select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conceptId: portraitEdit.selectedId }),
    });
    portraitEdit.busy = false;
    portraitEdit.ok = true;
    portraitEdit.concepts = [];
    portraitEdit.version = saved.brand && saved.brand.version;
    await refreshLists();
    const detail = await api("/api/show/agents/" + encodeURIComponent(id));
    if (detail && detail.agent && focusAgent && focusAgent.id === id) focusAgent = detail.agent;
  } catch (ex) {
    portraitEdit.busy = false;
    portraitEdit.error = (ex && ex.message) || "Could not save that portrait. The last one was kept.";
  }
  painted = "";
  render();
}

function pfpDebugOn() {
  try { return new URLSearchParams(location.search).get("debug") === "1"; }
  catch { return false; }
}

function pfpDebugPanel(info) {
  if (!pfpDebugOn() || !info) return "";
  const brand = info.brandRecord || info.brand || info;
  const sel = info.creationSelections || info.selections || brand.creationSelections || {};
  const assets = brand.assets || {};
  const motion = brand.animatedPfp || {};
  const rows = [
    ["Agent ID", info.agentId || info.id || brand.agentId || ""],
    ["Brand version", brand.version || ""],
    ["Visual dirty", String(info.visualDirty === true || brand.visualDirty === true)],
    ["Style ID", brand.styleId || brand.pfpStyleId || "neon-competitive"],
    ["Archetype", sel.archetype || ""],
    ["Body type", sel.bodyType || ""],
    ["Expression", sel.expression || ""],
    ["Attire", sel.attire || ""],
    ["Palette", sel.colorPalette || ""],
    ["Background", sel.background || ""],
    ["Accessory", sel.accessories || ""],
    ["Canonical PFP URL", assets.canonicalPfp || brand.canonicalPfp || info.canonicalPfp || ""],
    ["Animated manifest URL", motion.manifestUrl || ""],
  ];
  return `<aside class="pfp-debug" data-pfp-debug>${rows.map(([key, value]) => `<p><b>${esc(key)}</b> <span>${esc(value == null ? "" : String(value))}</span></p>`).join("")}</aside>`;
}

function regenConceptCard(c, name) {
  const visual = c.visualIdentity || {};
  const on = portraitEdit && c.id === portraitEdit.selectedId;
  const accent = hexColor(visual.accentColor) || "#4AD7FF";
  return `<button class="concept-card pfp-concept lda-card${on ? " is-selected" : ""}" type="button" data-regen-concept="${esc(c.id)}" aria-pressed="${on ? "true" : "false"}" aria-label="Select portrait option ${esc(String(c.conceptNumber || 0))}" style="--agent-accent:${esc(accent)}">
    <span class="pfp-concept__image-wrap">${conceptArt(c)}<span class="pfp-concept__ring"></span></span>
    <span class="concept-copy"><span class="concept-name"><b>${esc(name)}</b></span><span class="brand-title">${esc(c.title)}</span></span>
    <span class="pfp-select pfp-concept__label">${on ? "Selected" : "Option " + esc(String(c.conceptNumber || ""))}</span>
  </button>`;
}

function portraitEditor(agent) {
  if (!agent || agent.roster !== "user") return "";
  const edit = portraitEdit && portraitEdit.id === agent.id ? portraitEdit : null;
  const selections = (edit && edit.selections) || agent.creationSelections || defaultVisualSelections();
  const concepts = (edit && edit.concepts) || [];
  const picking = concepts.length > 0 && !(edit && edit.ok);
  return `<details class="portrait-editor"${edit && edit.open ? " open" : ""}>
    <summary>Regenerate PFP</summary>
    <p class="fine">Change the look, generate four new concepts, pick one. The current portrait stays live until you save; the new one becomes a new brand version (the old one is kept).</p>
    ${visualOptionGrids(selections)}
    <button class="cta lda-btn lda-btn-primary lda-btn-block" type="button" data-regenerate-pfp="${esc(agent.id)}"${edit && edit.busy ? " disabled" : ""}>${picking ? "Generate 4 more" : "Generate 4 concepts"}</button>
    ${picking ? `<div class="concept-grid" data-regen-grid>${concepts.map((c) => regenConceptCard(c, agent.name)).join("")}</div>
    <button class="cta lda-btn lda-btn-primary lda-btn-block" type="button" data-regen-confirm="${esc(agent.id)}"${edit && edit.busy ? " disabled" : ""}>Use this portrait</button>` : ""}
    ${edit && edit.error ? `<div class="err lda-error" role="alert">${esc(edit.error)}</div>` : ""}
    ${edit && edit.ok ? `<p class="fine" role="status">Portrait saved as version ${esc(String(edit.version || ""))}. Every surface now shows it.</p>` : ""}
  </details>`;
}

async function regeneratePortrait(id) {
  const agent = focusAgent && focusAgent.id === id ? focusAgent : (agents.find((row) => row.id === id) || null);
  if (!portraitEdit || portraitEdit.id !== id) {
    portraitEdit = {
      id,
      selections: Object.assign(defaultVisualSelections(), (agent && agent.creationSelections) || {}),
      open: true,
      error: "",
      busy: false,
      ok: false,
    };
  }
  portraitEdit.busy = true;
  portraitEdit.error = "";
  portraitEdit.ok = false;
  portraitEdit.open = true;
  painted = "";
  render();
  try {
    const round = await api("/api/show/agents/" + encodeURIComponent(id) + "/brand/pfp-concepts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: 4, regenerate: true, creationSelections: portraitEdit.selections }),
    });
    portraitEdit.busy = false;
    portraitEdit.ok = false;
    portraitEdit.concepts = round.concepts || [];
    portraitEdit.selectedId = (portraitEdit.concepts[0] && portraitEdit.concepts[0].id) || null;
    if (!portraitEdit.concepts.length) portraitEdit.error = "No concepts came back. Try again.";
  } catch (ex) {
    if (portraitEdit) {
      portraitEdit.busy = false;
      portraitEdit.ok = false;
      portraitEdit.open = true;
      portraitEdit.error = "Portrait generation failed. The last portrait was kept.";
    }
  }
  painted = "";
  render();
}

function agentDetail(a) {
  const mine = (me && me.theories && me.theories[a.id]) || [];
  const tags = ["Aggressive", "Conservative", "Bluffer", "Risk-taker", "Pressure player", "Unpredictable"];
  const rivals = (a.rivals || []).map((r) => {
    const person = { id: r.id, name: r.name };
    const meetings = Number(r.meetings) || 0;
    const plate = meetings >= 2
      ? `<span class="portrait-plate portrait-plate--roster">${facePlate(person, 96)}</span>`
      : mark(r.name, null, r.id);
    return `<div class="rowbtn rival-note" data-cast="${esc(r.id)}">${plate}<span><b>${esc(r.name)}</b>${titleLine(person)}</span><div class="fine">${esc(r.series)} in ${r.meetings}${meetings >= 2 ? " · head to head" : ""}</div></div>`;
  }).join("");
  const moments = (a.moments || []).map((m) => {
    const replayId = history.find((h) => h.title && h.title === m.title);
    const watch = replayId ? `<button class="ghost moment-card__watch" type="button" data-match="${esc(replayId.matchId)}">Watch replay</button>` : "";
    return `<div class="rowbtn moment-note"><span class="portrait-plate portrait-plate--market">${facePlate(a, 96)}</span><span><b>${esc(m.title)}</b><div class="fine">${esc(m.dek || "")}</div>${watch}</span></div>`;
  }).join("");
  const tendencies = presentApi() && presentApi().tendencyLines ? presentApi().tendencyLines(a) : [];
  return `
    <button class="ghost lda-btn lda-btn-ghost lda-btn-block" type="button" data-back="agents">All agents</button>
    <div class="agent-hero" data-cast="${esc(a.id)}"${brandStyle(a)}>${agentPortrait(a)}<h1 class="page">${esc(a.name)}</h1>${titleLine(a)}${paletteLine(a)}<p>${esc((brandFor(a) && brandFor(a).tagline) || a.line || "")}</p></div>
    ${portraitEditor(a)}
    ${pfpDebugPanel(a)}
    ${a.roster === "user" && a.status && a.status !== "READY" ? `<button class="cta lda-btn lda-btn-primary lda-btn-block" type="button" data-resume-agent="1">Continue branding</button>` : ""}
    ${argusDetail(a)}
    ${a.roster === "user" && a.playable ? `<p class="fine">User roster. The show seats this agent against the house cast when a chair is free${a.seated ? ", and they are on the slate now" : ""}.</p>` : ""}
    <p class="fine">${esc(a.archetype)}</p>
    <div class="statgrid">
      ${ui()
        ? ui().statPill(a.record, "Record") + ui().statPill(String(a.streak || 0), "Streak") + (a.bestStreak > 0 ? ui().statPill(String(a.bestStreak), "Best streak") : "") + ui().statPill(`${a.winRate || 0}%`, "Win rate") + ui().statPill(String(a.played || 0), "Played")
        : `<div><b>${esc(a.record)}</b><span>Record</span></div><div><b>${a.streak || 0}</b><span>Streak</span></div>${a.bestStreak > 0 ? `<div><b>${a.bestStreak}</b><span>Best streak</span></div>` : ""}<div><b>${a.winRate || 0}%</b><span>Win rate</span></div><div><b>${a.played || 0}</b><span>Played</span></div>`}
    </div>
    <section class="section"><h2>Style</h2><p>${esc(a.line)}</p><p class="fine">Strength: ${esc(a.strength)} Weakness: ${esc(a.weakness)}</p></section>
    ${tendencies.length ? `<section class="section"><h2>From the matches</h2>${tendencies.map((line) => `<p class="fine">${esc(line)}</p>`).join("")}</section>` : ""}
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
    <button class="rowbtn lda-card lda-match story-card" type="button" data-match="${esc(h.matchId)}">
      ${castLine(h.seats)}
      ${storyMarkup(h)}
    </button>`).join("");
}

const REPLAY_HOLD = { roll: 1200, bid: 1500, call: 2000, reveal: 2800, out: 1400, settle: 2600 };

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
  const stage = synthetic ? tableView(synthetic, reducedMotion() ? [] : (frame.beats || []), { you: false, frame: shot, animatePfp: false }) : "";
  const beats = events.filter((e) => e.type === "bid" || e.type === "challenge" || e.type === "match_over").map((e) => {
    if (e.type === "bid") return `<li>${esc(e.name)} bids ${e.count} ${esc(faceWord(e.face))}.</li>`;
    if (e.type === "challenge") return `<li><b>${esc(e.bidWasTrue ? "Telling the truth." : "Bluffing.")}</b> Call on ${e.bid.count} ${esc(faceWord(e.bid.face))}.</li>`;
    return `<li><b>${esc(e.name)} wins.</b></li>`;
  }).join("");
  const at = frames.length ? `${index + 1} / ${frames.length}` : "";
  const kicker = api && api.storyKicker ? api.storyKicker(m) : "";
  const dek = (m.story && m.story.dek) || "";
  const extra = api && api.storyLines ? api.storyLines(m).filter((line) => line !== dek) : [];
  return `
    <button class="ghost lda-btn lda-btn-ghost lda-btn-block" type="button" data-back="history">All stories</button>
    ${kicker ? `<div class="story-kicker">${esc(kicker)}</div>` : ""}
    <h1 class="page">${esc(m.story && m.story.title || "Match")}</h1>
    <p>${esc(dek)}</p>
    ${extra.map((line) => `<p class="fine">${esc(line)}</p>`).join("")}
    ${stage}
    <div class="replay-meta"><span class="fine">${at}</span><button class="ghost" type="button" data-replay>Play again</button></div>
    ${m.share ? shareBlock({ ...m.share, matchId: m.matchId }) : ""}
    <ol class="log">${beats}</ol>`;
}

function castBoard() {
  const rows = agents.slice().sort((a, b) => (b.won || 0) - (a.won || 0) || String(a.name).localeCompare(String(b.name))).slice(0, 8);
  if (!rows.length) return "";
  return `<section class="section cast-board"><h2>Leaderboard</h2>${rows.map((a, i) => `
    <button class="rowbtn cast-row roster-row" type="button" data-agent="${esc(a.id)}" data-cast="${esc(a.id)}"${brandStyle(a)}>
      <span class="cast-rank">#${i + 1}</span>
      <span class="portrait-plate portrait-plate--roster">${facePlate(a, 96)}</span>
      <span class="roster-id"><b>${esc(a.name)}</b>${titleLine(a)}</span>
      <span class="roster-stats"><span>${esc(a.record || "0–0")}</span>${a.streak ? `<span class="roster-extra">Streak ${a.streak}</span>` : ""}</span>
    </button>`).join("")}</section>`;
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
    ${me.bestRead ? `<section class="section"><h2>Best read</h2><div class="rowbtn" data-cast="${esc(me.bestRead.agentId)}">${mark((agents.find((a) => a.id === me.bestRead.agentId) || {}).name || me.bestRead.agentId, null, me.bestRead.agentId)}<span><b>${esc((agents.find((a) => a.id === me.bestRead.agentId) || {}).name || me.bestRead.agentId)}</b>${titleLine({ id: me.bestRead.agentId })}</span><div class="fine">${me.bestRead.accuracy}% over ${me.bestRead.picks} picks</div></div></section>` : ""}
    <section class="section"><h2>Predictors</h2>
      ${(leaders.length ? leaders : [{ id: me.id, accuracy: me.accuracy, pnl: me.pnl, picks: me.picks }]).slice(0, 8).map((p, i) => `<div class="rowbtn"><b>${i + 1}. ${esc(p.id === me.id ? "You" : p.id)}</b><div class="fine">${p.accuracy || 0}% · ${money(p.pnl || 0)} test</div></div>`).join("")}
    </section>
    ${castBoard()}`;
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
  const dur = 1100;
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

function clearPainted() {
  paintedMatch = "";
  paintedMarket = "";
  paintedSheet = "";
}

function focusKey(el) {
  const node = el && el.closest ? el.closest("[data-pick-side], [data-trade-prop], [data-sell], [data-trade-stake], [data-tag], [data-confirm-trade]") : null;
  if (!node) return "";
  return [
    node.getAttribute("data-pick-side") || "",
    node.getAttribute("data-agent") || "",
    node.getAttribute("data-trade-prop") || "",
    node.getAttribute("data-side") || "",
    node.getAttribute("data-trade-stake") || "",
    node.getAttribute("data-tag") || "",
    node.hasAttribute("data-sell") ? "sell" : "",
    node.hasAttribute("data-confirm-trade") ? "confirm" : "",
  ].join("|");
}

function focusSelector(key) {
  if (!key) return "";
  const [side, agent, prop, propSide, stake, tag, sell, confirm] = key.split("|");
  if (side) return `[data-pick-side="${side}"]${agent ? `[data-agent="${agent}"]` : ""}`;
  if (prop) return `[data-trade-prop="${prop}"]${propSide ? `[data-side="${propSide}"]` : ""}`;
  if (stake) return `[data-trade-stake="${stake}"]`;
  if (tag) return `[data-tag="${tag}"]`;
  if (sell) return "[data-sell]";
  if (confirm) return "[data-confirm-trade]";
  return "";
}

function releaseFocus(root) {
  const active = document.activeElement;
  if (!active || !root || !root.contains(active) || active === document.body) return "";
  const key = focusKey(active);
  if (active.blur) active.blur();
  return key;
}

function syncCreatorFromDom() {
  if (!creatorSession()) return;
  const root = matchEl.querySelector(".creator");
  if (!root) return;
  root.querySelectorAll("input[name], textarea[name], select[name]").forEach((el) => {
    if (!Object.prototype.hasOwnProperty.call(creator.form, el.name)) return;
    if (el.type === "range") creator.form[el.name] = Number(el.value) / 100;
    else creator.form[el.name] = el.value;
  });
}

function holdCreatorDom() {
  const root = matchEl.querySelector(".creator");
  if (!root) return null;
  const details = root.querySelector("details.advanced-config");
  const active = document.activeElement;
  const fieldEl = active && root.contains(active) && active.name && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")
    ? active
    : null;
  let field = null;
  if (fieldEl) {
    const text = fieldEl.tagName !== "SELECT" && fieldEl.type !== "range" && typeof fieldEl.selectionStart === "number";
    field = {
      name: fieldEl.name,
      start: text ? fieldEl.selectionStart : null,
      end: text ? fieldEl.selectionEnd : null,
      direction: text ? (fieldEl.selectionDirection || "none") : "none",
      scrollTop: fieldEl.scrollTop || 0,
    };
  }
  return { detailsOpen: !!(details && details.open), field };
}

function restoreCreatorDom(held) {
  if (!held) return;
  const root = matchEl.querySelector(".creator");
  if (!root) return;
  if (held.detailsOpen) {
    const details = root.querySelector("details.advanced-config");
    if (details) details.open = true;
  }
  if (!held.field) return;
  const el = Array.from(root.querySelectorAll("input[name], textarea[name], select[name]")).find((node) => node.name === held.field.name);
  if (!el || !el.focus) return;
  el.focus({ preventScroll: true });
  if (held.field.scrollTop) el.scrollTop = held.field.scrollTop;
  if (held.field.start != null && el.setSelectionRange) {
    const max = String(el.value || "").length;
    const start = Math.min(held.field.start, max);
    const end = Math.min(held.field.end == null ? start : held.field.end, max);
    try { el.setSelectionRange(start, end, held.field.direction || "none"); } catch { /* range inputs have no caret */ }
  }
}

function restoreFocus(key) {
  const sel = focusSelector(key);
  if (!sel) return;
  const next = view.querySelector(sel);
  if (next && next.focus) next.focus({ preventScroll: true });
}

function captureScroll() {
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  const zone = marketEl.querySelector(".market-zone");
  const marketTop = zone ? zone.getBoundingClientRect().top : null;
  const decision = presence().scrollHold(y, marketTop, window.innerHeight || 0);
  return { ...decision, marketTop };
}

function restoreScroll(saved) {
  if (!saved || !saved.hold) return;
  const apply = () => {
    const zone = saved.pinMarket ? marketEl.querySelector(".market-zone") : null;
    if (zone && saved.marketTop != null) {
      const delta = zone.getBoundingClientRect().top - saved.marketTop;
      if (Math.abs(delta) > 1) window.scrollBy(0, delta);
      return;
    }
    const y = window.scrollY || 0;
    if (Math.abs(y - saved.y) > 1) window.scrollTo(0, saved.y);
  };
  apply();
  requestAnimationFrame(apply);
}

function announceLine(text) {
  if (!liveLineEl) return;
  const line = text || "";
  if (liveLineEl.textContent === line) return;
  liveLineEl.textContent = line;
}

function paintSlot(el, html, prev) {
  if (html === prev) return prev;
  el.innerHTML = html;
  return html;
}

function introClock(match) {
  if (!match || !match.matchId || reducedMotion() || tab !== "watch") return null;
  const round = Number(match.round) || 1;
  const started = !!(match.bid && (match.bid.count || match.bid.face)) || !!(match.reveal && match.reveal.length);
  const early = match.phase === "pick" || (match.phase === "live" && round <= 1 && !started);
  if (!early) return null;
  if (!introStarted.has(match.matchId)) introStarted.set(match.matchId, performance.now());
  const t = performance.now() - introStarted.get(match.matchId);
  if (t > 1900) return null;
  return t;
}

function introClass(t) {
  const bits = ["match-intro"];
  if (t >= 200) bits.push("show-agent-a");
  if (t >= 500) bits.push("show-agent-b");
  if (t >= 800) bits.push("show-vs");
  if (t >= 1000) bits.push("show-copy");
  if (t >= 1250) bits.push("show-records");
  if (t >= 1550) bits.push("intro-complete");
  return bits.join(" ");
}

function scheduleIntro(t) {
  if (introTimer || t == null) return;
  const marks = [200, 500, 800, 1000, 1250, 1550, 1920];
  const next = marks.find((mark) => mark > t + 16);
  if (!next) return;
  introTimer = setTimeout(() => {
    introTimer = 0;
    if (creatorSession()) return;
    render();
  }, Math.max(16, next - t));
}

function clearIntro() {
  if (introTimer) clearTimeout(introTimer);
  introTimer = 0;
  introKey = "";
  if (!introEl) return;
  introEl.innerHTML = "";
  introEl.className = "";
  introEl.hidden = true;
  introEl.style.removeProperty("--hero-a");
  introEl.style.removeProperty("--hero-b");
}

function finishIntro() {
  const match = live();
  if (match && match.matchId) introStarted.set(match.matchId, performance.now() - 4000);
  clearIntro();
}

function paintMatchIntro(match) {
  if (!introEl) return;
  const t = introClock(match);
  if (t == null) {
    if (introKey) clearIntro();
    return;
  }
  const key = match.matchId;
  if (introKey !== key) {
    const [a, b] = match.seats || [];
    introEl.innerHTML = a && b ? `<section class="match-intro" data-match-intro="1">
      <div class="match-intro__body">
        <div class="match-intro__agent is-a">${matchupSide(a, "left", "hero")}</div>
        <div class="match-intro__vs"><span>VS</span></div>
        <div class="match-intro__agent is-b">${matchupSide(b, "right", "hero")}</div>
      </div>
    </section>` : "";
    const left = heroColors(a).primary;
    const right = heroColors(b).primary;
    if (left) introEl.style.setProperty("--hero-a", left);
    if (right) introEl.style.setProperty("--hero-b", right);
    introKey = key;
    introEl.hidden = false;
  }
  const root = introEl.querySelector(".match-intro");
  if (root) root.className = introClass(t);
  introEl.classList.toggle("intro-complete", t >= 1550);
  scheduleIntro(t);
  bindAnimatedPfps(introEl);
}

function render() {
  syncCreatorFromDom();
  syncLaunchFromDom();
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
  const errHtml = err ? `<div class="err lda-error" role="alert">${esc(err)}</div>` : "";
  const matchHtml = tab === "watch"
    ? linkBanner() + watchStage() + errHtml
    : linkBanner() + (tab === "arena" ? arena()
      : tab === "agents" ? agentsView()
      : tab === "history" ? historyView()
      : profile()) + errHtml;
  const marketHtml = tab === "watch" ? watchMarket() : "";
  const sheetHtml = tradeSheetMarkup();
  paintMatchIntro(tab === "watch" ? watching : null);
  if (matchHtml === paintedMatch && marketHtml === paintedMarket && sheetHtml === paintedSheet && !arriving) {
    announceLine(watching && watching.narrative && watching.narrative.line);
    bindAnimatedPfps(view);
    return;
  }
  const saved = pinScroll ? captureScroll() : null;
  const sheetOpened = !paintedSheet && !!sheetHtml;
  const repaintMatch = matchHtml !== paintedMatch || !!arriving;
  const heldCreator = repaintMatch ? holdCreatorDom() : null;
  const focus = [
    matchHtml === paintedMatch ? "" : releaseFocus(matchEl),
    marketHtml === paintedMarket ? "" : releaseFocus(marketEl),
    sheetHtml === paintedSheet ? "" : releaseFocus(sheetEl),
  ].find(Boolean) || "";
  view.classList.toggle("enter", !!arriving);
  paintedMatch = paintSlot(matchEl, matchHtml, arriving ? "" : paintedMatch);
  paintedMarket = paintSlot(marketEl, marketHtml, arriving ? "" : paintedMarket);
  paintedSheet = paintSlot(sheetEl, sheetHtml, arriving ? "" : paintedSheet);
  restoreCreatorDom(heldCreator);
  if (saved) restoreScroll(saved);
  if (sheetOpened) {
    const dialog = sheetEl.querySelector("[data-trade-dialog]");
    if (dialog && dialog.focus) dialog.focus({ preventScroll: true });
  } else if (!heldCreator || !heldCreator.field) restoreFocus(focus);
  announceLine(watching && watching.narrative && watching.narrative.line);
  kickTally();
  paintShareCards();
  bindAnimatedPfps(view);
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

view.addEventListener("input", (e) => {
  if (!creator) return;
  const el = e.target;
  if (!el.name || !Object.prototype.hasOwnProperty.call(creator.form, el.name)) return;
  if (el.type === "range") {
    creator.form[el.name] = Number(el.value) / 100;
    const out = el.parentElement && el.parentElement.querySelector("output");
    if (out) out.textContent = el.value;
  } else {
    creator.form[el.name] = el.value;
  }
});

view.addEventListener("click", async (e) => {
  const createBtn = e.target.closest("[data-create-agent]");
  if (createBtn) { openCreator(); return; }
  const resumeBtn = e.target.closest("[data-resume-agent]");
  if (resumeBtn && focusAgent) { resumeCreator(focusAgent); return; }
  if (e.target.closest("[data-argus-for]") && focusAgent) { openArgusLaunch(focusAgent); return; }
  const detailOpt = e.target.closest("[data-opt-group]");
  if (detailOpt && focusAgent && !creator && focusAgent.roster === "user") {
    if (!portraitEdit || portraitEdit.id !== focusAgent.id) {
      portraitEdit = {
        id: focusAgent.id,
        selections: Object.assign(defaultVisualSelections(), focusAgent.creationSelections || {}),
        open: true,
        error: "",
        busy: false,
        ok: false,
      };
    }
    portraitEdit.selections[detailOpt.dataset.optGroup] = detailOpt.dataset.optId;
    portraitEdit.concepts = [];          // concepts from the old options no longer apply
    portraitEdit.selectedId = null;
    portraitEdit.open = true;
    portraitEdit.ok = false;
    portraitEdit.error = "";
    // Persist the change and flag the portrait as needing regeneration (spec §5/§6).
    api("/api/show/agents/" + encodeURIComponent(focusAgent.id) + "/brand/selections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creationSelections: portraitEdit.selections }),
    }).catch(() => {});
    painted = "";
    render();
    return;
  }
  const regen = e.target.closest("[data-regenerate-pfp]");
  if (regen) { regeneratePortrait(regen.dataset.regeneratePfp); return; }
  const regenPick = e.target.closest("[data-regen-concept]");
  if (regenPick && portraitEdit) { portraitEdit.selectedId = regenPick.dataset.regenConcept; portraitEdit.error = ""; painted = ""; render(); return; }
  const regenConfirm = e.target.closest("[data-regen-confirm]");
  if (regenConfirm) { confirmRegenConcept(regenConfirm.dataset.regenConfirm); return; }
  if (creator) {
    const opt = e.target.closest("[data-opt-group]");
    if (opt) {
      creator.selections = Object.assign(defaultVisualSelections(), creator.selections);
      creator.selections[opt.dataset.optGroup] = opt.dataset.optId;
      creator.error = "";
      painted = "";
      render();
      return;
    }
    if (e.target.closest("[data-creator-next]")) { chooseLook(); return; }
    if (e.target.closest("[data-creator-generate]")) { generateAgent(); return; }
    if (e.target.closest("[data-argus-connect]")) { connectArgus(); return; }
    if (e.target.closest("[data-argus-launch]")) { launchArgus(); return; }
    if (e.target.closest("[data-argus-sponsor]")) { sponsorArgus(); return; }
    if (e.target.closest("[data-argus-check]")) { checkArgus(); return; }
    if (e.target.closest("[data-enter-arena]")) {
      stopCreatorBeat();
      creator = null;
      await refreshLists();
      setTab("arena");
      return;
    }
    if (e.target.closest("[data-more-traits]")) {
      creator.moreTraits = !creator.moreTraits;
      creator.error = "";
      painted = "";
      render();
      return;
    }
    const concept = e.target.closest("[data-concept]");
    if (concept) {
      creator.selectedId = concept.dataset.concept;
      creator.error = "";
      painted = "";
      render();
      return;
    }
    if (e.target.closest("[data-creator-next]")) {
      if (creator.step === 1) runConcepts("all");
      return;
    }
    if (e.target.closest("[data-creator-back]")) {
      if (creator.step <= 1) {
        stopCreatorBeat();
        creator = null;
      } else if (creator.step === 3) creator.step = 2;
      else creator.step -= 1;
      painted = "";
      render();
      return;
    }
  }
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
      api("/api/show/argus/config").then((cfg) => {
        argusOffer = cfg || argusOffer;
        if (focusAgent && focusAgent.id === j.agent.id) {
          painted = "";
          render();
        }
      }).catch(() => {});
      tab = "agents";
      paintTabs();
      pinScroll = false;
      render();
      window.scrollTo(0, 0);
      pinScroll = true;
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
  clearPainted();
  tallySeen = "";
  paintTabs();
  const href = cardHref({ ...j.share, matchId: j.matchId || id });
  const next = location.pathname + href;
  if (location.pathname + location.search + location.hash !== next) window.history.replaceState(null, "", next);
  pinScroll = false;
  render();
  window.scrollTo(0, 0);
  pinScroll = true;
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
    // A new build deployed under us: reload once so this page never runs stale code.
    if (j && j.build) {
      if (window.__ldaBuild && window.__ldaBuild !== j.build && !creatorSession()) { location.reload(); return; }
      window.__ldaBuild = j.build;
    }
    incoming = { failed: false, starting: !!j.starting, snap: j };
  } catch {
    if (gen !== pollGen) return;
    incoming = { failed: true };
  }
  const folded = presence().foldShow(showState, incoming, Date.now());
  const linkChanged = notePresence(folded);
  if (!folded.apply) {
    if (linkChanged && !focusAgent && !focusMatch && !creatorSession()) render();
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
  if (!creatorSession() && (tab === "arena" || tab === "agents" || tab === "history" || tab === "profile")) await refreshLists();
  if (gen !== pollGen) return;
  if (creatorSession()) {
    renderCredits();
    return;
  }
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
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (introKey) finishIntro();
  if (tab !== "watch" || !director) return;
  const frame = director.frame();
  if (!frame || frame.done) return;
  e.preventDefault();
  director.fastForward();
  directorSig = directorSignature(director.frame());
  render();
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
