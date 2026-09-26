// portraitlib.js — the generated-portrait library.
//
// Portraits are made offline (pfp-forge on a PC, no key in the site) and committed as
// public/assets/portraits/*.webp with a manifest of the tags each was generated from.
// The server never draws these; it matches an agent's creation selections to the
// closest entries. With no library on disk everything falls back to the SVG rig.
//
// PORTRAIT_LIB=off disables the library (tests); PORTRAIT_LIB=/path/manifest.json overrides.

const fs = require("fs");
const path = require("path");

const DEFAULT_MANIFEST = path.join(__dirname, "..", "public", "assets", "portraits", "manifest.json");
const URL_BASE = "/assets/portraits/";

// Weighted similarity between an agent's selections and an entry's tags.
const WEIGHTS = { archetype: 6, bodyType: 5, colorPalette: 3, background: 2, attire: 2, expression: 2, accessories: 1, skinTone: 1, hairStyle: 1 };
const SKIN_WORDS = { porcelain: "porcelain", fair: "fair", olive: "olive", tan: "tan", brown: "brown", deep: "deep brown", ebony: "ebony" };
const HAIR_WORDS = { bald: "bald", buzz: "buzz", cropped: "short", swept: "slicked", undercut: "undercut", long: "long", wild: "spiky", braids: "braids", mohawk: "mohawk", bun: "bun" };

let cache = null;

function manifestPath() {
  const env = process.env.PORTRAIT_LIB;
  if (env === "off") return null;
  return env || DEFAULT_MANIFEST;
}

function load(force) {
  const file = manifestPath();
  if (!file) return (cache = { file: null, entries: [] });
  if (cache && cache.file === file && !force) return cache;
  let entries = [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    entries = (Array.isArray(raw) ? raw : raw.entries || []).filter((e) => e && e.file).map((e, i) => ({
      id: String(e.id || e.file).replace(/\.(webp|png|jpg)$/i, ""),
      file: e.file,
      tags: e.tags || {},
      house: e.house || (e.tags && e.tags.house) || null,
      index: i,
    }));
  } catch { entries = []; }
  cache = { file, dir: path.dirname(file), entries };
  return cache;
}

function reload() { return load(true); }
function size() { return load().entries.length; }
function enabled() { return size() > 0; }
function urlFor(entry) { return entry ? URL_BASE + entry.file : null; }

function score(sel, tags) {
  let s = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    const want = sel[k], have = tags[k];
    if (!want || want === "auto" || want === "none") continue;
    if (k === "skinTone") { if (String(tags.skin || "").includes(SKIN_WORDS[want] || "\u0000")) s += w; continue; }
    if (k === "hairStyle") { if (String(tags.hair || "").includes(HAIR_WORDS[want] || "\u0000")) s += w; continue; }
    if (have === want) s += w;
  }
  return s;
}

// Closest `count` distinct library portraits for a selection set. Ties break on a
// stable per-agent hash so two agents with identical picks don't get identical faces
// in the same order; `exclude` skips ids already shown (regenerate rounds).
function match(selections, { count = 4, exclude = [], seed = "" } = {}) {
  const { entries } = load();
  if (!entries.length) return [];
  const sel = selections || {};
  const skip = new Set(exclude);
  const h = hash(seed);
  return entries
    .filter((e) => !e.house && !skip.has(e.id))
    .map((e) => ({ e, s: score(sel, e.tags), t: hash(e.id + seed) }))
    .sort((a, b) => b.s - a.s || ((a.t ^ h) >>> 0) - ((b.t ^ h) >>> 0))
    .slice(0, count)
    .map((x) => x.e);
}

function houseCandidates(agentId) {
  return load().entries.filter((e) => e.house === agentId);
}

// House cast: the first candidate unless HOUSE_PORTRAITS picks another ("dracula=3,fox=2").
function houseEntry(agentId) {
  const list = houseCandidates(agentId);
  if (!list.length) return null;
  const picks = String(process.env.HOUSE_PORTRAITS || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const p of picks) { const [id, n] = p.split("="); if (id === agentId) { const k = Math.max(1, Number(n) || 1) - 1; if (list[k]) return list[k]; } }
  return list[0];
}

function byId(id) { return load().entries.find((e) => e.id === id) || null; }

function hash(text) { let h = 2166136261; const s = String(text || ""); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

module.exports = { load, reload, size, enabled, urlFor, match, houseCandidates, houseEntry, byId, score, URL_BASE };
