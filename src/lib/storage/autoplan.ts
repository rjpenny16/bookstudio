"use client";

import { AUTOPLAN_KEY, DEFAULT_AUTOPLAN, planNewBook, type AutoPlanResult, type AutoPlanSettings } from "@/lib/kdp/autoplan";
import { refsFromSummaries } from "@/lib/kdp/quota";
import type { Project } from "@/lib/schema/project";
import { getValue, listProjects } from "./db";

export async function autoPlanSettings(): Promise<AutoPlanSettings> {
  const s = await getValue<AutoPlanSettings>(AUTOPLAN_KEY).catch(() => undefined);
  return s && Array.isArray(s.formats) ? s : DEFAULT_AUTOPLAN;
}

/** Plan a newly finished book's formats into free KDP weeks, against every other book's plans. */
export async function autoPlan(project: Project): Promise<AutoPlanResult> {
  const settings = await autoPlanSettings();
  if (!settings.enabled) return { project, planned: [], skipped: [] };
  const others = refsFromSummaries((await listProjects()).filter((s) => s.id !== project.id));
  return planNewBook(project, others, settings);
}
