/**
 * Zero-dependency static server for local preview.
 *
 * The page needs no build and no server to work — opening index.html straight
 * from disk is enough. This exists only so the local preview matches what
 * GitHub Pages serves over http, which is handy when checking theme behaviour
 * or sharing on a LAN.
 *
 *   node tools/serve.mjs [port]
 */

import { createServer } from "http";
import { readFile } from "fs/promises";
import path from "path";

const port = Number(process.argv[2] || 4173);
const root = process.cwd();

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");
  const file = path.resolve(root, rel);

  // never serve outside the project root
  if (!file.startsWith(root)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found: " + rel);
  }
}).listen(port, () => {
  console.log(`Serving ${root}\n  http://localhost:${port}/`);
});
