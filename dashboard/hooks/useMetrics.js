"use client";

import { useEffect, useState } from "react";

import { REFRESH_MS } from "@/lib/constants";
import { browserTz } from "@/lib/time";

/** Fetches /api/metrics for a day and refreshes it every 10 s. */
export default function useMetrics(date) {
  const [state, setState] = useState({ data: null, error: null });

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    let timer;
    const tz = encodeURIComponent(browserTz());

    async function load() {
      try {
        const res = await fetch(`/api/metrics?date=${date}&tz=${tz}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setState({ data, error: null });
      } catch (err) {
        if (!cancelled) setState((s) => ({ ...s, error: err.message }));
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
