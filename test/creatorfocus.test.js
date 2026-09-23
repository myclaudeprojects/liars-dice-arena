// The create wizard used to be rewritten from HTML on live-show ticks.
// That replaced the focused input, so later keystrokes never landed.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

assert(
  /motionTimer = setTimeout\(\(\) => \{[\s\S]*?creatorSession\(\)\) return;\s*render\(\);/.test(app),
  "motion ticks leave the wizard mounted",
);
assert(
  app.includes("if (linkChanged && !focusAgent && !focusMatch && !creatorSession()) render();"),
  "a presence change does not rebuild the wizard",
);
assert(
  app.includes("if (tab !== next || focusAgent || focusMatch || creatorSession()) return;"),
  "a list refresh does not rebuild the wizard",
);
assert(
  app.includes("!sameArchetypeList(creator.archetypes, j.archetypes)"),
  "identical archetype options do not rebuild the wizard",
);
assert(app.includes("syncCreatorFromDom();"), "a paint copies the live fields first");
assert(app.includes("const heldCreator = repaintMatch ? holdCreatorDom() : null;"), "a paint remembers the caret");
assert(app.includes("restoreCreatorDom(heldCreator);"), "a paint puts the caret back");
assert(
  app.includes("name=\"name\"") && app.includes("name=\"shortDescription\"") && app.includes("name=\"visualDirection\"") && app.includes("name=\"refine\""),
  "name, description, direction, and refine stay named fields",
);

function sliceFn(source, name) {
  const token = "function " + name + "(";
  const start = source.indexOf(token);
  if (start < 0) throw new Error("missing " + name);
  let i = source.indexOf("{", start);
  let depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("unclosed " + name);
}

function el(tag, attrs) {
  const node = {
    tagName: tag,
    name: (attrs && attrs.name) || "",
    type: (attrs && attrs.type) || (tag === "TEXTAREA" ? "textarea" : tag === "SELECT" ? "select" : "text"),
    value: (attrs && attrs.value) || "",
    className: (attrs && attrs.className) || "",
    open: !!(attrs && attrs.open),
    selectionStart: attrs && attrs.selectionStart != null ? attrs.selectionStart : 0,
    selectionEnd: attrs && attrs.selectionEnd != null ? attrs.selectionEnd : 0,
    selectionDirection: "none",
    scrollTop: (attrs && attrs.scrollTop) || 0,
    children: [],
    parent: null,
    contains(other) {
      if (other === node) return true;
      return node.children.some((child) => child.contains(other));
    },
    querySelector(sel) {
      const all = [];
      const walk = (n) => { all.push(n); n.children.forEach(walk); };
      walk(node);
      return all.find((n) => matches(n, sel)) || null;
    },
    querySelectorAll(sel) {
      const all = [];
      const walk = (n) => { all.push(n); n.children.forEach(walk); };
      walk(node);
      return all.filter((n) => matches(n, sel));
    },
    focus() { document.activeElement = node; node.focused = true; },
    blur() { if (document.activeElement === node) document.activeElement = null; node.focused = false; },
    setSelectionRange(start, end, direction) {
      node.selectionStart = start;
      node.selectionEnd = end;
      node.selectionDirection = direction || "none";
    },
  };
  return node;
}

function matches(node, sel) {
  if (sel === ".creator") return node.className.split(/\s+/).includes("creator");
  if (sel === "details.advanced-config") return node.tagName === "DETAILS" && node.className.split(/\s+/).includes("advanced-config");
  if (sel === "input[name], textarea[name], select[name]") {
    return (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.tagName === "SELECT") && !!node.name;
  }
  return false;
}

function adopt(parent, child) {
  child.parent = parent;
  parent.children.push(child);
  return child;
}

const document = { activeElement: null };
const creatorRoot = el("DIV", { className: "creator" });
const details = el("DETAILS", { className: "advanced-config", open: true });
const name = el("INPUT", { name: "name", type: "text", value: "Vesper", selectionStart: 3, selectionEnd: 3 });
const description = el("TEXTAREA", { name: "shortDescription", value: "A quiet closer who waits.", selectionStart: 8, selectionEnd: 14, scrollTop: 24 });
const aggression = el("INPUT", { name: "aggression", type: "range", value: "70" });
adopt(details, description);
adopt(creatorRoot, name);
adopt(creatorRoot, aggression);
adopt(creatorRoot, details);
const matchEl = {
  querySelector: (sel) => creatorRoot.querySelector(sel),
  contains: (node) => creatorRoot.contains(node),
};
document.activeElement = description;

const creator = {
  form: {
    name: "",
    shortDescription: "",
    aggression: 0.55,
    visualDirection: "",
  },
};
const sandbox = {
  creator,
  tab: "agents",
  matchEl,
  document,
  Array,
  Object,
  String,
  Number,
};
vm.createContext(sandbox);
vm.runInContext(
  [
    sliceFn(app, "creatorSession"),
    sliceFn(app, "sameArchetypeList"),
    sliceFn(app, "syncCreatorFromDom"),
    sliceFn(app, "holdCreatorDom"),
    sliceFn(app, "restoreCreatorDom"),
  ].join("\n"),
  sandbox,
);

sandbox.syncCreatorFromDom();
eq(creator.form.name, "Vesper", "typed name is kept");
eq(creator.form.shortDescription, "A quiet closer who waits.", "typed description is kept");
eq(creator.form.aggression, 0.7, "slider position is kept");

const held = sandbox.holdCreatorDom();
assert(held.detailsOpen, "advanced section stays open");
eq(held.field.name, "shortDescription", "description keeps the caret identity");
eq(held.field.start, 8, "selection start is remembered");
eq(held.field.end, 14, "selection end is remembered");
eq(held.field.scrollTop, 24, "description scroll is remembered");

// A full HTML rewrite replaces the nodes. The replacement carries the synced value.
const nextRoot = el("DIV", { className: "creator" });
const nextDetails = el("DETAILS", { className: "advanced-config", open: false });
const nextDescription = el("TEXTAREA", { name: "shortDescription", value: creator.form.shortDescription, selectionStart: 0, selectionEnd: 0, scrollTop: 0 });
adopt(nextDetails, nextDescription);
adopt(nextRoot, el("INPUT", { name: "name", type: "text", value: creator.form.name }));
adopt(nextRoot, nextDetails);
matchEl.querySelector = (sel) => nextRoot.querySelector(sel);
document.activeElement = null;
sandbox.restoreCreatorDom(held);
eq(document.activeElement, nextDescription, "description is focused again");
eq(nextDescription.selectionStart, 8, "caret start is restored");
eq(nextDescription.selectionEnd, 14, "caret end is restored");
eq(nextDescription.scrollTop, 24, "description scroll is restored");
assert(nextDetails.open, "advanced section is reopened");

const same = sandbox.sameArchetypeList(
  [{ id: "GAMBLER", label: "Gambler" }],
  [{ id: "GAMBLER", label: "Gambler" }],
);
assert(same, "same archetype list");
assert(!sandbox.sameArchetypeList([{ id: "GAMBLER", label: "Gambler" }], [{ id: "ORACLE", label: "Oracle" }]), "different archetype list");

sandbox.tab = "watch";
const ignored = "untouched";
creator.form.name = ignored;
sandbox.syncCreatorFromDom();
eq(creator.form.name, ignored, "other tabs do not read the wizard");

console.log("creatorfocus ok");
