/**
 * Coolify static host + APM.  Reuses fleet DD_* env vars.  Production
 * fails closed without DD_API_KEY.  Never put that key in the Vite bundle.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const distDir = resolve(rootDir, "dist");
const port = Number(process.env.PORT || 3000);
const env = (process.env.DD_ENV || process.env.NODE_ENV || "").trim();
const requireDatadog = env === "production" || process.env.DD_REQUIRE === "1";
const apiKey = (process.env.DD_API_KEY || "").trim();

if (requireDatadog && !apiKey) {
  throw new Error("DD_API_KEY missing.  Refusing to start.");
}

if (apiKey || process.env.DD_AGENT_HOST) {
  const { default: tracer } = await import("dd-trace");
  tracer.init({
    service: process.env.DD_SERVICE || "contactlogo-web",
    env: env || "development",
    version: process.env.DD_VERSION || "unknown",
    hostname: process.env.DD_AGENT_HOST || "127.0.0.1",
    port: process.env.DD_TRACE_AGENT_PORT || "8126",
    sampleRate: env === "production" ? 0.2 : 1.0,
    logInjection: true,
    runtimeMetrics: true,
    plugins: true,
  });
}

const types = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json"],
  [".woff2", "font/woff2"],
]);

function safeFile(urlPath) {
  const raw = decodeURIComponent((urlPath || "/").split("?")[0] || "/");
  const relative = raw === "/" ? "index.html" : raw.replace(/^\/+/, "");
  const resolved = normalize(join(distDir, relative));
  if (!resolved.startsWith(distDir)) return null;
  return resolved;
}

function logLine(fields) {
  process.stdout.write(`${JSON.stringify(fields)}\n`);
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = req.url || "/";
  const method = req.method || "GET";

  try {
    if (url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }

    let file = safeFile(url);
    if (!file) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("bad request");
      return;
    }

    let body;
    try {
      body = await readFile(file);
    } catch {
      if (extname(file) === "") {
        file = join(distDir, "index.html");
        body = await readFile(file);
      } else {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
    }

    res.writeHead(200, {
      "content-type": types.get(extname(file)) || "application/octet-stream",
    });
    res.end(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logLine({
      status: "error",
      service: process.env.DD_SERVICE || "contactlogo-web",
      env: env || "development",
      method,
      url,
      error: message,
    });
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end(message);
  } finally {
    logLine({
      status: "info",
      service: process.env.DD_SERVICE || "contactlogo-web",
      env: env || "development",
      method,
      url,
      http: { status_code: res.statusCode, method },
      duration_ms: Date.now() - started,
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  logLine({
    status: "info",
    service: process.env.DD_SERVICE || "contactlogo-web",
    env: env || "development",
    message: `contactlogo-web listening on ${port}`,
  });
});
