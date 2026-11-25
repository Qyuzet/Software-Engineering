// HTTP routes of the worker. The dashboard (on Vercel) calls these straight from the browser.
//
//   wss  /live/ingest     laptop -> worker: JPEG frames + status JSON (Bearer EDGE_TOKEN)
//   GET  /live/video      MJPEG stream for the dashboard's <img>
//   GET  /live/frame.jpg  newest single frame
//   GET  /live/status     {online, video, count, limit, crowded, fps, esp32, db, camera, ...}
//   GET  /live/health     {ok, version, database}  (used by the deploy health check)
//   GET  /api/metrics     one day of charts/stats from Postgres (demo data without a database)
//   POST /api/logs        laptop -> worker: log rows (x-api-key: EDGE_TOKEN)

import http from "node:http";

import { createLive, tokenMatches } from "./live.js";
import { insertLogs } from "./logs.js";
import { getMetrics } from "./metrics.js";

const MAX_BODY = 1024 * 1024;

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Body must be JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

/**
 * corsOrigins: ["*"] (default: the dashboard data is public and read-only) or a list of exact
 * origins such as ["https://crowd.etzalgroup.com", "http://localhost:3000"].
 */
function corsHeaders(origin, corsOrigins) {
  if (corsOrigins.includes("*")) return { "Access-Control-Allow-Origin": "*" };
  if (origin && corsOrigins.includes(origin)) return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  return { Vary: "Origin" };
}

function sendJson(res, status, body, headers) {
  res.writeHead(status, { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

export function createWorker({
  edgeToken = "",
  db = null,
  intervalS = 10,
  corsOrigins = ["*"],
  version = "dev",
  log = console,
} = {}) {
  const live = createLive({ edgeToken, log });
  const startedAt = Date.now();

  async function route(req, res, url, cors) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...cors, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "86400" });
      return res.end();
    }
    if (req.method === "GET") {
      switch (url.pathname) {
        case "/live/video":
          return live.serveVideo(req, res, cors);
        case "/live/status":
          return sendJson(res, 200, live.status(), cors);
        case "/live/frame.jpg": {
          const frame = live.frame();
          if (!frame) return sendJson(res, 404, { error: "No frame yet" }, cors);
          res.writeHead(200, { ...cors, "Content-Type": "image/jpeg", "Cache-Control": "no-store" });
          return res.end(frame);
        }
        case "/live/health":
          return sendJson(res, 200, {
            ok: true,
            version,
            database: db ? "on" : "off",
            uptime_s: Math.round((Date.now() - startedAt) / 1000),
          }, cors);
        case "/api/metrics":
          return sendJson(res, 200, await getMetrics(db, url.searchParams, { intervalS, log }), cors);
        case "/":
          return sendJson(res, 200, { service: "crowd-worker", version, health: "/live/health" }, cors);
        default:
          break;
      }
    }
    if (req.method === "POST" && url.pathname === "/api/logs") {
      if (!tokenMatches(req.headers["x-api-key"], edgeToken)) {
        return sendJson(res, 401, { error: "Invalid API key" }, cors);
      }
      const [status, body] = await insertLogs(db, await readJson(req));
      return sendJson(res, status, body, cors);
    }
    return sendJson(res, 404, { error: "Not found" }, cors);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://worker");
    const cors = corsHeaders(req.headers.origin, corsOrigins);
    route(req, res, url, cors).catch((err) => {
      if (!err.status) log.error("[worker]", req.method, url.pathname, err);
      if (res.headersSent) return res.destroy();
      return sendJson(res, err.status || 500, { error: err.status ? err.message : "Internal error" }, cors);
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url, "http://worker");
    if (pathname === "/live/ingest") live.handleUpgrade(req, socket, head);
    else socket.destroy();
  });

  return {
    server,
    live,
    /** Ends the video streams and the laptop socket, then stops accepting connections. */
    close() {
      live.close();
      const done = new Promise((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
      return done;
    },
  };
}
