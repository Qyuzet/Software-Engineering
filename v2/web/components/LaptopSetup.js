"use client";

// "This laptop" page: talks to the laptop app (panel.py on 127.0.0.1:8765) from this browser.
// Not installed -> what this laptop needs + the one-line installer + the cameras the browser can see.
// Installed     -> requirements check, webcams with pictures, camera choice, start/stop detection.
// Invite link   -> /laptop#join=<token>: the token is kept in this browser until the laptop app runs,
//                  then saved into it, so a teammate never has to paste anything.

import { ArrowLeft, Camera, CheckCircle2, CircleAlert, Copy, Laptop, Link2, Loader2, Play, Square, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AGENT_URL, INSTALL_COMMAND } from "@/lib/constants";

import styles from "./LaptopSetup.module.css";

// Chrome/Edge ask once before a website may reach apps on this computer ("local network access").
// Returns the PermissionStatus (state: prompt | granted | denied), or null if the browser has no such permission.
async function localAccessPermission() {
  for (const name of ["loopback-network", "local-network-access"]) {
    try {
      return await navigator.permissions.query({ name });
    } catch {
      /* not supported under this name */
    }
  }
  return null;
}

const JOIN_KEY = "crowd.join";

// Moves the token from an invite link (#join=...) into this browser's storage and out of the address bar
function takeInvite() {
  const m = window.location.hash.match(/(?:^#|&)join=([A-Za-z0-9_-]{8,128})(?:&|$)/);
  if (m) {
    localStorage.setItem(JOIN_KEY, m[1]);
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return !!localStorage.getItem(JOIN_KEY);
}

async function agent(path, body, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${AGENT_URL}${path}`, body === undefined
      ? { cache: "no-store", signal: ctrl.signal }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    const isJson = (res.headers.get("Content-Type") || "").includes("json");
    const data = isJson ? await res.json() : await res.blob();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function Row({ ok, warn, title, children }) {
  const Icon = ok ? CheckCircle2 : warn ? CircleAlert : XCircle;
  return (
    <li className={styles.row}>
      <Icon size={18} className={ok ? styles.ok : warn ? styles.warn : styles.bad} />
      <div><b>{title}</b><span>{children}</span></div>
    </li>
  );
}

function CopyCommand() {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.command}>
      <code>{INSTALL_COMMAND}</code>
      <button className={styles.btn} onClick={async () => {
        await navigator.clipboard.writeText(INSTALL_COMMAND);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}>
        <Copy size={15} /> {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

// Cameras the browser can see (works before anything is installed)
function BrowserCameras() {
  const [cams, setCams] = useState(null);
  const [error, setError] = useState(null);
  async function look() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });   // asks permission once
      const devices = await navigator.mediaDevices.enumerateDevices();
      stream.getTracks().forEach((t) => t.stop());
      setCams(devices.filter((d) => d.kind === "videoinput").map((d, i) => d.label || `Camera ${i + 1}`));
    } catch (err) {
      setError(err.name === "NotAllowedError" ? "Camera permission was refused." : err.name === "NotFoundError" ? "No camera found on this laptop." : err.message);
    }
  }
  return (
    <div>
      <button className={styles.btn} onClick={look}><Camera size={15} /> Show this laptop&apos;s cameras</button>
      {error && <p className={styles.badText}>{error}</p>}
      {cams && (
        <ul className={styles.plain}>
          {cams.length === 0 ? <li>No camera found.</li> : cams.map((c) => <li key={c}>{c}</li>)}
        </ul>
      )}
    </div>
  );
}

function InviteNote({ invite }) {
  if (!invite) return null;
  if (invite === "pending") {
    return (
      <section className={`${styles.card} ${styles.wide} ${styles.good}`}>
        <h2><Link2 size={18} /> Invite received</h2>
        <p>Start or install the laptop app below. This laptop joins by itself as soon as the app runs: nothing to paste.</p>
      </section>
    );
  }
  if (invite === "joined") {
    return (
      <section className={`${styles.card} ${styles.wide} ${styles.good}`}>
        <h2><CheckCircle2 size={18} /> This laptop has joined</h2>
        <p>It may now stream to the dashboard. Pick a camera below and press <b>Start detection</b>.</p>
      </section>
    );
  }
  return (
    <section className={`${styles.card} ${styles.wide} ${styles.ask}`}>
      <h2>The invite could not be saved</h2>
      <p>{invite}. Ask for a new invite link, or paste the token under Requirements.</p>
    </section>
  );
}

function NotConnected({ checking, permission }) {
  if (permission === "prompt") {
    return (
      <section className={`${styles.card} ${styles.wide} ${styles.ask}`}>
        <h2>Click &ldquo;Allow&rdquo; in the browser</h2>
        <p>
          Next to the address bar the browser asks whether <b>crowd.etzalgroup.com</b> may <b>access other apps and
          services on this device</b>. Click <b>Allow</b>: it only lets this page talk to the Crowd Laptop app on this
          computer (camera, requirements, start/stop). Nothing is installed by it.
        </p>
        <p className={styles.muted}>Don&apos;t see it? Click the icon left of the address bar, or reload the page.</p>
      </section>
    );
  }
  return (
    <>
      {permission === "denied" && (
        <section className={`${styles.card} ${styles.wide} ${styles.ask}`}>
          <h2>This page is blocked from the laptop app</h2>
          <p>Click the icon left of the address bar &rarr; <b>Site settings</b> &rarr; allow access to <b>apps on this
            device</b> (local network access), then reload the page.</p>
        </section>
      )}
      <section className={styles.card}>
        <h2>{checking ? "Looking for the laptop app..." : "This laptop is not connected yet"}</h2>
        <p className={styles.muted}>
          This page talks to the Crowd Laptop app on this computer. It connects by itself as soon as the app runs.
        </p>
        <ol className={styles.steps}>
          <li><b>Already installed?</b> Double-click <b>Crowd Laptop</b> on the desktop (or <code>v2\edge\run.bat</code>).</li>
          <li>
            <b>New laptop?</b> Open <b>PowerShell</b> (Start menu, type &ldquo;PowerShell&rdquo;), paste this and press Enter:
            <CopyCommand />
            It installs Python if needed, the app and its packages (about 1 GB, a few minutes), puts
            <b> Crowd Laptop</b> on the desktop and starts it.
          </li>
          <li>The first time, the browser asks to let this site access apps on this device: click <b>Allow</b>.</li>
        </ol>
      </section>

      <section className={styles.card}>
        <h2>What this laptop needs</h2>
        <ul className={styles.list}>
          <Row warn title="Windows 10 or 11">with internet, about 2 GB free disk space. Use Chrome or Edge for this page.</Row>
          <Row warn title="Python 3.9+">installed by the command above when missing.</Row>
          <Row warn title="Packages">YOLO (ultralytics + torch), OpenCV, pyserial, websocket-client, python-dotenv &ndash; installed by the command.</Row>
          <Row warn title="A camera">a webcam, or an Android phone with the IP Webcam app on the same Wi-Fi.</Row>
          <Row warn title="Invite link">from a teammate whose laptop is set up (laptop app &rarr; Copy invite link). Open it on this laptop.</Row>
          <Row warn title="ESP32 (optional)">lights and buzzer, by Wi-Fi or USB cable.</Row>
        </ul>
        <BrowserCameras />
      </section>
    </>
  );
}

function Requirements({ sys, onChanged }) {
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState(null);
  async function install() {
    try { onChanged(await agent("/api/install", {})); } catch (err) { setMsg(err.message); }
  }
  async function saveToken() {
    try { await agent("/api/settings", { edge_token: token.trim() }); setToken(""); setMsg("Token saved."); onChanged(await agent("/api/system")); }
    catch (err) { setMsg(err.message); }
  }
  async function copyInvite() {
    try {
      const { link } = await agent("/api/invite");
      await navigator.clipboard.writeText(link);
      setMsg("Invite link copied. Send it to the teammate; they open it on their laptop and it sets itself up. "
        + "Anyone with the link can stream to the dashboard, so keep it in the team.");
    } catch (err) { setMsg(err.message); }
  }
  return (
    <section className={styles.card}>
      <h2>Requirements</h2>
      <p className={styles.muted}>{sys.os} &middot; app in <code>{sys.app_folder}</code></p>
      <ul className={styles.list}>
        <Row ok={sys.python.ok} title={`Python ${sys.python.version}`}>{sys.python.ok ? "ok" : "too old: install Python 3.9 or newer"}</Row>
        {sys.packages.map((p) => (
          <Row key={p.name} ok={!!p.version} title={p.name}>{p.version ? `${p.version} - ${p.why}` : `missing - ${p.why}`}</Row>
        ))}
        <Row ok={sys.model.present} warn={!sys.model.present} title="YOLO model">{sys.model.present ? "present" : sys.model.note}</Row>
        <Row ok={sys.token_set} title="Edge token">
          {sys.token_set ? "set" : "missing: open the invite link from a teammate on this laptop, or paste the token below"}
        </Row>
      </ul>
      {sys.missing.length > 0 && (
        <button className={styles.btnPrimary} disabled={sys.installing} onClick={install}>
          {sys.installing ? <><Loader2 size={15} className={styles.spin} /> Installing...</> : `Install missing packages (${sys.missing.join(", ")})`}
        </button>
      )}
      {(sys.installing || sys.install_log.length > 0) && <pre className={styles.log}>{sys.install_log.join("\n")}</pre>}
      {sys.token_set ? (
        <div className={styles.inline}>
          <button className={styles.btn} onClick={copyInvite}><Link2 size={15} /> Copy invite link for another laptop</button>
        </div>
      ) : (
        <div className={styles.inline}>
          <input type="password" placeholder="Edge token" value={token} onChange={(e) => setToken(e.target.value)} />
          <button className={styles.btn} disabled={!token.trim()} onClick={saveToken}>Save token</button>
        </div>
      )}
      {msg && <p className={styles.muted}>{msg}</p>}
    </section>
  );
}

function Cameras({ settings, running, onSaved }) {
  const [cams, setCams] = useState(null);
  const [pics, setPics] = useState({});
  const [phone, setPhone] = useState(settings.phone_ip || "");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function find() {
    setBusy(true); setMsg(null);
    try {
      const list = await agent("/api/webcams", undefined, 20000);
      setCams(list);
      const next = {};
      for (const c of list) {
        try { next[c.index] = URL.createObjectURL(await agent(`/api/snapshot?webcam=${c.index}`, undefined, 15000)); } catch { /* no picture */ }
      }
      setPics(next);
      if (!list.length) setMsg("No webcam found. Plug one in, or use the phone.");
    } catch (err) { setMsg(err.message); }
    setBusy(false);
  }
  async function use(change, label) {
    try { await agent("/api/settings", change); setMsg(`Now using ${label}.${running ? " Restart detection to switch." : ""}`); onSaved(); }
    catch (err) { setMsg(err.message); }
  }
  const current = settings.camera === "webcam" ? `webcam ${settings.webcam_index}`
    : settings.camera === "phone" ? `phone ${settings.phone_ip}:${settings.phone_port}`
    : settings.camera === "sim" ? "simulation" : settings.camera_url;

  return (
    <section className={styles.card}>
      <h2>Camera</h2>
      <p className={styles.muted}>Now: <b>{current}</b></p>
      <button className={styles.btn} disabled={busy} onClick={find}>
        {busy ? <Loader2 size={15} className={styles.spin} /> : <Camera size={15} />} Find webcams on this laptop
      </button>
      {cams && cams.length > 0 && (
        <div className={styles.grid}>
          {cams.map((c) => (
            <figure key={c.index} className={styles.cam}>
              {pics[c.index]
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={pics[c.index]} alt={`Webcam ${c.index}`} />
                : <div className={styles.noPic}>no picture</div>}
              <figcaption>
                Webcam {c.index} <span>{c.size}</span>
                <button className={styles.btn} onClick={() => use({ camera: "webcam", webcam_index: c.index }, `webcam ${c.index}`)}>Use</button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <div className={styles.inline}>
        <input placeholder="Phone IP (IP Webcam app)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button className={styles.btn} disabled={!phone.trim()} onClick={() => use({ camera: "phone", phone_ip: phone.trim() }, `the phone at ${phone.trim()}`)}>Use phone</button>
        <button className={styles.btn} onClick={() => use({ camera: "sim" }, "simulation")}>Simulation</button>
      </div>
      {msg && <p className={styles.muted}>{msg}</p>}
    </section>
  );
}

function Detection({ state, refresh }) {
  const [msg, setMsg] = useState(null);
  const [checks, setChecks] = useState(null);
  const [busy, setBusy] = useState(null);
  async function act(path, label) {
    setBusy(label); setMsg(null);
    try {
      if (path === "/api/check") setChecks(await agent(path, {}, 60000));
      else { await agent(path, {}, 20000); refresh(); }
    } catch (err) { setMsg(err.message); }
    setBusy(null);
  }
  return (
    <section className={`${styles.card} ${styles.wide}`}>
      <h2>Detection {state.running ? <span className={styles.on}>running</span> : <span className={styles.off}>stopped</span>}</h2>
      <div className={styles.actions}>
        <button className={styles.btn} disabled={!!busy} onClick={() => act("/api/check", "check")}>
          {busy === "check" ? <Loader2 size={15} className={styles.spin} /> : null} Check everything
        </button>
        {state.running
          ? <button className={styles.btn} disabled={!!busy} onClick={() => act("/api/stop", "stop")}><Square size={14} /> Stop</button>
          : <button className={styles.btnPrimary} disabled={!!busy} onClick={() => act("/api/start", "start")}><Play size={14} /> Start detection</button>}
        {state.restart_needed && <button className={styles.btn} onClick={() => act("/api/restart", "restart")}>Restart with new settings</button>}
        <a className={styles.btn} href={AGENT_URL} target="_blank" rel="noopener">Open the laptop app (ESP32 Wi-Fi, log)</a>
        <Link className={styles.btn} href="/">Back to the dashboard</Link>
      </div>
      {msg && <p className={styles.badText}>{msg}</p>}
      {checks && (
        <ul className={styles.list}>
          {checks.checks.map((c) => (
            <Row key={c.name} ok={c.state === "ok"} warn={c.state === "warn" || c.state === "skip"} title={c.name}>{c.detail}</Row>
          ))}
        </ul>
      )}
      {state.log.length > 0 && <pre className={styles.log}>{state.log.slice(-12).join("\n")}</pre>}
    </section>
  );
}

export default function LaptopSetup() {
  const [status, setStatus] = useState("checking");     // checking | missing | connected
  const [sys, setSys] = useState(null);
  const [state, setState] = useState(null);
  const [permission, setPermission] = useState(null);   // prompt | granted | denied | null (not asked by this browser)
  const [invite, setInvite] = useState(null);           // null | pending | joined | error text
  const first = useRef(true);

  const refresh = useCallback(async () => {
    try {
      // The first request may wait for the browser's "allow access to this device" prompt
      const [s, st] = await Promise.all([agent("/api/system", undefined, first.current ? 30000 : 5000), agent("/api/state")]);
      setSys(s); setState(st); setStatus("connected");
    } catch {
      setStatus("missing");
      first.current = false;
      return;
    }
    first.current = false;
    const join = localStorage.getItem(JOIN_KEY);
    if (join) {                            // invite link opened on this laptop: hand the token to the app
      localStorage.removeItem(JOIN_KEY);
      try {
        await agent("/api/settings", { edge_token: join });
        setSys(await agent("/api/system"));
        setInvite("joined");
      } catch (err) {
        setInvite(err.message);
      }
    }
  }, []);

  useEffect(() => {
    if (takeInvite()) setInvite("pending");
    let timer;
    let stopped = false;
    let perm = null;
    const loop = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(loop, 2500);
    };
    localAccessPermission().then((p) => {
      if (stopped || !p) return;
      perm = p;
      setPermission(p.state);
      p.onchange = () => {                 // "Allow" clicked: connect right away
        setPermission(p.state);
        clearTimeout(timer);
        loop();
      };
    });
    loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (perm) perm.onchange = null;
    };
  }, [refresh]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}><ArrowLeft size={16} /> Dashboard</Link>
        <h1><Laptop size={20} /> This laptop</h1>
        <span className={status === "connected" ? styles.pillOn : styles.pill}>
          {status === "connected" ? "Laptop app connected" : status === "checking" ? "Checking..." : "Laptop app not found"}
        </span>
      </header>
      <main className={styles.main}>
        <InviteNote invite={invite} />
        {status === "connected" && sys && state ? (
          <>
            <Requirements sys={sys} onChanged={(s) => setSys(s)} />
            <Cameras settings={state.settings} running={state.running} onSaved={refresh} />
            <Detection state={state} refresh={refresh} />
          </>
        ) : (
          <NotConnected checking={status === "checking"} permission={permission} />
        )}
      </main>
    </div>
  );
}
