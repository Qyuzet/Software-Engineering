// Shared Recharts styling so every chart matches the light DCM-style theme.

export const AXIS = {
  stroke: "var(--muted)",
  tick: { fill: "var(--muted)", fontSize: 10 },
  tickLine: false,
  axisLine: false,
};

export const GRID = { stroke: "var(--grid)", strokeDasharray: "0" };

export const TOOLTIP = {
  contentStyle: {
    background: "#fff",
    border: "1px solid var(--border)",
    borderRadius: 4,
    color: "var(--text)",
    fontSize: 12,
    boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
  },
  labelStyle: { color: "var(--muted)" },
  itemStyle: { color: "var(--text)" },
  cursor: { stroke: "var(--muted)", strokeDasharray: "3 3", fill: "rgba(0,0,0,0.04)" },
};
