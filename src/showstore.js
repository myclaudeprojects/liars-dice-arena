// showstore.js — Durable Phase 2 book. Test credits, open picks, settled history.
//
// Render mounts a disk at /var/data (see render.yaml). Set SHOW_DATA_PATH to
// override. Without that disk, the file lives in ./data and does not survive
// a platform restart. Nothing here is money.
//
// One process owns the file. load() and save() take show.json.lock and hold
// it until this process exits. The lock records the owner's pid and the fd
// stays open. The same process may open the store again. SIGTERM and SIGINT
// run shutdown hooks (so a pending book can be flushed), release the lock,
// and exit, so a Render restart can hand the disk to the next instance.
// A lock is stale — and taken immediately — when its pid is dead, is not
// this app, cannot be inspected, or was reused (the process started after
// the lock file was written). Only a live `node server.js` that started
// before the lock is treated as the owner. That waiter waits LOCK_WAIT_MS
// (15s), then throws show_store_locked and does not write. Callers that
// pass lockWaitMs 0 fail fast and can retry without blocking /health.
//
// save() writes show.json.<generation>.tmp, fsyncs that file, fsyncs the
// directory, then renames it onto show.json and fsyncs the directory again.
// A crash before the rename leaves the previous show.json in place. load()
// never promotes a leftover .tmp. Corrupt JSON, or a document whose v is
// not 1, loads as null so the show can bootstrap a fresh book.

const fs = require("fs");
const path = require("path");

const LOCK_WAIT_MS = 15000;
const LOCK_POLL_MS = 20;
const heldLocks = new Set();
const shutdownHooks = [];
let exitHooked = false;
let clockHz = 0;

function onShutdown(fn) {
  shutdownHooks.push(fn);
  return () => {
    const i = shutdownHooks.indexOf(fn);
    if (i >= 0) shutdownHooks.splice(i, 1);
  };
}

function releaseHeldLocks() {
  for (const store of heldLocks) {
    try {
      if (store._lockFd != null) {
        try { store.fs.closeSync(store._lockFd); } catch { /* already closed */ }
        store._lockFd = null;
      }
      if (store._readPid(store.lockPath) === process.pid) store.fs.unlinkSync(store.lockPath);
    } catch { /* the directory may already be gone */ }
    store._lockHeld = false;
  }
}

function defaultShowPath() {
  if (process.env.SHOW_DATA_PATH) return process.env.SHOW_DATA_PATH;
  const disk = "/var/data";
  try {
    if (fs.existsSync(disk) && fs.statSync(disk).isDirectory()) return path.join(disk, "show.json");
  } catch { /* use the local dir */ }
  return path.join(__dirname, "..", "data", "show.json");
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function clockTicks() {
  if (clockHz) return clockHz;
  clockHz = 100;
  return clockHz;
}

// /proc/<pid>/stat field 22 is starttime, in ticks since boot. `comm` may
// contain spaces, so the fields after the closing paren are what we count.
function processStartMs(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const end = stat.lastIndexOf(")");
    if (end < 0) return null;
    const rest = stat.slice(end + 2).trim().split(/\s+/);
    const ticks = Number(rest[19]);
    if (!Number.isFinite(ticks)) return null;
    const boot = fs.readFileSync("/proc/stat", "utf8").match(/^btime\s+(\d+)/m);
    const btime = boot ? Number(boot[1]) : NaN;
    if (!Number.isFinite(btime)) return null;
    return btime * 1000 + (ticks * 1000) / clockTicks();
  } catch {
    return null;
  }
}

