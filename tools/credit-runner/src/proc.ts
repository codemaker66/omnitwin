import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import type { ChildEnv } from "./env.js";

export interface RunOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: ChildEnv;
  readonly timeoutMs: number;
  /** stdout and stderr are appended here as they arrive. */
  readonly logFile: string;
  /** Run `command` through the platform shell (cmd.exe on Windows). */
  readonly shell?: boolean;
  readonly stdin?: string;
  /** Secrets replaced with [REDACTED] before anything reaches the log or the tails. */
  readonly redact?: readonly string[];
  /** Called for every stdout line; `kill` stops the process tree and records why. */
  readonly onStdoutLine?: (line: string, kill: (reason: string) => void) => void;
  /**
   * How long to wait for the output pipes to close after the process itself has
   * exited. A grandchild that outlives its parent (a vitest worker, a dev server)
   * can hold the pipes open forever; after this grace the runner stops waiting.
   */
  readonly exitGraceMs?: number;
}

export interface RunResult {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly killedReason: string | null;
  readonly durationMs: number;
  readonly stdoutTail: string;
  readonly stderrTail: string;
}

const TAIL_CHARS = 6000;

/** Anything shaped like an Anthropic key is redacted, not only the key this run was given. */
const ANY_ANTHROPIC_KEY = /sk-ant-[A-Za-z0-9_-]{16,}/gu;

class Tail {
  private text = "";

  push(chunk: string): void {
    this.text = (this.text + chunk).slice(-TAIL_CHARS);
  }

  toString(): string {
    return this.text;
  }
}

export function redactAll(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join("[REDACTED]");
  }
  return out.replace(ANY_ANTHROPIC_KEY, "[REDACTED]");
}

/** Kills a process and everything it started (claude spawns shells, node, vitest…). */
export function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group is already gone.
  }
}

export function runProcess(options: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const secrets = options.redact ?? [];
    const log = createWriteStream(options.logFile, { flags: "a" });
    let logBroken = false;
    log.on("error", () => {
      // A full or vanished log disk must not crash the night; the tails still hold the end.
      logBroken = true;
    });
    const write = (text: string): void => {
      if (!logBroken) log.write(text);
    };

    const child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: options.env,
      shell: options.shell ?? false,
      windowsHide: true,
      // On POSIX a new process group lets killTree take the whole tree down.
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutTail = new Tail();
    const stderrTail = new Tail();
    let killedReason: string | null = null;
    let timedOut = false;
    let exitCode: number | null = null;
    let exited = false;
    let settled = false;
    let graceTimer: NodeJS.Timeout | undefined;

    const kill = (reason: string): void => {
      if (killedReason !== null) return;
      killedReason = reason;
      // Once the process has exited its pid may already belong to something else.
      if (!exited) killTree(child.pid);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill(`timed out after ${String(Math.round(options.timeoutMs / 60000))} min`);
    }, options.timeoutMs);

    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      const result: RunResult = {
        exitCode,
        timedOut,
        killedReason,
        durationMs: Date.now() - started,
        stdoutTail: stdoutTail.toString(),
        stderrTail: stderrTail.toString(),
      };
      if (logBroken) {
        resolve(result);
        return;
      }
      log.end(() => {
        resolve(result);
      });
    };

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      log.end();
      reject(error);
    });
    child.stdin.on("error", () => {
      // The child exited before reading its input; its exit code tells the story.
    });

    // Both streams are read line by line, so a secret is never split across two
    // chunks when it is redacted, and multi-byte characters are decoded whole.
    createInterface({ input: child.stdout }).on("line", (raw) => {
      const line = redactAll(raw, secrets);
      write(`${line}\n`);
      stdoutTail.push(`${line}\n`);
      options.onStdoutLine?.(line, kill);
    });
    createInterface({ input: child.stderr }).on("line", (raw) => {
      const line = redactAll(raw, secrets);
      write(`[stderr] ${line}\n`);
      stderrTail.push(`${line}\n`);
    });

    child.stdin.end(options.stdin ?? "");

    child.on("exit", (code) => {
      exited = true;
      exitCode = code;
      clearTimeout(timer);
      graceTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish();
      }, options.exitGraceMs ?? 5000);
    });
    child.on("close", (code) => {
      exitCode ??= code;
      finish();
    });
  });
}
