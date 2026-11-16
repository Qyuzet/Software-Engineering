# Crowd Control Dashboard

Next.js web dashboard for the Crowd Control Monitoring System.

## Run it

```powershell
cd dashboard
npm install        # first time only
npm run dev
```

Open http://localhost:3000.

- **Camera panel, live count, alert device:** start the Python script too (`python main.py` in the
  project folder). It serves the annotated video and status on `http://127.0.0.1:8080`, on this laptop only.
  No camera yet? Run `python simulate.py` instead: fake people, same pipeline, nothing written to the database.
- **Charts, calendar, alert log:** read from Neon. Until `DATABASE_URL` is set they show demo data,
  and the header says so.

## Connect Neon

Copy `.env.example` to `.env.local` and paste the same `DATABASE_URL` the Python script uses. Restart `npm run dev`.

## Layout

| Path | What it is |
|---|---|
| `app/page.js` | Assembles the components |
| `components/` | Sidebar, top bar, camera, charts, calendar, alert device, stats |
| `app/api/metrics` | `GET` one day of counts from Neon (or demo data) |
| `app/api/logs` | `POST {"person_count", "crowd_limit"}` to log a count (for the ESP32 path on slide 8) |
| `lib/queries.js` | SQL against the `crowd_logs` table |
| `lib/demoData.js` | Made-up data used when no database is set |
