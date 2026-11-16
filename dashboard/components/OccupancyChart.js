"use client";

import { useState } from "react";
import {
  Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { fmtMinute } from "@/lib/time";

import Panel, { Empty } from "./Panel";
import { AXIS, GRID, TOOLTIP } from "./chartTheme";

const HOUR_TICKS = [0, 180, 360, 540, 720, 900, 1080, 1260, 1440];

export default function OccupancyChart({ series = [], limit, peak, date, today, onDate }) {
  const [metric, setMetric] = useState("avg");

  return (
    <Panel title="Analyze" className="occupancy"
           actions={
             <>
               <input type="date" value={date ?? ""} max={today ?? undefined} aria-label="Day"
                      onChange={(e) => e.target.value && onDate(e.target.value)} />
               <select value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Measure">
                 <option value="avg">Average people</option>
                 <option value="max">Peak people</option>
               </select>
             </>
           }>
      <p className="chart-sub">People in the room, every 5 minutes</p>
      {series.length === 0 ? <Empty /> : (
        <div className="chart" style={{ height: 230 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 22, right: 12, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="occFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--blue)" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="var(--blue)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="minute" type="number" domain={[0, 1440]} ticks={HOUR_TICKS}
                     tickFormatter={(m) => fmtMinute(m).slice(0, 2)} {...AXIS} />
              <YAxis allowDecimals={false} {...AXIS} />
              <Tooltip {...TOOLTIP} labelFormatter={fmtMinute}
                       formatter={(v) => [v, metric === "avg" ? "Average" : "Peak"]} />
              {limit != null && (
                <ReferenceLine y={limit} stroke="var(--red)" strokeDasharray="5 4"
                               label={{ value: `limit ${limit}`, position: "insideTopRight", fill: "var(--red)", fontSize: 11 }} />
              )}
              <Area type="monotone" dataKey={metric} stroke="var(--blue)" strokeWidth={2}
                    fill="url(#occFill)" isAnimationActive={false} />
              {peak && metric === "max" && (
                <ReferenceDot x={peak.minute} y={peak.count} r={4} fill="var(--red)" stroke="none"
                              label={{ value: peak.count, position: "top", fill: "var(--text)", fontSize: 11 }} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}
