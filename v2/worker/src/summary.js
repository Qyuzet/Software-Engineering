// Turns 5-minute buckets into everything the dashboard draws.

const round1 = (x) => Math.round(x * 10) / 10;

export function summarize(buckets, episodes, intervalS) {
  const series = buckets.map((b) => ({ minute: b.minute, avg: round1(b.avg), max: b.max, limit: b.lim }));

  const sums = Array(24).fill(0);
  const counts = Array(24).fill(0);
  let total = 0, crowded = 0, near = 0, weighted = 0;
  let peak = null;
  for (const b of buckets) {
    const hour = Math.floor(b.minute / 60);
    sums[hour] += b.avg * b.n;
    counts[hour] += b.n;
    total += b.n;
    crowded += b.crowded;
    near += b.near;
    weighted += b.avg * b.n;
    if (!peak || b.max > peak.count) peak = { count: b.max, minute: b.minute };
  }

  return {
    series,
    hourly: sums.map((s, hour) => ({ hour, avg: counts[hour] ? round1(s / counts[hour]) : 0 })),
    share: { normal: total - crowded - near, near, crowded },
    stats: {
      peak,
      avg: total ? round1(weighted / total) : 0,
      alerts: episodes.length,
      crowdedMinutes: Math.round((crowded * intervalS) / 60),
      samples: total,
    },
  };
}
