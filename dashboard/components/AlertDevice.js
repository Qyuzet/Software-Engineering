import Panel, { Empty } from "./Panel";

// Mirrors the ESP32 box on slide 7: LCD text plus red and green LEDs.
export default function AlertDevice({ current, esp32 }) {
  return (
    <Panel title="Alert device" className="device">
      {!current ? <Empty>Waiting for a count.</Empty> : (
        <>
          <div className="lcd">
            <strong>Status: {current.crowded ? "CROWDED!" : "NORMAL"}</strong>
            <span>{current.crowded ? "Limit exceeded" : "Area is safe."}</span>
          </div>
          <div className="leds">
            <span className={`led red ${current.crowded ? "on blink" : ""}`}><i />RED</span>
            <span className={`led green ${current.crowded ? "" : "on"}`}><i />GREEN</span>
          </div>
          <p className="device-meta">
            {current.count} / {current.limit} people
            <br />
            ESP32: {esp32 ?? (current.live ? "unknown" : "last logged state")}
          </p>
        </>
      )}
    </Panel>
  );
}
