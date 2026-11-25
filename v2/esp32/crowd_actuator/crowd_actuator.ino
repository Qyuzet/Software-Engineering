/*
  crowd_actuator.ino - ESP32 Actuator for the Crowd Control Monitoring System (v2).

  Receives the crowd state from the laptop (edge/main.py):
    '1' = CROWDED, '0' = NORMAL
  over USB serial (ESP32_MODE=usb) or Wi-Fi (ESP32_MODE=wifi, GET http://<ESP32 address>/state?v=1).

  Outputs (breadboard wiring: P25 green, P26 yellow, P27 red, P33 buzzer):
    green on              = NORMAL
    red blinking + beeps  = CROWDED
    yellow blinking       = no signal from the laptop for 6 s (script stopped or link lost)

  Wi-Fi name and password are saved in the ESP32, so changing them needs no re-flashing:
    - Laptop control panel (double-click v2/edge/run.bat): over the USB cable or over Wi-Fi.
    - Setup hotspot: with no working Wi-Fi for 30 s the ESP32 opens "Crowd-ESP32-XXXX"
      (password crowd1234). Join it with a phone; the setup page opens (or go to http://192.168.4.1/wifi).
    - Any browser on the same network: http://<ESP32 address>/wifi
  secrets.h is optional: it only gives the Wi-Fi used before one is saved.

  USB commands (one line each, 115200 baud; used by the control panel):
    WIFI <name><TAB><password>   save + join, answers "WIFI OK <ip> <name>" or "WIFI FAIL <reason>"
    INFO                         answers "INFO {json}"
    FORGET                       erase the saved Wi-Fi
*/

#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>

// ---------------- Settings ----------------
#define USE_WIFI 1                        // 1 = also listen on Wi-Fi, 0 = USB cable only

#if __has_include("secrets.h")
#include "secrets.h"                      // optional first-boot Wi-Fi (copy secrets.example.h, never commit it)
#else
const char* WIFI_NAME = "";
const char* WIFI_PASSWORD = "";
#endif

#define GREEN_LED 25                      // NORMAL
#define YELLOW_LED 26                     // no signal
#define RED_LED 27                        // CROWDED
#define BUZZER_PIN 33                     // beeps while CROWDED

#define BUZZER_ENABLED 1                  // 0 = mute the buzzer (handy while testing)
#define BUZZER_ACTIVE 1                   // 1 = active buzzer (beeps on its own), 0 = passive buzzer
#define BUZZER_TONE_HZ 2000               // pitch for a passive buzzer

#define SIGNAL_TIMEOUT_MS 6000            // silence longer than this = no signal
#define RED_BLINK_MS 300
#define YELLOW_BLINK_MS 600
#define WIFI_RETRY_MS 10000               // retry Wi-Fi every 10 s while disconnected

#define SETUP_AP_PASSWORD "crowd1234"     // password of the setup hotspot (8+ characters)
#define SETUP_AP_AFTER_MS 30000           // open the setup hotspot after 30 s without Wi-Fi
#define SETUP_AP_KEEP_MS 120000           // close it 2 min after joining Wi-Fi (time to read the address)
#define WIFI_REPORT_MS 20000              // a new network gets 20 s before "WIFI FAIL"

// ---------------- State ----------------
bool crowded = false;
bool hasSignal = false;                   // received at least one command
unsigned long lastCommandAt = 0;
unsigned long lastBlinkAt = 0;
bool blinkOn = false;
bool buzzerOn = false;

String serialLine;                        // a text command being typed/sent over USB
unsigned long serialLineAt = 0;

#if USE_WIFI
WebServer server(80);
DNSServer dns;
Preferences prefs;
String wifiSsid, wifiPass;
bool wifiConnected = false;
bool apActive = false;
unsigned long lastWifiAttempt = 0;
unsigned long wifiDownSince = 0;
unsigned long connectedAt = 0;
unsigned long wifiChangedAt = 0;
bool reportPending = false;               // print WIFI OK / WIFI FAIL for the control panel
bool applyPending = false;                // new Wi-Fi from the web page, applied after the reply is sent
unsigned long applyAt = 0;
String pendingSsid, pendingPass;
#endif

