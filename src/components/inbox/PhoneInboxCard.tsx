"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface BotStatus {
  configured: boolean;
  connected: boolean;
  tag?: string;
  error?: string;
}

/** Settings card: whether the Discord bot that takes ideas from your phone is connected. */
export function PhoneInboxCard() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [test, setTest] = useState<{ ok: boolean; detail: string } | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    fetch("/api/inbox/bot")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  const run = async () => {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch("/api/inbox/bot", { method: "POST" });
      const body = await res.json();
      setStatus(body);
      setTest(body.ok ? { ok: true, detail: "Posted a test message in your ideas channel." } : { ok: false, detail: body.error });
    } catch (e) {
      setTest({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };
  const badge = !status ? null : status.connected ? <span className="badge badge-pass">connected{status.tag ? ` · ${status.tag}` : ""}</span> : status.configured ? <span className="badge badge-warn">not connected</span> : <span className="badge badge-warn">off</span>;
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Phone inbox (Discord)</h2>
      <div className="row">
        {badge ?? <span className="muted">Checking…</span>}
        {status?.configured && (
          <button className="btn btn-sm" onClick={run} disabled={testing}>
            {testing && <span className="spinner" />} Send test message
          </button>
        )}
      </div>
      {status?.error && <div className="notice notice-fail">{status.error}</div>}
      {test && <div className={`notice ${test.ok ? "notice-info" : "notice-fail"}`}>{test.detail}</div>}
      <p style={{ margin: 0, fontSize: 13 }}>
        Post a book idea in a private Discord channel from your phone and an open BookStudio tab builds the full draft. You review it in Review &amp; Publish when you&apos;re back. Ideas sent while this computer is off wait in Discord. See the <Link href="/inbox">Inbox</Link>.
      </p>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
        <li><code>DISCORD_BOT_TOKEN</code>: your bot&apos;s token from the Discord Developer Portal (turn on the Message Content intent).</li>
        <li><code>DISCORD_CHANNEL_ID</code>: the channel to post ideas in. <code>DISCORD_OWNER_ID</code>: your Discord user id; anyone else is ignored.</li>
        <li>Restart the server after setting them. The README has the step-by-step setup.</li>
      </ul>
    </div>
  );
}
