"use client";

import { useMemo } from "react";
import { checkMysteryPlan, mysterySizing } from "@/lib/agent/mystery";
import type { Project } from "@/lib/schema/project";

const KIND: Record<string, string> = { "word-search": "Word search", crossword: "Crossword", "word-scramble": "Word scramble", cryptogram: "Cryptogram" };

/**
 * The case behind a murder mystery, for the publisher: who is in it, the
 * fair-play check, and (behind a spoiler toggle) who did it and how each
 * clue points. Shown on Review & Publish for books autopilot planned.
 */
export function CasePanel({ project }: { project: Project }) {
  const plan = project.mystery;
  const check = useMemo(() => {
    if (!plan) return null;
    const z = mysterySizing({ trimId: project.spec.trimId, pageTarget: project.interior.pages.length, audience: project.brief.audience, topic: project.brief.topic, notes: project.brief.notes, difficulty: "medium" });
    return checkMysteryPlan(plan, z);
  }, [plan, project.spec.trimId, project.interior.pages.length, project.brief.audience, project.brief.topic, project.brief.notes]);
  if (project.bookType !== "mystery") return null;
  if (!plan || !check)
    return (
      <section className="card" aria-label="The case">
        <h2 style={{ marginTop: 0 }}>The case</h2>
        <p className="muted" style={{ margin: 0 }}>This book was made before the case plan was saved with it, so the case can&apos;t be shown here.</p>
      </section>
    );
  let exhibit = 0;
  const clues = plan.chapters.flatMap((ch, c) => ch.clues.map((cl) => ({ ...cl, chapter: c + 1, exhibit: ++exhibit })));
  return (
    <section className="card stack" aria-labelledby="review-case">
      <h2 id="review-case" style={{ margin: 0 }}>
        The case: {plan.caseTitle}
      </h2>
      <p style={{ margin: 0 }}>{plan.setting}</p>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Victim: {plan.victim.name}. Detective: {plan.sleuth.name}. {plan.chapters.length} chapters, {clues.length} clue puzzles.
      </p>
      <ul className="case-suspects" aria-label="Suspects">
        {plan.suspects.map((s) => (
          <li key={s.name}>
            <strong>{s.name}</strong>, {s.role}. <span className="muted">Motive: {s.motive} Alibi: {s.alibi}</span>
            {s.tell?.trim() && <span className="muted"> Tell: {s.tell}</span>}
          </li>
        ))}
      </ul>
      <div className={`notice ${check.problems.length ? "notice-warn" : "notice-pass"}`} aria-label="Fair-play check">
        {check.problems.length ? `Fair-play check: ${check.problems.length} note(s), listed under the spoilers (they name the culprit).` : "Fair-play check passed: the killer can be named from the clues alone, and every innocent suspect is cleared."}
      </div>
      <details className="spoilers">
        <summary>Show spoilers</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          <p style={{ margin: 0 }}>
            <strong>Culprit: {plan.culprit}.</strong> {plan.motive} {plan.method}
          </p>
          <p style={{ margin: 0 }}>
            Wrong theory mid-book: {plan.falseTheory.suspect}. {plan.falseTheory.why}
          </p>
          <p style={{ margin: 0 }}>
            Final proof: {plan.finalProof.answer}. {plan.finalProof.reveals}
          </p>
          {check.problems.length > 0 && (
            <ul aria-label="Fair-play notes" style={{ margin: 0, paddingLeft: 18 }}>
              {check.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="table-scroll">
            <table className="case-clues" aria-label="Clue chain">
              <thead>
                <tr>
                  <th>Exhibit</th>
                  <th>Ch.</th>
                  <th>Puzzle</th>
                  <th>Clue</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                {clues.map((cl) => (
                  <tr key={cl.exhibit}>
                    <td>{cl.exhibit}</td>
                    <td>{cl.chapter}</td>
                    <td>{KIND[cl.kind] ?? cl.kind}</td>
                    <td>{cl.answer}</td>
                    <td>{cl.suspect ? `${cl.effect} ${cl.suspect}` : "about the crime"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ margin: 0 }}>
            <strong>Solution:</strong> {plan.solution}
          </p>
        </div>
      </details>
    </section>
  );
}
