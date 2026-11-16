import { NextResponse } from "next/server";

import { DEFAULT_LIMIT } from "@/lib/constants";
import { getPool } from "@/lib/db";
import { getDemoDay } from "@/lib/demoData";
import { getDayFromNeon } from "@/lib/queries";
import { summarize } from "@/lib/summary";
import { isValidDate, nowIn, validTz } from "@/lib/time";

export const dynamic = "force-dynamic";

// GET /api/metrics?date=YYYY-MM-DD&tz=Area/City
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const tz = validTz(searchParams.get("tz"));
  const date = isValidDate(searchParams.get("date")) ? searchParams.get("date") : nowIn(tz).date;
  const intervalS = Number(process.env.LOG_INTERVAL_S) || 10;

  let day = null;
  let source = "demo";
  let warning = null;
  const pool = getPool();
  if (pool) {
    try {
      day = await getDayFromNeon(pool, date, tz);
      source = "neon";
    } catch (err) {
      console.error("[metrics]", err);
      warning = `Could not read Neon (${err.message}). Showing demo data.`;
    }
  }
  if (!day) day = getDemoDay(date, tz);

  const toMinutes = (rows) => Math.round((rows * intervalS) / 60);
  return NextResponse.json({
    source,
    warning,
    date,
    tz,
    limit: day.latest?.limit ?? day.buckets.at(-1)?.lim ?? DEFAULT_LIMIT,
    latest: day.latest,
    episodes: day.episodes,
    calendar: Object.fromEntries(Object.entries(day.calendar).map(([d, rows]) => [d, toMinutes(rows)])),
    ...summarize(day.buckets, day.episodes, intervalS),
  });
}
