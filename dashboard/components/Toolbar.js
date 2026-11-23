"use client";

import { CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";

// Dark control row above the camera: measure selector, date picker with Go, and Reset to Latest
export default function Toolbar({ metric, onMetric, date, today, onDate, source, warning, error }) {
  const [pending, setPending] = useState(date ?? "");
  useEffect(() => setPending(date ?? ""), [date]);

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <select className="tb-select" value={metric} onChange={(e) => onMetric(e.target.value)} aria-label="Measure">
          <option value="avg">Average</option>
          <option value="max">Peak</option>
        </select>
        {source && (
          <span className={`source-chip ${source}`}>
            {source === "neon" ? "Live data · Neon" : "Demo data (no DATABASE_URL)"}
          </span>
        )}
        {(warning || error) && <span className="warn-chip">{warning || `Dashboard API: ${error}`}</span>}
      </div>

      <div className="toolbar-right">
        <label className="tb-date">
          <CalendarDays size={15} />
          <input type="date" value={pending} max={today ?? undefined} aria-label="Day"
                 onChange={(e) => setPending(e.target.value)} />
        </label>
        <button className="tb-btn" disabled={!pending || pending === date} onClick={() => onDate(pending)}>Go</button>
        <button className="tb-reset" disabled={!today || date === today} onClick={() => onDate(today)}>
          Reset to Latest
        </button>
      </div>
    </div>
  );
}
