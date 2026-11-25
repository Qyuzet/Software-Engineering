// Run with: npm test
// Postgres tests run only when TEST_DATABASE_URL is set (CI sets it). They write rows dated
// 2001-02-03 with event_id "citest-..." and delete them again.

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";

import WebSocket from "ws";

import { createDb } from "../src/db.js";
import { createWorker } from "../src/server.js";

const TOKEN = "test-edge-token-0123456789";
const quiet = { log() {}, info() {}, warn() {}, error() {} };

async function startWorker(opts = {}) {
  const w = createWorker({ edgeToken: TOKEN, version: "test-rev", log: quiet, ...opts });
  await new Promise((resolve) => w.server.listen(0, "127.0.0.1", resolve));
  const { port } = w.server.address();
  return { ...w, base: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}` };
}

async function until(check, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

function connectEdge(url, token = TOKEN) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${url}/live/ingest`, { headers: { Authorization: `Bearer ${token}` } });
    ws.once("open", () => resolve(ws));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once("error", reject);
  });
}

const postLogs = (base, body, key = TOKEN) =>
  fetch(`${base}/api/logs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify(body),
  });

describe("worker without a database", () => {
  let w;
  before(async () => { w = await startWorker(); });
  after(() => w.close());

  test("health reports the version, with CORS for the dashboard", async () => {
    const res = await fetch(`${w.base}/live/health`, { headers: { Origin: "https://crowd.etzalgroup.com" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(
      { ...(await res.json()), uptime_s: 0 },
      { ok: true, version: "test-rev", database: "off", uptime_s: 0 },
    );
  });

  test("status is offline before the laptop connects", async () => {
    const s = await (await fetch(`${w.base}/live/status`)).json();
    assert.equal(s.online, false);
    assert.equal(s.video, false);
  });

  test("metrics fall back to demo data", async () => {
    const m = await (await fetch(`${w.base}/api/metrics?date=2026-01-05&tz=Asia/Jakarta`)).json();
    assert.equal(m.source, "demo");
    assert.equal(m.date, "2026-01-05");
    assert.equal(m.tz, "Asia/Jakarta");
    assert.ok(m.series.length > 100);
    assert.equal(m.hourly.length, 24);
    assert.ok(m.stats.samples > 0);
  });

  test("bad metrics parameters are replaced, not errors", async () => {
    const m = await (await fetch(`${w.base}/api/metrics?date=nope&tz=Not/AZone`)).json();
    assert.equal(m.tz, "UTC");
    assert.match(m.date, /^\d{4}-\d{2}-\d{2}$/);
  });

  test("log upload needs the token, and a database", async () => {
    assert.equal((await postLogs(w.base, { person_count: 1, crowd_limit: 10 }, "wrong")).status, 401);
    assert.equal((await postLogs(w.base, { person_count: 1, crowd_limit: 10 }, "")).status, 401);
    assert.equal((await postLogs(w.base, { person_count: 1, crowd_limit: 10 })).status, 503);
  });

  test("unknown paths are 404", async () => {
    assert.equal((await fetch(`${w.base}/nope`)).status, 404);
  });
});

describe("live relay", () => {
  let w;
  before(async () => { w = await startWorker(); });
  after(() => w.close());

  test("a wrong token cannot stream", async () => {
    await assert.rejects(connectEdge(w.ws, "wrong-token"), /401/);
  });

  test("frames and status from the laptop reach viewers", async () => {
    const edge = await connectEdge(w.ws);
    const jpeg = Buffer.from([0xff, 0xd8, 1, 2, 3, 4, 0xff, 0xd9]);

    // A viewer that is already watching gets the next frame pushed to it
    const got = new Promise((resolve, reject) => {
      http.get(`${w.base}/live/video`, (res) => {
        assert.match(res.headers["content-type"], /multipart\/x-mixed-replace/);
        let buf = Buffer.alloc(0);
        res.on("data", (c) => {
          buf = Buffer.concat([buf, c]);
          if (buf.includes(jpeg)) {
            res.destroy();
            resolve(buf);
          }
        });
      }).on("error", reject);
    });
    await until(() => w.live.status().viewers === 1);

    edge.send(JSON.stringify({ count: 7, limit: 10, crowded: false, fps: 5 }));
    edge.send(jpeg);

    const part = (await got).toString("latin1");
    assert.match(part, /--frame\r\nContent-Type: image\/jpeg\r\nContent-Length: 8/);

    const s = await until(async () => {
      const body = await (await fetch(`${w.base}/live/status`)).json();
      return body.online && body.video && body;
    });
    assert.equal(s.count, 7);
    assert.equal(s.crowded, false);

    const frame = Buffer.from(await (await fetch(`${w.base}/live/frame.jpg`)).arrayBuffer());
    assert.deepEqual(frame, jpeg);
    edge.close();
    await until(async () => !(await (await fetch(`${w.base}/live/status`)).json()).online);
  });

  test("a reconnecting laptop replaces its old connection", async () => {
    const first = await connectEdge(w.ws);
    const closed = new Promise((resolve) => first.once("close", resolve));
    const second = await connectEdge(w.ws);
    await closed;
    assert.equal(second.readyState, WebSocket.OPEN);
    second.close();
  });
});

describe("worker with Postgres", { skip: !process.env.TEST_DATABASE_URL && "set TEST_DATABASE_URL to run" }, () => {
  let w;
  let db;
  const day = "2001-02-03";
  const row = (i, extra = {}) => ({
    event_id: `citest-${process.pid}-${i}`,
    recorded_at: `${day}T10:0${i}:00Z`,
    person_count: 8 + i,
    crowd_limit: 10,
    is_crowded: 8 + i > 10,
    ...extra,
  });

  before(async () => {
    db = createDb(process.env.TEST_DATABASE_URL, quiet);
    w = await startWorker({ db });
  });
  after(async () => {
    await db.query("DELETE FROM crowd_logs WHERE event_id LIKE 'citest-%'");
    await w.close();
    await db.end();
  });

  test("rows are stored once, even when the upload is retried", async () => {
    const rows = [0, 1, 2, 3, 4].map((i) => row(i));
    let res = await postLogs(w.base, { rows });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { ok: true, inserted: 5, received: 5 });

    res = await postLogs(w.base, { rows });                // same batch again (e.g. lost reply)
    assert.deepEqual(await res.json(), { ok: true, inserted: 0, received: 5 });
  });

  test("invalid rows are refused", async () => {
    assert.equal((await postLogs(w.base, { rows: [{ person_count: -1, crowd_limit: 10 }] })).status, 400);
    const many = Array.from({ length: 1001 }, () => ({ person_count: 1, crowd_limit: 10 }));
    assert.equal((await postLogs(w.base, { rows: many })).status, 413);
  });

  test("metrics read the stored day", async () => {
    const m = await (await fetch(`${w.base}/api/metrics?date=${day}&tz=UTC`)).json();
    assert.equal(m.source, "postgres");
    assert.equal(m.stats.samples, 5);
    assert.equal(m.stats.alerts, 1);                        // rows 3 and 4 are one crowded run
    assert.deepEqual(m.stats.peak, { count: 12, minute: 600 });
    assert.ok(m.calendar[day] >= 0);
  });
});
