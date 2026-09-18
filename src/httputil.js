// Small HTTP helpers shared by the server (and tests).
const path = require("path");
const fs = require("fs");

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function resolvePublicFile(publicRoot, rel) {
  const root = path.resolve(publicRoot);
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return full;
}

function shouldReleaseTxClaim(err) {
  const msg = String(err?.message || err);
  return /not_found_yet|bad_tx_hash|tx_failed|tx_wrong_recipient/.test(msg);
}

module.exports = { escapeHtml, resolvePublicFile, shouldReleaseTxClaim };
