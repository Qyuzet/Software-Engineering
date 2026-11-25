// Live relay. The laptop (edge/main.py) pushes JPEG frames and a status JSON over one
// WebSocket (/live/ingest); browsers get an MJPEG stream (/live/video) and the status (/live/status).
// Viewers that download slowly skip frames instead of building up delay.

import crypto from "node:crypto";

import { WebSocketServer } from "ws";

const STALE_MS = 5000;          // no status for this long = laptop offline
const EDGE_IDLE_MS = 20000;     // close a silent laptop connection after this long
const MAX_VIEWERS = 100;

/** Constant-time comparison; an empty expected token never matches. */
export function tokenMatches(got, want) {
  if (!want) return false;
  const a = Buffer.from(got || "");
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createLive({ edgeToken, log = console }) {
  const state = { frame: null, frameAt: 0, status: null, statusAt: 0, edge: null, viewers: new Set() };
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });

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

  wss.on("connection", (ws, req) => {
    if (state.edge) state.edge.terminate();        // a reconnecting laptop replaces its old, half-dead socket
    state.edge = ws;
    ws.lastMsgAt = Date.now();
    log.info(`[live] laptop connected from ${req.headers["cf-connecting-ip"] || req.socket.remoteAddress}`);

    ws.on("message", (data, isBinary) => {
      ws.lastMsgAt = Date.now();
      if (isBinary) {
        state.frame = Buffer.isBuffer(data) ? data : Buffer.concat(data);
        state.frameAt = ws.lastMsgAt;
        for (const v of state.viewers) sendFrame(v, state.frame);
        return;
      }
      try {
        state.status = JSON.parse(data.toString());
        state.statusAt = ws.lastMsgAt;
      } catch {
        /* ignore malformed status */
      }
    });
    ws.on("close", () => {
      if (state.edge === ws) {
        state.edge = null;
        log.info("[live] laptop disconnected");
      }
    });
    ws.on("error", (err) => log.warn("[live] laptop socket error:", err.message));
  });

  const idleTimer = setInterval(() => {
    const ws = state.edge;
    if (ws && Date.now() - ws.lastMsgAt > EDGE_IDLE_MS) {
      log.warn("[live] laptop silent, closing");
      ws.terminate();
    }
  }, 5000);
  idleTimer.unref();

  return {
    /** Upgrade handler for /live/ingest. Needs "Authorization: Bearer <EDGE_TOKEN>". */
    handleUpgrade(req, socket, head) {
      const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!tokenMatches(got, edgeToken)) {
        socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    },

    serveVideo(req, res, headers = {}) {
      if (state.viewers.size >= MAX_VIEWERS) {
        res.writeHead(503, headers).end("too many viewers");
        return;
      }
      res.writeHead(200, {
        ...headers,
        "Content-Type": "multipart/x-mixed-replace; boundary=frame",
        "Cache-Control": "no-cache, no-store, no-transform",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      });
      req.socket.setNoDelay(true);
      const viewer = { res, busy: false };
      state.viewers.add(viewer);
      if (state.frame && Date.now() - state.frameAt < STALE_MS) sendFrame(viewer, state.frame);
      const bye = () => state.viewers.delete(viewer);
      req.on("close", bye);
      res.on("error", bye);
    },

    frame: () => state.frame,

    status() {
      const now = Date.now();
      const online = state.edge !== null && now - state.statusAt < STALE_MS;
      return {
        ...(online ? state.status : {}),
        online,
        video: online && now - state.frameAt < STALE_MS,
        viewers: state.viewers.size,
        time: state.statusAt || null,
      };
    },

    close() {
      clearInterval(idleTimer);
      state.edge?.terminate();
      for (const v of state.viewers) v.res.end();
      state.viewers.clear();
      wss.close();
    },
  };
}
