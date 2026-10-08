/* PsyConnect auth + data client.
   Talks to Supabase (GoTrue + PostgREST) over plain fetch, so there is no SDK to load.
   If no Supabase config is present, PCAuth.enabled is false and the app runs in
   local demo mode (data stays in this browser). */
(function () {
  "use strict";

  var cfg = window.PC_CONFIG || {};
  var base = String(cfg.supabaseUrl || "").replace(/\/+$/, "");
  var key = String(cfg.supabaseAnonKey || "");
  var enabled = !!(base && key);
  var SK = "pc.session.v1";
  var session = null;
  var gateResolve = null;

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SK)); } catch (e) { return null; }
  }
  function writeSession(s) {
    session = s;
    try {
      if (s) localStorage.setItem(SK, JSON.stringify(s));
      else localStorage.removeItem(SK);
    } catch (e) { /* storage blocked: session lasts for this page only */ }
  }
  function normSession(d) {
    if (!d || !d.access_token) return null;
    var exp = d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600);
    return {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: exp,
      user: d.user || (session && session.user) || null
    };
  }

  function friendly(status, code, msg) {
    var m = String(msg || "").toLowerCase();
    if (code === "invalid_credentials" || m.indexOf("invalid login") > -1) return "That email and password do not match.";
    if (code === "email_not_confirmed" || m.indexOf("not confirmed") > -1) return "Confirm your email first. Check your inbox for the link.";
    if (code === "user_already_exists" || m.indexOf("already registered") > -1) return "An account with this email already exists. Try signing in.";
    if (code === "weak_password") return msg || "Choose a stronger password.";
    if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || status === 429) return "Too many attempts. Wait a minute and try again.";
    if (code === "same_password") return "Choose a password you have not used before.";
    return msg || "Something went wrong. Try again.";
  }

  async function raw(path, opt) {
    opt = opt || {};
    var headers = { apikey: key, "Content-Type": "application/json" };
    headers.Authorization = "Bearer " + (opt.token || key);
    if (opt.headers) for (var k in opt.headers) headers[k] = opt.headers[k];
    var res;
    try {
      res = await fetch(base + path, {
        method: opt.method || "GET",
        headers: headers,
        body: opt.body === undefined ? undefined : JSON.stringify(opt.body),
        keepalive: !!opt.keepalive
      });
    } catch (e) {
      var ne = new Error("Cannot reach the server. Check your connection and try again.");
      ne.network = true;
      throw ne;
    }
    var txt = await res.text();
    var data = null;
    if (txt) { try { data = JSON.parse(txt); } catch (e) { data = txt; } }
    if (!res.ok) {
      var code = data && (data.error_code || data.code);
      var msg = data && (data.msg || data.error_description || data.message || data.error);
      var err = new Error(friendly(res.status, code, msg));
      err.status = res.status;
      err.code = code;
      throw err;
    }
    return data;
  }

  var refreshing = null;
  function refresh() {
    if (refreshing) return refreshing;
    if (!session || !session.refresh_token) return Promise.reject(new Error("No session"));
    refreshing = raw("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: session.refresh_token }
    }).then(function (d) {
      var s = normSession(d);
      if (!s) throw new Error("No session");
      writeSession(s);
      return s;
    }).then(function (s) { refreshing = null; return s; },
            function (e) { refreshing = null; throw e; });
    return refreshing;
  }

  function authError() {
    var e = new Error("Your session has ended. Sign in again.");
    e.status = 401;
    return e;
  }

  async function token() {
    if (!session) throw authError();
    if (session.expires_at - 60 < Date.now() / 1000) {
      try { await refresh(); }
      catch (e) {
        if (e.network) throw e;
        writeSession(null);
        throw authError();
      }
    }
    return session.access_token;
  }

  async function authed(path, opt) {
    opt = opt || {};
    opt.token = await token();
    try {
      return await raw(path, opt);
    } catch (e) {
      if (e.status === 401 && session) {
        await refresh();
        opt.token = session.access_token;
        return raw(path, opt);
      }
      throw e;
    }
  }

  /* ---------- public API ---------- */

  async function init() {
    if (!enabled) return { session: null };
    var out = { session: null, type: null, error: null };
    var hash = location.hash.replace(/^#/, "");
    if (hash.indexOf("access_token=") > -1 || hash.indexOf("error_description=") > -1) {
      var p = new URLSearchParams(hash);
      history.replaceState(null, "", location.pathname + location.search);
      if (p.get("error_description")) {
        out.error = "That link is invalid or has expired. Request a new one.";
      } else {
        var s = normSession({
          access_token: p.get("access_token"),
          refresh_token: p.get("refresh_token"),
          expires_at: +p.get("expires_at") || null,
          expires_in: +p.get("expires_in") || 3600
        });
        if (s) {
          try { s.user = await raw("/auth/v1/user", { token: s.access_token }); writeSession(s); out.type = p.get("type"); }
          catch (e) { out.error = e.message; }
        }
      }
    }
    if (!session) session = readSession();
    if (session && session.expires_at - 60 < Date.now() / 1000) {
      try { await refresh(); } catch (e) { if (!e.network) writeSession(null); }
    }
    out.session = session;
    return out;
  }

  async function signUp(email, password) {
    var d = await raw("/auth/v1/signup?redirect_to=" + encodeURIComponent(location.origin), {
      method: "POST", body: { email: email, password: password }
    });
    var s = normSession(d);
    if (s) { writeSession(s); return { session: s }; }
    return { confirm: true };
  }
  async function signIn(email, password) {
    var d = await raw("/auth/v1/token?grant_type=password", {
      method: "POST", body: { email: email, password: password }
    });
    var s = normSession(d);
    if (!s) throw new Error("Sign in failed. Try again.");
    writeSession(s);
    return s;
  }
  function resetPassword(email) {
    return raw("/auth/v1/recover?redirect_to=" + encodeURIComponent(location.origin), {
      method: "POST", body: { email: email }
    });
  }
  function updatePassword(pw) {
    return authed("/auth/v1/user", { method: "PUT", body: { password: pw } });
  }
  async function signOut() {
    try { if (session) await raw("/auth/v1/logout", { method: "POST", token: session.access_token }); } catch (e) { /* ignore */ }
    writeSession(null);
  }
  async function deleteAccount() {
    await authed("/rest/v1/rpc/delete_my_account", { method: "POST", body: {} });
    writeSession(null);
  }
  async function loadState() {
    var rows = await authed("/rest/v1/user_state?select=state,updated_at&limit=1");
    return rows && rows[0] ? rows[0] : null;
  }
  function saveState(state, o) {
    var row = { user_id: session.user.id, state: state, updated_at: new Date().toISOString() };
    return authed("/rest/v1/user_state?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: row,
      keepalive: !!(o && o.keepalive)
    });
  }

  /* ---------- sign-in screens ---------- */

  var VIEWS = {
    signin: {
      title: "Welcome back", sub: "Sign in to pick up where you left off.",
      btn: "Sign in", pw: "current-password", showPw: true,
      links: [["New here? Create an account", "signup"], ["Forgot your password?", "reset"]]
    },
    signup: {
      title: "Create your space", sub: "Your check-ins and journal are private to your account.",
      btn: "Create account", pw: "new-password", showPw: true, consent: true,
      links: [["Already have an account? Sign in", "signin"]]
    },
    reset: {
      title: "Reset your password", sub: "We will email you a link to set a new one.",
      btn: "Send reset link", showPw: false,
      links: [["Back to sign in", "signin"]]
    },
    newpass: {
      title: "Choose a new password", sub: "Use at least 8 characters.",
      btn: "Save password", pw: "new-password", showPw: true, noEmail: true, links: []
    }
  };

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "text") n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function field(id, label, type, autocomplete) {
    var i = el("input", { id: id, type: type, autocomplete: autocomplete, required: "", name: id });
    if (type === "password") i.setAttribute("minlength", "8");
    return el("div", { "class": "af" }, [el("label", { "for": id, text: label }), i]);
  }

  function showAuth(view, notice) {
    var v = VIEWS[view];
    var root = document.getElementById("auth");
    root.hidden = false;
    document.body.classList.add("authing");
    root.textContent = "";

    var form = el("form", { id: "auth-form", novalidate: "" });
    if (!v.noEmail) form.appendChild(field("a-email", "Email", "email", "email"));
    if (v.showPw) form.appendChild(field("a-pw", "Password", "password", v.pw));
    if (v.consent) {
      var cb = el("input", { id: "a-consent", type: "checkbox" });
      var lab = el("label", { "for": "a-consent", "class": "consent" });
      lab.appendChild(document.createTextNode("I understand PsyConnect is not an emergency or clinical service, and I agree to the "));
      lab.appendChild(el("a", { href: "/terms.html", target: "_blank", rel: "noopener", text: "Terms" }));
      lab.appendChild(document.createTextNode(" and "));
      lab.appendChild(el("a", { href: "/privacy.html", target: "_blank", rel: "noopener", text: "Privacy Policy" }));
      lab.appendChild(document.createTextNode("."));
      form.appendChild(el("div", { "class": "af row-check" }, [cb, lab]));
    }
    var err = el("p", { id: "auth-err", "class": "auth-err", role: "alert" });
    var ok = el("p", { id: "auth-ok", "class": "auth-ok", role: "status" });
    if (notice) ok.textContent = notice;
    var btn = el("button", { "class": "b", type: "submit", text: v.btn });
    form.appendChild(err);
    form.appendChild(btn);

    var links = el("p", { "class": "auth-links" });
    v.links.forEach(function (l) {
      var b = el("button", { type: "button", "class": "linkish", text: l[0] });
      b.addEventListener("click", function () { showAuth(l[1]); });
      links.appendChild(b);
    });

    var card = el("section", { "class": "c auth-card", "aria-labelledby": "auth-h" }, [
      el("p", { "class": "auth-brand", text: "PsyConnect" }),
      el("h1", { id: "auth-h", text: v.title }),
      el("p", { "class": "mut", text: v.sub }),
      ok, form, links,
      el("p", { "class": "auth-sos", text: "If you are in crisis or thinking of harming yourself, call Tele-MANAS on 14416 or KIRAN on 1800-599-0019 (India, free, 24 hours), or your local emergency number." })
    ]);
    root.appendChild(el("div", { "class": "auth-wrap" }, [card]));

    form.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      err.textContent = ""; ok.textContent = "";
      var emailEl = document.getElementById("a-email");
      var pwEl = document.getElementById("a-pw");
      var email = emailEl ? emailEl.value.trim() : "";
      var pw = pwEl ? pwEl.value : "";
      if (emailEl && !/^\S+@\S+\.\S+$/.test(email)) { err.textContent = "Enter a valid email address."; emailEl.focus(); return; }
      if (v.showPw && pw.length < 8) { err.textContent = "Use at least 8 characters for your password."; pwEl.focus(); return; }
      if (v.consent && !document.getElementById("a-consent").checked) { err.textContent = "Tick the box to continue."; return; }
      btn.disabled = true; btn.textContent = "One moment…";
      try {
        if (view === "signin") { await signIn(email, pw); finish(); }
        else if (view === "signup") {
          var r = await signUp(email, pw);
          if (r.session) finish();
          else showAuth("signin", "Account created. Check your email for a confirmation link, then sign in.");
        } else if (view === "reset") {
          await resetPassword(email);
          showAuth("signin", "If that email has an account, a reset link is on its way.");
        } else if (view === "newpass") { await updatePassword(pw); finish(); }
      } catch (e) {
        err.textContent = e.message;
        btn.disabled = false; btn.textContent = v.btn;
      }
    });
    var first = document.getElementById("a-email") || document.getElementById("a-pw");
    if (first) first.focus();
  }

  function finish() {
    var root = document.getElementById("auth");
    root.hidden = true; root.textContent = "";
    document.body.classList.remove("authing");
    if (gateResolve) { var r = gateResolve; gateResolve = null; r(session); }
  }

  /* Resolves once someone is signed in. */
  function gate(view, notice) {
    return new Promise(function (resolve) {
      gateResolve = resolve;
      showAuth(view || "signin", notice);
    });
  }

  window.PCAuth = {
    enabled: enabled,
    init: init,
    gate: gate,
    signOut: signOut,
    deleteAccount: deleteAccount,
    loadState: loadState,
    saveState: saveState,
    user: function () { return session && session.user ? session.user : null; }
  };
})();
