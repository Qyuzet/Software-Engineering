"""
check.py - tests every link before a run and says how to fix what is broken.

    python check.py          (run.bat does this before starting main.py)

  phone camera  IP Webcam app            PHONE_IP or CAMERA_SOURCE
  ESP32         wifi / usb / off         ESP32_MODE, ESP32_HOST or SERIAL_PORT
  worker        crowd-api on etzal       WORKER_URL
  token         may this laptop upload   EDGE_TOKEN

Nothing is changed: the ESP32 is only asked for its status page, and the token test uploads zero rows.
Exit code 1 if the camera, worker or token is not ready (a missing ESP32 is only a warning).
"""

import json
import sys
import urllib.error
import urllib.request

import config

DASHBOARD = "https://crowd.etzalgroup.com"
UA = {"User-Agent": "crowd-edge/2.0"}
TOKEN_HELP = "ssh -p 2222 mydebian 'grep EDGE_TOKEN ~/crowd-intelligent/worker.env'"


def _get(url, timeout=4, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    return urllib.request.urlopen(req, timeout=timeout)


def _why(err):
    if isinstance(err, urllib.error.HTTPError):
        return f"HTTP {err.code}"
    return str(getattr(err, "reason", err)) or err.__class__.__name__


def check_camera():
    src = config.CAMERA_SOURCE
    if src == "sim":
        return "ok", "simulated people (CAMERA_SOURCE=sim)"
    if isinstance(src, int):
        import cv2
        cap = cv2.VideoCapture(src, cv2.CAP_DSHOW)
        ok = cap.read()[0]
        cap.release()
        if ok:
            return "ok", f"laptop webcam {src}  (for the phone, set PHONE_IP in v2/edge/.env)"
        return "fail", f"webcam {src} gives no picture. For the phone, set PHONE_IP in v2/edge/.env"
    try:
        with _get(src) as r:
            ctype = r.headers.get("Content-Type", "")
            first = r.read(4096)
        if "multipart" in ctype or b"\xff\xd8" in first:
            return "ok", src
        return "fail", f"{src} answers, but it is not a video stream (the URL must end in /video)"
    except Exception as err:  # noqa: BLE001 - any failure means "not reachable"
        return "fail", (f"{src} not reachable ({_why(err)}).\n"
                        "                    On the phone: IP Webcam -> Start server. Phone and laptop on the same\n"
                        "                    Wi-Fi/hotspot. Put the IP the app shows into PHONE_IP in v2/edge/.env")


def check_esp32():
    mode = config.ESP32_MODE
    if mode == "off":
        return "skip", "off (ESP32_MODE=off): no LEDs/buzzer"
    if mode == "wifi":
        url = f"http://{config.ESP32_HOST}:{config.ESP32_PORT}/"
        try:
            with _get(url, timeout=3) as r:
                status = next((ln for ln in r.read().decode(errors="replace").splitlines()
                               if ln.startswith("Status")), "answers")
            return "ok", f"wifi {config.ESP32_HOST} - {status}"
        except Exception as err:  # noqa: BLE001
            return "warn", (f"wifi {config.ESP32_HOST} not reachable ({_why(err)}).\n"
                            "                    Same Wi-Fi as the laptop? Its IP is printed in the Arduino Serial Monitor\n"
                            "                    (115200 baud) -> ESP32_HOST in v2/edge/.env")
    try:
        import serial
        from serial.tools import list_ports
        with serial.Serial(config.SERIAL_PORT, config.SERIAL_BAUD, timeout=1):
            pass
        return "ok", f"usb {config.SERIAL_PORT}"
    except Exception as err:  # noqa: BLE001
        ports = ", ".join(p.device for p in list_ports.comports()) or "none found"
        return "warn", (f"usb {config.SERIAL_PORT} cannot be opened ({err.__class__.__name__}). Ports on this laptop: {ports}.\n"
                        "                    Close the Arduino Serial Monitor; set SERIAL_PORT in v2/edge/.env")


def check_worker():
    if not config.HUB_URL:
        return "fail", "WORKER_URL is empty. Set WORKER_URL=https://crowd-api.etzalgroup.com in v2/edge/.env", None
    try:
        with _get(f"{config.HUB_URL}/live/health") as r:
            health = json.load(r)
        with _get(f"{config.HUB_URL}/live/status") as r:
            live = json.load(r)
    except Exception as err:  # noqa: BLE001
        return "fail", f"{config.HUB_URL} not reachable ({_why(err)}). Internet ok? Is the URL right?", None
    db = "database on" if health.get("database") == "on" else "NO DATABASE (demo data)"
    return "ok", f"{config.HUB_URL} - version {str(health.get('version', '?'))[:7]}, {db}", live


def check_token():
    if not config.EDGE_TOKEN:
        return "fail", ("not set on this laptop yet (needed once). Paste it in the laptop app: Run -> Server -> "
                        f"Edge token, then Save. The admin gets it with:  {TOKEN_HELP}")
    try:
        with _get(f"{config.HUB_URL}/api/logs", data=b'{"rows": []}',
                  headers={"Content-Type": "application/json", "x-api-key": config.EDGE_TOKEN}):
            pass
        return "ok", "accepted"
    except urllib.error.HTTPError as err:
        if err.code == 503:
            return "ok", "accepted (but the worker has no database)"
        if err.code == 401:
            return "fail", ("the server does not accept this token. Paste the right one in the laptop app: "
                            f"Run -> Server -> Edge token. The admin gets it with:  {TOKEN_HELP}")
        return "fail", f"HTTP {err.code}"
    except Exception as err:  # noqa: BLE001
        return "fail", f"could not test ({_why(err)})"


def run_checks():
    """[(name, state, detail)], and whether another laptop is streaming right now."""
    rows = [("camera", *check_camera()), ("ESP32", *check_esp32())]
    state, detail, live = check_worker()
    rows.append(("worker", state, detail))
    if state == "ok":
        rows.append(("token", *check_token()))
    return rows, bool(live and live.get("online"))


def main():
    if "--json" in sys.argv:                     # for the control panel
        rows, other = run_checks()
        print(json.dumps({"checks": [{"name": n, "state": s, "detail": " ".join(d.split())} for n, s, d in rows],
                          "ready": all(s != "fail" for _, s, _ in rows), "other_laptop_streaming": other}))
        return 0

    print("Checking the links (nothing is changed)...\n")
    marks = {"ok": "OK  ", "fail": "FAIL", "warn": "WARN", "skip": "--  "}
    rows, other = run_checks()
    for name, state, detail in rows:
        print(f"  [{marks[state]}] {name:<10} {detail}")
    if other:
        print("\n  Note: another laptop is streaming right now. Starting here takes over from it.")

    states = [s for _, s, _ in rows]
    print(f"\n  Dashboard: {DASHBOARD}")
    if "fail" in states:
        print("  Not ready: fix the FAIL lines above (settings are in v2/edge/.env).")
        return 1
    print("  Ready." + ("  (ESP32 not reachable: detection and the website still work.)" if "warn" in states else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
