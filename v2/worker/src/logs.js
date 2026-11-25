// POST /api/logs   header  x-api-key: <EDGE_TOKEN>
//   {"rows": [{"event_id", "recorded_at", "person_count", "crowd_limit", "is_crowded"}, ...]}
//   or a single row object (v1 format, e.g. from the ESP32)
// A row whose event_id is already stored is skipped, so the laptop can safely retry an upload.

export const MAX_ROWS = 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;   // the laptop clock may be a bit ahead; more than this is replaced by "now"

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

/** Returns [httpStatus, jsonBody]. The caller has already checked the API key. */
export async function insertLogs(db, body) {
  if (!db) return [503, { error: "DATABASE_URL is not set on the worker" }];
  const input = Array.isArray(body?.rows) ? body.rows : [body];
  if (input.length === 0) return [200, { ok: true, inserted: 0, received: 0 }];
  if (input.length > MAX_ROWS) return [413, { error: `At most ${MAX_ROWS} rows per request` }];

  const rows = input.map(parseRow);
  if (rows.some((r) => r === null)) {
    return [400, { error: "person_count and crowd_limit must be whole numbers >= 0" }];
  }
  const values = [];
  const params = rows.map((row, i) => {
    values.push(...row);
    const o = i * 5;
    return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5})`;
  });
  await db.ready();
  const result = await db.query(
    `INSERT INTO crowd_logs (recorded_at, person_count, crowd_limit, is_crowded, event_id)
     VALUES ${params.join(", ")}
     ON CONFLICT (event_id) DO NOTHING`,
    values,
  );
  return [201, { ok: true, inserted: result.rowCount, received: rows.length }];
}
