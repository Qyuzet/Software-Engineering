/*
 * server.js - v2 hub: the Next.js dashboard plus the live video relay, on one port.
 *
 *   wss  /live/ingest     the laptop (edge/main.py) pushes JPEG frames + status JSON here.
 *                         Needs "Authorization: Bearer <EDGE_TOKEN>".
 *   GET  /live/video      MJPEG stream for the dashboard's <img> (any number of viewers)
 *   GET  /live/frame.jpg  the newest single frame
 *   GET  /live/status     {online, video, count, limit, crowded, fps, esp32, db, camera, ...}
 *   everything else       the Next.js dashboard and its /api routes (Postgres on this server)
 *
 * The laptop only makes outgoing connections, so it works from any Wi-Fi or hotspot.
 * Viewers that are slow to download skip frames instead of building up delay.
 */

const crypto = require("node:crypto");
const http = require("node:http");
const { parse } = require("node:url");

const dev = process.env.NODE_ENV !== "production";
require("@next/env").loadEnvConfig(process.cwd(), dev);

const next = require("next");
const { WebSocketServer } = require("ws");

const port = Number(process.env.PORT) || 3020;
const hostname = process.env.HOST || "127.0.0.1";
const EDGE_TOKEN = process.env.EDGE_TOKEN || "";
const STALE_MS = 5000;          // no status for this long = edge offline
const EDGE_IDLE_MS = 20000;     // close a silent edge connection after this long
const MAX_VIEWERS = 100;

if (!EDGE_TOKEN) console.warn("[hub] EDGE_TOKEN is not set: the laptop cannot connect until it is.");

// ---------------- live state (in memory) ----------------
const live = { frame: null, frameAt: 0, status: null, statusAt: 0, edge: null, viewers: new Set() };

function tokenOk(header) {
  const got = Buffer.from((header || "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(EDGE_TOKEN);
  return EDGE_TOKEN && got.length === want.length && crypto.timingSafeEqual(got, want);
}

function sendFrame(viewer, jpeg) {
  if (viewer.busy) return;                       // still sending an older frame: skip this one
  const ok = viewer.res.write(Buffer.concat([
    Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`),
    jpeg,
    Buffer.from("\r\n"),
  ]));
  if (!ok) {
    viewer.busy = true;
    viewer.res.once("drain", () => { viewer.busy = false; });
  }
}

function statusBody() {
  const now = Date.now();
  const online = live.edge !== null && now - live.statusAt < STALE_MS;
  return {
    ...(online ? live.status : {}),
    online,
    video: online && now - live.frameAt < STALE_MS,
    viewers: live.viewers.size,
    time: live.statusAt || null,
  };
}

// ---------------- edge ingest (WebSocket) ----------------
const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });

wss.on("connection", (ws, req) => {
  if (live.edge) live.edge.terminate();        // a reconnecting laptop replaces its old, half-dead socket
  live.edge = ws;
  ws.lastMsgAt = Date.now();
  console.log(`[hub] edge connected from ${req.headers["cf-connecting-ip"] || req.socket.remoteAddress}`);

  ws.on("message", (data, isBinary) => {
    ws.lastMsgAt = Date.now();
    if (isBinary) {
      live.frame = Buffer.isBuffer(data) ? data : Buffer.concat(data);
      live.frameAt = ws.lastMsgAt;
      for (const v of live.viewers) sendFrame(v, live.frame);
      return;
    }
    try {
      live.status = JSON.parse(data.toString());
      live.statusAt = ws.lastMsgAt;
    } catch {
      /* ignore malformed status */
    }
  });
  ws.on("close", () => {
    if (live.edge === ws) {
      live.edge = null;
      console.log("[hub] edge disconnected");
    }
  });
  ws.on("error", (err) => console.warn("[hub] edge socket error:", err.message));
});

setInterval(() => {
  const ws = live.edge;
  if (ws && Date.now() - ws.lastMsgAt > EDGE_IDLE_MS) {
    console.warn("[hub] edge silent, closing");
    ws.terminate();
  }
}, 5000).unref();

// ---------------- viewer endpoints ----------------
function serveVideo(req, res) {
  if (live.viewers.size >= MAX_VIEWERS) {
    res.writeHead(503).end("too many viewers");
    return;
  }
  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=frame",
    "Cache-Control": "no-cache, no-store, no-transform",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
  });
  req.socket.setNoDelay(true);
  const viewer = { res, busy: false };
  live.viewers.add(viewer);
  if (live.frame && Date.now() - live.frameAt < STALE_MS) sendFrame(viewer, live.frame);
  const bye = () => live.viewers.delete(viewer);
  req.on("close", bye);
  res.on("error", bye);
}

function serveJson(res, body) {
  const text = JSON.stringify(body);
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(text);
}

// ---------------- start ----------------
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const nextUpgrade = typeof app.getUpgradeHandler === "function" ? app.getUpgradeHandler() : null;

  const server = http.createServer((req, res) => {
    const url = parse(req.url, true);
    if (req.method === "GET" && url.pathname === "/live/video") return serveVideo(req, res);
    if (req.method === "GET" && url.pathname === "/live/status") return serveJson(res, statusBody());
    if (req.method === "GET" && url.pathname === "/live/frame.jpg") {
      if (!live.frame) return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" });
      return res.end(live.frame);
    }
    if (url.pathname === "/live/health") return serveJson(res, { ok: true });
    return handle(req, res, url);
  });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url);
    if (pathname === "/live/ingest") {
      if (!tokenOk(req.headers.authorization)) {
        socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } else if (dev && nextUpgrade) {
      nextUpgrade(req, socket, head);       // Next.js hot reload in `npm run dev`
    } else {
      socket.destroy();
    }
  });

  server.listen(port, hostname, () => {
    console.log(`[hub] ${dev ? "dev" : "production"} server on http://${hostname}:${port}`);
  });
});