// ---------------- Outputs ----------------
void setBuzzer(bool on) {
  if (!BUZZER_ENABLED) on = false;
  if (on == buzzerOn) return;             // only change the pin when needed
  buzzerOn = on;
#if BUZZER_ACTIVE
  digitalWrite(BUZZER_PIN, on ? HIGH : LOW);
#else
  if (on) tone(BUZZER_PIN, BUZZER_TONE_HZ);
  else noTone(BUZZER_PIN);
#endif
}

// '1' or '0' from Python, by USB or Wi-Fi
void applyCommand(char c) {
  if (c != '0' && c != '1') return;
  bool newState = (c == '1');
  if (newState != crowded || !hasSignal) {
    Serial.println(newState ? "State -> CROWDED" : "State -> NORMAL");
  }
  crowded = newState;
  hasSignal = true;
  lastCommandAt = millis();
}

bool signalLost() {
  return !hasSignal || millis() - lastCommandAt > SIGNAL_TIMEOUT_MS;
}

String stateText() {
  if (signalLost()) return "NO SIGNAL";
  return crowded ? "CROWDED" : "NORMAL";
}

void updateOutputs() {
  unsigned long now = millis();

  if (signalLost()) {
    digitalWrite(GREEN_LED, LOW);
    digitalWrite(RED_LED, LOW);
    setBuzzer(false);
    if (now - lastBlinkAt > YELLOW_BLINK_MS) {
      lastBlinkAt = now;
      blinkOn = !blinkOn;
      digitalWrite(YELLOW_LED, blinkOn);
    }
  } else if (crowded) {
    digitalWrite(GREEN_LED, LOW);
    digitalWrite(YELLOW_LED, LOW);
    if (now - lastBlinkAt > RED_BLINK_MS) {
      lastBlinkAt = now;
      blinkOn = !blinkOn;
      digitalWrite(RED_LED, blinkOn);
      setBuzzer(blinkOn);                 // beep together with the red LED
    }
  } else {
    digitalWrite(GREEN_LED, HIGH);
    digitalWrite(YELLOW_LED, LOW);
    digitalWrite(RED_LED, LOW);
    setBuzzer(false);
  }
}

// ---------------- Text helpers ----------------
String htmlEscape(const String& s) {
  String out;
  out.reserve(s.length() + 8);
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '&') out += "&amp;";
    else if (c == '<') out += "&lt;";
    else if (c == '>') out += "&gt;";
    else if (c == '"') out += "&quot;";
    else if (c == '\'') out += "&#39;";
    else out += c;
  }
  return out;
}

String jsonEscape(const String& s) {
  String out;
  out.reserve(s.length() + 4);
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '"' || c == '\\') {
      out += '\\';
      out += c;
    } else if ((uint8_t)c < 0x20) {
      out += ' ';
    } else {
      out += c;
    }
  }
  return out;
}

// Wi-Fi name 1-32 characters; password empty (open network) or 8-63 characters
bool validWifi(const String& ssid, const String& pass) {
  return ssid.length() >= 1 && ssid.length() <= 32 &&
         (pass.length() == 0 || (pass.length() >= 8 && pass.length() <= 63));
}

#if USE_WIFI
// ---------------- Wi-Fi ----------------
String apName() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char buf[24];
  snprintf(buf, sizeof(buf), "Crowd-ESP32-%02X%02X", mac[4], mac[5]);
  return String(buf);
}

String wifiReason() {
  switch (WiFi.status()) {
    case WL_NO_SSID_AVAIL: return "network not found (2.4 GHz only)";
    case WL_CONNECT_FAILED: return "wrong password?";
    case WL_CONNECTION_LOST: return "connection lost";
    default: return "could not connect - check the name and password (2.4 GHz only)";
  }
}

void connectWifi() {
  lastWifiAttempt = millis();
  WiFi.disconnect();
  if (wifiSsid.length() == 0) return;
  WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
}

void loadWifi() {
  prefs.begin("crowd", false);
  wifiSsid = prefs.getString("ssid", WIFI_NAME);
  wifiPass = prefs.getString("pass", WIFI_PASSWORD);
  prefs.end();
}

