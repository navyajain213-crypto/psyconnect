// End-to-end tests. Needs Playwright:  npm i --no-save playwright && npx playwright install chromium
// Run:  node tests/e2e.mjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startMock } from "./mock-supabase.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; failures.push(name); console.log("  FAIL " + name + (detail ? "  -> " + detail : "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(port, env = {}) {
  const p = spawn("node", ["scripts/dev.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), ...env }, stdio: "ignore" });
  return p;
}
async function waitUp(url) {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error("server did not start: " + url);
}

function watch(page, errors) {
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/ERR_|Failed to load resource|fonts\.g/i.test(t)) return; // offline fonts
    errors.push("console: " + t);
  });
  page.on("dialog", (d) => d.accept());
}

async function mockState() { return (await fetch("http://127.0.0.1:54321/__test/state")).json(); }
async function mockPost(path, body) {
  await fetch("http://127.0.0.1:54321" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
async function waitFor(fn, ms = 5000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await fn()) return true; await sleep(100); }
  return false;
}

async function appReady(page) {
  await page.waitForFunction(() => document.querySelector("#m") && document.querySelector("#m").innerHTML.length > 50, null, { timeout: 8000 });
}

async function checkinAndJournal(page, title, body) {
  await page.evaluate(() => { go("feel"); pk(0, 0, 0); trk(); });
  await page.evaluate(() => { S.ed = { e: "Content" }; go("journal"); });
  await page.fill("#jt", title);
  await page.fill("#jb", body);
  await page.evaluate(() => saveE());
}

async function signUpFlow(page, base, email, pw) {
  await page.goto(base);
  await page.waitForSelector("#auth-form");
  await page.click("text=New here? Create an account");
  await page.fill("#a-email", email);
  await page.fill("#a-pw", pw);
  await page.check("#a-consent");
  await page.click("#auth-form button[type=submit]");
}

const browser = await chromium.launch();
const procs = [];
let mock;

