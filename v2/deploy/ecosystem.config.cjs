// pm2 apps for crowd v2 on etzal. setup-server.sh / autodeploy.sh copy this file to
// ~/crowd-intelligent/ecosystem.config.cjs. Only crowd-* apps: never `pm2 delete` on this server.
const path = require("node:path");

const BASE = __dirname; // ~/crowd-intelligent

module.exports = {
  apps: [
    {
      // API + live relay on 127.0.0.1:3020 (installed by worker-release.sh)
      name: "crowd-worker",
      cwd: path.join(BASE, "worker"),
      script: "src/index.js",
      env: { NODE_ENV: "production", ENV_FILE: path.join(BASE, "worker.env") },
      max_memory_restart: "200M",
      restart_delay: 3000,
      kill_timeout: 4000,
    },
    {
      // CD: pulls the GitHub branch every minute and releases the worker when it changed
      name: "crowd-autodeploy",
      script: path.join(BASE, "repo/v2/deploy/autodeploy.sh"),
      interpreter: "bash",
      env: { CROWD_BASE: BASE },
      restart_delay: 10000,
    },
    {
      // Temporary public URL (https://<random>.trycloudflare.com, changes when restarted).
      // Stop it once crowd-api.etzalgroup.com is a public hostname of the cloudflared-etzal tunnel.
      name: "crowd-tunnel",
      script: "/usr/local/bin/cloudflared",
      args: "tunnel --url http://127.0.0.1:3020 --no-autoupdate",
      interpreter: "none",
      restart_delay: 5000,
    },
  ],
};
