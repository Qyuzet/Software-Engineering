# Crowd Control Monitoring System v2

v2 streams the live video to a website from any network, and logs to Postgres on our own
server (etzal) instead of Neon. The v1 code in the project root is unchanged and still works.

```
Phone (IP Webcam) ──Wi-Fi──> Laptop: edge/main.py
                               ├─ YOLOv8 count + crowd rule (3 s in / 5 s out, hysteresis)
                               ├─> ESP32 (wifi or usb): LEDs + buzzer
                               ├─> wss://crowd-api.etzalgroup.com/live/ingest   video + live status
                               └─> https://crowd-api.etzalgroup.com/api/logs     1 row / 10 s, queued on disk first
                                          │
etzal: worker/ (pm2 "crowd-worker", 127.0.0.1:3020) ── Cloudflare tunnel ── crowd-api.etzalgroup.com
  ├─ /live/video, /live/status   MJPEG + status for every viewer (slow viewers skip frames)
  ├─ /api/metrics                charts and stats from Postgres db "crowd"
  └─ /api/logs                   rows from the laptop, stored once even if re-sent
                                          ▲  (the browser calls the worker directly)
Vercel: web/  ── crowd.etzalgroup.com ── the dashboard (static Next.js, no server code)
```

| Folder | Runs on | What it is |
|---|---|---|
| `web/` | **Vercel** | The dashboard. Only static pages; the one setting is `NEXT_PUBLIC_WORKER_URL` |
| `worker/` | **etzal** | Node service: live relay, dashboard API, log ingest into Postgres. Has its own tests |
| `edge/` | laptop | Laptop app (control panel), camera on its own thread, YOLO, ESP32, pushes video out over one WebSocket, on-disk log queue |
| `esp32/` | ESP32 | Lights + buzzer; Wi-Fi set from the laptop app or its own setup hotspot, stored on the ESP32 |
| `deploy/` | etzal | `setup-server.sh` (once), `autodeploy.sh` (CD), `worker-release.sh`, pm2 config |
| `../.github/workflows/v2-ci.yml` | GitHub | CI for everything above |

## Dashboard on Vercel (`web/`)

