"use client";

import { AlertTriangle, Gauge, Users } from "lucide-react";
import { useEffect, useState } from "react";

import AlertCalendar from "@/components/AlertCalendar";
import AlertDevice from "@/components/AlertDevice";
import CameraPanel from "@/components/CameraPanel";
import KpiCard from "@/components/KpiCard";
import SiteHeader, { SiteTabs } from "@/components/SiteHeader";
import Toolbar from "@/components/Toolbar";
import { CapacityChart, HeadcountChart, HourlyAlertsChart } from "@/components/TrendCharts";
import ZoneSidebar, { RISK, riskOf } from "@/components/ZoneSidebar";
import useLiveStatus from "@/hooks/useLiveStatus";
import useMetrics from "@/hooks/useMetrics";
import { NEAR_LIMIT_RATIO } from "@/lib/constants";
import { browserTz, fmtMinute, nowIn } from "@/lib/time";

const SITE = "Lecture Hall A";

// The page only assembles the components; data comes from the same hooks and API as before.
export default function DashboardPage() {
  const [today, setToday] = useState(null);   // set after mount: "today" is the viewer's local day
  const [date, setDate] = useState(null);
  const [metric, setMetric] = useState("avg");
  const [nowMinute, setNowMinute] = useState(null);
  const { data, error } = useMetrics(date);
  const live = useLiveStatus();

  useEffect(() => {
    const now = nowIn(browserTz());
    setToday(now.date);
    setDate(now.date);
    setNowMinute(now.minute);
    const t = setInterval(() => setNowMinute(nowIn(browserTz()).minute), 30_000);
    return () => clearInterval(t);
  }, []);

  // Live numbers from main.py win; otherwise use the last row in the database
  const current = live.online
    ? { count: live.data.count, limit: live.data.limit, crowded: live.data.crowded, live: true }
    : data?.latest && { ...data.latest, live: false };
  const limit = current?.limit ?? data?.limit;
  const isToday = date === today;
  const marker = isToday ? nowMinute : null;
  const stats = data?.stats;
  const share = data?.share;

  const level = riskOf(current?.count, limit);
  const levelColour = RISK.find((r) => r.key === level)?.colour ?? "var(--track)";
  const pct = current && limit ? Math.round((current.count / limit) * 100) : null;
  const total = share ? share.normal + share.near + share.crowded : 0;
  const part = (v) => (total ? (v / total) * 100 : 0);

  return (
    <div className="app">
      <SiteHeader site={SITE} />
      <SiteTabs site={SITE} />

      <div className="body">
        <ZoneSidebar site={SITE} current={current} series={data?.series} share={share}
                     stats={stats} episodes={data?.episodes} isToday={isToday} />

        <main className="main">
          <Toolbar metric={metric} onMetric={setMetric} date={date} today={today} onDate={setDate}
                   source={data?.source} warning={data?.warning} error={error} />

          <div className="content">
            <div className="top-row">
              <CameraPanel live={live} site={SITE} />
              <div className="side-stack">
                <AlertDevice current={current} esp32={live.data?.esp32} />
                <AlertCalendar date={date} today={today} calendar={data?.calendar} onSelect={setDate} />
              </div>
            </div>

            <div className="metric-row">
              <KpiCard icon={<Users size={15} />} title="Headcount"
                       value={current?.count ?? "-"} unit="People"
                       bar={[{ pct: limit ? (current?.count / limit) * 100 : 0, colour: levelColour }]}
                       caption={`Crowd limit: ${limit ?? "-"} people. Peak${isToday ? " today" : ""}: ${
                         stats?.peak ? `${stats.peak.count} at ${fmtMinute(stats.peak.minute)}` : "-"}`} />
              <HeadcountChart series={data?.series} limit={limit} metric={metric} nowMinute={marker}
                              icon={<Users size={15} />} />
            </div>

            <div className="metric-row">
              <KpiCard icon={<Gauge size={15} />} title="Capacity"
                       value={pct ?? "-"} unit="% of limit in use"
                       bar={[{ pct: pct ?? 0, colour: levelColour }]}
                       caption={`Near-limit threshold ${NEAR_LIMIT_RATIO * 100}%. Day average: ${
                         stats?.samples ? stats.avg : "-"} people`} />
              <CapacityChart series={data?.series} limit={limit} nowMinute={marker} icon={<Gauge size={15} />} />
            </div>

            <div className="metric-row">
              <KpiCard icon={<AlertTriangle size={15} />} title="Alerts"
                       value={stats?.alerts ?? "-"} unit={`Alert${stats?.alerts === 1 ? "" : "s"} on this day`}
                       bar={[
                         { pct: part(share?.normal ?? 0), colour: "var(--green)" },
                         { pct: part(share?.near ?? 0), colour: "var(--yellow)" },
                         { pct: part(share?.crowded ?? 0), colour: "var(--red)" },
                       ]}
                       caption={`Over limit: ${stats?.crowdedMinutes ?? "-"} min. Log entries: ${
                         stats?.samples?.toLocaleString() ?? "-"}`} />
              <HourlyAlertsChart hourly={data?.hourly} limit={limit} nowMinute={marker}
                                 icon={<AlertTriangle size={15} />} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
