"""
config.py - edge (laptop) settings for v2.

Values come from v2/edge/.env first, then the project's root .env, so the
existing CAMERA_SOURCE / ESP32_MODE / ESP32_HOST / SERIAL_PORT keep working.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")                  # v2 settings win
load_dotenv(HERE.parent.parent / ".env")    # then the original project's .env (never overrides)


def _bool(name, default):
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


# ---------------- Camera ----------------
# CAMERA_SOURCE: 0/1/2 = webcam, a URL = phone stream, "sim" = simulated people (no YOLO, no camera)
# PHONE_IP: shortcut for the IP Webcam app -> http://<PHONE_IP>:8080/video
_phone_ip = os.getenv("PHONE_IP", "").strip()
_camera = os.getenv("CAMERA_SOURCE", "").strip() or (
    f"http://{_phone_ip}:{os.getenv('PHONE_PORT', '8080')}/video" if _phone_ip else "0")
CAMERA_SOURCE = int(_camera) if _camera.isdigit() else _camera
CAMERA_STALE_S = 3.0        # no new frame for this long = camera offline, reconnect
FRAME_WIDTH = 1280
FRAME_HEIGHT = 720

# ---------------- YOLOv8 ----------------
MODEL_FILE = os.getenv("MODEL_FILE", "yolov8n.pt")
CONFIDENCE = 0.30
IOU_THRESHOLD = 0.8
IMAGE_SIZE = int(os.getenv("IMAGE_SIZE", "960"))   # 640 = faster on a weak CPU
SMOOTHING_FRAMES = 5
PERSON_CLASS_ID = 0

# ---------------- Crowd rule (FR-02) ----------------
CROWD_LIMIT = int(os.getenv("CROWD_LIMIT", "10"))
CROWD_ENTER_HOLD_S = 3.0
CROWD_EXIT_HOLD_S = 5.0
CROWD_EXIT_MARGIN = 1
CROWD_GRACE_S = 1.0

# ---------------- ESP32 (INT-01) ----------------
# wifi | usb (alias: serial) | off
ESP32_MODE = {"usb": "serial"}.get(os.getenv("ESP32_MODE", "off").strip().lower(),
                                    os.getenv("ESP32_MODE", "off").strip().lower())
SERIAL_PORT = os.getenv("SERIAL_PORT", "COM3")
SERIAL_BAUD = 115200
ESP32_HOST = os.getenv("ESP32_HOST", "") or os.getenv("ESP32_IP", "192.168.1.50")
ESP32_PORT = int(os.getenv("ESP32_PORT", "80"))
ESP32_TIMEOUT_S = 0.5
RESEND_EVERY_S = 2.0
RECONNECT_EVERY_S = 3.0

# ---------------- Worker on etzal (video + status + logs) ----------------
# WORKER_URL (HUB_URL also accepted, the v2.0 name), e.g. https://crowd-api.etzalgroup.com
HUB_URL = (os.getenv("WORKER_URL") or os.getenv("HUB_URL", "")).strip().rstrip("/")
EDGE_TOKEN = os.getenv("EDGE_TOKEN", "")           # same value as EDGE_TOKEN in the worker's env
SITE_NAME = os.getenv("SITE_NAME", "Lecture Hall A")
UPLINK_MAX_FPS = float(os.getenv("UPLINK_MAX_FPS", "8"))     # video frames sent per second
UPLINK_WIDTH = int(os.getenv("UPLINK_WIDTH", "960"))         # frames are shrunk to this width
UPLINK_JPEG_QUALITY = int(os.getenv("UPLINK_JPEG_QUALITY", "65"))
STATUS_EVERY_S = 1.0

# ---------------- Logging (replaces Neon) ----------------
LOG_INTERVAL_S = 10                         # one row every 10 s
LOG_BATCH = 500                             # rows per upload
QUEUE_FILE = HERE / "data" / "queue.db"     # rows wait here (on disk) until the server confirms them

# ---------------- Local window ----------------
SHOW_WINDOW = _bool("SHOW_WINDOW", True)    # false = headless, the website is the only screen
