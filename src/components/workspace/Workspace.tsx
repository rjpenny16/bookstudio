"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { runPreflight, type Issue } from "@/lib/preflight";
import { loadProject, saveProject } from "@/lib/storage/db";
import { useProjectStore } from "@/lib/storage/store";
import { BriefTab } from "./BriefTab";
import { CoverTab } from "./CoverTab";
import { ExportTab } from "./ExportTab";
import { InteriorTab } from "./InteriorTab";
import { ListingTab } from "./ListingTab";
import { PreflightTab } from "./PreflightTab";
import { QualityTab } from "./QualityTab";

export type TabId = "brief" | "interior" | "cover" | "listing" | "quality" | "preflight" | "export";

const TABS: { id: TabId; label: string }[] = [
  { id: "brief", label: "Brief" },
  { id: "interior", label: "Interior" },
  { id: "cover", label: "Cover" },
  { id: "listing", label: "Listing" },
  { id: "quality", label: "Quality" },
  { id: "preflight", label: "Preflight" },
  { id: "export", label: "Export" },
];

export interface Focus {
  pageIndex: number;
  elementId: string | null;
}

export function Workspace() {
  const params = useParams<{ id: string }>();
  const project = useProjectStore((s) => s.project);
  const setProject = useProjectStore((s) => s.setProject);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  const savedAt = useProjectStore((s) => s.savedAt);
  const markSaved = useProjectStore((s) => s.markSaved);
  const [loaded, setLoaded] = useState<{ id: string; status: "missing" | "ready" } | null>(null);
  const status = loaded?.id === params.id ? loaded.status : "loading";
  const [tab, setTab] = useState<TabId>("interior");
  const [focus, setFocus] = useState<Focus>({ pageIndex: 0, elementId: null });

  useEffect(() => {
    let cancelled = false;
    loadProject(params.id).then((p) => {
      if (cancelled) return;
      if (!p) return setLoaded({ id: params.id, status: "missing" });
      setProject(p);
      setLoaded({ id: params.id, status: "ready" });
      const hash = window.location.hash.slice(1) as TabId;
      if (TABS.some((t) => t.id === hash)) setTab(hash);
    });
    return () => {
      cancelled = true;
      setProject(null);
    };
  }, [params.id, setProject]);

  // Autosave (debounced)
  useEffect(() => {
    if (!project || project.updatedAt === savedAt) return;
    const t = setTimeout(() => {
      saveProject(project).then(() => markSaved(project.updatedAt));
    }, 600);
    return () => clearTimeout(t);
  }, [project, savedAt, markSaved]);

  // Undo / redo shortcuts (not while typing in a form field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") || t.tagName === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const deferred = useDeferredValue(project);
  const report = useMemo(() => (deferred ? runPreflight(deferred) : null), [deferred]);

  const selectTab = (t: TabId) => {
    setTab(t);
    history.replaceState(null, "", `#${t}`);
  };

  const goToIssue = useCallback((issue: Issue) => {
    if (issue.area === "interior") {
      setFocus({ pageIndex: issue.pageIndex ?? 0, elementId: issue.elementId ?? null });
      selectTab("interior");
    } else if (issue.area === "cover") {
      setFocus((f) => ({ ...f, elementId: issue.elementId ?? null }));
      selectTab("cover");
    } else if (issue.area === "listing") selectTab("listing");
    else selectTab("interior");
  }, []);

  if (status === "loading") return <div className="page muted">Loading project…</div>;
  if (status === "missing" || !project)
    return (
      <div className="page">
        <h1>Project not found</h1>
        <p>It may have been deleted, or it lives in another browser. Projects are stored locally.</p>
        <Link className="btn" href="/">
          Back to projects
        </Link>
      </div>
    );

  const blocking = report?.blocking ?? 0;
  const warnings = report?.checks.filter((c) => c.status === "warn").length ?? 0;
  const saved = savedAt === project.updatedAt;

  return (
    <div>
      <header className="ws-head">
        <Link href="/" className="btn btn-ghost btn-sm" aria-label="Back to projects">
          ←
        </Link>
        <h1 className="ws-title" title={project.name}>
          {project.metadata.title || project.name}
        </h1>
        <span className="badge">
          {project.spec.widthIn}" × {project.spec.heightIn}" · {project.interior.pages.length} pp
        </span>
        <button className={`badge ${blocking ? "badge-fail" : warnings ? "badge-warn" : "badge-pass"}`} style={{ cursor: "pointer" }} onClick={() => selectTab("preflight")} aria-label={`Preflight: ${report?.passed} of ${report?.total} checks pass`}>
          Preflight {report?.passed}/{report?.total}
          {blocking ? ` · ${blocking} blocking` : warnings ? ` · ${warnings} warnings` : " ✓"}
        </button>
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 12 }} aria-live="polite">
          {saved ? "Saved" : "Saving…"}
        </span>
        <div className="btn-group">
          <button className="btn btn-sm" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button className="btn btn-sm" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
        </div>
      </header>
      <div className="ws-tabs">
        <div className="tabs" role="tablist" aria-label="Project sections">
          {TABS.map((t) => (
            <button key={t.id} role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} aria-selected={tab === t.id} className="tab" onClick={() => selectTab(t.id)}>
              {t.label}
              {t.id === "preflight" && blocking > 0 && <span className="badge badge-fail" style={{ marginLeft: 6 }}>{blocking}</span>}
            </button>
          ))}
        </div>
      </div>
      <section className="ws-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "brief" && <BriefTab />}
        {tab === "interior" && <InteriorTab focus={focus} setFocus={setFocus} />}
        {tab === "cover" && <CoverTab focusId={focus.elementId} />}
        {tab === "listing" && <ListingTab />}
        {tab === "quality" && <QualityTab onGo={selectTab} />}
        {tab === "preflight" && report && <PreflightTab report={report} onGo={goToIssue} />}
        {tab === "export" && report && <ExportTab report={report} onGoPreflight={() => selectTab("preflight")} />}
      </section>
    </div>
  );
}
