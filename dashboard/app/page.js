"use client";

import { useEffect, useState } from "react";

import AlertCalendar from "@/components/AlertCalendar";
import AlertDevice from "@/components/AlertDevice";
import AlertLog from "@/components/AlertLog";
import CameraPanel from "@/components/CameraPanel";
import HourlyChart from "@/components/HourlyChart";
import OccupancyChart from "@/components/OccupancyChart";
import OccupancyTimeline from "@/components/OccupancyTimeline";
import SectionHeader from "@/components/SectionHeader";
import Sidebar from "@/components/Sidebar";
import StatsList from "@/components/StatsList";
import StatusDonut from "@/components/StatusDonut";
import TopBar from "@/components/TopBar";
import useLiveStatus from "@/hooks/useLiveStatus";
import useMetrics from "@/hooks/useMetrics";
import { browserTz, nowIn } from "@/lib/time";

// The page only assembles the components; each one lives in /components.
export default function DashboardPage() {
  const [today, setToday] = useState(null);   // set after mount: "today" is the viewer's local day
  const [date, setDate] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const { data, error } = useMetrics(date);
  const live = useLiveStatus();

  useEffect(() => {
    const now = nowIn(browserTz()).date;
    setToday(now);
    setDate(now);
  }, []);

  // Live numbers from main.py win; otherwise use the last row in the database
  const current = live.online
    ? { count: live.data.count, limit: live.data.limit, crowded: live.data.crowded, live: true }
    : data?.latest && { ...data.latest, live: false };
  const limit = current?.limit ?? data?.limit;
  const isToday = date === today;

  return (
    <div className="shell">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} edgeOnline={live.online} source={data?.source} />

      <main className="main">
        <TopBar date={date} alerts={data?.stats.alerts} onMenu={() => setNavOpen(true)} />
        <SectionHeader source={data?.source} warning={data?.warning} error={error} />

        <div className="grid">
          <section className="col">
            <CameraPanel live={live} />
            <OccupancyTimeline series={data?.series} limit={limit} isToday={isToday} />
            <div className="row-3">
              <AlertDevice current={current} esp32={live.data?.esp32} />
              <AlertCalendar date={date} today={today} calendar={data?.calendar} onSelect={setDate} />
              <AlertLog episodes={data?.episodes} isToday={isToday} />
            </div>
          </section>

          <section className="col">
            <OccupancyChart series={data?.series} limit={limit} peak={data?.stats.peak}
                            date={date} today={today} onDate={setDate} />
            <HourlyChart hourly={data?.hourly} limit={limit} />
            <div className="row-2">
              <StatusDonut share={data?.share} />
              <StatsList current={current} stats={data?.stats} isToday={isToday} />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
