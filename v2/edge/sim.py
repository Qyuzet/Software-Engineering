"""
sim.py - CAMERA_SOURCE=sim: fake people walking in a fake room.

Same interface as camera.Camera, plus `.people` (the boxes), so the whole
pipeline (crowd rule, ESP32, uplink, logging, website) can be tested without
a phone and without YOLO installed.
"""

import math
import random
import time

import cv2
import numpy as np

import config

W, H = config.FRAME_WIDTH, config.FRAME_HEIGHT
FPS = 15
CYCLE_S = 90        # one quiet -> crowded -> quiet cycle every 90 s


class _Person:
    def __init__(self):
        self.depth = random.uniform(0.45, 1.0)
        self.x = random.uniform(80, W - 80)
        self.vx = random.choice((-1, 1)) * random.uniform(15, 50) * self.depth
        self.conf = random.uniform(0.62, 0.96)
        self.shade = int(110 + 90 * self.depth)

    def step(self, dt):
        self.x += self.vx * dt
        if not 60 < self.x < W - 60:
            self.vx = -self.vx
            self.x = min(max(self.x, 60), W - 60)

    def box(self):
        h = int(300 * self.depth)
        w = int(h * 0.42)
        foot = int(H * 0.45 + H * 0.5 * (self.depth - 0.45) / 0.55)
        x1 = max(0, int(self.x - w / 2))
        return x1, foot - h, x1 + w, foot

    def draw(self, frame):
        x1, y1, x2, y2 = self.box()
        cx, w = (x1 + x2) // 2, x2 - x1
        head = w // 3
        colour = (self.shade, self.shade - 10, self.shade - 25)
        cv2.circle(frame, (cx, y1 + head), head, colour, -1)
        cv2.ellipse(frame, (cx, y2), (w // 2, int((y2 - y1) * 0.62)), 0, 180, 360, colour, -1)


def _background():
    frame = np.zeros((H, W, 3), np.uint8)
    frame[: int(H * 0.42)] = (70, 45, 30)
    frame[int(H * 0.42):] = (45, 30, 22)
    for i in range(3):
        x = 170 + i * 360
        cv2.rectangle(frame, (x, 60), (x + 220, 230), (95, 70, 50), -1)
    for x in range(-W, 2 * W, 160):
        cv2.line(frame, (W // 2 + (x - W // 2) // 4, int(H * 0.42)), (x, H), (60, 42, 32), 1)
    return frame


class SimCamera:
    status = "simulated"
    online = True

    def __init__(self, limit_fn):
        self._limit_fn = limit_fn       # the wave goes a bit above the current limit
        self._bg = _background()
        self._people = []
        self._start = self._last = time.time()
        self._id = 0
        self.people = []
        print("[CAMERA] Simulation: fake people, no YOLO")

    def read(self, last_id, timeout=1.0):
        wait = 1 / FPS - (time.time() - self._last)
        if wait > 0:
            time.sleep(wait)
        now = time.time()
        dt, self._last = now - self._last, now
        wave = (1 - math.cos(2 * math.pi * (now - self._start) / CYCLE_S)) / 2
        target = round(2 + wave * (self._limit_fn() + 3))
        while len(self._people) < target:
            self._people.append(_Person())
        while len(self._people) > target:
            self._people.pop(random.randrange(len(self._people)))
        frame = self._bg.copy()
        for p in sorted(self._people, key=lambda p: p.depth):
            p.step(dt)
            p.draw(frame)
        self.people = [(*p.box(), p.conf) for p in self._people]
        cv2.putText(frame, "SIMULATION", (W - 260, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 200, 255), 2)
        self._id += 1
        return self._id, frame

    def release(self):
        pass
