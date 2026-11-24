import { Activity, Bell, LayoutDashboard, Settings, Video, X } from "lucide-react";

const NAV = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Cameras", icon: Video },
  { label: "Alerts", icon: Bell },
  { label: "Reports", icon: Activity },
  { label: "Settings", icon: Settings },
];

function StatusRow({ label, ok, text }) {
  return (
    <div className="sys-row">
      <span>{label}</span>
      <span className={`sys-val ${ok ? "ok" : "off"}`}><i />{text}</span>
    </div>
  );
}

export default function Sidebar({ open, onClose, edgeOnline, source }) {
  return (
    <>
      <div className={`scrim ${open ? "show" : ""}`} onClick={onClose} />
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">CC</span>
          <div>
            <strong>CrowdControl</strong>
            <small>Monitoring System</small>
          </div>
          <button className="icon-btn close-nav" onClick={onClose} aria-label="Close menu"><X size={18} /></button>
        </div>

        <nav className="nav">
          {NAV.map(({ label, icon: Icon, active }) => (
            <button key={label} className={`nav-item ${active ? "active" : ""}`}
                    disabled={!active} title={active ? undefined : "Coming soon"}>
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>

        <div className="sys">
          <p className="sys-title">System</p>
          <StatusRow label="Edge camera" ok={edgeOnline} text={edgeOnline ? "Online" : "Offline"} />
          <StatusRow label="Database" ok={source === "neon"} text={source === "neon" ? "Postgres (etzal)" : "Demo data"} />
        </div>
      </aside>
    </>
  );
}
