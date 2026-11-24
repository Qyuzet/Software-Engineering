# Crowd Control Monitoring System v2

v2 streams the live video to the website from any network, and logs to Postgres on our own
server (etzal) instead of Neon. The v1 code in the project root is unchanged and still works.

```
Phone (IP Webcam) ──Wi-Fi──> Laptop: edge/main.py
                               ├─ YOLOv8 count + crowd rule (3 s in / 5 s out, hysteresis)
                               ├─> ESP32 (wifi or usb): LEDs + buzzer
                               ├─> wss://<hub>/live/ingest   annotated video + live status
                               └─> https://<hub>/api/logs     one row / 10 s, queued on disk first
                                          │
Server etzal: web/server.js (pm2 "crowd-web", 127.0.0.1:3020) ── Cloudflare tunnel ── browsers
  ├─ /live/video   MJPEG to every viewer (slow viewers skip frames, never lag)
  ├─ /live/status  count, limit, crowded, fps, esp32, db, camera
  ├─ /api/*        dashboard data from Postgres db "crowd"
  └─ /             the dashboard
```

| Folder | Runs on | What changed from v1 |
|---|---|---|
| `edge/` | laptop | Camera read on its own thread (no lag build-up with the IP cam), pushes video out over one WebSocket, logs via the server with an on-disk queue, `SHOW_WINDOW=false` for no pop-up, `CAMERA_SOURCE=sim` for testing |
| `web/` | etzal | Copy of `dashboard/` + `server.js` (live relay). Same origin for video and data: no CORS, no mixed content |
| `esp32/` | ESP32 | Same sketch; Wi-Fi name/password moved to `secrets.h` (gitignored) |
| `deploy/` | laptop → etzal | `setup-server.sh` (once), `deploy.sh` (every update), pm2 config |

## Run the laptop side

```powershell
cd v2/edge
pip install -r requirements.txt
copy .env.example .env      # set HUB_URL and EDGE_TOKEN (see below)
python main.py
```

`edge/.env` only needs what is new; everything else (`CAMERA_SOURCE`, `ESP32_MODE`, `ESP32_HOST`,
`SERIAL_PORT`) is read from the project's root `.env`, like v1. `ESP32_MODE` accepts `wifi`, `usb` or `off`.

- `HUB_URL`: the public address of the server (now a `trycloudflare.com` address, see below).
- `EDGE_TOKEN`: `ssh -p 2222 mydebian 'grep EDGE_TOKEN ~/crowd-intelligent/web/.env'`

What keeps working when something fails:

| Failure | What happens |
|---|---|
| Phone app stops / Wi-Fi blip | Camera reconnects by itself; website shows "Phone camera offline", ESP32 keeps its state |
| Internet or server down | Detection + ESP32 keep running; rows wait in `edge/data/queue.db` and upload later, never twice |
| ESP32 unplugged / unreachable | Retries every 3 s; ESP32 blinks yellow after 6 s without a signal |
| Laptop restarts | Queued rows survive on disk |

## Deploy the server side

```bash
ssh -p 2222 mydebian 'bash -s' < v2/deploy/setup-server.sh   # once: db "crowd", role "crowd", web/.env
bash v2/deploy/deploy.sh                                     # every update: upload, build, pm2 reload
```

On etzal: `~/crowd-intelligent/`, pm2 apps `crowd-web` and `crowd-tunnel`, Postgres db `crowd`.
Never `pm2 delete` other apps on that server.

## Permanent address

`crowd-tunnel` is a quick tunnel: its `https://<random>.trycloudflare.com` address changes whenever it
restarts (`pm2 logs crowd-tunnel | grep trycloudflare` shows the current one). For a fixed address,
add a public hostname to the existing `cloudflared-etzal` tunnel in the Cloudflare dashboard
(Zero Trust → Networks → Tunnels → etzal → Public Hostname):
`crowd.etzalgroup.com` → `http://localhost:3020`. Then put that in `HUB_URL` and stop the quick tunnel:
`pm2 stop crowd-tunnel && pm2 save`.
