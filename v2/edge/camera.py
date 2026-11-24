"""
camera.py - reads the camera on its own thread and keeps only the newest frame.

Why: YOLO runs slower than the phone sends frames. Reading in the main loop
lets old frames pile up in the network buffer, so the video drifts further
behind reality. Here a background thread drains the stream continuously and
the main loop always gets the latest frame.

Reconnects by itself when the phone app stops, the Wi-Fi blips, or a cable is pulled.
"""

import platform
import threading
import time

import cv2

import config


def is_stream(source) -> bool:
    return isinstance(source, str) and "://" in source


class Camera:
    def __init__(self, source=config.CAMERA_SOURCE):
        self.source = source
        self.status = "starting"
        self._frame = None
        self._frame_id = 0
        self._last_frame_at = 0.0
        self._cond = threading.Condition()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="camera", daemon=True)
        self._thread.start()

    # ---------- main loop ----------
    def read(self, last_id: int, timeout: float = 1.0):
        """Wait for a frame newer than last_id. Returns (frame_id, frame) or (last_id, None)."""
        with self._cond:
            self._cond.wait_for(lambda: self._frame_id != last_id or self._stop.is_set(), timeout)
            if self._frame_id == last_id:
                return last_id, None
            return self._frame_id, self._frame

    @property
    def online(self) -> bool:
        return time.time() - self._last_frame_at < config.CAMERA_STALE_S

    def release(self):
        self._stop.set()
        with self._cond:
            self._cond.notify_all()
        self._thread.join(timeout=3)

    # ---------- background thread ----------
    def _open(self):
        if is_stream(self.source):
            cap = cv2.VideoCapture(self.source, cv2.CAP_FFMPEG)
            cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
            cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)
        else:
            backend = cv2.CAP_DSHOW if platform.system() == "Windows" else cv2.CAP_ANY
            cap = cv2.VideoCapture(int(self.source), backend)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, config.FRAME_WIDTH)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, config.FRAME_HEIGHT)
        if not cap.isOpened():
            cap.release()
            return None
        return cap

    def _run(self):
        backoff = 1.0
        while not self._stop.is_set():
            cap = self._open()
            if cap is None:
                if self.status != "offline":
                    print(f"[CAMERA] WARNING: cannot open {self.source}. Retrying...")
                self.status = "offline"
                self._stop.wait(backoff)
                backoff = min(backoff * 2, 10)
                continue
            print(f"[CAMERA] Opened {self.source}")
            self.status = "online"
            backoff = 1.0
            failures = 0
            opened_at = time.time()
            while not self._stop.is_set():
                ok, frame = cap.read()
                if not ok:
                    failures += 1
                    last_good = max(self._last_frame_at, opened_at)
                    if failures >= 10 or time.time() - last_good > config.CAMERA_STALE_S:
                        print("[CAMERA] WARNING: stream stalled. Reconnecting...")
                        break
                    time.sleep(0.05)
                    continue
                failures = 0
                with self._cond:
                    self._frame = frame
                    self._frame_id += 1
                    self._last_frame_at = time.time()
                    self._cond.notify_all()
            cap.release()
            self.status = "offline"
