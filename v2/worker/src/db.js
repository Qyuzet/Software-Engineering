import pg from "pg";

// Same columns as v1 (Neon), plus event_id so a retried upload from the laptop is stored once.
export const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS crowd_logs (
    id           BIGSERIAL PRIMARY KEY,
    recorded_at  TIMESTAMPTZ NOT NULL,
    person_count INTEGER     NOT NULL,
    crowd_limit  INTEGER     NOT NULL,
    is_crowded   BOOLEAN     NOT NULL,
    event_id     TEXT        UNIQUE
);
CREATE INDEX IF NOT EXISTS crowd_logs_recorded_at_idx ON crowd_logs (recorded_at)`;

/** Returns a small Postgres wrapper, or null when there is no DATABASE_URL (demo mode). */
export function createDb(url, log = console) {
  if (!url) return null;
  const pool = new pg.Pool({
    connectionString: url,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  // A dropped idle connection must not crash the worker
  pool.on("error", (err) => log.warn("[db] idle connection error:", err.message));

  let table = null;
  return {
    query: (text, params) => pool.query(text, params),
    /** Creates the table on first use; retried on the next call if it failed. */
    ready() {
      if (!table) {
        table = pool.query(CREATE_TABLE_SQL).catch((err) => {
          table = null;
          throw err;
        });
      }
      return table;
    },
    end: () => pool.end(),
  };
}
