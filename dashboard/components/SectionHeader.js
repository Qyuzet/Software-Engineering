export default function SectionHeader({ source, warning, error }) {
  return (
    <div className="section-head">
      <h2>Crowd Management Analytics</h2>
      <select aria-label="Room" defaultValue="hall-a">
        <option value="hall-a">Lecture Hall A</option>
      </select>
      {source && (
        <span className={`source ${source}`}>
          {source === "neon" ? "Live data from Neon" : "Demo data: set DATABASE_URL to use Neon"}
        </span>
      )}
      {(warning || error) && <span className="warn">{warning || `Dashboard API: ${error}`}</span>}
    </div>
  );
}
