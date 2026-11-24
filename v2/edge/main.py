"""
main.py - v2 edge script (runs on the laptop).

Phone IP Webcam -> YOLOv8 count -> crowd rule -> ESP32 (LEDs + buzzer)
                                             -> server hub (live video + status for the website)
                                             -> log queue (Postgres on the server, every 10 s)

Run:   python main.py               (settings in v2/edge/.env, falls back to the root .env)
       CAMERA_SOURCE=sim python main.py   (fake people, no camera, no YOLO)
Keys (only with SHOW_WINDOW=true):  q = quit,  + / - = raise or lower the crowd limit
Ctrl+C stops it in headless mode.
"""

import time

import cv2

import config
from crowd_state import CrowdState
from esp32_link import ESP32Link
from hud import draw_hud
from log_queue import LogQueue
from uplink import Uplink

WINDOW_NAME = "Crowd Control Monitoring System v2"


def main():
    limit = config.CROWD_LIMIT
    simulated = config.CAMERA_SOURCE == "sim"
    if simulated:
        from sim import SimCamera
        camera, counter = SimCamera(lambda: limit), None
    else:
        from camera import Camera
        from detector import PersonCounter
        counter = PersonCounter()          # load the model before the camera starts streaming
        camera = Camera()

    esp32 = ESP32Link()
    logs = LogQueue()
    uplink = Uplink()

    state = CrowdState()
    crowded = state.crowded
    esp32.send_state(crowded)
    fps, last_time, frame_id = 0.0, time.time(), 0
    count, people = 0, []

    print(f"Running. Camera: {config.CAMERA_SOURCE} | ESP32: {config.ESP32_MODE} | "
          f"Hub: {config.HUB_URL or 'off'} | Window: {'on' if config.SHOW_WINDOW else 'off'}")
    try:
        while True:
            frame_id, frame = camera.read(frame_id, timeout=1.0)
            status = {"site": config.SITE_NAME, "limit": limit, "crowded": crowded,
                      "esp32": esp32.status, "db": logs.status, "camera": camera.status}

            if frame is None:
                # Camera offline: keep the ESP32 heartbeat and website status alive, no video
                esp32.send_state(crowded)
                uplink.publish(None, {**status, "count": count, "fps": 0})
                if config.SHOW_WINDOW and (cv2.waitKey(1) & 0xFF) == ord("q"):
                    break
                continue

            # 1) Count people
            if simulated:
                people = camera.people
                count = len(people)
            else:
                people, count = counter.detect(frame)

            # 2) Crowd rule (FR-02 with hold times + hysteresis)
            if state.update(count, limit):
                crowded = state.crowded
                print(f"[{time.strftime('%H:%M:%S')}] State -> "
                      f"{'CROWDED' if crowded else 'NORMAL'} (count {count}, limit {limit})")
            esp32.send_state(crowded)
            logs.update(count, limit, crowded)

            # 3) HUD, website, local window
            now = time.time()
            fps = 0.9 * fps + 0.1 * (1.0 / max(now - last_time, 1e-6))
            last_time = now
            draw_hud(frame, people, count, limit, crowded, fps, esp32.status, logs.status)
            uplink.publish(frame, {**status, "crowded": crowded, "count": count, "fps": round(fps, 1)})

            if config.SHOW_WINDOW:
                cv2.imshow(WINDOW_NAME, frame)
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    break
                if key in (ord("+"), ord("=")):
                    limit += 1
                    print(f"Limit set to {limit}")
                elif key == ord("-") and limit > 0:
                    limit -= 1
                    print(f"Limit set to {limit}")
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        camera.release()
        uplink.close()
        esp32.close()
        logs.close()
        if config.SHOW_WINDOW:
            cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
