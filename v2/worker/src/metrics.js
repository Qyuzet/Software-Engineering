// GET /api/metrics?date=YYYY-MM-DD&tz=Area/City: everything the dashboard draws for one day.
// Reads Postgres; without a database (or if it fails) it answers with demo data instead.

import { DEFAULT_LIMIT } from "./constants.js";
import { getDemoDay } from "./demoData.js";
import { summarize } from "./summary.js";
import { isValidDate, nowIn, validTz } from "./time.js";

// $1 = day (YYYY-MM-DD), $2 = IANA time zone. Rows are grouped by the viewer's local day.
const DAY_RANGE = `
  recorded_at >= (($1::date)::timestamp AT TIME ZONE $2::text)
  AND recorded_at < ((($1::date) + 1)::timestamp AT TIME ZONE $2::text)`;

const MINUTE_OF = (expr) =>
  `floor(extract(epoch from (${expr} AT TIME ZONE $2::text)::time) / 60)::int`;

// 5-minute buckets for the charts
const BUCKETS_SQL = `
SELECT floor(extract(epoch from (recorded_at AT TIME ZONE $2::text)::time) / 300)::int * 5 AS minute,
       avg(person_count)::float8                                   AS avg,
       max(person_count)::int                                      AS max,
       max(crowd_limit)::int                                       AS lim,
       count(*)::int                                               AS n,
       count(*) FILTER (WHERE is_crowded)::int                     AS crowded,
       count(*) FILTER (WHERE NOT is_crowded
                          AND person_count >= crowd_limit * 0.8)::int AS near
FROM crowd_logs
WHERE ${DAY_RANGE}
GROUP BY 1
ORDER BY 1`;

// Each unbroken run of crowded rows is one alert
const EPISODES_SQL = `
WITH s AS (
  SELECT recorded_at, person_count, is_crowded,
         CASE WHEN is_crowded AND NOT coalesce(lag(is_crowded) OVER w, false) THEN 1 ELSE 0 END AS starts
  FROM crowd_logs
  WHERE ${DAY_RANGE}
  WINDOW w AS (ORDER BY recorded_at)
), g AS (
  SELECT *, sum(starts) OVER (ORDER BY recorded_at) AS grp FROM s
)
SELECT ${MINUTE_OF("min(recorded_at)")} AS start,
       ${MINUTE_OF("max(recorded_at)")} AS "end",
       max(person_count)::int AS peak
FROM g
WHERE is_crowded
GROUP BY grp
ORDER BY 1`;

// Crowded rows per day for the calendar
const CALENDAR_SQL = `
SELECT to_char((recorded_at AT TIME ZONE $2::text)::date, 'YYYY-MM-DD') AS day,
       count(*) FILTER (WHERE is_crowded)::int AS crowded
FROM crowd_logs
WHERE recorded_at >= (date_trunc('month', $1::timestamp) AT TIME ZONE $2::text)
  AND recorded_at < ((date_trunc('month', $1::timestamp) + interval '1 month') AT TIME ZONE $2::text)
GROUP BY 1`;

const LATEST_SQL = `
SELECT recorded_at, person_count, crowd_limit, is_crowded
FROM crowd_logs
ORDER BY id DESC
LIMIT 1`;

/** Reads one day from Postgres in the same shape getDemoDay() returns. */
async function readDay(db, date, tz) {
  await db.ready();
  const params = [date, tz];
  const [buckets, episodes, calendar, latest] = await Promise.all([
    db.query(BUCKETS_SQL, params),
    db.query(EPISODES_SQL, params),
    db.query(CALENDAR_SQL, params),
    db.query(LATEST_SQL),
  ]);
  const last = latest.rows[0];
  return {
    buckets: buckets.rows,
    episodes: episodes.rows,
    calendar: Object.fromEntries(calendar.rows.map((r) => [r.day, r.crowded])),
    latest: last
      ? { count: last.person_count, limit: last.crowd_limit, crowded: last.is_crowded, at: last.recorded_at }
      : null,
  };
}

export async function getMetrics(db, searchParams, { intervalS, log = console }) {
  const tz = validTz(searchParams.get("tz"));
  const date = isValidDate(searchParams.get("date")) ? searchParams.get("date") : nowIn(tz).date;

  let day = null;
  let source = "demo";
  let warning = null;
  if (db) {
    try {
      day = await readDay(db, date, tz);
      source = "postgres";
    } catch (err) {
      log.error("[metrics]", err.message);
      warning = "Could not read the database. Showing demo data.";   // details stay in the server log
    }
  }
  if (!day) day = getDemoDay(date, tz);

  const toMinutes = (rows) => Math.round((rows * intervalS) / 60);
  return {
    source,
    warning,
    date,
    tz,
    limit: day.latest?.limit ?? day.buckets.at(-1)?.lim ?? DEFAULT_LIMIT,
    latest: day.latest,
    episodes: day.episodes,
    calendar: Object.fromEntries(Object.entries(day.calendar).map(([d, rows]) => [d, toMinutes(rows)])),
    ...summarize(day.buckets, day.episodes, intervalS),
  };
}