try {
  mock = await startMock(54321);

  /* ============ DEMO MODE (no Supabase configured) ============ */
  console.log("\nDemo mode");
  procs.push(startServer(3100));
  await waitUp("http://localhost:3100/");
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    watch(page, errors);
    await page.goto("http://localhost:3100/");
    await appReady(page);
    check("app renders without sign-in", await page.locator("#auth").isHidden());
    check("demo banner is visible", await page.locator("#demo-banner").isVisible());
    check("account button is visible", await page.locator("#acct").isVisible());

    const views = await page.evaluate(() => Object.keys(R));
    check("found app views", views.length >= 10, String(views.length));
    for (const v of views) {
      const before = errors.length;
      let html = "";
      try { html = await page.evaluate((x) => { go(x); return document.querySelector("#m").innerHTML; }, v); }
      catch (e) { errors.push("eval " + v + ": " + e.message); }
      await sleep(30);
      check("empty-state view '" + v + "' renders cleanly", html.length > 20 && errors.length === before, errors.slice(before).join(" | "));
    }

    await checkinAndJournal(page, "First entry", "Feeling steady today.");
    const st = await page.evaluate(() => ({ h: S.hist.length, e: S.ent.length, s: S.streak }));
    check("check-in and journal entry recorded", st.h === 1 && st.e === 1 && st.s === 1, JSON.stringify(st));
    await sleep(1300);
    await page.reload();
    await appReady(page);
    const st2 = await page.evaluate(() => ({ h: S.hist.length, e: S.ent.length, s: S.streak, did: S.did, lab: S.ent[0] && S.ent[0].d }));
    check("data survives a reload", st2.h === 1 && st2.e === 1 && st2.s === 1 && st2.did === true, JSON.stringify(st2));
    check("entry label is computed from its date", st2.lab === "Today", st2.lab);

    await page.evaluate(() => { S.ed = { e: "Content" }; go("journal"); });
    await page.fill("#jt", '<img src=x onerror="window.__x=1">');
    await page.fill("#jb", "<script>window.__y=1</script> body");
    await page.evaluate(() => saveE());
    await page.evaluate(() => go("journal"));
    await sleep(200);
    const xss = await page.evaluate(() => ({ x: window.__x, y: window.__y, text: document.querySelector("#m").innerText }));
    check("journal text is escaped (no script runs)", xss.x === undefined && xss.y === undefined && xss.text.includes("<img src=x"), JSON.stringify(xss).slice(0, 160));

    await page.click("#acct");
    await page.click("#ac-del");
    await page.waitForLoadState("load");
    await appReady(page);
    const st3 = await page.evaluate(() => ({ h: S.hist.length, e: S.ent.length }));
    check("delete my data clears everything", st3.h === 0 && st3.e === 0, JSON.stringify(st3));
    check("no script errors in demo mode", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  /* ============ SUPABASE MODE (mock backend) ============ */
  console.log("\nSupabase mode");
  const env = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: "test-anon-key" };
  procs.push(startServer(3101, env));
  await waitUp("http://localhost:3101/");
  const base = "http://localhost:3101/";
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    watch(page, errors);

    await page.goto(base);
    await page.waitForSelector("#auth-form");
    check("signed-out visitors see only the sign-in screen", await page.evaluate(() => document.body.classList.contains("authing") && getComputedStyle(document.querySelector("#m")).display === "none"));
    check("crisis helpline is on the sign-in screen", (await page.locator(".auth-sos").innerText()).includes("14416"));

    await page.fill("#a-email", "nobody@example.com");
    await page.fill("#a-pw", "wrongpass1");
    await page.click("#auth-form button[type=submit]");
    await page.waitForFunction(() => document.querySelector("#auth-err").textContent.length > 0);
    check("wrong credentials show a clear error", (await page.locator("#auth-err").innerText()).includes("do not match"));

    await page.click("text=New here? Create an account");
    await page.fill("#a-email", "asha@example.com");
    await page.fill("#a-pw", "short");
    await page.check("#a-consent");
    await page.click("#auth-form button[type=submit]");
    check("short password is rejected before any request", (await page.locator("#auth-err").innerText()).includes("8 characters"));

    await page.fill("#a-pw", "correct horse 9");
    await page.uncheck("#a-consent");
    await page.click("#auth-form button[type=submit]");
    check("sign-up needs consent", (await page.locator("#auth-err").innerText()).includes("Tick the box"));

    await page.check("#a-consent");
    await page.click("#auth-form button[type=submit]");
    await appReady(page);
    check("sign-up signs the user in and starts the app", await page.locator("#auth").isHidden());

    let s = await mockState();
    const firstRest = s.log.find((l) => l.path.startsWith("/rest/v1/user_state"));
    check("data is loaded before anything is saved", firstRest && firstRest.method === "GET", JSON.stringify(firstRest));

    await checkinAndJournal(page, "Evening note", "Walked by the river.");
    const saved = await waitFor(async () => { const m = await mockState(); const r = Object.values(m.rows)[0]; return r && r.state.ent && r.state.ent.length === 1; });
    check("journal entry is saved to the backend", saved);
    s = await mockState();
    const row = Object.values(s.rows)[0];
    check("saved state includes check-in, streak and day", row && row.state.hist.length === 1 && row.state.streak === 1 && row.state.lastDay, JSON.stringify(row && Object.keys(row.state)));

    await page.reload();
    await appReady(page);
    const st = await page.evaluate(() => ({ e: S.ent.length, t: S.ent[0] && S.ent[0].t }));
    check("reload keeps the session and restores data", st.e === 1 && st.t === "Evening note", JSON.stringify(st));

    await page.click("#acct");
    check("account dialog shows the signed-in email", (await page.locator("#mo").innerText()).includes("asha@example.com"));
    await page.click("#ac-out");
    await page.waitForSelector("#auth-form");
    check("sign out returns to the sign-in screen", true);
    check("sign out clears the stored session", await page.evaluate(() => !localStorage.getItem("pc.session.v1")));

    await page.fill("#a-email", "asha@example.com");
    await page.fill("#a-pw", "correct horse 9");
    await page.click("#auth-form button[type=submit]");
    await appReady(page);
    check("signing back in restores the data", (await page.evaluate(() => S.ent.length)) === 1);

    // a second account must not see the first account's data
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    watch(p2, errors);
    await signUpFlow(p2, base, "ravi@example.com", "another pass 77");
    await appReady(p2);
    check("a different account starts empty (isolation)", (await p2.evaluate(() => S.ent.length + S.hist.length)) === 0);
    await ctx2.close();

    // streak reset after a gap
    const old = new Date(Date.now() - 3 * 864e5);
    await mockPost("/__test/seed", { email: "asha@example.com", state: { streak: 5, lastDay: old.toLocaleDateString("en-CA"), hist: [["Today", "Content", 0, 0, 3, "", old.getTime()]], ent: [] } });
    await page.reload();
    await appReady(page);
    const gap = await page.evaluate(() => ({ s: S.streak, did: S.did, d: S.hist[0][3], l: S.hist[0][0] }));
    check("streak resets after a missed day", gap.s === 0 && gap.did === false, JSON.stringify(gap));
    check("old check-in labels are recomputed", gap.d === 3 && gap.l !== "Today", JSON.stringify(gap));

    // failed load must never overwrite saved data
    await mockPost("/__test/seed", { email: "asha@example.com", state: { streak: 4, lastDay: PCdayLocal(), ent: [{ t: "Keep me", b: "x", e: "Content", tg: "t", d: "Today", fav: 0, ts: Date.now() }], hist: [] } });
    await mockPost("/__test/flags", { failLoad: true });
    const postsBefore = (await mockState()).log.filter((l) => l.method === "POST" && l.path.startsWith("/rest/v1/user_state")).length;
    await page.reload();
    await page.waitForSelector("text=We could not load PsyConnect");
    await sleep(1200);
    const postsAfter = (await mockState()).log.filter((l) => l.method === "POST" && l.path.startsWith("/rest/v1/user_state")).length;
    check("load failure shows a retry screen", true);
    check("nothing is saved after a failed load", postsAfter === postsBefore, postsBefore + " -> " + postsAfter);
    await mockPost("/__test/flags", { failLoad: false });
    await page.click("text=Try again");
    await appReady(page);
    check("retry recovers and shows the saved data", (await page.evaluate(() => S.ent[0] && S.ent[0].t)) === "Keep me");

    // delete account
    await page.click("#acct");
    await page.click("#ac-del");
    await page.waitForSelector("#auth-form");
    s = await mockState();
    check("delete account removes the user and their data", !s.users.find((u) => u.email === "asha@example.com") && Object.keys(s.rows).length <= 1);
    check("no script errors in Supabase mode", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  /* email confirmation flow */
  {
    await mockPost("/__test/flags", { confirm: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    watch(page, errors);
    await signUpFlow(page, base, "meera@example.com", "confirm me 123");
    await page.waitForSelector("text=Check your email");
    check("sign-up with email confirmation asks the user to check email", true);
    await page.fill("#a-email", "meera@example.com");
    await page.fill("#a-pw", "confirm me 123");
    await page.click("#auth-form button[type=submit]");
    await page.waitForFunction(() => document.querySelector("#auth-err").textContent.length > 0);
    check("unconfirmed account cannot sign in yet", (await page.locator("#auth-err").innerText()).includes("Confirm your email"));
    check("no script errors in confirmation flow", errors.length === 0, errors.join(" | "));
    await ctx.close();
    await mockPost("/__test/flags", { confirm: false });
  }

  /* production headers */
  {
    const r = await fetch(base);
    const csp = r.headers.get("content-security-policy") || "";
    check("CSP header is applied", csp.includes("default-src 'self'") && csp.includes("frame-ancestors 'none'"));
  }
} finally {
  await browser.close();
  procs.forEach((p) => p.kill());
  mock && mock.server.close();
}

function PCdayLocal() { return new Date().toLocaleDateString("en-CA"); }

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) { console.log("Failed: " + failures.join("; ")); process.exit(1); }
