"use client";

import { BarChart3, CircleUserRound, LaptopMinimal, LayoutDashboard, Maximize } from "lucide-react";
import Link from "next/link";

const ACTIONS = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Reports", icon: BarChart3 },
  { label: "Laptop", icon: LaptopMinimal, href: "/laptop" },
  { label: "Fullscreen", icon: Maximize, fullscreen: true },
  { label: "Account", icon: CircleUserRound },
];

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.();
}

// White top bar: logo, breadcrumb and the icon buttons on the right (like the DCM layout)
export default function SiteHeader({ site }) {
  return (
    <header className="site-header">
      <div className="brand">
        <span className="brand-logo">cc<b>m</b></span>
        <span className="brand-badge" title="Team 04 – Crowd Control Systems">T4</span>
        <nav className="crumbs" aria-label="Breadcrumb">
          <span>Dashboard</span>
          <span className="sep">|</span>
          <span>All Sites</span>
          <span className="sep">|</span>
          <strong>{site}</strong>
        </nav>
      </div>

      <div className="header-actions">
        {ACTIONS.map(({ label, icon: Icon, active, fullscreen, href }) => href ? (
          <Link key={label} href={href} className="header-action" title="Set up this laptop: camera, requirements, start/stop">
            <Icon size={18} />
            <span>{label}</span>
          </Link>
        ) : (
          <button key={label}
                  className={`header-action ${active ? "active" : ""}`}
                  disabled={!active && !fullscreen}
                  title={!active && !fullscreen ? "Coming soon" : label}
                  onClick={fullscreen ? toggleFullscreen : undefined}>
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </header>
  );
}

// Dark strip with the site tabs under the header
export function SiteTabs({ site }) {
  return (
    <div className="site-tabs">
      <button className="tab active">All Sites</button>
      <span className="tab-sep" />
      <button className="tab">{site}</button>
      <span className="tab-sep" />
    </div>
  );
}
