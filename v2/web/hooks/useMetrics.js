"use client";

import { useEffect, useState } from "react";

import { API_URL, REFRESH_MS, WORKER_URL } from "@/lib/constants";
import { browserTz } from "@/lib/time";

/** Fetches the worker's /api/metrics for a day and refreshes it every 10 s. */
export default function useMetrics(date) {
  const [state, setState] = useState({ data: null, error: null });

  useEffect(() => {
    if (!date) return;
    if (!WORKER_URL) {
      setState({ data: null, error: "NEXT_PUBLIC_WORKER_URL is not set" });
      return;
    }
    let cancelled = false;
    let timer;
    const tz = encodeURIComponent(browserTz());

    async function load() {
      try {
        const res = await fetch(`${API_URL}/metrics?date=${date}&tz=${tz}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setState({ data, error: null });
      } catch (err) {
        const reason = err instanceof TypeError ? "server not reachable" : err.message;
        if (!cancelled) setState((s) => ({ ...s, error: reason }));
      }
      if (!cancelled) timer = setTimeout(load, REFRESH_MS);
    }

    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [date]);

  return state;
}
