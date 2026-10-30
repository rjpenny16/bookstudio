"use client";

import { useEffect } from "react";
import { AUTOPILOT_STEPS, runAutopilot } from "@/lib/agent/autopilot";
import { imageStatus } from "@/lib/cover/artClient";
import type { InboxItem, InboxResult } from "@/lib/inbox/state";
import { setRunnerState } from "@/lib/inbox/runnerState";
import { coverGeometry } from "@/lib/kdp/geometry";
import { ensureFonts, loadImages, rasterize } from "@/lib/render/canvas";
import type { Project } from "@/lib/schema/project";
import { DEFAULT_AUTHOR } from "@/lib/schema/factory";
import { saveProject } from "@/lib/storage/db";
import { snapshotForBook } from "@/lib/market/client";
import { artEnabled, resolveSetup, type SetupState } from "@/components/autopilot/SetupForm";

/** How often an idle tab asks for the next idea, and how often a building tab says it's still alive. */
const POLL_MS = 30_000;
const HEARTBEAT_MS = 60_000;

const post = (url: string, body?: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/** Front cover as a PNG (base64, no data: prefix) for the Discord reply. */
async function coverPng(project: Project): Promise<string | undefined> {
  try {
    await ensureFonts();
    const images = await loadImages(project.assets);
    const cg = coverGeometry(project.spec, project.interior.pages.length);
    const canvas = rasterize({ widthPt: cg.trimW, heightPt: cg.trimH, scale: 600 / cg.trimH, background: project.cover.background, elements: project.cover.elements, images, originX: -cg.front.x, originY: -cg.front.y });
    return canvas.toDataURL("image/png").split(",")[1];
  } catch {
    return undefined;
  }
}

async function build(item: InboxItem) {
  const label = item.text.split("\n")[0];
  setRunnerState({ building: label, step: "Starting" });
  const beat = setInterval(() => void post(`/api/inbox/${item.id}`, { action: "heartbeat" }).catch(() => undefined), HEARTBEAT_MS);
  try {
    const setup: SetupState = {
      topic: item.idea.topic,
      audience: item.idea.audience,
      trimId: item.idea.trimId,
      pageTarget: item.idea.pageTarget,
      author: DEFAULT_AUTHOR,
      notes: item.idea.notes,
      coverArt: item.idea.coverArt,
    };
    const { bookType, trimId } = resolveSetup(setup);
    const images = await imageStatus().catch(() => null);
    const market = await snapshotForBook(setup.topic);
    const res = await runAutopilot(
      { market: market.snapshot ?? undefined, topic: setup.topic, audience: setup.audience, bookType, trimId, author: setup.author, notes: setup.notes, coverArt: artEnabled(setup, images), pageTarget: setup.pageTarget },
      (id, st) => st === "running" && setRunnerState({ step: AUTOPILOT_STEPS.find((s) => s.id === id)?.label ?? id }),
    );
    await saveProject(res.project);
    const result: InboxResult = {
      projectId: res.project.id,
      title: res.project.metadata.title,
      pages: res.project.interior.pages.length,
      preflight: { passed: res.report.passed, total: res.report.total, blocking: res.report.blocking },
    };
    await post(`/api/inbox/${item.id}`, { action: "ready", result, coverPng: await coverPng(res.project) });
  } catch (err) {
    await post(`/api/inbox/${item.id}`, { action: "failed", error: err instanceof Error ? err.message : String(err) }).catch(() => undefined);
  } finally {
    clearInterval(beat);
    setRunnerState({ building: null, step: null });
  }
}

/** Claims and builds ideas one at a time; returns when nothing is waiting. */
async function drain() {
  for (;;) {
    const res = await post("/api/inbox/claim");
    if (!res.ok) return;
    const { item } = (await res.json()) as { item: InboxItem | null };
    if (!item) return;
    setRunnerState({});
    await build(item);
  }
}

/**
 * Builds ideas sent from the phone while any BookStudio tab is open. Autopilot
 * runs here because it renders pages and covers in the browser and saves
 * projects to this browser's storage. A Web Lock keeps it to one tab.
 */
export function InboxRunner() {
  useEffect(() => {
    let stopped = false;
    let busy = false;
    const tick = async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        if (typeof navigator !== "undefined" && navigator.locks) {
          await navigator.locks.request("bookstudio-inbox", { ifAvailable: true }, async (lock) => {
            if (lock) await drain();
          });
        } else {
          await drain();
        }
      } catch {
        // Server not reachable; try again on the next tick.
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  return null;
}
