// pm2 apps for the crowd hub on etzal. Lives at ~/crowd-intelligent/ecosystem.config.cjs.
//   pm2 startOrReload ~/crowd-intelligent/ecosystem.config.cjs --only crowd-web
// Only touches crowd-* processes. Never `pm2 delete` other apps on this server.
const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "crowd-web",
      cwd: path.join(__dirname, "web"),
      script: "server.js",
      env: { NODE_ENV: "production" },
      max_memory_restart: "400M",
      restart_delay: 3000,
    },
    {
      // Temporary public URL (https://<random>.trycloudflare.com, changes when restarted).
      // Remove once crowd.etzalgroup.com is added to the cloudflared-etzal tunnel.
      name: "crowd-tunnel",
      script: "/usr/local/bin/cloudflared",
      args: "tunnel --url http://127.0.0.1:3020 --no-autoupdate",
      interpreter: "none",
      restart_delay: 5000,
    },
  ],
};
