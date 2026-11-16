// Date helpers. Days are "YYYY-MM-DD" strings and times are minutes since local midnight,
// so the server and the browser agree without passing Date objects around.

export function validTz(tz) {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export function browserTz() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Today's date and the current minute of the day in a time zone. */
export function nowIn(tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}

export function isValidDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Same day in the month `delta` months away, clamped to the month's length and to `max`. */
export function shiftMonth(date, delta, max) {
  const [y, m, d] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + delta, 1));
  const ny = first.getUTCFullYear();
  const nm = first.getUTCMonth() + 1;
  const day = Math.min(d, daysInMonth(ny, nm));
  const out = `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return max && out > max ? max : out;
}

export function fmtMinute(minute) {
  const h = Math.floor(minute / 60) % 24;
  const m = Math.floor(minute % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function fmtDate(date, opts = { day: "numeric", month: "short", year: "numeric" }) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}
