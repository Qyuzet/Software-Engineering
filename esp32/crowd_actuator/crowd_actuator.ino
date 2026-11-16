/*
  crowd_actuator.ino - ESP32 Actuator for the Crowd Control Monitoring System.

  Receives the crowd state from the Python Core Script (INT-01):
    '1' = CROWDED, '0' = NORMAL
  over USB serial (ESP32_MODE=serial) or Wi-Fi (ESP32_MODE=wifi,
  HTTP GET http://<ESP32 address>/state?v=1). Both work at the same time.

  LEDs (breadboard wiring: P25 green, P26 yellow, P27 red):
    green on        = NORMAL
    red blinking    = CROWDED
    yellow blinking = no signal from the laptop for 6 s (script stopped or link lost)

  Python re-sends the state every 2 s (RESEND_EVERY_S in config.py), so 6 s of
  silence means three missed messages.
*/

#include <WiFi.h>
#include <WebServer.h>

// ---------------- Settings ----------------
#define USE_WIFI 1                        // 1 = also listen on Wi-Fi, 0 = USB cable only
const char* WIFI_NAME = "Galaxy A55 5G 2E2B";
const char* WIFI_PASSWORD = "bayardululah";

#define GREEN_LED 25                      // NORMAL
#define YELLOW_LED 26                     // no signal
#define RED_LED 27                        // CROWDED

#define SIGNAL_TIMEOUT_MS 6000            // silence longer than this = no signal
#define RED_BLINK_MS 300
#define YELLOW_BLINK_MS 600
#define WIFI_RETRY_MS 10000               // retry Wi-Fi every 10 s while disconnected

// ---------------- State ----------------
bool crowded = false;
bool hasSignal = false;                   // received at least one command
unsigned long lastCommandAt = 0;
unsigned long lastBlinkAt = 0;
bool blinkOn = false;

#if USE_WIFI
WebServer server(80);
bool wifiConnected = false;
unsigned long lastWifiAttempt = 0;
#endif

// '1' or '0' from Python, by USB or Wi-Fi
void applyCommand(char c) {
  if (c != '0' && c != '1') return;       // ignore anything else (newlines, noise)
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

void updateLeds() {
  unsigned long now = millis();

  if (signalLost()) {
    digitalWrite(GREEN_LED, LOW);
    digitalWrite(RED_LED, LOW);
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
    }
  } else {
    digitalWrite(GREEN_LED, HIGH);
    digitalWrite(YELLOW_LED, LOW);
    digitalWrite(RED_LED, LOW);
  }
}

#if USE_WIFI
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

// GET /  - open in a browser to check the ESP32
void handleRoot() {
  String msg = "Crowd Control ESP32 Actuator\n";
  if (signalLost()) msg += "Status: NO SIGNAL from the laptop\n";
  else msg += crowded ? "Status: CROWDED\n" : "Status: NORMAL\n";
  server.send(200, "text/plain", msg);
}

void maintainWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiConnected) {
      wifiConnected = true;
      Serial.print("Wi-Fi connected. ESP32 address: ");
      Serial.println(WiFi.localIP());
      Serial.println("Put this address in ESP32_HOST in your .env file.");
    }
    server.handleClient();
    return;
  }
  if (wifiConnected) {
    wifiConnected = false;
    Serial.println("Wi-Fi lost. Retrying...");
  }
  if (millis() - lastWifiAttempt > WIFI_RETRY_MS) {
    lastWifiAttempt = millis();
    WiFi.disconnect();
    WiFi.begin(WIFI_NAME, WIFI_PASSWORD);
  }
}
#endif

void setup() {
  Serial.begin(115200);                   // must match SERIAL_BAUD in config.py
  pinMode(GREEN_LED, OUTPUT);
  pinMode(YELLOW_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  Serial.println();
  Serial.println("Crowd Control ESP32 Actuator ready. Waiting for '1' or '0'.");

#if USE_WIFI
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);   // connects in the background
  lastWifiAttempt = millis();
  server.on("/", handleRoot);
  server.on("/state", handleState);
  server.begin();
#endif
}

void loop() {
  while (Serial.available()) {
    applyCommand((char)Serial.read());
  }

#if USE_WIFI
  maintainWifi();
#endif

  updateLeds();
}