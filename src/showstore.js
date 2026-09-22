// showstore.js — Durable Phase 2 book. Test credits, open picks, settled history.
//
// Render mounts a disk at /var/data (see render.yaml). Set SHOW_DATA_PATH to
// override. Without that disk, the file lives in ./data and does not survive
// a platform restart. Nothing here is money.

const fs = require("fs");
const path = require("path");

function defaultShowPath() {
  if (process.env.SHOW_DATA_PATH) return process.env.SHOW_DATA_PATH;
  const disk = "/var/data";
  try {
    if (fs.existsSync(disk) && fs.statSync(disk).isDirectory()) return path.join(disk, "show.json");
  } catch { /* use the local dir */ }
  return path.join(__dirname, "..", "data", "show.json");
}

class ShowStore {
  constructor(file) {
    this.file = file;
  }

  load() {
    let raw;
    try { raw = fs.readFileSync(this.file, "utf8"); }
    catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
    const data = JSON.parse(raw);
    if (!data || data.v !== 1) return null;
    return data;
  }

  save(data) {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { ShowStore, defaultShowPath };
