import { NEAR_LIMIT_RATIO } from "@/lib/constants";

import AlertLog from "./AlertLog";

export const RISK = [
  { key: "low", label: "Low", colour: "var(--green)" },
  { key: "medium", label: "Medium", colour: "var(--yellow)" },
  { key: "high", label: "High", colour: "var(--red)" },
];

/** Low = under 80% of the limit, Medium = 80% up to the limit, High = over the limit (CROWDED). */
export function riskOf(count, limit) {
  if (count == null || !limit) return null;
  if (count > limit) return "high";
  if (count >= NEAR_LIMIT_RATIO * limit) return "medium";
  return "low";
}

function RiskBars({ level }) {
  const on = { low: 1, medium: 2, high: 3 }[level] ?? 0;
  const colour = RISK.find((r) => r.key === level)?.colour ?? "var(--track)";
  return (
    <span className="risk-bars" aria-label={`Risk ${level ?? "unknown"}`}>
      {[3, 2, 1].map((n) => <i key={n} style={{ background: n <= on ? colour : "var(--bar-off)" }} />)}
    </span>
  );
}

function Trend({ dir, good }) {
  if (!dir) return <span className="trend" />;
  return <span className={`trend ${good ? "good" : "bad"}`}>{dir === "up" ? "▲" : "▼"}</span>;
}

function Metric({ icon, label, value, unit, trend, children }) {
  return (
    <div className="zm">
      <div className="zm-row">
        <span className="zm-label"><span className="zm-icon">{icon}</span>{label}</span>
        {trend}
        <strong>{value}</strong>
        <small>{unit}</small>
      </div>
      <div className="zm-bar">{children}</div>
    </div>
  );
}

// Left column: risk-level summary, the zone card for the camera, and the alert log
export default function ZoneSidebar({ site, current, series = [], share, stats, episodes, isToday }) {
  const limit = current?.limit;
  const level = riskOf(current?.count, limit);
  const pct = current && limit ? Math.round((current.count / limit) * 100) : null;

  // Trend: compare the last two 5-minute buckets
  const a = series.at(-2)?.avg;
  const b = series.at(-1)?.avg;
  const dir = a == null || b == null || a === b ? null : b > a ? "up" : "down";

  const total = share ? share.normal + share.near + share.crowded : 0;
  const part = (v) => (total ? (v / total) * 100 : 0);
  const fill = current && limit ? Math.min(100, (current.count / limit) * 100) : 0;
  const levelColour = RISK.find((r) => r.key === level)?.colour ?? "var(--track)";

  return (
    <aside className="zone-sidebar">
      <div className="risk-summary">
        <div className="rs-head">
          <span>No. of Zones:</span>
          <span>Risk Level:</span>
        </div>
        <div className="rs-cells">
          <div className="rs-cell all"><b>1</b><i style={{ background: "var(--dark)" }} /><small>All</small></div>
          {RISK.map((r) => (
            <div key={r.key} className="rs-cell">
              <b>{level === r.key ? 1 : 0}</b>
              <i style={{ background: r.colour }} />
              <small>{r.label}</small>
            </div>
          ))}
        </div>
      </div>

      <div className={`zone-card ${level ?? ""}`}>
        <div className="zone-head">
          <span>Zone 1</span>
          <strong>{site}</strong>
          <RiskBars level={level} />
        </div>

        <Metric icon="👤" label="Headcount" value={current?.count ?? "-"} unit="ppl"
                trend={<Trend dir={dir} good={dir === "down"} />}>
          <i style={{ width: `${fill}%`, background: levelColour }} />
        </Metric>

        <Metric icon="◔" label="Capacity" value={pct ?? "-"} unit="%"
                trend={<Trend dir={dir} good={dir === "down"} />}>
          <i style={{ width: `${Math.min(100, pct ?? 0)}%`, background: levelColour }} />
        </Metric>

        <Metric icon="✔" label="Under limit" value={total ? Math.round(part(share.normal + share.near)) : "-"} unit="%">
          <i style={{ width: `${part(share?.normal ?? 0)}%`, background: "var(--green)" }} />
          <i style={{ width: `${part(share?.near ?? 0)}%`, background: "var(--yellow)" }} />
          <i style={{ width: `${part(share?.crowded ?? 0)}%`, background: "var(--red)" }} />
        </Metric>

        <p className="zone-foot">
          Limit {limit ?? "-"} people · {stats?.alerts ?? 0} alert{stats?.alerts === 1 ? "" : "s"}
          {current && <> · {current.live ? "live" : "last logged"}</>}
        </p>
      </div>

      <AlertLog episodes={episodes} isToday={isToday} />
    </aside>
  );
}