function processCmdline(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ");
  } catch {
    return null;
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

class ShowStore {
  constructor(file, opts = {}) {
    this.file = file;
    this.fs = opts.fs || fs;
    this.lockWaitMs = opts.lockWaitMs == null ? LOCK_WAIT_MS : opts.lockWaitMs;
    this.lockPath = file + ".lock";
    this._lockHeld = false;
    this._lockFd = null;
    this._writeGen = 0;
  }

  // "live" means a node server.js that started before this lock file was
  // written. Anything else is a leftover from a killed process or a recycled
  // pid (Render reuses low pids, and an unreadable cmdline is not this app).
  _lockKind(owner) {
    if (owner == null) return "unreadable";
    if (!pidAlive(owner)) return "dead";
    const started = processStartMs(owner);
    let mtime = null;
    try { mtime = this.fs.statSync(this.lockPath).mtimeMs; } catch { /* no mtime */ }
    if (started != null && mtime != null && started > mtime + 1500) return "reused";
    const cmd = processCmdline(owner);
    if (cmd == null) return "unreadable";
    if (/\bnode\b/.test(cmd) && /server\.js\b/.test(cmd)) return "live";
    return "other";
  }

  _readPid(lockPath) {
    try {
      const text = String(this.fs.readFileSync(lockPath, "utf8") || "").trim();
      const pid = Number(text);
      if (!Number.isInteger(pid) || pid <= 0) return null;
      return pid;
    } catch {
      return null;
    }
  }

  _stealLock(expectedPid) {
    const owner = this._readPid(this.lockPath);
    if (expectedPid == null) {
      if (owner != null) return;
    } else if (owner !== expectedPid) {
      return;
    }
    try { this.fs.unlinkSync(this.lockPath); } catch { /* another waiter took it */ }
  }

  _acquire() {
    if (this._lockHeld) return;
    // The lock lives next to the data file. On a first boot (fresh disk, new
    // SHOW_DATA_PATH) that directory may not exist yet: create it, or the very
    // first load() dies on ENOENT before save() ever gets a chance to mkdir.
    try { this.fs.mkdirSync(path.dirname(this.lockPath), { recursive: true }); } catch { /* best effort; open below reports real failures */ }
    const deadline = Date.now() + this.lockWaitMs;
    let stoleUnreadable = false;
    let announcedWait = false;
    for (;;) {
      try {
        const fd = this.fs.openSync(this.lockPath, "wx");
        try {
          this.fs.writeFileSync(fd, `${process.pid}\n`);
          this.fs.fsyncSync(fd);
        } catch (err) {
          try { this.fs.closeSync(fd); } catch { /* already closed */ }
          throw err;
        }
        this._lockFd = fd;
        this._lockHeld = true;
        this._hookRelease();
        if (announcedWait) console.log(`show store: lock acquired by pid ${process.pid}`);
        return;
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        const owner = this._readPid(this.lockPath);
        if (owner === process.pid) {
          this._lockHeld = true;
          this._hookRelease();
          return;
        }
        const kind = this._lockKind(owner);
        if (kind !== "live") {
          console.log(`show store: removing stale lock (${kind}) held by ${owner == null ? "an unreadable owner" : "pid " + owner}`);
          this._stealLock(owner);
          continue;
        }
        if (Date.now() >= deadline) {
          if (!stoleUnreadable && owner == null) {
            stoleUnreadable = true;
            this._stealLock(null);
            continue;
          }
          const who = owner == null ? "" : ` (pid ${owner})`;
          const err = new Error(`show store is locked by another process${who}`);
          err.code = "show_store_locked";
          throw err;
        }
        if (!announcedWait) {
          announcedWait = true;
          const who = owner == null ? "an unreadable owner" : `pid ${owner}`;
          console.log(`show store: waiting up to ${this.lockWaitMs}ms for lock held by ${who}`);
        }
        sleepSync(LOCK_POLL_MS);
      }
    }
  }

  _hookRelease() {
    heldLocks.add(this);
    if (exitHooked) return;
    exitHooked = true;
    process.on("exit", releaseHeldLocks);
    const stop = (sig) => {
      console.log(`show store: releasing lock on ${sig}`);
      for (const fn of shutdownHooks) {
        try { fn(); } catch (e) { console.error("show store shutdown hook:", e && e.message); }
      }
      releaseHeldLocks();
      process.exit(0);
    };
    // A listener replaces Node's default exit. Leave immediately after the
    // unlock so this process cannot write once the next instance may take it.
    process.once("SIGTERM", () => stop("SIGTERM"));
    process.once("SIGINT", () => stop("SIGINT"));
  }

  _syncDir(dir) {
    let fd;
    try {
      fd = this.fs.openSync(dir, "r");
      this.fs.fsyncSync(fd);
    } catch {
      // The file fsync already pushed the bytes. Directory fsync is not
      // available on every filesystem, and a failure here must not skip the rename.
    } finally {
      if (fd != null) {
        try { this.fs.closeSync(fd); } catch { /* already closed */ }
      }
    }
  }

  load() {
    this._acquire();
    let raw;
    try { raw = this.fs.readFileSync(this.file, "utf8"); }
    catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
    let data;
    try { data = JSON.parse(raw); }
    catch { return null; }
    if (!data || data.v !== 1) return null;
    return data;
  }

  save(data) {
    this._acquire();
    const gen = ++this._writeGen;
    this._writeSync(data, gen);
  }

  // Async save used by the show loop. JSON is encoded in slices so /health
  // can run between them, then the bytes are written and fsynced on the
  // libuv threadpool. A newer save (including the sync shutdown flush) wins.
  async saveAsync(data) {
    if (this.fs !== fs) {
      this.save(data);
      return;
    }
    this._acquire();
    const gen = ++this._writeGen;
    const dir = path.dirname(this.file);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = `${this.file}.${gen}.tmp`;
    const fh = await fs.promises.open(tmp, "w");
    let buf = [];
    let size = 0;
    let abandoned = false;
    const push = async (s) => {
      if (abandoned || gen !== this._writeGen) { abandoned = true; return; }
      buf.push(s);
      size += s.length;
      if (size < 64 * 1024) return;
      const chunk = buf.join("");
      buf = [];
      size = 0;
      await fh.write(chunk);
      await new Promise((r) => setImmediate(r));
      if (gen !== this._writeGen) abandoned = true;
    };
    try {
      await writeEncoded(data, push);
      if (!abandoned && buf.length) await fh.write(buf.join(""));
      if (!abandoned) await fh.sync();
    } finally {
      await fh.close();
    }
    // The generation check and the rename are synchronous so a SIGTERM
    // flush cannot commit a newer book and then lose it to this rename.
    if (abandoned || gen !== this._writeGen) {
      try { await fs.promises.unlink(tmp); } catch { /* a newer writer owns the name */ }
      return;
    }
    fs.renameSync(tmp, this.file);
    this._syncDir(dir);
  }

  _writeSync(data, gen) {
    const dir = path.dirname(this.file);
    this.fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.${gen}.tmp`;
    const payload = JSON.stringify(data);
    const fd = this.fs.openSync(tmp, "w");
    try {
      this.fs.writeFileSync(fd, payload);
      this.fs.fsyncSync(fd);
    } finally {
      this.fs.closeSync(fd);
    }
    if (gen !== this._writeGen) {
      try { this.fs.unlinkSync(tmp); } catch { /* superseded */ }
      return;
    }
    this._syncDir(dir);
    this.fs.renameSync(tmp, this.file);
    this._syncDir(dir);
  }
}

function yieldEncode() {
  return new Promise((r) => setImmediate(r));
}

function childIsHeavy(child) {
  if (Array.isArray(child)) return child.length >= 48;
  if (!child || typeof child !== "object" || child instanceof Date) return false;
  const keys = Object.keys(child);
  if (keys.length >= 48) return true;
  for (const key of keys) {
    const grand = child[key];
    if (Array.isArray(grand) && grand.length >= 48) return true;
    if (grand && typeof grand === "object" && !(grand instanceof Date) && !Array.isArray(grand) && Object.keys(grand).length >= 48) return true;
  }
  return false;
}

// JSON.stringify, but large arrays and maps yield so the event loop can
// answer /health. Output matches JSON.stringify for plain JSON data.
async function writeEncoded(value, push) {
  if (value instanceof Date) { await push(JSON.stringify(value)); return; }
  if (Array.isArray(value)) {
    if (value.length < 48) { await push(JSON.stringify(value)); return; }
    await push("[");
    for (let i = 0; i < value.length; i++) {
      if (i) await push(",");
      const part = JSON.stringify(value[i]);
      await push(part === undefined ? "null" : part);
      if ((i & 63) === 63) await yieldEncode();
    }
    await push("]");
    return;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    let heavy = keys.length >= 48;
    if (!heavy) {
      for (const key of keys) if (childIsHeavy(value[key])) { heavy = true; break; }
    }
    if (!heavy) { await push(JSON.stringify(value)); return; }
    await push("{");
    let first = true;
    for (let i = 0; i < keys.length; i++) {
      const child = value[keys[i]];
      if (child === undefined) continue;
      if (!first) await push(",");
      first = false;
      if (childIsHeavy(child)) {
        await push(JSON.stringify(keys[i]) + ":");
        await writeEncoded(child, push);
      } else {
        await push(JSON.stringify(keys[i]) + ":" + JSON.stringify(child));
      }
      if ((i & 63) === 63) await yieldEncode();
    }
    await push("}");
    return;
  }
  await push(JSON.stringify(value));
}

async function encodeBook(value) {
  const chunks = [];
  await writeEncoded(value, async (s) => { chunks.push(s); });
  return chunks.join("");
}

module.exports = { ShowStore, defaultShowPath, LOCK_WAIT_MS, onShutdown, encodeBook };
