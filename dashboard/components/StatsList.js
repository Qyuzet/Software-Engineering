import { fmtMinute } from "@/lib/time";

function Stat({ label, value, tone }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

export default function StatsList({ current, stats, isToday }) {
  const s = stats ?? {};
  return (
    <div className="stats">
      <Stat label={current?.live ? "People now (live)" : "People now"}
            value={current ? `${current.count} / ${current.limit}` : "-"}
            tone={current?.crowded ? "red" : "green"} />
      <Stat label={isToday ? "Peak today" : "Peak"}
            value={s.peak ? `${s.peak.count} at ${fmtMinute(s.peak.minute)}` : "-"} />
      <Stat label="Average" value={s.samples ? s.avg : "-"} />
      <Stat label="Alerts" value={s.alerts ?? "-"} tone={s.alerts ? "red" : undefined} />
      <Stat label="Minutes over limit" value={s.crowdedMinutes ?? "-"} />
      <Stat label="Log entries" value={s.samples?.toLocaleString() ?? "-"} />
    </div>
  );
}
