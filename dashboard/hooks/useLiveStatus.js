"use client";

import { useEffect, useState } from "react";

import { EDGE_URL } from "@/lib/constants";

const STALE_AFTER_MS = 5000; // the Python loop stopped sending frames

/** Polls the Python script's /status endpoint. online = main.py is running and counting. */
export default function useLiveStatus() {
  const [live, setLive] = useState({ online: false, data: null });

  useEffect(() => {
    let cancelled = false;
    let timer;
    // Fresh = Python's timestamp keeps moving. Comparing it with this browser's clock
    // would break whenever the two clocks disagree.
    let lastStamp = null;
    let lastChange = 0;

    async function poll() {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 1500);
      let online = false;
      try {
        const res = await fetch(`${EDGE_URL}/status`, { signal: ctrl.signal, cache: "no-store" });
        const data = await res.json();
        if (data.time !== lastStamp) {
          lastStamp = data.time;
          lastChange = Date.now();
        }
        online = res.ok && data.time != null && Date.now() - lastChange < STALE_AFTER_MS;
        if (!cancelled) setLive(online ? { online: true, data } : { online: false, data: null });
      } catch {
        if (!cancelled) setLive({ online: false, data: null });
      } finally {
        clearTimeout(timeout);
      }
      // Poll quickly while live; back off while the script is not running
      if (!cancelled) timer = setTimeout(poll, online ? 1000 : 3000);
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return live;
}
