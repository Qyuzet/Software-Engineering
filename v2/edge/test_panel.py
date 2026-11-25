"""
Tests for the laptop control panel (panel.py). Run from the repo root:
    python -m unittest discover -s v2/edge -p "test_*.py"
They use a temporary settings file; the real v2/edge/.env is not touched.
"""

import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

os.environ["PANEL_PORT"] = "8799"
import panel  # noqa: E402  (reads PANEL_PORT on import)

DASHBOARD = "https://crowd.etzalgroup.com"


class PanelTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        panel.ENV_FILE = Path(cls.tmp.name) / ".env"
        panel.ROOT_ENV = Path(cls.tmp.name) / "no-root.env"
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", panel.PORT), panel.Handler)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{panel.PORT}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.tmp.cleanup()

    def call(self, path, body=None, headers=None, method=None, raw=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        h = {"Content-Type": "application/json"} if body is not None else {}
        h.update(headers or {})
        req = urllib.request.Request(self.base + path, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, r.headers, r.read()
        except urllib.error.HTTPError as err:
            return err.code, err.headers, err.read()

    def test_settings_are_saved_to_the_env_file(self):
        code, _, body = self.call("/api/settings", {
            "camera": "phone", "phone_ip": "10.31.176.62", "esp32_mode": "wifi", "esp32_host": "10.31.176.176",
            "worker_url": "https://crowd-api.etzalgroup.com", "edge_token": "abcdefgh12345678",
            "crowd_limit": 12, "site_name": "Lecture Hall A", "show_window": False})
        self.assertEqual(code, 200, body)
        state = json.loads(body)
        self.assertEqual(state["settings"]["camera"], "phone")
        self.assertEqual(state["settings"]["crowd_limit"], 12)
        self.assertTrue(state["settings"]["token_set"])
        self.assertNotIn("abcdefgh12345678", body.decode())             # the token is never sent back
        text = panel.ENV_FILE.read_text()
        for line in ("PHONE_IP=10.31.176.62", "CAMERA_SOURCE=", "ESP32_MODE=wifi", "EDGE_TOKEN=abcdefgh12345678",
                     'SITE_NAME="Lecture Hall A"', "SHOW_WINDOW=false"):
            self.assertIn(line, text)

        # switching to a webcam keeps the phone IP for later
        code, _, body = self.call("/api/settings", {"camera": "webcam", "webcam_index": 1})
        s = json.loads(body)["settings"]
        self.assertEqual((s["camera"], s["webcam_index"], s["phone_ip"]), ("webcam", 1, "10.31.176.62"))

    def test_invite_link_carries_the_token_after_the_hash(self):
        self.call("/api/settings", {"camera": "sim", "esp32_mode": "off",
                                    "worker_url": "https://crowd-api.etzalgroup.com", "edge_token": "invite12345678"})
        code, _, body = self.call("/api/invite", headers={"Origin": DASHBOARD})
        self.assertEqual(code, 200, body)
        self.assertEqual(json.loads(body)["link"], f"{DASHBOARD}/laptop#join=invite12345678")
        self.assertEqual(self.call("/api/invite", headers={"Origin": "https://evil.example"})[0], 403)

    def test_bad_values_are_refused_with_a_reason(self):
        for change in ({"camera": "phone", "phone_ip": "not an ip!"}, {"crowd_limit": 0},
                       {"camera": "url", "camera_url": "file:///etc/passwd"}, {"edge_token": "x y"}):
            code, _, body = self.call("/api/settings", change)
            self.assertEqual(code, 400, change)
            self.assertIn("error", json.loads(body))

    def test_other_websites_are_refused(self):
        self.assertEqual(self.call("/api/start", {}, {"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.call("/api/start", raw=b"{}", headers={"Content-Type": "text/plain"})[0], 403)
        self.assertEqual(self.call("/api/state", headers={"Host": "evil.example:8799"})[0], 403)
        self.assertEqual(self.call("/api/snapshot?webcam=0", headers={"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.assertEqual(self.call("/api/start", method="OPTIONS", headers={"Origin": "https://evil.example"})[0], 403)

    def test_the_dashboard_website_is_allowed(self):
        code, headers, _ = self.call("/api/start", method="OPTIONS", headers={
            "Origin": DASHBOARD, "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Private-Network": "true"})
        self.assertEqual(code, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], DASHBOARD)
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")

        code, headers, body = self.call("/api/system", headers={"Origin": DASHBOARD})
        self.assertEqual(code, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], DASHBOARD)
        report = json.loads(body)
        self.assertIn("python", report)
        self.assertEqual({p["name"] for p in report["packages"]} >= {"ultralytics", "pyserial"}, True)

    def test_the_panel_page_itself_works(self):
        code, headers, body = self.call("/")
        self.assertEqual(code, 200)
        self.assertIn(b"Laptop panel", body)
        self.assertEqual(self.call("/api/state", headers={"Sec-Fetch-Site": "same-origin"})[0], 200)


if __name__ == "__main__":
    unittest.main()
