"use client";

import { useSyncExternalStore } from "react";

/** What the background runner is doing, for the sidebar badge and the Inbox page. */
export interface RunnerState {
  /** Text of the idea being built, if any. */
  building: string | null;
  /** Current autopilot step label. */
  step: string | null;
  /** Bumped whenever the inbox changes, so lists refetch. */
  version: number;
}

let state: RunnerState = { building: null, step: null, version: 0 };
const listeners = new Set<() => void>();

export function setRunnerState(patch: Partial<RunnerState>) {
  state = { ...state, ...patch, version: state.version + 1 };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const useRunnerState = () => useSyncExternalStore(subscribe, () => state, () => state);
