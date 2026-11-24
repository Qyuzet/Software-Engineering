"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { NEAR_LIMIT_RATIO } from "@/lib/constants";
import { fmtMinute } from "@/lib/time";

import { AXIS, GRID, TOOLTIP } from "./chartTheme";

const HOUR_TICKS = [0, 180, 360, 540, 720, 900, 1080, 1260, 1440];
const MARGIN = { top: 8, right: 4, bottom: 0, left: -14 };

function ChartCard({ icon, title, axisLabel, empty, children }) {
  return (
    <div className="card chart-card">
      <div className="card-tab">{icon}<span>{title}</span></div>
      <div className="chart-body">
        {empty ? <p className="empty">No data for this day yet.</p> : (
          <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
        )}
        {axisLabel && <span className="axis-label">{axisLabel}</span>}
      </div>
    </div>
  );
}

const nowLine = (nowMinute) =>
  nowMinute != null && <ReferenceLine x={nowMinute} stroke="var(--red)" strokeWidth={2} />;

const xAxis = (
  <XAxis dataKey="minute" type="number" domain={[0, 1440]} ticks={HOUR_TICKS}
         tickFormatter={(m) => fmtMinute(m)} {...AXIS} />
);

/** Row 1: people over the day – selected measure (teal) with peak/average behind it (grey) */
export function HeadcountChart({ series = [], limit, metric, nowMinute, icon }) {
  const other = metric === "avg" ? "max" : "avg";
  const name = (k) => (k === "avg" ? "Average" : "Peak");
  return (
    <ChartCard icon={icon} title="Headcount" axisLabel="Headcount" empty={series.length === 0}>
      <LineChart data={series} margin={MARGIN}>
        <CartesianGrid {...GRID} />
        {xAxis}
        <YAxis orientation="right" allowDecimals={false} {...AXIS} />
        <Tooltip {...TOOLTIP} labelFormatter={fmtMinute} formatter={(v, k) => [v, name(k)]} />
        {limit != null && <ReferenceLine y={limit} stroke="var(--red)" strokeDasharray="5 4" />}
        <Line type="monotone" dataKey={other} stroke="var(--grey-line)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey={metric} stroke="var(--teal)" strokeWidth={2} dot={false} isAnimationActive={false} />
        {nowLine(nowMinute)}
      </LineChart>
    </ChartCard>
  );
}

/** Row 2: share of the limit in use (%), with the 80% and 100% lines */
export function CapacityChart({ series = [], limit, nowMinute, icon }) {
  const data = limit ? series.map((b) => ({ minute: b.minute, pct: Math.round((b.avg / limit) * 100) })) : [];
  return (
    <ChartCard icon={icon} title="Capacity" axisLabel="% of limit" empty={data.length === 0}>
      <AreaChart data={data} margin={MARGIN}>
        <CartesianGrid {...GRID} />
        {xAxis}
        <YAxis orientation="right" allowDecimals={false} domain={[0, (max) => Math.max(120, Math.ceil(max / 20) * 20)]} {...AXIS} />
        <Tooltip {...TOOLTIP} labelFormatter={fmtMinute} formatter={(v) => [`${v}%`, "Of limit"]} />
        <ReferenceLine y={NEAR_LIMIT_RATIO * 100} stroke="var(--yellow)" strokeDasharray="5 4" />
        <ReferenceLine y={100} stroke="var(--red)" strokeDasharray="5 4" />
        <Area type="monotone" dataKey="pct" stroke="var(--teal)" strokeWidth={1.5}
              fill="var(--teal-soft)" isAnimationActive={false} />
        {nowLine(nowMinute)}
      </AreaChart>
    </ChartCard>
  );
}

/** Row 3: average people per hour; hours near or over the limit are highlighted */
export function HourlyAlertsChart({ hourly = [], limit, nowMinute, icon }) {
  const colour = (avg) => {
    if (limit != null && avg > limit) return "var(--red)";
    if (limit != null && avg >= NEAR_LIMIT_RATIO * limit) return "var(--pink)";
    return "var(--grey-bar)";
  };
  const data = hourly.map((h) => ({ ...h, minute: h.hour * 60 + 30 }));
  return (
    <ChartCard icon={icon} title="Hourly average" axisLabel="People / hour" empty={!hourly.some((h) => h.avg > 0)}>
      <BarChart data={data} margin={MARGIN} barCategoryGap={1}>
        <CartesianGrid {...GRID} />
        {xAxis}
        <YAxis orientation="right" allowDecimals={false} {...AXIS} />
        <Tooltip {...TOOLTIP} labelFormatter={(m) => `${fmtMinute(m - 30)} – ${fmtMinute(m + 30)}`}
                 formatter={(v) => [v, "Average"]} />
        <Bar dataKey="avg" barSize={22} isAnimationActive={false}>
          {data.map((h) => <Cell key={h.hour} fill={colour(h.avg)} />)}
        </Bar>
        {nowLine(nowMinute)}
      </BarChart>
    </ChartCard>
  );
}
