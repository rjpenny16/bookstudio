"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { aiStatus, type AiStatus } from "@/lib/ai/client";
import { AUTOPILOT_STEPS, runAutopilot, type AgentStep, type AutopilotResult } from "@/lib/agent/autopilot";
import { ackLine, CHAT_LIMIT, chatMessage, parseIdea, STAGE_STEP, stageFor, stepLine, type DirectionStage } from "@/lib/agent/chat";
import { applyTitle, intentInput, reviseFromChat, routeMessage } from "@/lib/agent/regenerateClient";
import type { ChatTarget } from "@/lib/ai/tasks";
import { imageStatus, type ImageStatus } from "@/lib/cover/artClient";
import { runPreflight } from "@/lib/preflight";
import { DEFAULT_AUTHOR } from "@/lib/schema/factory";
import type { ChatMessage, Project, TitleOption } from "@/lib/schema/project";
import { loadProject, saveProject } from "@/lib/storage/db";
import { LiveBuild } from "./LiveBuild";
import { artEnabled, CostEstimate, EXAMPLES, resolveSetup, SetupForm, setupFromParams, type SetupState } from "./SetupForm";

/**
 * Autopilot as a conversation. The first message is the book idea and
 * starts the build; while it runs, one status line says where it is and a
 * message is passed to the next stage that can use it; once the draft is
 * done, a message revises the part it is about. The thread is kept with
 * the book, so reopening it carries on where it left off.
 */

const INTRO = "Tell me the book you want: what it's about and who it's for (for example, \"cozy murder mystery at a seaside hotel for adults\"). I'll plan it, write it, name it, design the cover and check it against KDP's rules, then stop for your review. Send me directions any time.";

/** Build stages back to the chat targets a leftover direction is revised with. */
const STAGE_TARGET: Record<DirectionStage, ChatTarget> = { plan: "plan", content: "content", title: "title", listing: "listing", cover: "cover" };

