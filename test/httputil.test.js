const os = require("os");
const fs = require("fs");
const path = require("path");
const { escapeHtml, resolvePublicFile, shouldReleaseTxClaim, timingSafeEqualString } = require("../src/httputil");

function assert(cond, msg) { if (!cond) throw new Error(msg); }

assert(escapeHtml(`<img src=x onerror="alert(1)">`) === "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;", "escape");
assert(shouldReleaseTxClaim({ message: "tx_not_found_yet" }), "retryable");
assert(!shouldReleaseTxClaim({ message: "Betting had closed" }), "keep claim after refund");
assert(timingSafeEqualString("ak_abc", "ak_abc"), "equal secrets");
assert(!timingSafeEqualString("ak_abc", "ak_abd"), "mismatch");
assert(!timingSafeEqualString("ak_abc", "ak_ab"), "length");
assert(!timingSafeEqualString(null, "x"), "null");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pub-"));
fs.writeFileSync(path.join(root, "ok.txt"), "hi");
assert(resolvePublicFile(root, "ok.txt"), "in-root file");
assert(!resolvePublicFile(root, "../ok.txt"), "parent rejected");
assert(!resolvePublicFile(root, "missing.txt"), "missing");
console.log("httputil ok");
