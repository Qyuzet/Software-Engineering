"""
simulate.py - runs the system without a camera, for demos before the hardware is ready.

Fake people walk around a fake room. Everything after the camera is the real code:
the threshold rule (FR-02), ESP32 link (INT-01), HUD and the dashboard feed.
Nothing is written to the database unless you pass --db.

Run:   python simulate.py          (add --db to log the fake counts to Neon)
Keys:  q = quit,  + / - = raise or lower the crowd limit,
       a / z = add or remove a person (manual mode),  space = back to automatic
"""

import argparse
import math
import os
import random
import time

import cv2
import numpy as np

import config
from db_logger import DBLogger
from esp32_link import ESP32Link
from hud import draw_hud
from stream_server import StreamServer

WINDOW_NAME = "Crowd Control Monitoring System (SIMULATION)"
W, H = config.FRAME_WIDTH, config.FRAME_HEIGHT
FPS = 15
CYCLE_S = 90        # automatic mode: one quiet -> crowded -> quiet cycle every 90 s


def target_count(t: float, limit: int) -> int:
    """Automatic mode: a slow wave that goes above the limit for part of each cycle."""
    wave = (1 - math.cos(2 * math.pi * t / CYCLE_S)) / 2      # 0 -> 1 -> 0
    return round(2 + wave * (limit + 3))


class Person:
    def __init__(self):
        self.depth = random.uniform(0.45, 1.0)    # 1 = close to the camera
        self.x = random.uniform(80, W - 80)
        self.vx = random.choice((-1, 1)) * random.uniform(15, 50) * self.depth   # pixels per second
        self.conf = random.uniform(0.62, 0.96)
        self.shade = int(110 + 90 * self.depth)

    def step(self, dt: float):
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


def make_background():
    frame = np.zeros((H, W, 3), np.uint8)
    wall, floor = (70, 45, 30), (45, 30, 22)        # BGR: dark navy room
    frame[: int(H * 0.42)] = wall
    frame[int(H * 0.42):] = floor
    for i in range(3):                              # three "windows" on the back wall
        x = 170 + i * 360
        cv2.rectangle(frame, (x, 60), (x + 220, 230), (95, 70, 50), -1)
    for x in range(-W, 2 * W, 160):                 # floor lines towards the camera
        cv2.line(frame, (W // 2 + (x - W // 2) // 4, int(H * 0.42)), (x, H), (60, 42, 32), 1)
    return frame


def main():
    parser = argparse.ArgumentParser(description="Run the crowd monitor on simulated people.")
    parser.add_argument("--db", action="store_true", help="also log the simulated counts to Neon")
    args = parser.parse_args()

    esp32 = ESP32Link(mode=os.getenv("ESP32_MODE", "off"))
    db = DBLogger(database_url=config.DATABASE_URL if args.db else "")
    stream = StreamServer()
    background = make_background()

    people = []
    limit = config.CROWD_LIMIT
    crowded = False
    manual = None                   # None = automatic wave, otherwise a fixed number of people
    esp32.send_state(crowded)
    start = time.time()
    last = start - 1 / FPS          # so the first frame doesn't report a huge FPS
    fps = float(FPS)

    print("Simulating. Press 'q' to quit, '+' / '-' to change the limit, "
          "'a' / 'z' to add or remove people, space for automatic.")
    try:
        while True:
            now = time.time()
            dt, last = now - last, now
            fps = 0.9 * fps + 0.1 * (1.0 / max(dt, 1e-6))

            # 1) Fake camera: walk the people around and draw them
            target = manual if manual is not None else target_count(now - start, limit)
            while len(people) < target:
                people.append(Person())
            while len(people) > target:
                people.pop(random.randrange(len(people)))
            frame = background.copy()
            for p in sorted(people, key=lambda p: p.depth):
                p.step(dt)
                p.draw(frame)
            boxes = [(*p.box(), p.conf) for p in people]
            count = len(people)

            # 2) Threshold rule (FR-02: alert when count > limit), same as main.py
            now_crowded = count > limit
            if now_crowded != crowded:
                crowded = now_crowded
                print(f"[{time.strftime('%H:%M:%S')}] State -> "
                      f"{'CROWDED' if crowded else 'NORMAL'} (count {count}, limit {limit})")
            esp32.send_state(crowded)
            db.update(count, limit, crowded)

            # 3) Heads-up display, local window and dashboard feed
            draw_hud(frame, boxes, count, limit, crowded, fps, esp32.status, db.status)
            label = "SIMULATION" + (" (manual)" if manual is not None else "")
            cv2.putText(frame, label, (W - 330, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 200, 255), 2)
            cv2.imshow(WINDOW_NAME, frame)
            stream.publish(frame, {"count": count, "limit": limit, "crowded": crowded,
                                   "fps": round(fps, 1), "esp32": esp32.status, "db": db.status})

            # 4) Keyboard controls
            wait_ms = max(1, int(1000 / FPS - (time.time() - now) * 1000))
            key = cv2.waitKey(wait_ms) & 0xFF
            if key == ord("q"):
                break
            if key in (ord("+"), ord("=")):
                limit += 1
                print(f"Limit set to {limit}")
            elif key == ord("-") and limit > 0:
                limit -= 1
                print(f"Limit set to {limit}")
            elif key == ord("a"):
                manual = count + 1
            elif key == ord("z"):
                manual = max(0, count - 1)
            elif key == ord(" "):
                manual = None
    finally:
        esp32.close()
        db.close()
        stream.close()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
