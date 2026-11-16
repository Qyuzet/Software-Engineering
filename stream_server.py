"""
stream_server.py - shares the annotated video and live status with the web dashboard.

Listens on 127.0.0.1 only, so the video never leaves the laptop:
  /video   MJPEG stream (shown in the dashboard's camera panel)
  /status  JSON: count, limit, crowded, fps, esp32, db
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2

import config


class StreamServer:
    def __init__(self, host: str = config.STREAM_HOST, port: int = config.STREAM_PORT):
        self._jpeg = None
        self._status = {}
        self._cond = threading.Condition()
        self._clients = 0                   # open /video connections
        self._last_encode = 0.0
        self._server = None
        try:
            self._server = ThreadingHTTPServer((host, port), self._make_handler())
        except OSError as err:
            print(f"[STREAM] WARNING: cannot open port {port} ({err}). Dashboard feed disabled.")
            return
        self._server.daemon_threads = True
        threading.Thread(target=self._server.serve_forever, name="stream-server", daemon=True).start()
        print(f"[STREAM] Dashboard feed at http://{host}:{port}/video")

    # ---------- called from the main loop (never blocks for long) ----------
    def publish(self, frame, status: dict):
        with self._cond:
            self._status = {**status, "time": time.time()}
            # Only spend time on JPEG encoding when someone is watching
            if self._clients == 0 or time.time() - self._last_encode < 1 / config.STREAM_MAX_FPS:
                return
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, config.STREAM_JPEG_QUALITY])
        if ok:
            with self._cond:
                self._jpeg = buf.tobytes()
                self._last_encode = time.time()
                self._cond.notify_all()

    def close(self):
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()

    # ---------- HTTP handlers (one thread per connection) ----------
    def _make_handler(self):
        stream = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):   # keep the console quiet
                pass

            def do_GET(self):
                if self.path.startswith("/status"):
                    stream._send_status(self)
                elif self.path.startswith("/video"):
                    stream._send_video(self)
                else:
                    self.send_error(404)

        return Handler

    def _send_status(self, h):
        with self._cond:
            body = json.dumps(self._status).encode()
        h.send_response(200)
        h.send_header("Content-Type", "application/json")
        h.send_header("Access-Control-Allow-Origin", "*")   # the dashboard runs on another port
        h.send_header("Cache-Control", "no-store")
        h.send_header("Content-Length", str(len(body)))
        h.end_headers()
        h.wfile.write(body)

    def _send_video(self, h):
        h.send_response(200)
        h.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
        h.send_header("Cache-Control", "no-store")
        h.end_headers()
        with self._cond:
            self._clients += 1
        try:
            last = None
            while True:
                with self._cond:
                    self._cond.wait_for(lambda: self._jpeg is not last, timeout=2)
                    jpeg = self._jpeg
                if jpeg is None or jpeg is last:
                    continue
                last = jpeg
                h.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                              + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n")
        except OSError:   # browser closed the tab (BrokenPipe, ConnectionReset/Aborted)
            pass
        finally:
            with self._cond:
                self._clients -= 1
