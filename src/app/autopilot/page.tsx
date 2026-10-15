"use client";

import { Suspense } from "react";
import { Chat } from "@/components/autopilot/Chat";

export default function AutopilotPage() {
  return (
    <Suspense fallback={<div className="page muted">Loading…</div>}>
      <Chat />
    </Suspense>
  );
}
