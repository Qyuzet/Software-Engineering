"use client";

import { VideoOff } from "lucide-react";
import { useEffect, useState } from "react";

import { EDGE_URL } from "@/lib/constants";

function useClock() {
  const [now, setNow] = useState(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function CameraPanel({ live, site }) {
  // A new session each time main.py comes back, so the <img> reconnects to the stream
  const [session, setSession] = useState(0);
  useEffect(() => {
    if (live.online) setSession((s) => s + 1);
  }, [live.online]);
  const now = useClock();

  const s = live.data;
  return (
    <div className="camera-panel">
      <div className="camera">
        {live.online ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={session} src={`${EDGE_URL}/video?s=${session}`} alt="Live camera feed with detected people" />
        ) : (
          <div className="camera-off">
            <VideoOff size={40} />
            <p>Camera offline</p>
            <small>
              Start the edge script on this laptop: <code>python main.py</code>
              {" "}(or <code>python simulate.py</code> without a camera)
            </small>
          </div>
        )}
        <span className="cam-label">{site}</span>
        {live.online && (
          <div className="cam-live">
            <span className={`count-bubble ${s.crowded ? "red" : "green"}`} title="People in view">{s.count}</span>
            <span className="live-chip"><i />LIVE · {Math.round(s.fps)} FPS</span>
          </div>
        )}
        {now && (
          <span className="cam-time">
            {now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).toLowerCase()}
          </span>
        )}
      </div>
    </div>
  );
}
