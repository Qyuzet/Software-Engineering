// Shared Recharts styling so every chart matches the dark theme.

export const AXIS = {
  stroke: "var(--muted)",
  tick: { fill: "var(--muted)", fontSize: 11 },
  tickLine: false,
  axisLine: false,
};

export const GRID = { stroke: "var(--border)", strokeDasharray: "3 3" };

export const TOOLTIP = {
  contentStyle: {
    background: "var(--panel-2)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text)",
    fontSize: 12,
  },
  labelStyle: { color: "var(--muted)" },
  itemStyle: { color: "var(--text)" },
  cursor: { stroke: "var(--muted)", strokeDasharray: "3 3", fill: "rgba(255,255,255,0.04)" },
};
