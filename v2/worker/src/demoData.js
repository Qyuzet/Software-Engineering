// Realistic but made-up lecture-hall data, used until DATABASE_URL is set.
// It is seeded by the date, so the same day always looks the same.

import { DEFAULT_LIMIT, NEAR_LIMIT_RATIO } from "./constants.js";
import { daysInMonth, nowIn } from "./time.js";

const PER_BUCKET = 30; // 5 minutes of rows logged every 10 s

// [minute of day, people, spread]: morning class, late morning, after lunch, afternoon, evening
const PEAKS = [
  [570, 7, 45],
  [660, 11, 40],
  [810, 13, 38],
  [930, 10, 45],
  [1140, 4, 60],
];

function seeded(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dayBuckets(date, uptoMinute) {
  const rand = seeded(date);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const scale = weekday === 0 || weekday === 6 ? 0.35 : 0.8 + rand() * 0.35;
  const lim = DEFAULT_LIMIT;
  const buckets = [];
  for (let minute = 0; minute <= Math.min(uptoMinute, 1435); minute += 5) {
    let level = 0;
    for (const [mu, amp, sd] of PEAKS) level += amp * scale * Math.exp(-(((minute - mu) / sd) ** 2) / 2);
    const avg = Math.max(0, level + (rand() - 0.5) * 1.6);
    const max = Math.round(avg + rand() * 2);
    const crowded = max > lim
      ? Math.round(PER_BUCKET * Math.min(1, Math.max(0.15, (avg - lim + 1.5) / 3)))
      : 0;
    const near = avg >= NEAR_LIMIT_RATIO * lim ? Math.round((PER_BUCKET - crowded) * 0.7) : 0;
    buckets.push({ minute, avg, max, lim, n: PER_BUCKET, crowded, near });
  }
  return buckets;
}

function episodesOf(buckets) {
  const out = [];
  let cur = null;
  for (const b of buckets) {
    if (b.crowded > 0) {
      if (!cur) cur = { start: b.minute, end: b.minute + 4, peak: b.max };
      else {
        cur.end = b.minute + 4;
        cur.peak = Math.max(cur.peak, b.max);
      }
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function getDemoDay(date, tz) {
  const now = nowIn(tz);
  const upto = (d) => (d === now.date ? now.minute : d < now.date ? 1440 : -1);

  const buckets = dayBuckets(date, upto(date));

  const [y, m] = date.split("-").map(Number);
  const calendar = {};
  for (let day = 1; day <= daysInMonth(y, m); day++) {
    const key = `${date.slice(0, 7)}-${String(day).padStart(2, "0")}`;
    if (key > now.date) break;
    calendar[key] = dayBuckets(key, upto(key)).reduce((sum, b) => sum + b.crowded, 0);
  }

  const today = dayBuckets(now.date, now.minute);
  const last = today.at(-1);
  const count = Math.round(last.avg);

  return {
    buckets,
    episodes: episodesOf(buckets),
    calendar,
    latest: { count, limit: last.lim, crowded: count > last.lim, at: new Date().toISOString() },
  };
}
