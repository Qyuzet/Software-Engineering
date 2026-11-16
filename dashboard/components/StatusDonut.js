"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import Panel, { Empty } from "./Panel";

const SLICES = [
  { key: "normal", label: "Normal", colour: "var(--green)" },
  { key: "near", label: "Near limit", colour: "var(--amber)" },
  { key: "crowded", label: "Over limit", colour: "var(--red)" },
];

export default function StatusDonut({ share }) {
  const total = share ? share.normal + share.near + share.crowded : 0;
  const data = SLICES.map((s) => ({ ...s, value: share?.[s.key] ?? 0 }));
  const pct = (v) => (total ? Math.round((v / total) * 100) : 0);

  return (
    <Panel title="Time by status" className="donut">
      {!total ? <Empty /> : (
        <>
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" innerRadius="68%" outerRadius="92%" startAngle={90} endAngle={-270}
                     stroke="none" paddingAngle={2} isAnimationActive={false}>
                  {data.map((d) => <Cell key={d.key} fill={d.colour} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center">
              <strong>{pct(share.crowded)}%</strong>
              <small>over limit</small>
            </div>
          </div>
          <ul className="donut-legend">
            {data.map((d) => (
              <li key={d.key}><i style={{ background: d.colour }} />{d.label}<b>{pct(d.value)}%</b></li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
