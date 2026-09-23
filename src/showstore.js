// showstore.js — Durable Phase 2 book. Test credits, open picks, settled history.
//
// Render mounts a disk at /var/data (see render.yaml). Set SHOW_DATA_PATH to
// override. Without that disk, the file lives in ./data and does not survive
// a platform restart. Nothing here is money.
//
// One process owns the file. load() and save() take show.json.lock and hold
// it until this process exits. The lock records the owner's pid. The same
// process may open the store again. A second process waits LOCK_WAIT_MS
// (400ms), then throws show_store_locked and does not write. A lock whose
// pid is dead, or still unreadable when the wait ends, is removed and taken.
//
// save() writes show.json.tmp, fsyncs that file, fsyncs the directory, then
// renames it onto show.json and fsyncs the directory again. A crash before
// the rename leaves the previous show.json in place. load() never promotes
// a leftover .tmp. Corrupt JSON, or a document whose v is not 1, loads as
// null so the show can bootstrap a fresh book.

const fs = require("fs");
const path = require("path");

const LOCK_WAIT_MS = 400;
const LOCK_POLL_MS = 20;
const heldLocks = new Set();
let exitHooked = false;

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

  _stealLock() {
    try { this.fs.unlinkSync(this.lockPath); } catch { /* another waiter took it */ }
  }

  _acquire() {
    if (this._lockHeld) return;
    const deadline = Date.now() + this.lockWaitMs;
    let stoleUnreadable = false;
    for (;;) {
      try {
        const fd = this.fs.openSync(this.lockPath, "wx");
        try {
          this.fs.writeFileSync(fd, `${process.pid}\n`);
          this.fs.fsyncSync(fd);
        } finally {
          this.fs.closeSync(fd);
        }
        this._lockHeld = true;
        this._hookRelease();
        return;
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        const owner = this._readPid(this.lockPath);
        if (owner === process.pid) {
          this._lockHeld = true;
          this._hookRelease();
          return;
        }
        if (owner != null && !pidAlive(owner)) {
          this._stealLock();
          continue;
        }
        if (Date.now() >= deadline) {
          if (owner == null && !stoleUnreadable) {
            stoleUnreadable = true;
            this._stealLock();
            continue;
          }
          const err = new Error("show store is locked by another process");
          err.code = "show_store_locked";
          throw err;
        }
        sleepSync(LOCK_POLL_MS);
      }
    }
  }

  _hookRelease() {
    heldLocks.add(this);
    if (exitHooked) return;
    exitHooked = true;
    process.on("exit", () => {
      for (const store of heldLocks) {
        try {
          if (store._readPid(store.lockPath) === process.pid) store.fs.unlinkSync(store.lockPath);
        } catch { /* the directory may already be gone */ }
      }
    });
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
    const dir = path.dirname(this.file);
    this.fs.mkdirSync(dir, { recursive: true });
    const tmp = this.file + ".tmp";
    const payload = JSON.stringify(data);
    const fd = this.fs.openSync(tmp, "w");
    try {
      this.fs.writeFileSync(fd, payload);
      this.fs.fsyncSync(fd);
    } finally {
      this.fs.closeSync(fd);
    }
    this._syncDir(dir);
    this.fs.renameSync(tmp, this.file);
    this._syncDir(dir);
  }
}

module.exports = { ShowStore, defaultShowPath, LOCK_WAIT_MS };
