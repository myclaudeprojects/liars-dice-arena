// Small DOM helpers for the spectator app. They return HTML strings.
// The classes live in primitives.css. Nothing here decides a match.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ldaUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CAST_IDS = Object.freeze([
    "dracula", "caesar", "reaper", "athena", "shark", "oracle",
    "fox", "brutus", "monk", "siren", "miser", "jester",
  ]);

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function classes(list) {
    return list.filter(Boolean).join(" ");
  }

  function dataAttrs(data) {
    if (!data) return "";
    return Object.keys(data).map((key) => {
      const val = data[key];
      if (val == null || val === false) return "";
      const name = "data-" + key;
      return val === true ? name : `${name}="${esc(val)}"`;
    }).filter(Boolean).join(" ");
  }

  function emblem() {
    return `<span class="lda-emblem" aria-hidden="true"></span>`;
  }

  function palette(id) {
    if (!id) return "";
    return `<span class="lda-palette" data-cast="${esc(id)}" aria-hidden="true"><i class="is-primary"></i><i class="is-secondary"></i><i class="is-accent"></i></span>`;
  }

  function avatar(name, hue, id) {
    const raw = String(name || "?").replace(/^The /, "");
    const letter = raw[0] || "?";
    const cast = CAST_IDS.includes(id) ? id : "";
    const tone = Number.isFinite(Number(hue)) ? Number(hue) : 40;
    const style = cast ? "" : ` style="--agent-accent:hsl(${tone} 42% 58%)"`;
    const castAttr = cast ? ` data-cast="${cast}"` : "";
    return `<div class="mark lda-avatar"${castAttr}${style} aria-hidden="true"><span class="lda-avatar-glyph">${esc(letter)}</span></div>`;
  }

  function liveBadge(label, opts) {
    const o = opts || {};
    const text = label || (o.final ? "Final" : "Live");
    const kind = o.final ? "lda-badge-final" : o.stale ? "lda-badge-stale" : "lda-badge-live";
    const dot = o.final || o.stale ? "" : `<i class="dot lda-live-dot" aria-hidden="true"></i>`;
    return `<span class="kicker lda-badge ${kind}">${dot}<span>${esc(text)}</span></span>`;
  }

  function marketBadge(text) {
    return `<p class="test-badge lda-badge lda-badge-market"><span class="lda-badge-mark" aria-hidden="true">AC</span><span>${esc(text)}</span></p>`;
  }

  function button(opts) {
    const o = opts || {};
    const variant = o.variant || "primary";
    const variantClass = variant === "ghost" ? "lda-btn-ghost" : variant === "choice" ? "lda-btn-choice" : "lda-btn-primary";
    const side = o.side === "no" ? "no" : o.side === "yes" ? "yes" : "";
    const cls = classes([
      "lda-btn",
      variantClass,
      side ? "lda-choice" : "",
      side === "yes" ? "lda-choice-yes" : "",
      side === "no" ? "lda-choice-no" : "",
      o.block === false ? "" : "lda-btn-block",
      o.loading ? "is-loading" : "",
      o.selected ? "is-selected" : "",
      o.extra,
    ]);
    const disabled = o.disabled || o.loading ? " disabled" : "";
    const busy = o.loading ? ` aria-busy="true"` : "";
    const pressed = o.selected ? ` aria-pressed="true"` : (side ? ` aria-pressed="false"` : "");
    const label = o.ariaLabel ? ` aria-label="${esc(o.ariaLabel)}"` : "";
    const extra = dataAttrs(o.data);
    const inner = o.html != null ? o.html : esc(o.text || "");
    const spin = o.loading ? `<span class="lda-spinner" aria-hidden="true"></span><span class="sr">Working.</span>` : "";
    return `<button class="${cls}" type="${esc(o.type || "button")}"${disabled}${busy}${pressed}${label}${extra ? " " + extra : ""}>${spin}${inner}</button>`;
  }

  function choice(opts) {
    const o = opts || {};
    const side = o.side === "no" ? "no" : "yes";
    const word = side === "no" ? "NO" : "YES";
    const price = o.price == null ? "" : String(o.price);
    const detail = o.detail || "";
    const html = `<span class="lda-choice-copy"><b><span class="lda-choice-side">${word}</span> ${esc(price)}</b>${detail ? `<span>${esc(detail)}</span>` : ""}</span>`;
    return button({
      variant: "choice",
      side,
      html,
      extra: o.extra == null ? "giant" : o.extra,
      loading: !!o.loading,
      disabled: !!o.disabled,
      selected: !!o.selected,
      data: o.data,
      ariaLabel: o.ariaLabel || `${word} ${price}. ${detail}`.replace(/\s+/g, " ").trim(),
    });
  }

  function statPill(value, label, tone) {
    const toneClass = tone === "win" || tone === "good" ? "is-win" : tone === "loss" || tone === "bad" ? "is-loss" : "";
    return `<div class="lda-pill ${toneClass}"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
  }

  function cardClass(kind) {
    if (kind === "match") return "lda-card lda-match";
    if (kind === "result") return "lda-card lda-result";
    return "lda-card";
  }

    return {
    CAST_IDS,
    esc,
    avatar,
    emblem,
    palette,
    liveBadge,
    marketBadge,
    button,
    choice,
    statPill,
    cardClass,
  };
});