Set up as Vercel project `crowd-dashboard` (qyuzet's projects), connected to
`github.com/Qyuzet/Software-Engineering` (our fork of the team repo), production branch `master`.
To set it up again somewhere else:

1. Vercel → Add New → Project → import the repo.
2. **Root Directory: `v2/web`**. Framework: Next.js (detected). Nothing else to change.
3. Environment Variables: `NEXT_PUBLIC_WORKER_URL` = `https://crowd-api.etzalgroup.com`
4. Settings → Domains → add `crowd.etzalgroup.com`.

Every push then deploys by itself: the production branch to `crowd.etzalgroup.com`, other branches
to preview URLs. `NEXT_PUBLIC_*` values are built into the page, so redeploy after changing it.
Locally: `cp .env.example .env.local`, then `npm install` and `npm run dev`.

## Worker on etzal (`worker/` + `deploy/`)

Once, from the laptop:

```bash
ssh -p 2222 mydebian 'bash -s' < v2/deploy/setup-server.sh
# another repo or branch: ssh -p 2222 mydebian 'REPO_URL=... DEPLOY_BRANCH=... bash -s' < v2/deploy/setup-server.sh
```

It creates the database and `~/crowd-intelligent/worker.env` (DATABASE_URL, EDGE_TOKEN, CORS_ORIGINS),
checks out only `v2/worker` + `v2/deploy` from GitHub, and starts three pm2 apps:

| pm2 app | What it does |
|---|---|
| `crowd-worker` | the worker on 127.0.0.1:3020 |
| `crowd-autodeploy` | **CD**: every 60 s fetches the branch; when `v2/worker` changed it installs, runs the tests, swaps, checks `/live/health` reports the new commit, and rolls back if not |
| `crowd-tunnel` | temporary `trycloudflare.com` URL, until `crowd-api.etzalgroup.com` is set up (below) |

```bash
pm2 logs crowd-autodeploy          # what CD is doing
pm2 restart crowd-autodeploy       # deploy now instead of within a minute
curl -s localhost:3020/live/health # {"ok":true,"version":"<commit>",...}
```

The branch is in `~/crowd-intelligent/autodeploy.env`. CD pulls from the public repo, so there are
no SSH keys in GitHub and no GitHub keys on the server. Anyone who can push to that branch can run
code on etzal, so protect the branch. Never `pm2 delete` other apps on this server.

## CI (GitHub Actions)

`v2-ci.yml` runs on every push and pull request that touches `v2/`:

- **worker**: unit + HTTP + WebSocket tests, and Postgres tests against a real Postgres 15
- **web**: `next build`, the same as Vercel
- **edge**: compiles every file, then runs `edge/main.py` with the simulated camera against a real worker and checks that video and status arrive
- **deploy-scripts**: shellcheck

## Domains (Cloudflare, etzalgroup.com)

| Name | Points to | How |
|---|---|---|
| `crowd.etzalgroup.com` | Vercel | DNS → CNAME `crowd` → `cname.vercel-dns.com`, **DNS only** (grey cloud) |
| `crowd-api.etzalgroup.com` | the worker | Zero Trust → Networks → Tunnels → `cloudflared-etzal` → Public Hostname → `crowd-api` . `etzalgroup.com` → `http://localhost:3020` |

`crowd-api` instead of `api.crowd`: Cloudflare's free certificate covers only one level of subdomain.
Once `https://crowd-api.etzalgroup.com/live/health` answers, stop the quick tunnel:
`pm2 stop crowd-tunnel && pm2 save`. Optionally limit who may read the API from a browser:
`CORS_ORIGINS=https://crowd.etzalgroup.com` in `worker.env`, then `pm2 restart crowd-worker`.

## Run it (the only thing you start yourself)

The worker, the database and the website are always on. On the laptop:

1. **Phone**: IP Webcam app → *Start server* (same Wi-Fi/hotspot as the laptop). Or use a webcam.
2. **ESP32**: power it (or plug in the USB cable).
3. Double-click **Crowd Laptop** on the desktop (or `v2\edge\run.bat`). The **laptop app** opens
   at `http://127.0.0.1:8765`: choose the camera (phone / webcam / simulation / URL) and the ESP32
   (Wi-Fi / USB / off), set the ESP32's Wi-Fi, *Check everything*, **Start detection**.
4. Open **https://crowd.etzalgroup.com**: live video, count and charts.

**https://crowd.etzalgroup.com/laptop** (the *Laptop* button on the dashboard) does the same from the
website, in Chrome/Edge on that laptop: it finds the laptop app, lists what is installed or missing
(and installs missing packages), shows the webcams with a picture of each, switches the camera and
starts/stops detection. The first time, the browser asks to let the site reach apps on this
computer: click **Allow**. The laptop app only accepts this website and itself (`PANEL_ALLOWED_ORIGINS`
adds more), and only listens on 127.0.0.1.

### A new laptop

1. Someone whose laptop is already set up clicks **Copy invite link** (laptop app → Run, or
   `/laptop` → Requirements) and sends it to you.
2. Open the invite link on the new laptop. The page lists what the laptop needs. Then in PowerShell:

   ```powershell
   irm https://crowd.etzalgroup.com/install.ps1 | iex
   ```

   It installs Python 3.12 if missing (winget, no admin), downloads `v2/edge` from GitHub into
   `%LOCALAPPDATA%\CrowdControl\edge`, installs the packages (about 1 GB), adds **Crowd Laptop** to the
   desktop and starts it. Run it again to update; settings are kept.
3. The invite page connects to the app by itself and saves the edge token into it. Nothing to paste.

The invite link is `https://crowd.etzalgroup.com/laptop#join=<EDGE_TOKEN>`: the part after `#` never
reaches Vercel, and the page removes it from the address bar. Anyone with the link can stream to the
dashboard, so share it only with the team. To cut everyone off, put a new `EDGE_TOKEN` in
`~/crowd-intelligent/worker.env`, `pm2 restart crowd-worker`, and send a new invite link.
The very first laptop gets the token from the server:
`ssh -p 2222 mydebian 'grep EDGE_TOKEN ~/crowd-intelligent/worker.env'`

### ESP32 Wi-Fi without re-flashing

Flash `esp32/crowd_actuator` once (Arduino IDE, board *ESP32 Dev Module*; `secrets.h` is optional).
After that the Wi-Fi name/password are stored on the ESP32 and can be changed:

- **USB cable**: laptop app → ESP32 → *Set the ESP32's Wi-Fi network* → *Send over USB cable*.
  The ESP32 joins and reports its address, which the app saves (Wi-Fi mode).
- **No laptop**: with no working Wi-Fi for 30 s the ESP32 opens the hotspot `Crowd-ESP32-XXXX`
  (password `crowd1234`). Join it with a phone; the setup page opens (or `http://192.168.4.1/wifi`).
- **On the same network**: `http://<ESP32 address>/wifi`.

Without the app: `python main.py` (settings in `v2/edge/.env`, see `.env.example`) and
`python check.py` to test every link.

| Failure | What happens |
|---|---|
| Phone app stops / Wi-Fi blip | Camera reconnects by itself; website shows "Phone camera offline", ESP32 keeps its state |
| Internet or worker down | Detection + ESP32 keep running; rows wait in `edge/data/queue.db` and upload later, never twice |
| ESP32 unplugged / unreachable | Retries every 3 s; ESP32 blinks yellow after 6 s without a signal |
| Bad worker release | Tests fail or health check fails: the previous version keeps running |
