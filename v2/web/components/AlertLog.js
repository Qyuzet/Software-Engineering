import { fmtMinute } from "@/lib/time";

import Panel, { Empty } from "./Panel";

export default function AlertLog({ episodes = [], isToday }) {
  return (
    <Panel title="Alert log" className="alert-log">
      {episodes.length === 0 ? <Empty>No alerts on this day.</Empty> : (
        <ul>
          {[...episodes].reverse().map((e) => (
            <li key={e.start}>
              <span className="dot" />
              <div>
                <strong>{fmtMinute(e.start)} – {fmtMinute(e.end)}</strong>
                <small>Peak {e.peak} people · {Math.max(1, e.end - e.start)} min</small>
              </div>
            </li>
          ))}
        </ul>
      )}
      {isToday && <p className="foot">Updates every 10 s</p>}
    </Panel>
  );
}
