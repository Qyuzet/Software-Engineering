"""
config.py - all settings in one place.

Secrets (the Neon database URL) are read from the .env file, never written here.
"""

import os

from dotenv import load_dotenv

load_dotenv()  # reads .env in the project folder, if it exists

# ---------------- Camera / vision (YOLOv8 Engine) ----------------
# CAMERA_SOURCE (set it in .env):
#   0, 1, 2 ...  = a webcam (0 = built-in, 1 or 2 = USB webcam or a phone app like DroidCam/Iriun)
#   a URL        = a phone stream, e.g. http://192.168.43.1:8080/video (IP Webcam app)
_camera = os.getenv("CAMERA_SOURCE", "0").strip()
CAMERA_SOURCE = int(_camera) if _camera.isdigit() else _camera
CAMERA_RECONNECT_AFTER = 30 # failed reads in a row (~3 s) before reopening the camera
FRAME_WIDTH = 1280
FRAME_HEIGHT = 720
MODEL_FILE = "yolov8n.pt"   # 'n' = nano, fastest; downloads automatically on first run
CONFIDENCE = 0.30           # ignore detections below 30% confidence (lower = finds half-hidden people)
IOU_THRESHOLD = 0.8         # boxes overlapping more than this are merged (higher = keeps people standing close)
IMAGE_SIZE = 960            # YOLO input size; 640 = fast, 960/1280 = finds small or far-away people
SMOOTHING_FRAMES = 5        # median of the last N counts to stop flickering
PERSON_CLASS_ID = 0         # COCO class 0 = "person"

# ---------------- Threshold rule (FR-02) ----------------
CROWD_LIMIT = 10            # alert when count is GREATER than this

# ---------------- ESP32 link (INT-01) ----------------
# "serial" = USB cable (step 4), "wifi" = over the network (step 5), "off" = no hardware
ESP32_MODE = os.getenv("ESP32_MODE", "serial")
SERIAL_PORT = os.getenv("SERIAL_PORT", "COM3")      # Windows: COM3, COM4...  Mac: /dev/cu.usbserial-XXXX
SERIAL_BAUD = 115200                                # must match the ESP32 sketch
ESP32_HOST = os.getenv("ESP32_HOST", "192.168.1.50")  # ESP32 IP address (shown in its Serial Monitor)
ESP32_PORT = 80
ESP32_TIMEOUT_S = 0.5       # give up on one send after this long
RESEND_EVERY_S = 2.0        # re-send the current state regularly so the ESP32 recovers after a reconnect
RECONNECT_EVERY_S = 3.0     # how often to retry when the ESP32 is unreachable

# ---------------- Database logging (INT-02) ----------------
DATABASE_URL = os.getenv("DATABASE_URL", "")  # Neon connection string, from .env
LOG_INTERVAL_S = 10         # insert one row every 10 seconds
MAX_BUFFERED_ROWS = 360     # keep up to 1 hour of rows in memory if Neon is unreachable

# ---------------- Dashboard feed (web dashboard camera panel) ----------------
STREAM_HOST = "127.0.0.1"   # localhost only: the video never leaves the laptop
STREAM_PORT = int(os.getenv("STREAM_PORT", "8080"))
STREAM_MAX_FPS = 15         # cap the dashboard video to save CPU
STREAM_JPEG_QUALITY = 70