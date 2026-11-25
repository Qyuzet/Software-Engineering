"use client";

import { useEffect, useState } from "react";

import { LIVE_URL, WORKER_URL } from "@/lib/constants";

/**
 * Polls the worker's /live/status. online = the laptop is connected and sending status;
 * data.video = frames are arriving too (false while the phone camera is offline).
 */
export default function useLiveStatus() {
  const [live, setLive] = useState({ online: false, data: null });

  useEffect(() => {
    if (!WORKER_URL) return undefined;     // not configured: stay offline (useMetrics shows why)
    let cancelled = false;
    let timer;

    async function poll() {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 3000);
      let online = false;
      try {
        const res = await fetch(`${LIVE_URL}/status`, { signal: ctrl.signal, cache: "no-store" });
        const data = await res.json();
        online = res.ok && data.online === true;
        if (!cancelled) setLive(online ? { online: true, data } : { online: false, data: null });
      } catch {
        if (!cancelled) setLive({ online: false, data: null });
      } finally {
        clearTimeout(timeout);
      }
      // Poll quickly while live; back off while the laptop is not connected
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
