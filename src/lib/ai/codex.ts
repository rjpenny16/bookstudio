import "server-only";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Running the codex CLI on the user's ChatGPT subscription, shared by cover
 * art (through the gpt-image-bridge script) and writing (codex exec). Both go
 * through the same bash, so they see the same codex and the same login.
 */

/**
 * The bash that runs codex. On Windows that's Git for Windows' bash: it isn't
 * on PATH for a server started from PowerShell, and System32\bash.exe is WSL,
 * which can't see a Windows codex. CODEX_BASH overrides it.
 */
export function bridgeShell(): string {
  if (process.env.CODEX_BASH) return process.env.CODEX_BASH;
  if (process.platform !== "win32") return "bash";
  const roots = [process.env.ProgramFiles, process.env["ProgramW6432"], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs")];
  return roots.map((r) => r && path.join(r, "Git", "bin", "bash.exe")).find((p): p is string => !!p && existsSync(p)) ?? "bash";
}

export const noBash = () =>
  process.platform === "win32"
    ? "Git for Windows (its bash) is needed to run codex. Install it from https://git-scm.com, or set CODEX_BASH to a bash.exe."
    : "bash is needed to run codex.";

/** codex is a native binary on Windows, so paths go over as C:/... */
export const codexPath = (p: string) => p.replaceAll("\\", "/");

export interface CodexRun {
  /** Arguments for the bridge's bash. */
  args: string[];
  /** This request's own temp dir; codex's workdir goes inside it, so its name is in codex's command line. */
  dir: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Sent on stdin, then closed. */
  stdin?: string;
  /** Names the job in error messages ("image generation", "writing"). */
  what: string;
  fail: (message: string, status: number) => Error;
}

/** Runs codex in the bridge's bash; stopping it (timeout or cancel) stops codex too, not just the wrapper. */
export function runCodex({ args, dir, timeoutMs, signal, stdin, what, fail }: CodexRun): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(fail(`The ${what} request was cancelled.`, 499));
    const win = process.platform === "win32";
    // Its own process group, so cancelling stops codex too and not just the wrapper.
    const child = spawn(bridgeShell(), args, { detached: !win, windowsHide: true, stdio: [stdin === undefined ? "ignore" : "pipe", "ignore", "pipe"], env: { ...process.env, TMPDIR: dir } });
    let stderr = "";
    let why: Error | null = null;
    const kill = (err: Error) => {
      why = err;
      if (win) {
        // Git bash's processes don't form a Windows process tree taskkill /T can follow, so codex is found by
        // its workdir instead (the temp dir name is unique to this request and contains only safe characters).
        execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
        const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${path.basename(dir)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
        execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true }, () => {});
        return;
      }
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    };
    const timer = setTimeout(() => kill(fail(`codex took longer than ${Math.round(timeoutMs / 60_000)} minutes; try again.`, 504)), timeoutMs);
    const onAbort = () => kill(fail(`The ${what} request was cancelled.`, 499));
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr!.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    if (stdin !== undefined) {
      child.stdin!.on("error", () => {});
      child.stdin!.end(stdin);
    }
    const done = (err: Error | null) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve();
    };
    child.on("error", (e) => done(fail((e as NodeJS.ErrnoException).code === "ENOENT" ? noBash() : `Could not run codex: ${e.message}`, 503)));
    // A stopped request settles as soon as the wrapper exits; a straggler holding stderr open mustn't keep it waiting.
    child.on("exit", () => why && done(why));
    child.on("close", (code) => {
      if (why) return done(why);
      if (code === 0) return done(null);
      if (code === 127) return done(fail("codex CLI not found on the server. Install it (npm install -g @openai/codex) and run: codex login", 503));
      const tail = stderr.trim().split("\n").slice(-6).join("\n");
      if (/not logged in|codex login|unauthori[sz]ed|\b401\b/i.test(tail)) return done(fail("codex isn't logged in. Run: codex login (with your ChatGPT account)", 401));
      if (/rate.?limit|usage limit|\b429\b/i.test(tail)) return done(fail("ChatGPT usage limit reached; try again later.", 429));
      done(fail(`codex ${what} failed${tail ? `: ${tail}` : ` (exit ${code})`}`, 502));
    });
  });
}
