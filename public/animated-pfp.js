// Idle motion for layered SVG, when a portrait actually has those layers.
// Neon-competitive rasters stay posters. A missing portrait is a letter.
//
// House cast and created agents are lda-pfp-v2 drawings in the neon-competitive
// style, not webp layer packs and not a Pixi/GSAP stage. Groups in the SVG
// (bg, grid, torso, head, eyes, pupils, rim, aura, scan) are the rig.
// This runtime moves those groups. List rows never opt in: only mounts marked
// .animated-pfp with a hero context play.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ldaAnimatedPfp = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MOTION_PROFILES = Object.freeze({
    ELEGANT_SMOKE: Object.freeze({
      floatY: 6,
      headDriftX: 3,
      headDriftY: 2,
      pupilRange: 2.5,
      blinkMinMs: 2600,
      blinkMaxMs: 6200,
      auraDrift: 12,
      particleSpeed: 0.18,
    }),
    REGAL_STEADY: Object.freeze({
      floatY: 3,
      headDriftX: 1.5,
      headDriftY: 1,
      pupilRange: 1.5,
      blinkMinMs: 3200,
      blinkMaxMs: 7000,
      auraDrift: 5,
      particleSpeed: 0.08,
    }),
    CHAOTIC_SPECTRAL: Object.freeze({
      floatY: 8,
      headDriftX: 4,
      headDriftY: 4,
      pupilRange: 3,
      blinkMinMs: 1800,
      blinkMaxMs: 5000,
      auraDrift: 20,
      particleSpeed: 0.28,
    }),
    // Locked neon roster motion. House cast and created agents use this rig.
    NEON_COMPETITIVE: Object.freeze({
      floatY: 3.2,
      headDriftX: 1.8,
      headDriftY: 1.4,
      pupilRange: 1.8,
      blinkMinMs: 2600,
      blinkMaxMs: 5800,
      auraDrift: 8,
      particleSpeed: 0.16,
      pulseMin: 0.82,
      pulseMax: 1.0,
      glowDuration: 1.9,
      scanDriftY: 10,
      particleAlphaMin: 0.38,
      particleAlphaMax: 0.66,
    }),
  });

  const MOTION_TO_PROFILE = Object.freeze({
    FAST_CONFIDENT: "ELEGANT_SMOKE",
    SLOW_REGAL: "REGAL_STEADY",
    MECHANICAL_PRECISE: "REGAL_STEADY",
    CHAOTIC_UNEVEN: "CHAOTIC_SPECTRAL",
  });

  const STATE_MOD = Object.freeze({
    idle: { speed: 0.92, amp: 0.78, aura: 0.85 },
    thinking: { speed: 0.88, amp: 0.7, aura: 1.02 },
    activeTurn: { speed: 1.06, amp: 1, aura: 1.16 },
    winner: { speed: 1.12, amp: 1, aura: 1.28 },
    loser: { speed: 0.76, amp: 0.82, aura: 0.62 },
    reveal: { speed: 1, amp: 1.12, aura: 1.22 },
    marketHot: { speed: 1.04, amp: 0.9, aura: 1.18 },
  });

  const HERO_CONTEXTS = Object.freeze(["watch", "profile", "reveal", "hero"]);
  const LAYER_KEYS = Object.freeze([
    "bg", "bgGrid", "bgFx", "torso", "head", "hairFront", "hairBack",
    "eyesOpen", "eyesClosed", "pupils", "collarFx", "rimGlow", "aura", "particles", "scanFx",
  ]);
  const POSTER_OPACITY = Object.freeze({
    eyesClosed: "0",
    bgGrid: "0.22",
    rimGlow: "0.78",
    aura: "0.7",
    particles: "0.52",
    scanFx: "0.12",
  });
  const MAX_PLAYING = 4;
  const USER = 1024 / 256;

  function hash01(seed, i) {
    let h = Math.imul((Number(seed) ^ Math.imul((i + 1) >>> 0, 374761393)) >>> 0, 668265263) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return (h >>> 0) / 4294967296;
  }

  function seedFromId(id) {
    let h = 2166136261;
    const s = String(id || "pfp");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function profileForBrand(brand) {
    const row = brand && typeof brand === "object" ? brand : {};
    const named = row.animatedPfp && MOTION_PROFILES[row.animatedPfp.motionProfile];
    if (named) return row.animatedPfp.motionProfile;
    // Style lock. Motion language stays on the brand for identity, and every
    // current portrait plays the same neon competitive rig.
    return "NEON_COMPETITIVE";
  }

  function animatedPfpMeta(brand, previewUrl) {
    if (!brand || !previewUrl) return null;
    const motionProfile = profileForBrand(brand);
    const row = brand && typeof brand === "object" ? brand : {};
    const canonical = (row.assets && row.assets.canonicalPfp) || previewUrl;
    return {
      version: Number(row.version) || 1,
      engine: "neon-competitive",
      styleId: "neon-competitive",
      manifestUrl: null,
      sourceCanonicalPfp: canonical,
      previewUrl,
      enabled: false,
      motionProfile,
      qualityTier: "POSTER",
      manifest: {
        version: 1,
        width: 1024,
        height: 1024,
        poster: canonical,
        source: "neon-competitive",
        layers: {},
        anchors: {
          head: { x: 512, y: 430 },
          leftEye: { x: 394, y: 430 },
          rightEye: { x: 630, y: 430 },
          chest: { x: 512, y: 760 },
        },
        motionProfile,
      },
    };
  }

  function shouldAnimate({ reducedMotion = false, lowPower = false, context = "", enabled = true } = {}) {
    if (enabled === false || reducedMotion || lowPower) return false;
    return HERO_CONTEXTS.includes(context);
  }

  function breathPeriod(profile) {
    if (profile.floatY <= 3) return 6400;
    if (profile.floatY >= 7) return 4600;
    return 5600;
  }

  function blinkWindow(profile, seed, index) {
    const gap = profile.blinkMinMs + (profile.blinkMaxMs - profile.blinkMinMs) * hash01(seed, index);
    const hold = 78 + hash01(seed, index + 401) * 46;
    const double = hash01(seed, index + 877) < 0.22;
    const span = gap + hold + (double ? 120 + hold : 0);
    return { gap, hold, double, span };
  }

  function blinkClosed(elapsed, profile, seed) {
    let t = 0;
    for (let i = 0; i < 4000 && t <= elapsed; i++) {
      const w = blinkWindow(profile, seed, i);
      const start = t + w.gap;
      if (elapsed < start) return false;
      const local = elapsed - start;
      if (local < w.hold) return true;
      if (w.double) {
        const second = w.hold + 120;
        if (local >= second && local < second + w.hold * 0.85) return true;
      }
      t += w.span;
    }
    return false;
  }

  function pupilOffset(elapsed, profile, seed) {
    let t = 0;
    let from = { x: 0, y: 0 };
    for (let i = 0; i < 4000; i++) {
      const hold = 1200 + hash01(seed, 3000 + i) * 1400;
      const to = {
        x: (hash01(seed, 1000 + i) * 2 - 1) * profile.pupilRange,
        y: (hash01(seed, 2000 + i) * 2 - 1) * profile.pupilRange * 0.65,
      };
      if (elapsed <= t + hold) {
        const p = hold ? Math.min(1, Math.max(0, (elapsed - t) / hold)) : 1;
        const e = 0.5 - 0.5 * Math.cos(Math.PI * p);
        return {
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e,
        };
      }
      from = to;
      t += hold;
    }
    return from;
  }

  function unitWave(t, ms) {
    return Math.sin((t / ms) * Math.PI * 2) * 0.5 + 0.5;
  }

  function poseAt(elapsedMs, profileName, state, seed) {
    const profile = MOTION_PROFILES[profileName] || MOTION_PROFILES.NEON_COMPETITIVE;
    const mod = STATE_MOD[state] || STATE_MOD.idle;
    const t = Math.max(0, Number(elapsedMs) || 0) * mod.speed;
    const amp = mod.amp;
    const period = breathPeriod(profile);
    const speed = Number(profile.particleSpeed) > 0 ? profile.particleSpeed : 0.12;
    const wild = speed >= 0.2 ? 1 : 0;
    const breathe = (Math.sin((t / period) * Math.PI * 2) + 1) / 2;
    const floatY = breathe * profile.floatY * amp;
    const headX = (Math.sin((t / 3800) * Math.PI * 2) + wild * 0.4 * Math.sin((t / 1100) * Math.PI * 2)) * profile.headDriftX * amp / (1 + wild * 0.4);
    const headY = Math.sin((t / 3200) * Math.PI * 2) * profile.headDriftY * amp + floatY * 0.55;
    const pupil = pupilOffset(t, profile, seed >>> 0);
    const auraWave = Math.sin((t / 2200) * Math.PI * 2) * 0.5 + 0.5;
    const glowMs = (profile.glowDuration || 1.9) * 1000;
    const pulseMin = profile.pulseMin == null ? 0.9 : profile.pulseMin;
    const pulseMax = profile.pulseMax == null ? 1 : profile.pulseMax;
    const particleMin = profile.particleAlphaMin == null ? 0.45 : profile.particleAlphaMin;
    const particleMax = profile.particleAlphaMax == null ? 0.75 : profile.particleAlphaMax;
    const scanDrift = profile.scanDriftY == null ? 6 : profile.scanDriftY;
    return {
      floatY,
      headX,
      headY,
      pupilX: pupil.x * amp,
      pupilY: pupil.y * amp,
      breath: breathe,
      auraAlpha: (0.62 + 0.38 * auraWave) * Math.min(1.15, mod.aura),
      auraRot: Math.sin((t / 5200) * Math.PI * 2) * 0.008 * (profile.auraDrift / 8),
      auraDrift: profile.auraDrift * amp,
      particleY: Math.sin((t / (7000 / Math.max(speed, 0.05))) * Math.PI * 2) * profile.auraDrift * amp,
      particleAlpha: particleMin + (particleMax - particleMin) * unitWave(t, 1800),
      rimAlpha: pulseMin + (pulseMax - pulseMin) * unitWave(t, glowMs),
      scanY: Math.sin((t / 4800) * Math.PI * 2) * scanDrift,
      scanAlpha: 0.08 + 0.1 * unitWave(t, 2400),
      gridAlpha: 0.16 + 0.12 * unitWave(t, 3000),
      gridRot: Math.sin((t / 6800) * Math.PI * 2) * -0.34,
      eyesClosed: blinkClosed(t, profile, seed >>> 0),
    };
  }

  function fmt(n) {
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function applyPose(svg, pose) {
    if (!svg || !svg.querySelector) return;
    const nodes = svg.querySelectorAll("[data-layer]");
    if (!pose || pose.rest) {
      nodes.forEach((node) => {
        node.removeAttribute("transform");
        const name = node.getAttribute("data-layer");
        if (Object.prototype.hasOwnProperty.call(POSTER_OPACITY, name)) node.setAttribute("opacity", POSTER_OPACITY[name]);
        else if (name === "eyesOpen" || name === "pupils") node.removeAttribute("opacity");
      });
      return;
    }
    const set = (name, transform, opacity) => {
      const node = svg.querySelector(`[data-layer="${name}"]`);
      if (!node) return;
      if (transform) node.setAttribute("transform", transform);
      else node.removeAttribute("transform");
      if (opacity == null) node.removeAttribute("opacity");
      else node.setAttribute("opacity", opacity);
    };
    const dy = -pose.floatY * USER;
    const scaleY = 1 + pose.breath * 0.014;
    set("torso", `translate(0 940) scale(1 ${fmt(scaleY)}) translate(0 -940) translate(0 ${fmt(dy)})`);
    set("head", `translate(${fmt(pose.headX * USER)} ${fmt(pose.headY * USER)})`);
    set("rimGlow", `translate(${fmt(pose.headX * USER)} ${fmt(pose.headY * USER)})`, fmt(pose.rimAlpha == null ? 0.78 : pose.rimAlpha));
    set("hairFront", `translate(${fmt(pose.headX * 0.4 * USER)} ${fmt(-pose.floatY * 0.12 * USER)})`);
    set("hairBack", `translate(${fmt(pose.headX * 0.25 * USER)} ${fmt(pose.headY * 0.35 * USER)})`);
    set("collarFx", `translate(0 ${fmt(dy * 0.8)})`);
    const shut = pose.eyesClosed ? "0" : null;
    set("pupils", `translate(${fmt(pose.pupilX * USER)} ${fmt(pose.pupilY * USER)})`, shut);
    set("eyesOpen", null, shut);
    set("eyesClosed", null, pose.eyesClosed ? "1" : "0");
    const drift = pose.particleY * USER * 0.22;
    const fx = pose.auraDrift * USER * 0.08;
    set("bgFx", `translate(${fmt(Math.sin(pose.auraRot * 80) * fx)} ${fmt(drift * 0.35)})`);
    set("bgGrid", `rotate(${fmt(pose.gridRot || 0)} 512 512)`, fmt(pose.gridAlpha == null ? 0.22 : pose.gridAlpha));
    set("aura", `rotate(${fmt(pose.auraRot * (180 / Math.PI))} 512 512)`, String(Math.max(0.45, Math.min(1, pose.auraAlpha))));
    set("particles", `translate(${fmt(drift * 0.25)} ${fmt(-pose.particleY * USER * 0.45)})`, String(Math.max(0.3, Math.min(1, pose.particleAlpha))));
    set("scanFx", `translate(0 ${fmt((pose.scanY || 0) * USER)})`, fmt(pose.scanAlpha == null ? 0.12 : pose.scanAlpha));
  }

  const readyText = new Map();
  const pending = new Map();
  const clocks = new Map();
  const playing = new Set();
  let raf = 0;
  let observer = null;
  let watchingPage = false;

  function elapsedFor(key) {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!clocks.has(key)) clocks.set(key, now);
    return now - clocks.get(key);
  }

  function environmentBlocksMotion() {
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
    const nav = typeof navigator !== "undefined" ? navigator : null;
    const conn = nav && (nav.connection || nav.mozConnection || nav.webkitConnection);
    return !!(conn && conn.saveData);
  }

  function safeSvgText(text) {
    const raw = String(text || "");
    if (!/^<svg\b/i.test(raw) || /script|foreignObject|on\w+=/i.test(raw)) return "";
    return raw;
  }

  function parseSvg(text) {
    if (typeof DOMParser === "undefined") return null;
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const svg = doc && doc.documentElement;
    if (!svg || String(svg.tagName).toLowerCase() !== "svg") return null;
    if (svg.querySelector && svg.querySelector("parsererror")) return null;
    return svg;
  }

  function loadSvg(url) {
    if (readyText.has(url)) return Promise.resolve(readyText.get(url));
    if (pending.has(url)) return pending.get(url);
    const job = fetch(url, { credentials: "same-origin" }).then((res) => {
      if (!res.ok) throw new Error("pfp");
      return res.text();
    }).then((text) => {
      const safe = safeSvgText(text);
      if (!safe) throw new Error("pfp");
      readyText.set(url, safe);
      pending.delete(url);
      return safe;
    }).catch((err) => {
      pending.delete(url);
      throw err;
    });
    pending.set(url, job);
    return job;
  }

  function applyLive(node) {
    const svg = node.querySelector && node.querySelector("svg");
    if (!svg) return;
    const hidden = typeof document !== "undefined" && document.hidden;
    if (hidden || node.dataset.pfpVisible === "0") {
      applyPose(svg, { rest: true });
      return;
    }
    const key = node.dataset.pfpKey || "pfp";
    applyPose(svg, poseAt(
      elapsedFor(key),
      node.dataset.motion,
      node.dataset.state || "idle",
      seedFromId(node.dataset.agent || key),
    ));
  }

  function ensureObserver() {
    if (observer || typeof IntersectionObserver === "undefined") return;
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const node = entry.target;
        node.dataset.pfpVisible = entry.isIntersecting ? "1" : "0";
        if (!entry.isIntersecting) {
          const svg = node.querySelector("svg");
          if (svg) applyPose(svg, { rest: true });
        }
      }
      kick();
    }, { threshold: 0.2 });
  }

  function ensureVisibility() {
    if (watchingPage || typeof document === "undefined") return;
    watchingPage = true;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        return;
      }
      kick();
    });
  }

  function kick() {
    if (raf || typeof requestAnimationFrame !== "function") return;
    if (typeof document !== "undefined" && document.hidden) return;
    raf = requestAnimationFrame(tick);
  }

  function tick() {
    raf = 0;
    let live = 0;
    for (const node of [...playing]) {
      if (!node.isConnected) {
        playing.delete(node);
        if (observer) observer.unobserve(node);
        continue;
      }
      if (node.dataset.pfpVisible === "0") continue;
      live += 1;
      applyLive(node);
    }
    if (live > 0) raf = requestAnimationFrame(tick);
  }

  function startNode(node) {
    const svg = node.querySelector("svg");
    if (!svg || !svg.querySelector("[data-layer]")) {
      node.classList.add("is-static");
      node.classList.remove("is-playing");
      return;
    }
    node.classList.add("is-playing");
    node.classList.remove("is-static");
    node.dataset.pfpLive = "1";
    if (!node.dataset.pfpKey) {
      node.dataset.pfpKey = `${node.dataset.agent || "pfp"}:${node.dataset.context || "hero"}`;
    }
    ensureObserver();
    ensureVisibility();
    if (observer && node.dataset.pfpObserved !== "1") {
      observer.observe(node);
      node.dataset.pfpObserved = "1";
    }
    playing.add(node);
    applyLive(node);
    kick();
  }

  function upgrade(node, text) {
    if (node.dataset.pfpLive === "1" && node.querySelector("svg [data-layer]")) {
      playing.add(node);
      kick();
      return;
    }
    const svg = parseSvg(text);
    if (!svg || !svg.querySelector("[data-layer]")) {
      node.classList.add("is-static");
      return;
    }
    svg.setAttribute("aria-hidden", "true");
    const img = node.querySelector("img");
    if (img) {
      const cls = img.getAttribute("class");
      if (cls) svg.setAttribute("class", cls);
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      img.replaceWith(svg);
    }
    startNode(node);
  }

  function arm(node) {
    if (node.dataset.pfpLive === "1" && node.querySelector("svg [data-layer]")) {
      playing.add(node);
      applyLive(node);
      kick();
      return;
    }
    if (node.dataset.inline === "1" || node.querySelector("svg[data-layered], svg [data-layer]")) {
      startNode(node);
      return;
    }
    const src = node.dataset.pfpSrc || "";
    if (!src) {
      node.classList.add("is-static");
      return;
    }
    if (readyText.has(src)) {
      upgrade(node, readyText.get(src));
      return;
    }
    loadSvg(src).then((text) => {
      if (!node.isConnected || (node.dataset.pfpSrc || "") !== src) return;
      upgrade(node, text);
    }).catch(() => {
      if (node.isConnected) node.classList.add("is-static");
    });
  }

  function scan(root) {
    if (!root || typeof root.querySelectorAll !== "function") return 0;
    const nodes = [...root.querySelectorAll(".animated-pfp")];
    if (root.matches && root.matches(".animated-pfp")) nodes.unshift(root);
    if (environmentBlocksMotion()) {
      nodes.forEach((node) => {
        node.classList.add("is-static");
        node.classList.remove("is-playing");
      });
      return 0;
    }
    const eligible = nodes.filter((node) => {
      if (node.closest && node.closest("[hidden]")) return false;
      return shouldAnimate({
        context: node.getAttribute("data-context") || "",
        enabled: node.getAttribute("data-enabled") !== "0",
      });
    });
    const rank = { reveal: 0, hero: 1, profile: 2, watch: 3 };
    eligible.sort((a, b) => (rank[a.getAttribute("data-context")] ?? 9) - (rank[b.getAttribute("data-context")] ?? 9));
    const chosen = new Set(eligible.slice(0, MAX_PLAYING));
    nodes.forEach((node) => {
      if (!chosen.has(node)) {
        node.classList.add("is-static");
        node.classList.remove("is-playing");
        return;
      }
      arm(node);
    });
    return chosen.size;
  }

  return {
    MOTION_PROFILES,
    MOTION_TO_PROFILE,
    STATE_MOD,
    HERO_CONTEXTS,
    LAYER_KEYS,
    POSTER_OPACITY,
    MAX_PLAYING,
    profileForBrand,
    animatedPfpMeta,
    shouldAnimate,
    blinkWindow,
    blinkClosed,
    poseAt,
    applyPose,
    seedFromId,
    scan,
  };
});
