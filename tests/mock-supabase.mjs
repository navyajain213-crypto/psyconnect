// Minimal in-memory stand-in for the Supabase endpoints PsyConnect calls.
// It mimics row-level security: a user only ever sees and writes their own row.
import { createServer } from "node:http";

export function startMock(port = 54321) {
  const users = new Map();      // email -> { id, email, password, confirmed }
  const rows = new Map();       // user_id -> { state, updated_at }
  const log = [];               // { method, path }
  const flags = { confirm: false, failLoad: false };
  let n = 0;

  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const mkToken = (uid) => "tok." + b64({ uid, exp: Date.now() + 3600e3 });
  const uidFrom = (req) => {
    const h = req.headers.authorization || "";
    if (!h.startsWith("Bearer tok.")) return null;
    try {
      const p = JSON.parse(Buffer.from(h.slice(11), "base64url").toString());
      return p.exp > Date.now() ? p.uid : null;
    } catch { return null; }
  };
  const byId = (id) => [...users.values()].find((u) => u.id === id);
  const session = (u) => ({
    access_token: mkToken(u.id),
    refresh_token: "ref." + u.id,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: u.id, email: u.email }
  });

  const server = createServer(async (req, res) => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "apikey, authorization, content-type, prefer",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
    };
    const send = (code, body) => {
      res.writeHead(code, { ...cors, "Content-Type": "application/json" });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

    const url = new URL(req.url, "http://x");
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
    const path = url.pathname;
    if (!path.startsWith("/__test")) log.push({ method: req.method, path });

    // ---- test control ----
    if (path === "/__test/state") {
      return send(200, { users: [...users.values()], rows: Object.fromEntries(rows), log, flags });
    }
    if (path === "/__test/flags") { Object.assign(flags, body); return send(200, flags); }
    if (path === "/__test/seed") {
      const u = users.get(body.email);
      rows.set(u.id, { state: body.state, updated_at: new Date().toISOString() });
      return send(200, {});
    }
    if (path === "/__test/reset") { users.clear(); rows.clear(); log.length = 0; flags.confirm = false; flags.failLoad = false; return send(200, {}); }

    // ---- auth ----
    if (path === "/auth/v1/signup" && req.method === "POST") {
      if (users.has(body.email)) return send(400, { error_code: "user_already_exists", msg: "User already registered" });
      if (!body.password || body.password.length < 8) return send(422, { error_code: "weak_password", msg: "Password should be at least 8 characters." });
      const u = { id: "u" + ++n, email: body.email, password: body.password, confirmed: !flags.confirm };
      users.set(u.email, u);
      return send(200, flags.confirm ? { id: u.id, email: u.email } : session(u));
    }
    if (path === "/auth/v1/token") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const u = users.get(body.email);
        if (!u || u.password !== body.password) return send(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" });
        if (!u.confirmed) return send(400, { error_code: "email_not_confirmed", msg: "Email not confirmed" });
        return send(200, session(u));
      }
      if (grant === "refresh_token") {
        const u = byId(String(body.refresh_token || "").replace("ref.", ""));
        if (!u) return send(400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
        return send(200, session(u));
      }
    }
    if (path === "/auth/v1/user") {
      const u = byId(uidFrom(req));
      if (!u) return send(401, { msg: "invalid JWT" });
      if (req.method === "PUT") { u.password = body.password; }
      return send(200, { id: u.id, email: u.email });
    }
    if (path === "/auth/v1/logout") return send(204);
    if (path === "/auth/v1/recover") return send(200, {});

    // ---- data (row-level security) ----
    if (path === "/rest/v1/user_state") {
      const uid = uidFrom(req);
      if (!uid) return send(401, { message: "JWT expired", code: "PGRST301" });
      if (req.method === "GET") {
        if (flags.failLoad) return send(500, { message: "database unavailable" });
        const r = rows.get(uid);
        return send(200, r ? [r] : []);
      }
      if (req.method === "POST") {
        if (body.user_id !== uid) return send(403, { message: "new row violates row-level security policy", code: "42501" });
        rows.set(uid, { state: body.state, updated_at: body.updated_at });
        return send(201);
      }
    }
    if (path === "/rest/v1/rpc/delete_my_account") {
      const uid = uidFrom(req);
      if (!uid) return send(401, { message: "JWT expired" });
      const u = byId(uid);
      users.delete(u.email); rows.delete(uid);
      return send(200, null);
    }
    send(404, { message: "not found: " + path });
  });

  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port })));
}
