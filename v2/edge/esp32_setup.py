"""
esp32_setup.py - Wi-Fi setup and status of the ESP32, used by the control panel (panel.py).

Needs the v2 firmware (v2/esp32/crowd_actuator) flashed once.
  USB:   text lines at 115200 baud:  "WIFI <name>\t<password>"  ->  "WIFI OK <ip> <name>" / "WIFI FAIL <reason>"
                                     "INFO"                     ->  "INFO {json}"
  Wi-Fi: POST http://<esp32>/wifi (ssid, pass),  GET http://<esp32>/info
"""

import json
import time
import urllib.parse
import urllib.request

BAUD = 115200
UA = {"User-Agent": "crowd-edge/2.0"}
# USB-serial chips used on ESP32 boards (Silicon Labs CP210x, WCH CH34x, FTDI, Espressif native USB)
ESP32_USB_VIDS = {0x10C4, 0x1A86, 0x0403, 0x303A}


class SetupError(Exception):
    """A problem the user can fix; the message says how."""


def ports():
    """Serial ports, the likely ESP32 first; Bluetooth ports last."""
    try:
        from serial.tools import list_ports  # pyserial (imported here so the panel starts without it)
    except ImportError:
        return []
    out = []
    for p in list_ports.comports():
        bluetooth = "bluetooth" in (p.description or "").lower() or "BTHENUM" in (p.hwid or "")
        likely = p.vid in ESP32_USB_VIDS
        out.append({"device": p.device, "description": p.description or p.device,
                    "likely_esp32": likely, "bluetooth": bluetooth})
    return sorted(out, key=lambda p: (not p["likely_esp32"], p["bluetooth"], p["device"]))


def check_wifi(ssid, password):
    if not 1 <= len(ssid.encode()) <= 32:
        raise SetupError("Wi-Fi name must be 1-32 characters.")
    if password and not 8 <= len(password.encode()) <= 63:
        raise SetupError("Password must be empty (open network) or 8-63 characters.")
    if any(c in ssid + password for c in "\t\r\n"):
        raise SetupError("Tabs and line breaks are not allowed.")


# ---------------- USB ----------------
class _Board:
    def __init__(self, port):
        try:
            import serial  # pyserial
        except ImportError as err:
            raise SetupError("pyserial is not installed: install the missing packages first.") from err
        try:
            ser = serial.serial_for_url(port, do_not_open=True, baudrate=BAUD, timeout=0.2)
            ser.dtr = False   # keep reset/boot lines released: opening the port must not restart the board
            ser.rts = False
            ser.open()
        except serial.SerialException as err:
            text = str(err)
            if "denied" in text.lower() or "busy" in text.lower() or "PermissionError" in text:
                raise SetupError(f"{port} is busy. Stop detection (USB mode) and close the Arduino "
                                 "Serial Monitor, then try again.") from err
            if "FileNotFoundError" in text or "cannot find" in text.lower():
                raise SetupError(f"{port} is not connected. Plug in the ESP32's USB cable and press Refresh.") from err
            raise SetupError(f"Cannot open {port}: {text}") from err
        self.ser = ser
        self.buf = b""

    def close(self):
        self.ser.close()

    def send(self, line):
        self.ser.write((line + "\n").encode())

    def wait_for(self, prefixes, timeout):
        """First line that starts with one of `prefixes`, or None."""
        end = time.time() + timeout
        while time.time() < end:
            self.buf += self.ser.read(256)
            while b"\n" in self.buf:
                raw, self.buf = self.buf.split(b"\n", 1)
                text = raw.decode(errors="replace").strip()
                if text.startswith(prefixes):
                    return text
        return None

    def info(self):
        # The board may restart when the port opens; ask again after it has booted
        for wait in (3, 4):
            self.send("INFO")
            reply = self.wait_for(("INFO ",), wait)
            if reply:
                return json.loads(reply[5:])
        raise SetupError("The ESP32 does not answer on this port. Is it the right port, and is the v2 "
                         "firmware (v2/esp32/crowd_actuator) flashed? Close the Arduino Serial Monitor.")


def info_usb(port):
    board = _Board(port)
    try:
        return board.info()
    finally:
        board.close()


def wifi_usb(port, ssid, password, timeout=30):
    """Saves the Wi-Fi on the ESP32 over USB and waits until it joins. Returns its info (with "ip")."""
    check_wifi(ssid, password)
    board = _Board(port)
    try:
        board.info()                                     # firmware present and listening
        board.send(f"WIFI {ssid}\t{password}")
        reply = board.wait_for(("WIFI OK", "WIFI FAIL"), timeout)
        if reply is None:
            raise SetupError("No answer from the ESP32 within 30 s.")
        if reply.startswith("WIFI FAIL"):
            raise SetupError(f"The ESP32 could not join \"{ssid}\": {reply[10:]}")
        return board.info()
    finally:
        board.close()


# ---------------- Wi-Fi ----------------
def info_http(host, timeout=3):
    try:
        req = urllib.request.Request(f"http://{host}/info", headers=UA)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as err:
        if err.code == 404:
            raise SetupError(f"{host} is an ESP32 with the old firmware: flash v2/esp32/crowd_actuator once.") from err
        raise SetupError(f"{host} answered HTTP {err.code}.") from err
    except Exception as err:  # noqa: BLE001
        raise SetupError(f"No ESP32 at {host} ({getattr(err, 'reason', err)}). Same Wi-Fi as the laptop?") from err


def wifi_http(host, ssid, password):
    """Sends a new Wi-Fi to an ESP32 that is online now. It then leaves the current network."""
    check_wifi(ssid, password)
    info_http(host)
    data = urllib.parse.urlencode({"ssid": ssid, "pass": password}).encode()
    req = urllib.request.Request(f"http://{host}/wifi", data=data, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=5):
            pass
    except urllib.error.HTTPError as err:
        raise SetupError(err.read().decode(errors="replace") or f"HTTP {err.code}") from err
