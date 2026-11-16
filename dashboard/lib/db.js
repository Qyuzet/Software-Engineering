import { Pool } from "pg";

// Same table the Python script (db_logger.py) creates.
export const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS crowd_logs (
    id           BIGSERIAL PRIMARY KEY,
    recorded_at  TIMESTAMPTZ NOT NULL,
    person_count INTEGER     NOT NULL,
    crowd_limit  INTEGER     NOT NULL,
    is_crowded   BOOLEAN     NOT NULL
)`;

// Kept on globalThis so hot reloads in `next dev` reuse one pool.
const g = globalThis;

/** Returns the shared connection pool, or null when DATABASE_URL is not set (demo mode). */
export function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!g.__crowdPool) {
    g.__crowdPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 5000,
    });
    // Neon closes idle connections; without this handler that would crash the server.
    g.__crowdPool.on("error", (err) => console.warn("[db] idle connection closed:", err.message));
  }
  return g.__crowdPool;
}

export function ensureTable(pool) {
  if (!g.__crowdTable) {
    g.__crowdTable = pool.query(CREATE_TABLE_SQL).catch((err) => {
      g.__crowdTable = null;
      throw err;
    });
  }
  return g.__crowdTable;
}
