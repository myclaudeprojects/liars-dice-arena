const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const rw = (f, fn) => { const p = path.join(root, f); const raw = fs.readFileSync(p, "utf8"); const crlf = raw.includes("\r\n"); const a = raw.replace(/\r\n/g, "\n"); const b = fn(a); fs.writeFileSync(p, crlf ? b.replace(/\n/g, "\r\n") : b); console.log(f, a === b ? "(no change)" : "patched"); };
const rep = (s, a, b) => { if (s.includes(b)) return s; if (!s.includes(a)) throw new Error("anchor missing: " + a.slice(0, 70)); return s.replace(a, b); };

rw("src/brands.js", (s) => rep(s, `  exportState() {`, `  // Drop every version of an agent's brand (admin removal of a user agent).
  removeAgent(agentId) {
    let n = 0;
    for (const key of [...this._versions.keys()]) { const row = this._versions.get(key); if (row && row.agentId === agentId) { this._versions.delete(key); n++; } }
    this._active.delete(agentId);
    return n;
  }

  exportState() {`));

rw("src/showrunner.js", (s) => rep(s, `  // Every library portrait is single-use:`, `  // Admin: remove a user-created agent (draft or finished). Refuses house cast and anything
  // seated in a live match. Its portrait returns to the pool; records and brands go with it.
  removeAgent(agentId) {
    const draft = this.userAgents.get(agentId);
    if (!draft) throw creatorError("unknown_agent", "No such user agent.", 404);
    if (this.busyIds().has(agentId)) throw creatorError("agent_busy", "That agent is seated in a live match. Try again after it settles.", 409);
    const brands = this.brands.removeAgent(agentId);
    this.userAgents.delete(agentId);
    try { if (this.records && this.records.remove) this.records.remove(agentId); } catch { /* records are optional */ }
    this.persist();
    this.emitState();
    console.log("AGENT_REMOVED", { agentId, name: draft.name, brandVersions: brands });
    return { removed: agentId, name: draft.name, brandVersions: brands };
  }

  // Every library portrait is single-use:`));

rw("src/showhttp.js", (s) => rep(s, `    if (req.method === "POST" && path === "/agents/brand/create") {`, `    // Admin removal: DELETE /api/show/agents/:id with header x-admin-token = ADMIN_TOKEN (env).
    const del = path.match(/^\\/agents\\/([^/]+)$/);
    if (req.method === "DELETE" && del) {
      const want = process.env.ADMIN_TOKEN;
      const got = req.headers["x-admin-token"];
      if (!want) { send(res, 403, { ok: false, error: "Admin actions are disabled: set ADMIN_TOKEN on the server.", code: "admin_disabled" }); return true; }
      if (!got || got !== want) { send(res, 401, { ok: false, error: "Bad admin token.", code: "unauthorized" }); return true; }
      try { send(res, 200, { ok: true, ...show.removeAgent(decodeURIComponent(del[1])) }); }
      catch (e) { send(res, e.status || 400, { ok: false, error: e.publicMessage || e.message, code: e.code || "remove_failed" }); }
      return true;
    }
    if (req.method === "POST" && path === "/agents/brand/create") {`));
