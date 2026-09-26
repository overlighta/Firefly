import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
const root = resolve("dist");
const port = Number(process.env.PORT || process.argv.find(a => a.startsWith("--port="))?.split("=")[1] || 4328);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".json": "application/json", ".woff2": "font/woff2" };
createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (/^\/memory\/[0-9a-f-]{36}\/?$/i.test(pathname)) pathname = "/memory/";
    let file = resolve(root, "." + pathname);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    let status = 200;
    try { if ((await stat(file)).isDirectory()) file = resolve(file, "index.html"); await stat(file); }
    catch { file = resolve(root, "404.html"); status = 404; }
    const body = await readFile(file);
    res.writeHead(status, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": pathname.startsWith("/_astro/") ? "public, max-age=31536000, immutable" : "no-cache", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet", "Referrer-Policy": "strict-origin-when-cross-origin" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch { res.writeHead(400).end("Bad request"); }
}).listen(port, "127.0.0.1", () => console.log(`Private journal preview: http://127.0.0.1:${port}`));
