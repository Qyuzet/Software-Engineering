"""
uplink.py - pushes the annotated video and live status to the worker on etzal.

One outgoing WebSocket (wss://<WORKER_URL>/live/ingest), so it works from any
network (campus Wi-Fi, phone hotspot) without opening ports on the laptop:
  binary message = one JPEG frame
  text message   = status JSON (count, limit, crowded, fps, esp32, db, camera)

Runs on its own thread: a slow or dead connection never slows the YOLO loop.
Frames are dropped (never queued) when the network can't keep up, so the
website always shows the newest picture instead of a growing delay.
"""

import json
import threading
import time

import cv2

import config


class Uplink:
    def __init__(self, url: str = config.HUB_URL, token: str = config.EDGE_TOKEN):
        self.status = "off (no WORKER_URL)" if not url else "connecting"
        self._url = url.replace("https://", "wss://", 1).replace("http://", "ws://", 1) + "/live/ingest"
        self._token = token
        self._frame = None
        self._frame_new = False
        self._state = {}
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread = None
        if url:
            self._thread = threading.Thread(target=self._run, name="uplink", daemon=True)
            self._thread.start()

    # ---------- main loop (never blocks) ----------
    def publish(self, frame, state: dict):
        with self._lock:
            if frame is not None:
                self._frame, self._frame_new = frame, True
            self._state = state
        self._wake.set()

    def close(self):
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=3)

    # ---------- background thread ----------
    def _encode(self, frame):
        h, w = frame.shape[:2]
        if w > config.UPLINK_WIDTH:
            frame = cv2.resize(frame, (config.UPLINK_WIDTH, int(h * config.UPLINK_WIDTH / w)),
                               interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, config.UPLINK_JPEG_QUALITY])
        return buf.tobytes() if ok else None

    def _run(self):
        import websocket  # websocket-client

        backoff = 1.0
        while not self._stop.is_set():
            ws = None
            try:
                ws = websocket.create_connection(
                    self._url, timeout=10, enable_multithread=True,
                    header=[f"Authorization: Bearer {self._token}", "User-Agent: crowd-edge/2.0"])
                print(f"[UPLINK] Connected to {self._url}")
                self.status = "streaming"
                backoff = 1.0
                last_frame_at = last_status_at = 0.0
                while not self._stop.is_set():
                    self._wake.wait(timeout=config.STATUS_EVERY_S)
                    self._wake.clear()
                    now = time.time()
                    with self._lock:
                        frame = self._frame if self._frame_new else None
                        state = self._state
                        if frame is not None and now - last_frame_at >= 1 / config.UPLINK_MAX_FPS:
                            self._frame_new = False
                        else:
                            frame = None
                    if frame is not None:
                        jpeg = self._encode(frame)
                        if jpeg:
                            ws.send_binary(jpeg)
                        last_frame_at = now
                    if now - last_status_at >= config.STATUS_EVERY_S:
                        ws.send(json.dumps({**state, "uplink": self.status}))
                        last_status_at = now
            except Exception as err:  # refused, DNS, 401, timeout, connection dropped...
                if self.status != "OFFLINE - retrying":
                    reason = str(err).split(" -+-+- ")[0]      # drop the response headers dump
                    if "401" in reason:
                        reason += " - check EDGE_TOKEN"
                    print(f"[UPLINK] WARNING: worker unreachable ({reason}). Retrying; detection keeps running.")
                self.status = "OFFLINE - retrying"
                self._stop.wait(backoff)
                backoff = min(backoff * 2, 15)
            finally:
                if ws is not None:
                    try:
                        ws.close(timeout=1)
                    except Exception:
                        pass
