// Tiny static server for local development and tests. No dependencies.
// Serves ./public. If SUPABASE_URL and SUPABASE_ANON_KEY are set it serves a matching /js/config.js.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const port = Number(process.env.PORT || 3000);
// Apply the same security headers as vercel.json so local runs match production.
let secHeaders = {};
try {
  const cfg = JSON.parse(readFileSync(join(root, "..", "vercel.json"), "utf8"));
  for (const h of cfg.headers[0].headers) secHeaders[h.key] = h.value;
  if (process.env.SUPABASE_URL && secHeaders["Content-Security-Policy"]) {
    const origin = new URL(process.env.SUPABASE_URL).origin;
    secHeaders["Content-Security-Policy"] = secHeaders["Content-Security-Policy"].replace("connect-src 'self'", "connect-src 'self' " + origin);
  }
} catch { /* run without extra headers */ }
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/js/config.js" && process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    res.writeHead(200, { ...secHeaders, "Content-Type": types[".js"], "Cache-Control": "no-store" });
    return res.end("window.PC_CONFIG=" + JSON.stringify({ supabaseUrl: process.env.SUPABASE_URL, supabaseAnonKey: process.env.SUPABASE_ANON_KEY }) + ";");
  }
  if (path === "/") path = "/index.html";
  if (!extname(path)) path += ".html";
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { ...secHeaders, "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}).listen(port, () => console.log("PsyConnect dev server on http://localhost:" + port));
