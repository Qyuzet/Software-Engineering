import { Bell, Menu } from "lucide-react";

import { fmtDate } from "@/lib/time";

export default function TopBar({ date, alerts, onMenu }) {
  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open menu"><Menu size={20} /></button>
      <div className="topbar-title">
        <h1>Crowd Monitoring</h1>
        <span className="pill">{date ? fmtDate(date) : "-"}</span>
      </div>
      <div className="topbar-right">
        <div className="bell" title={`${alerts ?? 0} alerts on this day`}>
          <Bell size={20} />
          {alerts > 0 && <span className="badge">{alerts}</span>}
        </div>
        <div className="user">
          <div>
            <strong>Operator</strong>
            <small>Administrator</small>
          </div>
          <span className="avatar">OP</span>
        </div>
      </div>
    </header>
  );
}
