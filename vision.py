"""
vision.py - Camera [E] + YOLOv8 Engine [S].

Opens the camera and counts people in each frame. The camera can be a webcam
(CAMERA_SOURCE=0) or a phone stream (CAMERA_SOURCE=http://.../video).
If the camera drops out, it is reopened automatically.
"""

import platform
import time
from collections import deque
from statistics import median

import cv2
from ultralytics import YOLO

import config


def is_stream(source) -> bool:
    """True for a network stream such as a phone camera URL."""
    return isinstance(source, str) and "://" in source


class Camera:
    """Wraps the webcam or phone stream."""

    def __init__(self, source=config.CAMERA_SOURCE):
        self.source = source
        self.cap = None
        self._failed_reads = 0
        if not self._open():
            if is_stream(source):
                raise SystemExit(f"Could not open the phone camera at {source}. Check the address, that the "
                                 "camera app is running, and that the laptop is on the same Wi-Fi.")
            raise SystemExit(f"Could not open camera {source}. Try another CAMERA_SOURCE in .env (0, 1 or 2).")
        print(f"[CAMERA] Opened {source}")

    def _open(self) -> bool:
        if is_stream(self.source):
            cap = cv2.VideoCapture(self.source)             # FFmpeg reads network streams
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)             # keep only the newest frame (less lag)
        else:
            # On Windows, the DirectShow backend opens USB webcams much faster
            backend = cv2.CAP_DSHOW if platform.system() == "Windows" else cv2.CAP_ANY
            cap = cv2.VideoCapture(int(self.source), backend)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, config.FRAME_WIDTH)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, config.FRAME_HEIGHT)
        if not cap.isOpened():
            cap.release()
            return False
        self.cap = cap
        return True

    def read(self):
        """Return a frame, or None if the camera did not deliver one."""
        ok, frame = self.cap.read() if self.cap is not None else (False, None)
        if ok:
            self._failed_reads = 0
            return frame

        # Camera dropped out (phone app stopped, Wi-Fi blip, cable pulled): reopen it
        self._failed_reads += 1
        if self._failed_reads >= config.CAMERA_RECONNECT_AFTER:
            print("[CAMERA] WARNING: camera offline. Trying to reconnect...")
            self.release()
            if self._open():
                print("[CAMERA] Reconnected.")
            else:
                time.sleep(1)
            self._failed_reads = 0
        return None

    def release(self):
        if self.cap is not None:
            self.cap.release()
            self.cap = None


class PersonCounter:
    """Runs YOLOv8 locked to the 'person' class and smooths the count."""

    def __init__(self):
        print("Loading YOLOv8 model (first run downloads it)...")
        self.model = YOLO(config.MODEL_FILE)
        self.recent_counts = deque(maxlen=config.SMOOTHING_FRAMES)

    def detect(self, frame):
        """Return (people, smoothed_count). people = list of (x1, y1, x2, y2, confidence)."""
        result = self.model(frame, classes=[config.PERSON_CLASS_ID],
                            conf=config.CONFIDENCE, iou=config.IOU_THRESHOLD,
                            imgsz=config.IMAGE_SIZE, verbose=False)[0]
        people = [
            (*map(int, box), conf)
            for box, conf in zip(result.boxes.xyxy.tolist(), result.boxes.conf.tolist())
        ]
        self.recent_counts.append(len(people))
        return people, int(median(self.recent_counts))