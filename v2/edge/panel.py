"""
panel.py - the laptop control panel, at http://127.0.0.1:8765 (run.bat opens it in the browser).

  Camera    phone (IP Webcam) / laptop webcam / simulation / other URL, with a test picture
  ESP32     wifi / usb / off, a status test, and sending it a Wi-Fi name + password
  Run       crowd limit, check every link, start / stop detection (main.py), its log, the live view

Settings are saved in v2/edge/.env, the same file main.py and check.py read.

The dashboard website (https://crowd.etzalgroup.com/laptop) talks to this panel too, from the
browser on this laptop: it shows what is installed, the webcams, and starts/stops detection.
Only this computer can reach the panel (127.0.0.1). Of all websites, only the panel itself and the
dashboard may use it; anything else is refused.
"""

import importlib.metadata
import json
import os
import platform
import re
import signal
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from dotenv import dotenv_values

import esp32_setup

VERSION = "2.2"
HERE = Path(__file__).resolve().parent
ENV_FILE = HERE / ".env"
ROOT_ENV = HERE.parent.parent / ".env"
PORT = int(os.getenv("PANEL_PORT", "8765"))
DASHBOARD = "https://crowd.etzalgroup.com"
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
PANEL_ORIGINS = {f"http://{h}" for h in ALLOWED_HOSTS}
# Websites allowed to use the panel from the browser (comma list in PANEL_ALLOWED_ORIGINS adds more)
WEB_ORIGINS = {DASHBOARD, "https://crowd-dashboard-delta.vercel.app"} | {
    o.strip().rstrip("/") for o in os.getenv("PANEL_ALLOWED_ORIGINS", "").split(",") if o.strip()}

# Everything the panel writes. These are also removed from the environment of main.py/check.py,
# so the .env file is what counts.
MANAGED = ["CAMERA_SOURCE", "PHONE_IP", "PHONE_PORT", "ESP32_MODE", "ESP32_HOST", "ESP32_IP", "SERIAL_PORT",
           "CROWD_LIMIT", "SITE_NAME", "SHOW_WINDOW", "WORKER_URL", "HUB_URL", "EDGE_TOKEN"]

HOST_RE = re.compile(r"^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$")          # 10.31.176.176 or host:port
PORTNAME_RE = re.compile(r"^[A-Za-z0-9_./:-]{1,64}$")          # COM3, /dev/ttyUSB0
URL_RE = re.compile(r"^(https?|rtsp)://[^\s\"'#]{1,300}$")
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
SITE_RE = re.compile(r"^[^\"\\#\r\n]{1,60}$")


class BadRequest(Exception):
    pass


# ---------------- settings (.env) ----------------
def _values():
    vals = {k: v for k, v in dotenv_values(ROOT_ENV).items() if v is not None} if ROOT_ENV.exists() else {}
    if ENV_FILE.exists():
        vals.update({k: v for k, v in dotenv_values(ENV_FILE).items() if v is not None})
    return vals


def read_settings():
    v = _values()
    src = (v.get("CAMERA_SOURCE") or "").strip()
    phone_ip = (v.get("PHONE_IP") or "").strip()
    phone_port = (v.get("PHONE_PORT") or "8080").strip()
    if src == "sim":
        camera = "sim"
    elif src.isdigit():
        camera = "webcam"
    elif src:
        m = re.match(r"^http://([^:/]+):(\d+)/video$", src)       # IP Webcam address written as a URL
        m = m if m and (not phone_ip or m.group(1) == phone_ip) else None
        camera = "phone" if m else "url"
        if m:
            phone_ip, phone_port = m.group(1), m.group(2)
    else:
        camera = "phone" if phone_ip else "webcam"
    mode = (v.get("ESP32_MODE") or "off").strip().lower()
    return {
        "camera": camera,
        "phone_ip": phone_ip,
        "phone_port": int(phone_port) if phone_port.isdigit() else 8080,
        "webcam_index": int(src) if src.isdigit() else 0,
        "camera_url": src if camera == "url" else "",
        "esp32_mode": {"serial": "usb"}.get(mode, mode),
        "esp32_host": (v.get("ESP32_HOST") or v.get("ESP32_IP") or "").strip(),
        "serial_port": (v.get("SERIAL_PORT") or "COM3").strip(),
        "crowd_limit": int(v["CROWD_LIMIT"]) if (v.get("CROWD_LIMIT") or "").isdigit() else 10,
        "site_name": (v.get("SITE_NAME") or "Lecture Hall A").strip(),
        "show_window": (v.get("SHOW_WINDOW") or "true").strip().lower() in ("1", "true", "yes", "on"),
        "worker_url": (v.get("WORKER_URL") or v.get("HUB_URL") or "").strip().rstrip("/"),
        "token_set": bool((v.get("EDGE_TOKEN") or "").strip()),
    }


