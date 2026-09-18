const os = require("os");
const fs = require("fs");
const path = require("path");
process.env.CREDITS_PATH = path.join(os.tmpdir(), "lda-credits-" + process.pid + ".json");
try { fs.unlinkSync(process.env.CREDITS_PATH); } catch {}

const { CreditBook, STARTING_CREDITS } = require("../src/credits");

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, m) { if (Math.abs(a - b) > 1e-9) throw new Error((m || "eq") + `: ${a} != ${b}`); }

const book = new CreditBook({ persist: false, starting: STARTING_CREDITS });
eq(book.balance("shark"), STARTING_CREDITS, "free grant on first look");
eq(book.debit("shark", 1), STARTING_CREDITS - 1, "debit ante");
eq(book.credit("shark", 3), STARTING_CREDITS - 1 + 3, "credit pot");
eq(book.ensure("broke", 10), STARTING_CREDITS, "free refill when empty");
const snap = book.snapshot(["shark", "broke"]);
assert(snap.shark === STARTING_CREDITS + 2 && snap.broke === STARTING_CREDITS, "snapshot");
try { book.debit("x", 0); throw new Error("zero should throw"); }
catch (e) { if (e.message !== "bad_amount") throw e; }

const disk = new CreditBook({ persist: true, starting: 50 });
eq(disk.balance("a"), 50, "persist grant");
disk.debit("a", 5);
const again = new CreditBook({ persist: true, starting: 50 });
eq(again.balance("a"), 45, "reload from disk");
console.log("credits ok");
