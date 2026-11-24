import { Volume2, VolumeX } from "lucide-react";

import Panel, { Empty } from "./Panel";

// Mirrors the ESP32 alert box: green = NORMAL, red blinking + buzzer = CROWDED,
// yellow blinking = no live signal from the laptop (edge script not connected).
export default function AlertDevice({ current, esp32 }) {
  const live = current?.live;
  const crowded = current?.crowded;
  return (
    <Panel title="Alert device (ESP32)" className="device">
      {!current ? <Empty>Waiting for a count.</Empty> : (
        <>
          <div className={`lcd ${!live ? "idle" : crowded ? "alarm" : ""}`}>
            <strong>Status: {!live ? "NO SIGNAL" : crowded ? "CROWDED!" : "NORMAL"}</strong>
            <span>{!live ? "Showing last logged state" : crowded ? "Limit exceeded" : "Area is safe."}</span>
          </div>
          <div className="leds">
            <span className={`led green ${live && !crowded ? "on" : ""}`}><i />GREEN</span>
            <span className={`led yellow ${!live ? "on blink" : ""}`}><i />YELLOW</span>
            <span className={`led red ${live && crowded ? "on blink" : ""}`}><i />RED</span>
            <span className={`buzzer ${live && crowded ? "on" : ""}`}>
              {live && crowded ? <Volume2 size={14} /> : <VolumeX size={14} />}BUZZER
            </span>
          </div>
          <p className="device-meta">
            {current.count} / {current.limit} people · ESP32: {esp32 ?? (live ? "unknown" : "not connected")}
          </p>
        </>
      )}
    </Panel>
  );
}