def _need(cond, message):
    if not cond:
        raise BadRequest(message)


def _updates_from(s):
    """Validates the panel's settings and turns them into .env lines."""
    cur = read_settings()
    get = lambda k: s.get(k, cur.get(k))                    # noqa: E731
    camera = get("camera")
    _need(camera in ("phone", "webcam", "sim", "url"), "Unknown camera type.")
    phone_ip = str(get("phone_ip") or "").strip()
    phone_port = int(get("phone_port") or 8080)
    up = {}
    if phone_ip:
        _need(HOST_RE.match(phone_ip), "Phone IP looks wrong (example: 10.31.176.62).")
        up["PHONE_IP"] = phone_ip
    _need(1 <= phone_port <= 65535, "Phone port must be 1-65535.")
    up["PHONE_PORT"] = str(phone_port)
    if camera == "phone":
        _need(phone_ip, "Enter the phone IP shown in the IP Webcam app.")
        up["CAMERA_SOURCE"] = ""                            # empty = use PHONE_IP
    elif camera == "webcam":
        idx = int(get("webcam_index") or 0)
        _need(0 <= idx <= 9, "Webcam number must be 0-9.")
        up["CAMERA_SOURCE"] = str(idx)
    elif camera == "sim":
        up["CAMERA_SOURCE"] = "sim"
    else:
        url = str(get("camera_url") or "").strip()
        _need(URL_RE.match(url), "Camera URL must start with http://, https:// or rtsp://")
        up["CAMERA_SOURCE"] = url

    mode = get("esp32_mode")
    _need(mode in ("wifi", "usb", "off"), "Unknown ESP32 mode.")
    up["ESP32_MODE"] = mode
    host = str(get("esp32_host") or "").strip()
    if host:
        _need(HOST_RE.match(host), "ESP32 address looks wrong (example: 10.31.176.176).")
        up["ESP32_HOST"] = host
    port = str(get("serial_port") or "").strip()
    if port:
        _need(PORTNAME_RE.match(port), "Serial port looks wrong (example: COM3).")
        up["SERIAL_PORT"] = port

    limit = int(get("crowd_limit") or 10)
    _need(1 <= limit <= 500, "Crowd limit must be 1-500.")
    up["CROWD_LIMIT"] = str(limit)
    site = str(get("site_name") or "").strip()
    _need(SITE_RE.match(site), "Room name: 1-60 characters, no quotes or #.")
    up["SITE_NAME"] = site
    up["SHOW_WINDOW"] = "true" if get("show_window") else "false"
    worker = str(get("worker_url") or "").strip().rstrip("/")
    _need(re.match(r"^https?://[A-Za-z0-9.:-]+$", worker), "Worker URL looks wrong (https://crowd-api.etzalgroup.com).")
    up["WORKER_URL"] = worker
    token = str(s.get("edge_token") or "").strip()
    if token:
        _need(TOKEN_RE.match(token), "The token has 8-128 letters, digits, - or _.")
        up["EDGE_TOKEN"] = token
    return up


def _format(value):
    return f'"{value}"' if re.search(r"\s", value) else value


def write_settings(payload):
    updates = _updates_from(payload)
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.exists() else [
        "# Laptop settings (gitignored). Edited by the control panel (run.bat) or by hand."]
    out, done = [], set()
    for line in lines:
        m = re.match(r"\s*([A-Z_][A-Z0-9_]*)\s*=", line)
        key = m.group(1) if m else None
        if key in ("HUB_URL", "ESP32_IP"):                  # older names, replaced by WORKER_URL / ESP32_HOST
            continue
        if key in updates:
            if key not in done:
                out.append(f"{key}={_format(updates[key])}")
                done.add(key)
            continue
        out.append(line)
    out += [f"{k}={_format(v)}" for k, v in updates.items() if k not in done]
    tmp = ENV_FILE.with_suffix(".tmp")
    tmp.write_text("\n".join(out) + "\n", encoding="utf-8")
    os.replace(tmp, ENV_FILE)
    return read_settings()