void saveWifi(const String& ssid, const String& pass) {
  prefs.begin("crowd", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.end();
  wifiSsid = ssid;
  wifiPass = pass;
  Serial.printf("Saved Wi-Fi \"%s\". Joining it...\n", ssid.c_str());
  wifiChangedAt = millis();
  reportPending = true;
  connectWifi();
}

void forgetWifi() {
  prefs.begin("crowd", false);
  prefs.clear();
  prefs.end();
  wifiSsid = WIFI_NAME;
  wifiPass = WIFI_PASSWORD;
  Serial.println("Saved Wi-Fi erased.");
  wifiChangedAt = millis();
  reportPending = wifiSsid.length() > 0;
  connectWifi();
}

void startSetupHotspot() {
  if (apActive) return;
  WiFi.mode(WIFI_AP_STA);                 // keep trying the saved network at the same time
  WiFi.softAP(apName().c_str(), SETUP_AP_PASSWORD);
  dns.start(53, "*", WiFi.softAPIP());    // every name points here, so phones open the setup page
  apActive = true;
  Serial.printf("Setup hotspot on: join \"%s\" (password %s), then open http://%s/wifi\n",
                apName().c_str(), SETUP_AP_PASSWORD, WiFi.softAPIP().toString().c_str());
}

void stopSetupHotspot() {
  if (!apActive) return;
  dns.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  apActive = false;
  Serial.println("Setup hotspot off.");
}

String infoJson() {
  String j = "{\"ssid\":\"" + jsonEscape(wifiSsid) + "\"";
  j += ",\"connected\":" + String(wifiConnected ? "true" : "false");
  j += ",\"ip\":\"" + (wifiConnected ? WiFi.localIP().toString() : String("")) + "\"";
  j += ",\"rssi\":" + String(wifiConnected ? WiFi.RSSI() : 0);
  j += ",\"reason\":\"" + (wifiConnected ? String("") : jsonEscape(wifiReason())) + "\"";
  j += ",\"setup_hotspot\":\"" + (apActive ? apName() : String("")) + "\"";
  j += ",\"state\":\"" + stateText() + "\"";
  j += ",\"firmware\":\"v2\"}";
  return j;
}

void maintainWifi() {
  unsigned long now = millis();

  if (applyPending && now - applyAt > 500) {   // the web page got its reply; now switch networks
    applyPending = false;
    saveWifi(pendingSsid, pendingPass);
  }

  bool up = WiFi.status() == WL_CONNECTED;
  if (up && !wifiConnected) {
    wifiConnected = true;
    connectedAt = now;
    Serial.printf("Wi-Fi connected to \"%s\". ESP32 address: %s\n",
                  WiFi.SSID().c_str(), WiFi.localIP().toString().c_str());
    Serial.println("Laptop: ESP32_MODE=wifi, ESP32_HOST=<that address> (the control panel fills it in).");
  } else if (!up && wifiConnected) {
    wifiConnected = false;
    wifiDownSince = now;
    Serial.println("Wi-Fi lost. Retrying...");
  }

  if (reportPending) {
    if (up && WiFi.SSID() == wifiSsid) {
      Serial.printf("WIFI OK %s %s\n", WiFi.localIP().toString().c_str(), wifiSsid.c_str());
      reportPending = false;
    } else if (now - wifiChangedAt > WIFI_REPORT_MS) {
      Serial.printf("WIFI FAIL %s\n", wifiReason().c_str());
      reportPending = false;
    }
  }

  if (!up) {
    if (wifiSsid.length() > 0 && now - lastWifiAttempt > WIFI_RETRY_MS) connectWifi();
    if (!apActive && (wifiSsid.length() == 0 || now - wifiDownSince > SETUP_AP_AFTER_MS)) startSetupHotspot();
  } else if (apActive && now - connectedAt > SETUP_AP_KEEP_MS) {
    stopSetupHotspot();
  }

  if (apActive) dns.processNextRequest();
  server.handleClient();
}

// ---------------- Web pages ----------------
const char PAGE_HEAD[] PROGMEM =
  "<!doctype html><html><head><meta charset=utf-8>"
  "<meta name=viewport content='width=device-width,initial-scale=1'><title>Crowd ESP32</title><style>"
  "body{font-family:system-ui,sans-serif;background:#f3f5f7;margin:0;padding:24px;color:#1d2329}"
  ".c{max-width:420px;margin:auto;background:#fff;border-radius:12px;padding:20px 22px;"
  "box-shadow:0 1px 3px #0002}h1{font-size:19px;margin:0 0 4px}.s{color:#5b6670;font-size:14px;margin:0 0 16px}"
  "label{display:block;font-size:13px;font-weight:600;margin:12px 0 4px}"
  "input{width:100%;box-sizing:border-box;padding:10px;font-size:16px;border:1px solid #c6ced6;border-radius:8px}"
  "button{margin-top:16px;width:100%;padding:12px;font-size:16px;font-weight:600;border:0;border-radius:8px;"
  "background:#1f7a46;color:#fff}.h{font-size:13px;color:#5b6670}.ok{color:#1f7a46}.bad{color:#b3261e}"
  "</style></head><body><div class=c>";
const char PAGE_FOOT[] PROGMEM = "</div></body></html>";

String statusLine() {
  if (wifiConnected) {
    return "Connected to <b>" + htmlEscape(wifiSsid) + "</b> &middot; address <b>" +
           WiFi.localIP().toString() + "</b>";
  }
  if (wifiSsid.length() == 0) return "No Wi-Fi saved yet.";
  return "Not connected to <b>" + htmlEscape(wifiSsid) + "</b>: " + htmlEscape(wifiReason());
}

// GET /wifi - choose the network
void handleWifiPage() {
  String options;
  int n = WiFi.scanNetworks();
  for (int i = 0; i < n && i < 25; i++) {
    String name = WiFi.SSID(i);
    if (name.length() > 0) options += "<option value=\"" + htmlEscape(name) + "\">";
  }
  WiFi.scanDelete();

  String page = FPSTR(PAGE_HEAD);
  page += "<h1>Crowd ESP32 &middot; Wi-Fi</h1><p class=s>" + statusLine() + "</p>";
  page += "<form method=post action=/wifi>"
          "<label for=n>Wi-Fi name (same network as the laptop)</label>"
          "<input id=n name=ssid list=nets required maxlength=32 autocomplete=off value=\"" +
          htmlEscape(wifiSsid) + "\"><datalist id=nets>" + options + "</datalist>"
          "<label for=p>Password</label>"
          "<input id=p name=pass type=password maxlength=63 placeholder='empty for an open network'>"
          "<button>Save and connect</button></form>"
          "<p class=h>2.4 GHz networks only. On an iPhone hotspot, turn on <i>Maximize Compatibility</i>.</p>";
  page += FPSTR(PAGE_FOOT);
  server.send(200, "text/html", page);
}

// POST /wifi - save, then show the result as soon as it is known
void handleWifiSave() {
  String ssid = server.arg("ssid");
  String pass = server.arg("pass");
  ssid.trim();
  if (!validWifi(ssid, pass)) {
    server.send(400, "text/plain", "Wi-Fi name: 1-32 characters. Password: empty, or 8-63 characters.");
    return;
  }
  String page = FPSTR(PAGE_HEAD);
  page += "<h1>Joining " + htmlEscape(ssid) + "...</h1>"
          "<p class=s id=r data-s=\"" + htmlEscape(ssid) + "\">Saved. Waiting for the network...</p>"
          "<p class=h>If this page stops updating, your phone left the setup hotspot: the ESP32 address is "
          "also shown in the laptop control panel (USB) and in the Arduino Serial Monitor.</p>"
          "<script>var r=document.getElementById('r'),t=0;"
          "function p(){fetch('/info').then(function(x){return x.json()}).then(function(j){"
          "if(j.connected&&j.ssid==r.dataset.s){r.className='ok';"
          "r.textContent='Connected. ESP32 address: '+j.ip+' - put it in the laptop control panel.';}"
          "else if(++t>12){r.className='bad';r.textContent='Not connected: '+j.reason+'. Go back and try again.';}"
          "else setTimeout(p,2000)}).catch(function(){setTimeout(p,2000)})}setTimeout(p,3000)</script>";
  page += FPSTR(PAGE_FOOT);
  server.send(200, "text/html", page);
  pendingSsid = ssid;
  pendingPass = pass;
  applyPending = true;
  applyAt = millis();
}

// GET /info - JSON for the control panel and the page above
void handleInfo() {
  server.send(200, "application/json", infoJson());
}

// GET /state?v=1  (sent by esp32_link.py in wifi mode)
void handleState() {
  String v = server.hasArg("v") ? server.arg("v") : "";
  if (v != "0" && v != "1") {
    server.send(400, "text/plain", "use /state?v=0 or /state?v=1");
    return;
  }
  applyCommand(v[0]);
  server.send(200, "text/plain", "ok");
}

// GET /  - quick check in a browser (check.py reads the Status line)
void handleRoot() {
  String msg = "Crowd Control ESP32 Actuator\n";
  if (signalLost()) msg += "Status: NO SIGNAL from the laptop\n";
  else msg += crowded ? "Status: CROWDED\n" : "Status: NORMAL\n";
  msg += BUZZER_ENABLED ? "Buzzer: on\n" : "Buzzer: muted\n";
  msg += "Wi-Fi setup: /wifi\n";
  server.send(200, "text/plain", msg);
}

// Anything else: while the setup hotspot is on, send phones to the setup page
void handleNotFound() {
  if (apActive) {
    server.sendHeader("Location", "http://" + WiFi.softAPIP().toString() + "/wifi", true);
    server.send(302, "text/plain", "");
    return;
  }
  server.send(404, "text/plain", "Not found");
}
#endif

// ---------------- USB commands ----------------
void handleSerialLine(String line) {
  if (line.endsWith("\r")) line.remove(line.length() - 1);
  if (line.startsWith("WIFI ")) {
#if USE_WIFI
    String rest = line.substring(5);
    int sep = rest.indexOf('\t');
    if (sep < 0) sep = rest.indexOf('|');           // easier to type in the Serial Monitor
    String ssid = sep < 0 ? rest : rest.substring(0, sep);
    String pass = sep < 0 ? String("") : rest.substring(sep + 1);
    if (!validWifi(ssid, pass)) {
      Serial.println("WIFI FAIL name 1-32 characters, password empty or 8-63 characters");
      return;
    }
    saveWifi(ssid, pass);
#else
    Serial.println("WIFI FAIL Wi-Fi is off in this firmware (USE_WIFI 0)");
#endif
  } else if (line == "INFO") {
#if USE_WIFI
    Serial.println("INFO " + infoJson());
#else
    Serial.println("INFO {\"state\":\"" + stateText() + "\",\"firmware\":\"v2\"}");
#endif
  } else if (line == "FORGET") {
#if USE_WIFI
    forgetWifi();
#endif
  }
}

// Single '0'/'1' characters are state commands (sent every 2 s by esp32_link.py);
// text commands start with a capital letter and end with a newline.
void readSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (serialLine.length() == 0) {
      if (c == '0' || c == '1') {
        applyCommand(c);
      } else if (c >= 'A' && c <= 'Z') {
        serialLine = c;
        serialLineAt = millis();
      }
      continue;
    }
    if (c == '\n') {
      String line = serialLine;
      serialLine = "";
      handleSerialLine(line);
    } else if (serialLine.length() < 200) {
      serialLine += c;
    }
  }
  if (serialLine.length() > 0 && millis() - serialLineAt > 3000) serialLine = "";  // half a line: drop it
}

void setup() {
  Serial.begin(115200);                   // must match SERIAL_BAUD in config.py
  pinMode(GREEN_LED, OUTPUT);
  pinMode(YELLOW_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  Serial.println();
  Serial.println("Crowd Control ESP32 Actuator v2 ready. Waiting for '1' or '0'.");

#if USE_WIFI
  WiFi.mode(WIFI_STA);
  loadWifi();
  if (wifiSsid.length() > 0) {
    Serial.printf("Joining Wi-Fi \"%s\"...\n", wifiSsid.c_str());
    connectWifi();
  } else {
    Serial.println("No Wi-Fi saved yet.");
  }
  wifiDownSince = millis();
  server.on("/", HTTP_GET, handleRoot);
  server.on("/state", handleState);
  server.on("/info", HTTP_GET, handleInfo);
  server.on("/wifi", HTTP_GET, handleWifiPage);
  server.on("/wifi", HTTP_POST, handleWifiSave);
  server.onNotFound(handleNotFound);
  server.begin();
#endif
}

void loop() {
  readSerial();
#if USE_WIFI
  maintainWifi();
#endif
  updateOutputs();
}
