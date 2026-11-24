"""
detector.py - YOLOv8 locked to the 'person' class, with a smoothed count.
"""

from collections import deque
from statistics import median

import config


class PersonCounter:
    def __init__(self):
        from ultralytics import YOLO   # imported here so CAMERA_SOURCE=sim works without it
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
