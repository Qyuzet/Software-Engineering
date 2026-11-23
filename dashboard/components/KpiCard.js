// Left card of each bottom row: a tab-style title, one big number and a progress bar
export default function KpiCard({ icon, title, value, unit, bar = [], caption }) {
  return (
    <div className="card kpi">
      <div className="card-tab">{icon}<span>{title}</span></div>
      <div className="kpi-value">
        <strong>{value}</strong>
        <span>{unit}</span>
      </div>
      <div className="kpi-bar">
        {bar.map((seg, i) => <i key={i} style={{ width: `${Math.max(0, Math.min(100, seg.pct))}%`, background: seg.colour }} />)}
      </div>
      {caption && <p className="kpi-caption">{caption}</p>}
    </div>
  );
}
