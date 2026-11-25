// crowd-worker entry point (pm2 app "crowd-worker" on etzal).
// Settings come from the environment or from ENV_FILE (default ./.env); see .env.example.

import fs from "node:fs";
import process from "node:process";

import { createDb } from "./db.js";
import { createWorker } from "./server.js";

try {
  process.loadEnvFile(process.env.ENV_FILE || ".env");
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}

// worker-release.sh writes the deployed git commit into REVISION (first line)
function readVersion() {
  try {
    return fs.readFileSync(new URL("../REVISION", import.meta.url), "utf8").split("\n")[0].trim() || "dev";
  } catch {
    return process.env.WORKER_VERSION || "dev";
  }
}

const env = process.env;
const host = env.HOST || "127.0.0.1";
const port = Number(env.PORT) || 3020;
const version = readVersion();
const corsOrigins = (env.CORS_ORIGINS || "*").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);

if (!env.EDGE_TOKEN) console.warn("[worker] EDGE_TOKEN is not set: the laptop cannot connect or upload logs.");
if (!env.DATABASE_URL) console.warn("[worker] DATABASE_URL is not set: /api/metrics serves demo data.");

const db = createDb(env.DATABASE_URL);
db?.ready().then(
  () => console.log("[worker] database ready"),
  (err) => console.error("[worker] database not reachable yet:", err.message),
);

const worker = createWorker({
  edgeToken: env.EDGE_TOKEN || "",
  db,
  intervalS: Number(env.LOG_INTERVAL_S) || 10,
  corsOrigins,
  version,
});

worker.server.listen(port, host, () => {
  console.log(`[worker] ${version} listening on http://${host}:${port} (CORS: ${corsOrigins.join(", ")})`);
});

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal}: shutting down`);
  setTimeout(() => process.exit(0), 3000).unref();
  Promise.allSettled([worker.close(), db?.end()]).then(() => process.exit(0));
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
