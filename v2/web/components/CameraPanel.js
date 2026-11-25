"use client";

import { VideoOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { LIVE_URL } from "@/lib/constants";

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
  const video = live.online && live.data?.video;
  // A new session each time the video comes back, so the <img> reconnects to the stream
  const [session, setSession] = useState(0);
  useEffect(() => {
    if (video) setSession((s) => s + 1);
  }, [video]);
  const now = useClock();

  const s = live.data;
  return (
    <div className="camera-panel">
      <div className="camera">
        {video ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={session} src={`${LIVE_URL}/video?s=${session}`} alt="Live camera feed with detected people" />
        ) : (
          <div className="camera-off">
            <VideoOff size={40} />
            {live.online ? (
              <>
                <p>Phone camera offline</p>
                <small>The laptop is connected but gets no video. Check that the IP Webcam app is running.</small>
              </>
            ) : (
              <>
                <p>Camera offline</p>
                <small>
                  Start detection on the laptop: open <Link href="/laptop">This laptop</Link>
                  {" "}(or double-click <code>Crowd Laptop</code> on its desktop).
                </small>
              </>
            )}
          </div>
        )}
        <span className="cam-label">{site}</span>
        {video && (
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
