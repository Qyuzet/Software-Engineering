import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { ensureTable, getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_ROWS = 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;   // laptop clock may be a bit ahead; more than this is rejected

function keyOk(got) {
  const want = process.env.EDGE_TOKEN || "";
  const a = Buffer.from(got || "");
  const b = Buffer.from(want);
  return want !== "" && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseRow(r) {
  const count = Number(r?.person_count);
  const limit = Number(r?.crowd_limit);
  if (!Number.isInteger(count) || count < 0 || !Number.isInteger(limit) || limit < 0) return null;
  let at = r.recorded_at ? new Date(r.recorded_at) : new Date();
  if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + MAX_FUTURE_MS) at = new Date();
  const eventId = typeof r.event_id === "string" && /^[\w-]{8,64}$/.test(r.event_id) ? r.event_id : null;
  const crowded = typeof r.is_crowded === "boolean" ? r.is_crowded : count > limit;
  return [at.toISOString(), count, limit, crowded, eventId];
}

// POST /api/logs   header  x-api-key: <EDGE_TOKEN>
//   {"rows": [{"event_id", "recorded_at", "person_count", "crowd_limit", "is_crowded"}, ...]}
//   or a single row object (v1 format, e.g. from the ESP32)
export async function POST(request) {
  if (!keyOk(request.headers.get("x-api-key"))) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 503 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const input = Array.isArray(body?.rows) ? body.rows : [body];
  if (input.length === 0) return NextResponse.json({ ok: true, inserted: 0 });
  if (input.length > MAX_ROWS) {
    return NextResponse.json({ error: `At most ${MAX_ROWS} rows per request` }, { status: 413 });
  }
  const rows = input.map(parseRow);
  if (rows.some((r) => r === null)) {
    return NextResponse.json({ error: "person_count and crowd_limit must be whole numbers >= 0" }, { status: 400 });
  }

  const values = [];
  const params = rows.map((row, i) => {
    values.push(...row);
    const o = i * 5;
    return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5})`;
  });
  await ensureTable(pool);
  const result = await pool.query(
    `INSERT INTO crowd_logs (recorded_at, person_count, crowd_limit, is_crowded, event_id)
     VALUES ${params.join(", ")}
     ON CONFLICT (event_id) DO NOTHING`,
    values,
  );
  return NextResponse.json({ ok: true, inserted: result.rowCount, received: rows.length }, { status: 201 });
}