def child_env():
    env = {k: v for k, v in os.environ.items() if k not in MANAGED}
    env.update(PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8")
    return env


# ---------------- detection (main.py) ----------------
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


class Detection:
    def __init__(self):
        self.proc = None
        self.started_at = None
        self.settings_at_start = None
        self.log = deque(maxlen=300)
        self.lock = threading.Lock()

    @property
    def running(self):
        return self.proc is not None and self.proc.poll() is None

    def start(self):
        with self.lock:
            if self.running:
                return
            self.log.clear()
            self.log.append(f"[panel] starting detection ({time.strftime('%H:%M:%S')})")
            flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
            self.proc = subprocess.Popen(
                [sys.executable, "-u", "main.py"], cwd=HERE, env=child_env(), creationflags=flags,
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace")
            self.started_at = time.time()
            self.settings_at_start = read_settings()
            threading.Thread(target=self._read, args=(self.proc,), daemon=True).start()

    def _read(self, proc):
        for line in proc.stdout:
            line = ANSI.sub("", line).strip()
            if not line or (("━" in line or "Downloading" in line) and "100%" not in line):
                continue                                    # progress bars: keep only the last one
            self.log.append(line)
        code = proc.wait()
        self.log.append(f"[panel] detection stopped (exit code {code})")

    def stop(self, timeout=10):
        with self.lock:
            proc = self.proc
            if proc is None or proc.poll() is not None:
                return
            try:
                if os.name == "nt":
                    proc.send_signal(signal.CTRL_BREAK_EVENT)   # main.py treats it like Ctrl+C
                else:
                    proc.send_signal(signal.SIGINT)
                proc.wait(timeout)
            except (subprocess.TimeoutExpired, OSError):
                proc.kill()
                proc.wait()


detection = Detection()
camera_lock = threading.Lock()


# ---------------- camera test picture ----------------
def _first_jpeg_http(url, timeout=6):
    req = urllib.request.Request(url, headers={"User-Agent": "crowd-edge/2.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        buf, end = b"", time.time() + timeout
        while time.time() < end and len(buf) < 4_000_000:
            chunk = r.read(16384)
            if not chunk:
                break
            buf += chunk
            start = buf.find(b"\xff\xd8")
            stop = buf.find(b"\xff\xd9", start + 2) if start >= 0 else -1
            if stop > 0:
                return buf[start:stop + 2]
    raise BadRequest("The camera answered, but no picture arrived (is the URL a video stream?).")


def snapshot(webcam=None):
    """One JPEG from the camera in the settings, or from webcam number `webcam`."""
    import cv2
    s = read_settings()
    if webcam is not None:
        _need(0 <= webcam <= 9, "Webcam number must be 0-9.")
        s = {**s, "camera": "webcam", "webcam_index": webcam}
    if s["camera"] == "sim":
        raise BadRequest("Simulation has no camera: start detection to see the fake people.")
    if s["camera"] in ("phone", "url"):
        url = f"http://{s['phone_ip']}:{s['phone_port']}/video" if s["camera"] == "phone" else s["camera_url"]
        if url.startswith("http"):
            try:
                return _first_jpeg_http(url)
            except BadRequest:
                raise
            except Exception as err:  # noqa: BLE001
                raise BadRequest(f"{url} not reachable ({getattr(err, 'reason', err)}). Is IP Webcam running "
                                 "(Start server), and are the phone and laptop on the same Wi-Fi?") from err
        source, api = url, cv2.CAP_FFMPEG
    else:
        if detection.running:
            raise BadRequest("The webcam is in use by detection. Stop it to test the webcam.")
        source, api = s["webcam_index"], cv2.CAP_DSHOW if os.name == "nt" else cv2.CAP_ANY
    with camera_lock:
        cap = cv2.VideoCapture(source, api)
        try:
            frame = None
            for _ in range(5):                               # the first webcam frames are often dark
                ok, img = cap.read()
                if ok:
                    frame = img
        finally:
            cap.release()
    if frame is None:
        raise BadRequest(f"No picture from {source}.")
    return cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])[1].tobytes()


def find_webcams():
    import cv2
    if detection.running and read_settings()["camera"] == "webcam":
        raise BadRequest("Stop detection first: it is using the webcam.")
    found = []
    with camera_lock:
        for i in range(5):
            cap = cv2.VideoCapture(i, cv2.CAP_DSHOW if os.name == "nt" else cv2.CAP_ANY)
            ok = cap.isOpened() and cap.read()[0]
            if ok:
                found.append({"index": i, "size": f"{int(cap.get(3))}x{int(cap.get(4))}"})
            cap.release()
    return found


# ---------------- what is installed ----------------
REQUIREMENTS = [
    # (package names to look for, why it is needed)
    (["ultralytics"], "YOLO person detection"),
    (["torch"], "runs the YOLO model"),
    (["opencv-python", "opencv-python-headless", "opencv-contrib-python"], "camera and video"),
    (["websocket-client"], "streams the video to the website"),
    (["pyserial"], "ESP32 over the USB cable"),
    (["python-dotenv"], "reads the settings file"),
]


def _installed(names):
    for name in names:
        try:
            return name, importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            continue
    return names[0], None


class Installer:
    """pip install -r requirements.txt into this Python, with its output kept for the website."""

    def __init__(self):
        self.proc = None
        self.log = deque(maxlen=200)

    @property
    def running(self):
        return self.proc is not None and self.proc.poll() is None

    def start(self):
        if self.running:
            return
        self.log.clear()
        self.log.append("[panel] installing the packages from requirements.txt (several minutes the first time)")
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "-r", "requirements.txt"],
            cwd=HERE, env=child_env(), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace")
        threading.Thread(target=self._read, args=(self.proc,), daemon=True).start()

    def _read(self, proc):
        for line in proc.stdout:
            line = ANSI.sub("", line).strip()
            if line and not line.startswith(("Requirement already satisfied", "  ")):
                self.log.append(line)
        code = proc.wait()
        self.log.append("[panel] packages installed" if code == 0 else f"[panel] pip failed (exit code {code})")


installer = Installer()


def system_report():
    packages = []
    for names, why in REQUIREMENTS:
        name, version = _installed(names)
        packages.append({"name": name, "version": version, "why": why})
    s = read_settings()
    model = HERE / "yolov8n.pt"
    py_ok = sys.version_info >= (3, 9)
    missing = [p["name"] for p in packages if not p["version"]]
    return {
        "panel": VERSION,
        "app_folder": str(HERE),
        "os": f"{platform.system()} {platform.release()}",
        "python": {"version": platform.python_version(), "ok": py_ok, "executable": sys.executable},
        "packages": packages,
        "missing": missing,
        "model": {"present": model.exists(), "note": "downloaded automatically on the first start (6 MB)"},
        "token_set": s["token_set"],
        "worker_url": s["worker_url"],
        "ready": py_ok and not missing and s["token_set"],
        "installing": installer.running,
        "install_log": list(installer.log)[-60:],
    }


def run_check():
    out = subprocess.run([sys.executable, "check.py", "--json"], cwd=HERE, env=child_env(),
                         capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
    try:
        return json.loads(out.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError) as err:
        raise BadRequest(f"check.py failed: {(out.stderr or out.stdout)[-400:]}") from err


# ---------------- ESP32 ----------------
def esp32_info(body):
    via = body.get("via")
    if via == "usb":
        return esp32_setup.info_usb(_port(body))
    if via == "wifi":
        return esp32_setup.info_http(_host(body))
    raise BadRequest("via must be usb or wifi")


def esp32_wifi(body):
    ssid, password = str(body.get("ssid", "")), str(body.get("password", ""))
    via = body.get("via")
    if via == "usb":
        info = esp32_setup.wifi_usb(_port(body), ssid, password)
        return {"joined": True, "info": info}
    if via == "wifi":
        esp32_setup.wifi_http(_host(body), ssid, password)
        return {"joined": None}
    raise BadRequest("via must be usb or wifi")


def _port(body):
    port = str(body.get("port") or "").strip()
    _need(PORTNAME_RE.match(port), "Choose the ESP32's COM port.")
    if detection.running and read_settings()["esp32_mode"] == "usb":
        raise BadRequest("Detection is using the USB cable. Stop detection first.")
    return port


def _host(body):
    host = str(body.get("host") or "").strip()
    _need(HOST_RE.match(host), "Enter the ESP32 address.")
    return host


# ---------------- HTTP ----------------
class Handler(BaseHTTPRequestHandler):
    server_version = "CrowdPanel/1"

    def log_message(self, *args):
        pass

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin in WEB_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Frame-Options", "DENY")
        self._cors()
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _trusted(self):
        if self.headers.get("Host") not in ALLOWED_HOSTS:          # blocks DNS-rebinding tricks
            return False
        origin = self.headers.get("Origin")
        if origin is not None:
            return origin in PANEL_ORIGINS or origin in WEB_ORIGINS
        # No Origin: the panel page itself, a typed URL or a script on this computer are fine;
        # an <img> or link embedded in some other website (cross-site) is not
        return self.headers.get("Sec-Fetch-Site") in (None, "none", "same-origin")

    def do_OPTIONS(self):
        # CORS preflight from the dashboard website
        if self.headers.get("Host") not in ALLOWED_HOSTS or self.headers.get("Origin") not in WEB_ORIGINS:
            return self._send(403, {"error": "Forbidden"})
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")   # Chrome: public site -> this computer
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _state(self):
        s = read_settings()
        return {
            "settings": s,
            "running": detection.running,
            "started_at": detection.started_at if detection.running else None,
            "restart_needed": detection.running and detection.settings_at_start not in (None, s),
            "log": list(detection.log)[-150:],
            "dashboard": DASHBOARD,
            "env_file": str(ENV_FILE),
        }

    def do_GET(self):
        if not self._trusted():
            return self._send(403, {"error": "Forbidden"})
        path, _, query = self.path.partition("?")
        params = dict(p.split("=", 1) for p in query.split("&") if "=" in p)
        try:
            if path in ("/", "/index.html"):
                return self._send(200, (HERE / "panel.html").read_bytes(), "text/html; charset=utf-8")
            if path == "/api/state":
                return self._send(200, self._state())
            if path == "/api/system":
                return self._send(200, system_report())
            if path == "/api/ports":
                return self._send(200, esp32_setup.ports())
            if path == "/api/webcams":
                return self._send(200, find_webcams())
            if path == "/api/snapshot":
                webcam = int(params["webcam"]) if params.get("webcam", "").isdigit() else None
                return self._send(200, snapshot(webcam), "image/jpeg")
            return self._send(404, {"error": "Not found"})
        except (BadRequest, esp32_setup.SetupError) as err:
            return self._send(400, {"error": str(err)})

    def do_POST(self):
        if not self._trusted() or not self.headers.get("Content-Type", "").startswith("application/json"):
            return self._send(403, {"error": "Forbidden"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(min(length, 65536)) or b"{}")
            path = self.path
            if path == "/api/settings":
                write_settings(body)
                return self._send(200, self._state())
            if path == "/api/check":
                return self._send(200, run_check())
            if path == "/api/start":
                if body.get("settings"):
                    write_settings(body["settings"])
                detection.start()
                return self._send(200, self._state())
            if path == "/api/stop":
                detection.stop()
                return self._send(200, self._state())
            if path == "/api/restart":
                detection.stop()
                detection.start()
                return self._send(200, self._state())
            if path == "/api/install":
                installer.start()
                return self._send(200, system_report())
            if path == "/api/esp32/info":
                return self._send(200, esp32_info(body))
            if path == "/api/esp32/wifi":
                return self._send(200, esp32_wifi(body))
            return self._send(404, {"error": "Not found"})
        except (BadRequest, esp32_setup.SetupError, ValueError) as err:
            return self._send(400, {"error": str(err)})
        except subprocess.TimeoutExpired:
            return self._send(504, {"error": "Timed out"})


def main():
    url = f"http://127.0.0.1:{PORT}/"
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        print(f"The panel is already running: opening {url}")
        webbrowser.open(url)
        return
    httpd.daemon_threads = True
    print(f"Control panel: {url}   (keep this window open; Ctrl+C or close it to quit)")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, webbrowser.open, args=(url,)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        print("Closing the panel...")
        detection.stop()
        httpd.server_close()


if __name__ == "__main__":
    main()
