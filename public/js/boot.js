/* PsyConnect boot: sign in -> load saved data -> start the app. */
(function () {
  "use strict";

  function byId(id) { return document.getElementById(id); }

  function fatal(message, retry) {
    var root = byId("auth");
    root.hidden = false;
    document.body.classList.add("authing");
    root.textContent = "";
    var card = document.createElement("section");
    card.className = "c auth-card";
    var h = document.createElement("h1");
    h.textContent = "We could not load PsyConnect";
    var p = document.createElement("p");
    p.textContent = message;
    var b = document.createElement("button");
    b.className = "b";
    b.textContent = "Try again";
    b.addEventListener("click", function () {
      root.hidden = true; root.textContent = "";
      document.body.classList.remove("authing");
      retry();
    });
    card.appendChild(h); card.appendChild(p); card.appendChild(b);
    var wrap = document.createElement("div");
    wrap.className = "auth-wrap";
    wrap.appendChild(card);
    root.appendChild(wrap);
    b.focus();
  }

  function accountDialog() {
    var u = PCAuth.user();
    var who = PCAuth.enabled
      ? '<p class="mut">Signed in as <b>' + esc(u && u.email ? u.email : "your account") + "</b></p>"
      : '<p class="mut">Demo mode. Your data stays in this browser only.</p>';
    md(
      '<h2 style="margin:0">Your account</h2>' + who +
      '<p class="row n">' +
      (PCAuth.enabled ? '<button class="b a" id="ac-out">Sign out</button>' : "") +
      '<button class="b a" id="ac-exp">Download my data</button>' +
      '<button class="b r" id="ac-del">Delete my data' + (PCAuth.enabled ? " and account" : "") + "</button></p>" +
      '<p class="mut">Deleting removes everything stored about you and cannot be undone.</p>'
    );
    var out = byId("ac-out");
    if (out) out.addEventListener("click", async function () {
      out.disabled = true;
      await PCStore.flush(false);
      PCStore.stop();
      await PCAuth.signOut();
      location.reload();
    });
    byId("ac-exp").addEventListener("click", function () {
      var blob = new Blob([PCStore.exportData()], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "psyconnect-data.json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
    byId("ac-del").addEventListener("click", async function () {
      var msg = PCAuth.enabled
        ? "Delete your account and all your check-ins and journal entries? This cannot be undone."
        : "Delete everything saved in this browser? This cannot be undone.";
      if (!confirm(msg)) return;
      PCStore.stop();
      try {
        if (PCAuth.enabled) await PCAuth.deleteAccount();
        else PCStore.clearDemo();
      } catch (e) {
        toast("Could not delete: " + e.message);
        return;
      }
      location.reload();
    });
  }

  function launch() {
    var original = draw;
    draw = function () { original(); PCStore.touch(); };
    var acct = byId("acct");
    acct.hidden = false;
    acct.addEventListener("click", accountDialog);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") PCStore.flush(true);
    });
    addEventListener("pagehide", function () { PCStore.flush(true); });
    draw();
  }

  async function main() {
    if (PCAuth.enabled) {
      var st;
      try { st = await PCAuth.init(); }
      catch (e) { return fatal(e.message, main); }
      if (!st.session) await PCAuth.gate("signin", st.error || "");
      else if (st.type === "recovery") await PCAuth.gate("newpass");
    } else {
      byId("demo-banner").hidden = false;
    }
    try { await PCStore.load(); }
    catch (e) { return fatal("Your saved data could not be loaded. " + e.message, main); }
    launch();
  }

  main();
})();
