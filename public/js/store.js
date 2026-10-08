/* PsyConnect persistence.
   The app keeps its working state in the global S (see app.js). This module loads the
   signed-in user's saved state into S, then watches S after every draw() and saves
   changes. Rule: nothing is ever saved until the first load has succeeded, so a failed
   load can never overwrite real data with an empty state. */
(function () {
  "use strict";

  var KEYS = ["streak", "lastDay", "hist", "ent", "bm", "appt", "owned", "stk", "sv", "prep", "lang"];
  var DEMO_KEY = "pc.demo.state.v1";
  var lastJson = "";
  var timer = null;
  var saving = false;
  var pending = false;
  var ready = false;
  var disabled = false;
  var warned = false;

  function snapshotObj() {
    var o = {};
    KEYS.forEach(function (k) { if (S[k] !== undefined) o[k] = S[k]; });
    return o;
  }

  /* Give every new check-in and journal entry a timestamp so labels stay correct. */
  function stamp() {
    var now = Date.now();
    S.hist.forEach(function (h) {
      if (!h[6]) { while (h.length < 6) h.push(""); h[6] = now; }
    });
    S.ent.forEach(function (x) { if (!x.ts) x.ts = now; });
  }

  function dayDiff(ts) {
    var a = new Date(ts), b = new Date();
    a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0);
    return Math.round((b - a) / 864e5);
  }

  /* Recompute "Today", "Mon", "2 days ago" style labels from the stored timestamps. */
  function relabel() {
    S.hist.forEach(function (h) {
      if (!h[6]) return;
      var d = dayDiff(h[6]);
      h[3] = d;
      h[0] = d === 0 ? "Today" : d < 7 ? new Date(h[6]).toLocaleDateString("en-US", { weekday: "short" }) : "";
    });
    S.ent.forEach(function (x) {
      if (!x.ts) return;
      var d = dayDiff(x.ts), t = new Date(x.ts);
      x.d = d === 0 ? "Today"
        : d < 7 ? t.toLocaleDateString("en-US", { weekday: "short" }) + ", " + t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : t.toLocaleDateString("en-US", { day: "numeric", month: "short" });
    });
  }

  function hydrate(state) {
    if (state && typeof state === "object") {
      KEYS.forEach(function (k) { if (state[k] !== undefined) S[k] = state[k]; });
    }
    if (!Array.isArray(S.hist)) S.hist = [];
    S.hist = S.hist.filter(Array.isArray);
    if (!Array.isArray(S.ent)) S.ent = [];
    S.ent = S.ent.filter(function (x) { return x && typeof x === "object"; });
    if (!S.bm || typeof S.bm !== "object" || Array.isArray(S.bm)) S.bm = {};
    ["owned", "stk", "sv"].forEach(function (k) { if (!Array.isArray(S[k])) S[k] = []; });
    if (!S.prep || typeof S.prep !== "object") S.prep = {};
    if (typeof S.lang !== "string") S.lang = "English";
    if (typeof S.streak !== "number" || S.streak < 0) S.streak = 0;

    var today = PCday();
    if (S.lastDay === today) {
      S.did = true;
    } else {
      S.did = false;
      if (S.lastDay) {
        var gap = Math.round((Date.parse(today) - Date.parse(S.lastDay)) / 864e5);
        if (gap > 1) S.streak = 0;
      }
    }
    relabel();
    lastJson = JSON.stringify(snapshotObj());
  }

  async function load() {
    var state = null;
    if (PCAuth.enabled) {
      var row = await PCAuth.loadState();
      state = row ? row.state : null;
    } else {
      try { state = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch (e) { state = null; }
    }
    hydrate(state);
    ready = true;
  }

  function status(kind, err) {
    if (kind === "error") {
      if (err && err.status === 401) {
        md('<h2 style="margin:0">Your session ended</h2><p>Sign in again to keep saving. Your last changes may not be saved.</p><p><button class="b" onclick="location.reload()">Sign in</button></p>');
      } else if (!warned) {
        warned = true;
        toast("Could not save. We will keep trying.");
      }
    } else if (warned) {
      warned = false;
      toast("Saved.");
    }
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(function () { flush(false); }, ms);
  }

  async function flush(keepalive) {
    if (!ready || disabled || saving || !pending) return;
    saving = true;
    pending = false;
    var json = lastJson;
    var ok = false, error = null;
    try {
      if (PCAuth.enabled) {
        await PCAuth.saveState(JSON.parse(json), { keepalive: !!keepalive && json.length < 60000 });
      } else {
        localStorage.setItem(DEMO_KEY, json);
      }
      ok = true;
    } catch (e) {
      error = e;
    }
    saving = false;
    if (ok) {
      status("saved");
      if (pending) schedule(300);
    } else {
      pending = true;
      status("error", error);
      if (!(error && error.status === 401)) schedule(10000);
    }
  }

  /* Called after every draw(). */
  function touch() {
    if (!ready || disabled) return;
    stamp();
    var j = JSON.stringify(snapshotObj());
    if (j === lastJson) return;
    lastJson = j;
    pending = true;
    schedule(800);
  }

  function exportData() {
    return JSON.stringify({ exportedAt: new Date().toISOString(), app: "PsyConnect", data: snapshotObj() }, null, 2);
  }

  function stop() { disabled = true; clearTimeout(timer); }
  function clearDemo() { try { localStorage.removeItem(DEMO_KEY); } catch (e) { /* ignore */ } }

  window.PCStore = { load: load, touch: touch, flush: flush, exportData: exportData, stop: stop, clearDemo: clearDemo };
})();