export function Chat() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [images, setImages] = useState<ImageStatus | null>(null);
  const [setup, setSetup] = useState<SetupState>(() => setupFromParams(params));
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [preview, setPreview] = useState<{ project: Project; hasCover: boolean } | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [result, setResult] = useState<AutopilotResult | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const queue = useRef<{ stage: DirectionStage; text: string }[]>([]);
  const started = useRef(new Set<string>());
  const later = useRef<{ stage: DirectionStage; text: string }[]>([]);
  const autoStarted = useRef(false);
  /** The home page's one-click start goes straight to Review & Publish when the draft is done. */
  const thenReview = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  /** The thread as it stands (state lags a render behind; saves read this). */
  const thread = useRef<ChatMessage[]>([]);
  const push = (...m: ChatMessage[]) => {
    thread.current = [...thread.current, ...m];
    setMessages(thread.current);
  };
  const resetThread = (list: ChatMessage[]) => {
    thread.current = list;
    setMessages(list);
  };

  useEffect(() => {
    aiStatus().then(setStatus).catch(() => setStatus(null));
    imageStatus().then(setImages).catch(() => setImages(null));
    // Reopening a book's chat: its thread and draft come back.
    const id = params.get("project");
    if (id)
      loadProject(id).then((p) => {
        if (!p) return;
        setProject(p);
        resetThread(p.chat ?? []);
      });
  }, [params]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages.length, busy]);

  const say = (text: string, tone?: ChatMessage["tone"]) => push(chatMessage("agent", text, tone));

  /** Save the draft with the thread so far. */
  const persist = async (p: Project) => {
    const next = { ...p, chat: thread.current.slice(-CHAT_LIMIT) };
    await saveProject(next);
    setProject(next);
  };

  const build = async (idea: string) => {
    const parsed = parseIdea(idea);
    const s: SetupState = { ...setup, topic: parsed.topic, audience: setup.audience.trim() || parsed.audience };
    setSetup(s);
    setRunning(true);
    setResult(null);
    setPreview(null);
    queue.current = [];
    later.current = [];
    started.current = new Set();
    setSteps(AUTOPILOT_STEPS.map((x) => ({ ...x, status: "pending" })));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const { bookType, trimId } = resolveSetup(s);
    const add = say;
    add(`On it: ${s.topic}${s.audience ? ` for ${s.audience}` : ""}${bookType === "mystery" && !/myster/i.test(s.topic) ? ", as a murder mystery puzzle book" : ""}. I'll post short updates as I go.`);
    try {
      const res = await runAutopilot(
        {
          topic: s.topic,
          audience: s.audience,
          bookType,
          trimId,
          author: s.author.trim() || DEFAULT_AUTHOR,
          notes: s.notes,
          coverArt: artEnabled(s, images),
          pageTarget: s.pageTarget,
          style: s.templateId || s.paletteId ? { templateId: s.templateId, paletteId: s.paletteId } : undefined,
          takeDirections: (stage) => {
            const mine = queue.current.filter((d) => d.stage === stage);
            queue.current = queue.current.filter((d) => d.stage !== stage);
            return mine.map((d) => d.text).join(" ");
          },
        },
        (id, st, detail) => {
          if (st === "running") started.current.add(id);
          setSteps((prev) => prev.map((x) => (x.id === id ? { ...x, status: st, detail } : x)));
          const line = st === "done" ? stepLine(id, detail) : null;
          if (line) add(line);
        },
        ctrl.signal,
        (p, stage) => setPreview({ project: p, hasCover: stage === "cover" || stage === "done" }),
      );
      setResult(res);
      const pre = res.report;
      add(`The draft is done: "${res.project.metadata.title}", ${res.project.interior.pages.length} pages, KDP checks ${pre.passed}/${pre.total}${pre.blocking ? ` (${pre.blocking} blocking)` : ""}.${res.notes.length ? ` ${res.notes.length} note(s) are under Details.` : ""} Tell me anything you'd like changed.`, "done");
      let p = res.project;
      // Directions that came too late for their stage (or that a stage couldn't use) are applied now.
      for (const d of [...res.unused, ...later.current, ...queue.current]) {
        const target = STAGE_TARGET[d.stage];
        add(`Now for what you asked earlier: "${d.text}".`);
        const r = await reviseFromChat(p, { target, chapter: 0, section: "", instruction: d.text, reply: "" }, d.text, ctrl.signal).catch((e) => ({ project: p, summary: `That didn't work: ${e instanceof Error ? e.message : e}` }));
        if (r) {
          p = r.project;
          add(r.summary);
        } else add("That one changes how the book is planned, so it needs a new build. Start a new book with it when you're ready.");
      }
      queue.current = [];
      later.current = [];
      await persist(p);
      if (thenReview.current) router.push(`/projects/${p.id}#review`);
      else router.replace(`/autopilot?project=${p.id}`);
    } catch (e) {
      add(e instanceof Error && e.message === "Cancelled" ? "Stopped. Nothing was saved; send the idea again to start over." : `Something went wrong: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setRunning(false);
    }
  };

  const revise = async (text: string, p: Project) => {
    setBusy("Working on it…");
    const add = say;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const intent = await routeMessage(intentInput(p, text, "done"), ctrl.signal);
      if (intent.target === "question") {
        add(intent.reply || "Tell me what you'd like changed and I'll do it.");
        await persist(p);
        return;
      }
      add(intent.reply || "On it.");
      setBusy(intent.target === "cover" ? "Redesigning the cover…" : intent.target === "title" ? "Thinking of titles…" : "Rewriting…");
      const r = await reviseFromChat(p, intent, text, ctrl.signal);
      if (!r) {
        add(intent.target === "plan" || p.mystery ? "That changes how the book is planned (the case, its chapters or its sections), so it needs a new build. Start a new book with it and I'll build it from scratch." : "I couldn't find that part of the book. Name the section, chapter, title, listing or cover you want changed.");
        await persist(p);
        return;
      }
      add(r.summary, "done");
      await persist(r.project);
    } catch (e) {
      add(`That didn't work: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setBusy(null);
    }
  };

  /** A message while the book is being built: answered, or passed on to the next stage that can use it. */
  const direct = async (text: string) => {
    const intent = await routeMessage(intentInput(preview?.project ?? null, text, "building"));
    const stage = stageFor(intent.target);
    if (!stage) return say(intent.reply || "I'm still building; tell me anything you'd like changed.");
    const used = !started.current.has(STAGE_STEP[stage]);
    (used ? queue : later).current.push({ stage, text: intent.instruction.trim() || text });
    say(ackLine(stage, used));
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setDraft("");
    push(chatMessage("user", text));
    if (running) return direct(text);
    if (project) return revise(text, project);
    return build(text);
  };

  const pickTitle = async (o: TitleOption) => {
    if (!project || busy) return;
    push(chatMessage("user", `Use the title "${o.title}".`));
    setBusy("Updating the title page and cover…");
    try {
      const r = await applyTitle(project, o);
      say(r.summary, "done");
      await persist(r.project);
    } finally {
      setBusy(null);
    }
  };

  const newBook = () => {
    setProject(null);
    setResult(null);
    setPreview(null);
    setSteps([]);
    resetThread([]);
    router.replace("/autopilot");
  };

  // The home page's one-screen start lands here with go=1: the idea is the first message.
  useEffect(() => {
    if (params.get("go") !== "1" || autoStarted.current || !status || !images || !setup.topic.trim()) return;
    autoStarted.current = true;
    thenReview.current = true;
    const idea = setup.audience.trim() ? `${setup.topic} for ${setup.audience}` : setup.topic;
    void Promise.resolve().then(() => send(idea));
  });

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  };

  const current = steps.find((s) => s.status === "running");
  const shown = result?.project ?? project;
  const fresh = !project && !running && !messages.length;
  const estimateSetup = { ...setup, ...(draft.trim() ? parseIdea(draft) : {}), audience: setup.audience || parseIdea(draft).audience };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>AI Autopilot</h1>
          <p>Chat with the agent that makes your book. It plans, writes, names and designs it, checks it against KDP&apos;s rules and stops for your approval. It never publishes for you.</p>
        </div>
        {(project || messages.length > 0) && !running && (
          <button className="btn" onClick={newBook}>
            New book
          </button>
        )}
      </div>
      <div className="split-aside">
        <section className="card chat" aria-label="Autopilot chat">
          <ol className="chat-log" aria-label="Conversation" aria-live="polite">
            <li className="bubble bubble-agent">{INTRO}</li>
            {messages.map((m) => (
              <li key={m.id} className={`bubble bubble-${m.role}${m.tone ? ` bubble-${m.tone}` : ""}`}>
                {m.text}
              </li>
            ))}
            {running && (
              <li className="bubble bubble-agent bubble-status" aria-label="Status">
                <span className="spinner" /> {current ? current.label : "Starting…"}
              </li>
            )}
            {busy && (
              <li className="bubble bubble-agent bubble-status" aria-label="Status">
                <span className="spinner" /> {busy}
              </li>
            )}
          </ol>
          {shown && !running && <DraftCard project={shown} result={result} onTitle={pickTitle} disabled={!!busy} />}
          {steps.length > 0 && (
            <details className="chat-details">
              <summary>Details</summary>
              <ol className="steps">
                {steps.map((s, i) => (
                  <li key={s.id} className={`step ${s.status}`}>
                    <span className="step-dot">{s.status === "done" ? "✓" : s.status === "error" ? "!" : s.status === "running" ? <span className="spinner" /> : i + 1}</span>
                    <div>
                      <strong>{s.label}</strong>
                      {s.detail && <div className="step-detail">{s.detail}</div>}
                      {!s.detail && s.id === "art" && s.status === "running" && images?.provider === "codex" && <div className="step-detail">Drawing through your ChatGPT plan; usually 2 to 6 minutes</div>}
                    </div>
                  </li>
                ))}
              </ol>
              {result && result.notes.length > 0 && (
                <div className="notice notice-info">
                  {result.notes.map((n, i) => (
                    <div key={i}>{n}</div>
                  ))}
                </div>
              )}
            </details>
          )}
          <div ref={endRef} />
          {fresh && (
            <div className="chip-list" aria-label="Examples">
              {EXAMPLES.map((ex) => (
                <button key={ex.topic} className="chip" onClick={() => setDraft(`${ex.topic} for ${ex.audience}`)}>
                  {ex.topic}
                </button>
              ))}
            </div>
          )}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <textarea
              aria-label="Message"
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              placeholder={running ? "Send a direction, e.g. \"make the victim a chef\"" : project ? "Ask for a change, e.g. \"make chapter 3 spookier\" or \"a punchier title\"" : "e.g. large print sudoku for seniors"}
            />
            <div className="row">
              <button className="btn btn-primary" type="submit" disabled={!draft.trim() || !!busy}>
                {project || running ? "Send" : "Start the book"}
              </button>
              {(running || busy) && (
                <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>
                  Cancel
                </button>
              )}
            </div>
          </form>
          {!project && !running && (
            <>
              <CostEstimate setup={estimateSetup} status={status} images={images} />
              <details>
                <summary>Book settings</summary>
                <SetupForm value={{ ...setup, topic: setup.topic || estimateSetup.topic }} onChange={setSetup} images={images} />
              </details>
            </>
          )}
        </section>
        <aside className="stack sticky-aside">
          {(running || preview || shown) && (
            <div className="card stack">
              <h2 style={{ margin: 0 }}>Your book so far</h2>
              <LiveBuild project={shown ?? preview?.project ?? null} hasCover={shown ? true : (preview?.hasCover ?? false)} max={8} />
            </div>
          )}
          <div className="card stack">
            <h2 style={{ margin: 0 }}>Model</h2>
            {status ? (
              <>
                <span className={`badge ${status.provider === "offline" ? "badge-warn" : "badge-pass"}`}>
                  {status.provider} · {status.model}
                </span>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  {status.detail}
                </p>
                {status.provider === "offline" && (
                  <p className="field-hint" style={{ margin: 0 }}>
                    Offline mode uses built-in templates instead of a language model, so nothing is flagged as AI-generated. Set <code>ANTHROPIC_API_KEY</code>, <code>AI_PROVIDER=codex</code> (ChatGPT subscription) or <code>AI_PROVIDER=ollama</code> for real drafting. See <Link href="/settings">Settings</Link>.
                  </p>
                )}
              </>
            ) : (
              <span className="muted">Checking…</span>
            )}
            <h3 style={{ margin: "8px 0 0" }}>Cover art</h3>
            {images ? (
              <>
                <span className={`badge ${images.configured ? "badge-pass" : "badge-warn"}`}>{images.configured ? `${images.provider} · ${images.model}` : "none"}</span>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  {images.detail}
                </p>
              </>
            ) : (
              <span className="muted">Checking…</span>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** The finished draft: what's inside, the quality review, other titles and where to go next. */
function DraftCard({ project, result, onTitle, disabled }: { project: Project; result: AutopilotResult | null; onTitle: (o: TitleOption) => void; disabled: boolean }) {
  const report = result?.report ?? runPreflight(project);
  const others = (project.brief.titleOptions ?? []).filter((o) => o.title !== project.metadata.title);
  const body = project.interior.sections.filter((s) => s.role === "body" && s.config.kind !== "section-divider");
  return (
    <div className="stack draft-card">
      <h2 style={{ margin: 0 }}>Draft ready for your review</h2>
      <p style={{ margin: 0 }}>
        <b>{project.metadata.title}</b>: {project.interior.pages.length} pages, preflight {report.passed}/{report.total}
        {report.blocking ? `, ${report.blocking} blocking` : ""}.
      </p>
      {others.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <strong>Other titles</strong>
          <div className="chip-list" aria-label="Other titles">
            {others.map((o) => (
              <button key={o.title} className="chip" disabled={disabled} title={o.why} onClick={() => onTitle(o)}>
                {o.title}
              </button>
            ))}
          </div>
        </div>
      )}
      <details>
        <summary>What&apos;s inside</summary>
        <ul aria-label="Book sections" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
          {body.map((s) => (
            <li key={s.id}>
              {s.label}: {project.interior.pages.filter((p) => p.sectionId === s.id).length} pages
            </li>
          ))}
          <li>
            Plus: {project.interior.sections.filter((s) => s.role !== "body" && !s.label.endsWith(": answers")).map((s) => s.label).join(", ")}
          </li>
        </ul>
        {result && (
          <ul aria-label="Quality review" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            <li>
              Rule checks: {result.quality.counts.high} high, {result.quality.counts.medium} medium, {result.quality.counts.low} low
            </li>
            {result.quality.reviews.listing && result.quality.reviews.listing.provider !== "offline" && (
              <li>
                Listing critique: {result.quality.reviews.listing.score}/10 · {result.quality.reviews.listing.summary}
              </li>
            )}
            {result.quality.reviews.visual && (
              <li>
                Cover &amp; pages: {result.quality.reviews.visual.score}/10{result.quality.reviews.visual.thumbnailReadable ? "" : " · title hard to read as a thumbnail"} · {result.quality.reviews.visual.summary}
              </li>
            )}
            {project.coverArt?.chosenId && (
              <li>
                Cover art: picked &ldquo;{project.coverArt.candidates.find((c) => c.id === project.coverArt!.chosenId)?.name}&rdquo; of {project.coverArt.candidates.length}. {project.coverArt.pickReason}
              </li>
            )}
            {result.repairs.length > 0 && <li>{result.repairs.length} automatic repair(s): {result.repairs.join("; ")}</li>}
          </ul>
        )}
      </details>
      <div className="row">
        <Link className="btn btn-primary" href={`/projects/${project.id}#review`}>
          Review &amp; Publish
        </Link>
        <Link className="btn" href={`/projects/${project.id}#interior`}>
          Open in studio
        </Link>
        <Link className="btn" href={`/projects/${project.id}#quality`}>
          Quality review
        </Link>
        <Link className="btn" href={`/projects/${project.id}#listing`}>
          Review listing
        </Link>
      </div>
    </div>
  );
}
