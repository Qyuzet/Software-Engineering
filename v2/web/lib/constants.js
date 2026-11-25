export const DEFAULT_LIMIT = 10;          // matches CROWD_LIMIT in edge/config.py
export const REFRESH_MS = 10_000;         // the edge logs every 10 s
export const NEAR_LIMIT_RATIO = 0.8;      // "near limit" = at least 80% of the limit

// The worker on etzal serves the live video, the live status and the database API.
// Set NEXT_PUBLIC_WORKER_URL in Vercel (Project Settings -> Environment Variables) or in .env.local.
export const WORKER_URL = (process.env.NEXT_PUBLIC_WORKER_URL || "").trim().replace(/\/+$/, "");
export const LIVE_URL = `${WORKER_URL}/live`;
export const API_URL = `${WORKER_URL}/api`;

// The laptop app (v2/edge/panel.py) on the computer that opens the dashboard. Only this website
// and the panel itself may use it; the browser may ask to allow access to apps on this device.
export const AGENT_URL = "http://127.0.0.1:8765";
export const INSTALL_COMMAND = "irm https://crowd.etzalgroup.com/install.ps1 | iex";
