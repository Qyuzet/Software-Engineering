import { NEAR_LIMIT_RATIO } from "@/lib/constants";
import { browserTz, nowIn } from "@/lib/time";

import Panel from "./Panel";

const TICKS = ["00", "03", "06", "09", "12", "15", "18", "21", "24"];

function colour(b, limit) {
  if (b.max > limit) return "var(--red)";
  if (b.max >= NEAR_LIMIT_RATIO * limit) return "var(--amber)";
  return "var(--green)";
}

// A 24-hour strip, one slice per 5 minutes, coloured by how full the room was.
export default function OccupancyTimeline({ series = [], limit, isToday }) {
  const nowMinute = isToday ? nowIn(browserTz()).minute : null;
  return (
    <Panel title="Occupancy timeline" className="timeline"
           actions={
             <div className="legend">
               <span><i style={{ background: "var(--green)" }} />Normal</span>
               <span><i style={{ background: "var(--amber)" }} />Near limit</span>
               <span><i style={{ background: "var(--red)" }} />Over limit</span>
             </div>
           }>
      <svg viewBox="0 0 288 10" preserveAspectRatio="none" className="strip" role="img"
           aria-label="Occupancy through the day">
        <rect width="288" height="10" rx="2" fill="var(--track)" />
        {series.map((b) => (
          <rect key={b.minute} x={b.minute / 5} width="1.05" height="10" fill={colour(b, limit)} />
        ))}
        {nowMinute != null && <rect x={nowMinute / 5} width="0.8" height="10" fill="var(--text)" />}
      </svg>
      <div className="ticks">{TICKS.map((t) => <span key={t}>{t}</span>)}</div>
    </Panel>
  );
}
