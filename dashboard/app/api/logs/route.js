import { NextResponse } from "next/server";

import { ensureTable, getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/logs  {"person_count": 7, "crowd_limit": 10, "is_crowded": false}
// Lets a device (e.g. the ESP32) log a count without knowing the database password.
export async function POST(request) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 503 });

  const key = process.env.INGEST_API_KEY;
  if (key && request.headers.get("x-api-key") !== key) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const count = Number(body.person_count);
  const limit = Number(body.crowd_limit);
  if (!Number.isInteger(count) || count < 0 || !Number.isInteger(limit) || limit < 0) {
    return NextResponse.json({ error: "person_count and crowd_limit must be whole numbers >= 0" }, { status: 400 });
  }
  const crowded = typeof body.is_crowded === "boolean" ? body.is_crowded : count > limit;

  await ensureTable(pool);
  await pool.query(
    "INSERT INTO crowd_logs (recorded_at, person_count, crowd_limit, is_crowded) VALUES (now(), $1, $2, $3)",
    [count, limit, crowded],
  );
  return NextResponse.json({ ok: true }, { status: 201 });
}
