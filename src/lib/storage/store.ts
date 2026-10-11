"use client";

import { produce, type Draft } from "immer";
import { create } from "zustand";
import { reflowCoverElements } from "@/lib/cover/reflow";
import type { Element, Project } from "@/lib/schema/project";

const HISTORY_LIMIT = 80;

interface ProjectState {
  project: Project | null;
  past: Project[];
  future: Project[];
  savedAt: string | null;
  setProject: (p: Project | null) => void;
  /** Apply a change. Page-count/paper changes automatically keep the cover anchored. */
  update: (recipe: (draft: Draft<Project>) => void, opts?: { history?: boolean }) => void;
  replace: (p: Project, opts?: { history?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  markSaved: (at: string) => void;
}

function withCoverReflow(before: Project, after: Project): Project {
  const pagesChanged = before.interior.pages.length !== after.interior.pages.length;
  const specChanged = before.spec.paper !== after.spec.paper || before.spec.ink !== after.spec.ink;
  if (!pagesChanged && !specChanged) return after;
  return produce(after, (d) => {
    d.cover.elements = reflowCoverElements(after.cover.elements, after.spec, before.interior.pages.length, after.interior.pages.length, before.spec) as Draft<Element>[];
  });
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  past: [],
  future: [],
  savedAt: null,
  setProject: (p) => set({ project: p, past: [], future: [], savedAt: p?.updatedAt ?? null }),
  update: (recipe, opts) => {
    const cur = get().project;
    if (!cur) return;
    let next = produce(cur, recipe);
    if (next === cur) return;
    next = withCoverReflow(cur, next);
    next = produce(next, (d) => {
      d.updatedAt = new Date().toISOString();
    });
    const history = opts?.history ?? true;
    set({ project: next, past: history ? [...get().past, cur].slice(-HISTORY_LIMIT) : get().past, future: history ? [] : get().future });
  },
  replace: (p, opts) => {
    const cur = get().project;
    const next = cur ? withCoverReflow(cur, p) : p;
    set({ project: next, past: cur && (opts?.history ?? true) ? [...get().past, cur].slice(-HISTORY_LIMIT) : get().past, future: [] });
  },
  undo: () => {
    const { past, project, future } = get();
    if (!past.length || !project) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future] });
  },
  redo: () => {
    const { past, project, future } = get();
    if (!future.length || !project) return;
    set({ project: future[0], past: [...past, project], future: future.slice(1) });
  },
  markSaved: (at) => set({ savedAt: at }),
}));
