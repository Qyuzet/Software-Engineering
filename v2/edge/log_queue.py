"""
log_queue.py - INT-02 v2: logs the count every 10 s to the server's Postgres (replaces Neon).

Rows are written to a small SQLite file on the laptop first (data/queue.db),
then uploaded in batches to POST <HUB_URL>/api/logs. A row is deleted locally
only after the server confirms it, so nothing is lost when the Wi-Fi drops or
the laptop restarts. Every row has a unique event_id, so a retried upload is
never stored twice. The laptop never holds the database password.
"""

import json
import sqlite3
import threading
import time
import urllib.request
import uuid
from datetime import datetime, timezone

import config


class LogQueue:
    def __init__(self, url: str = config.HUB_URL, token: str = config.EDGE_TOKEN):
        self._endpoint = f"{url}/api/logs" if url else ""
        self._token = token
        self.status = "starting"
        self._latest = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="log-queue", daemon=True)
        self._thread.start()

    # ---------- main loop (never blocks) ----------
    def update(self, count: int, limit: int, crowded: bool):
        with self._lock:
            self._latest = (count, limit, crowded)

    def close(self):
        self._stop.set()
        self._thread.join(timeout=5)

    # ---------- background thread ----------
    def _run(self):
        config.QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(config.QUEUE_FILE)
        db.execute("""CREATE TABLE IF NOT EXISTS queue (
            event_id TEXT PRIMARY KEY, recorded_at TEXT NOT NULL,
            person_count INTEGER NOT NULL, crowd_limit INTEGER NOT NULL, is_crowded INTEGER NOT NULL)""")
        db.commit()
        pending = db.execute("SELECT count(*) FROM queue").fetchone()[0]
        if pending:
            print(f"[LOG] {pending} rows from an earlier run are waiting to upload.")

        next_row = time.time() + config.LOG_INTERVAL_S
        next_upload, backoff = 0.0, 5.0
        while not self._stop.wait(1.0):
            now = time.time()
            if now >= next_row:
                next_row = max(next_row + config.LOG_INTERVAL_S, now + 1)
                with self._lock:
                    latest = self._latest
                if latest is not None:
                    db.execute("INSERT INTO queue VALUES (?, ?, ?, ?, ?)",
                               (uuid.uuid4().hex, datetime.now(timezone.utc).isoformat(),
                                latest[0], latest[1], int(latest[2])))
                    db.commit()
                    if not self.status.startswith("OFFLINE"):   # while offline, keep the backoff
                        next_upload = min(next_upload, now)

            if now < next_upload:
                continue
            rows = db.execute("SELECT * FROM queue ORDER BY recorded_at LIMIT ?",
                              (config.LOG_BATCH,)).fetchall()
            if not rows:
                next_upload = now + config.LOG_INTERVAL_S
                continue
            if not self._endpoint:
                self.status = f"local only - {self._count(db)} rows queued (no HUB_URL)"
                next_upload = now + 30
                continue
            try:
                self._upload(rows)
                db.executemany("DELETE FROM queue WHERE event_id = ?", [(r[0],) for r in rows])
                db.commit()
                left = self._count(db)
                self.status = "logging every 10 s" if not left else f"catching up - {left} rows left"
                next_upload = now if left else now + config.LOG_INTERVAL_S
                backoff = 5.0
            except Exception as err:
                if not self.status.startswith("OFFLINE"):
                    print(f"[LOG] WARNING: cannot upload logs ({err}). Keeping them on disk.")
                self.status = f"OFFLINE - {self._count(db)} rows queued"
                next_upload = now + backoff
                backoff = min(backoff * 2, 60)
        db.close()

    @staticmethod
    def _count(db):
        return db.execute("SELECT count(*) FROM queue").fetchone()[0]

    def _upload(self, rows):
        body = json.dumps({"rows": [
            {"event_id": r[0], "recorded_at": r[1], "person_count": r[2],
             "crowd_limit": r[3], "is_crowded": bool(r[4])} for r in rows]}).encode()
        req = urllib.request.Request(self._endpoint, data=body, method="POST", headers={
            "Content-Type": "application/json", "x-api-key": self._token, "User-Agent": "crowd-edge/2.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status not in (200, 201):
                raise OSError(f"server replied HTTP {resp.status}")
