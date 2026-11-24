"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { NEAR_LIMIT_RATIO } from "@/lib/constants";

import Panel, { Empty } from "./Panel";
import { AXIS, GRID, TOOLTIP } from "./chartTheme";

function barColour(avg, limit) {
  if (avg > limit) return "var(--red)";
  if (avg >= NEAR_LIMIT_RATIO * limit) return "var(--amber)";
  return "var(--blue)";
}

export default function HourlyChart({ hourly = [], limit }) {
  const hasData = hourly.some((h) => h.avg > 0);
  return (
    <Panel title="Average people per hour" className="hourly">
      {!hasData ? <Empty /> : (
        <div className="chart" style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hourly} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="hour" interval={2} tickFormatter={(h) => `${String(h).padStart(2, "0")}h`} {...AXIS} />
              <YAxis allowDecimals={false} {...AXIS} />
              <Tooltip {...TOOLTIP} labelFormatter={(h) => `${String(h).padStart(2, "0")}:00 – ${String(h + 1).padStart(2, "0")}:00`}
                       formatter={(v) => [v, "Average"]} />
              <Bar dataKey="avg" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false}>
                {hourly.map((h) => <Cell key={h.hour} fill={barColour(h.avg, limit ?? Infinity)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}
