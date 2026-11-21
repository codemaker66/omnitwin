import type { ChildEnv } from "./env.js";
import { runProcess } from "./proc.js";
import {
  classifyLine,
  detectStopSignal,
  EXPECTED_API_KEY_SOURCE,
  type InitMessage,
  type ResultMessage,
  type StopSignal,
} from "./stream.js";
import type { Effort } from "./task.js";

export interface ClaudeArgsInput {
  readonly model: string;
  readonly effort: Effort;
  readonly budgetUsd: number;
  readonly allowedTools: readonly string[];
  readonly readOnly: boolean;
  readonly settingsFile: string;
  readonly systemPromptFile: string;
  readonly session: { readonly kind: "new" | "resume"; readonly id: string };
}

/**
 * Flags for one headless run. Each one closes a specific door:
 * --bare            auth is ANTHROPIC_API_KEY only; no hooks, plugins, memory or CLAUDE.md
 *                   discovery. Its built-in tools are Bash, Edit, Read and PowerShell only.
 * --tools           drops PowerShell (and Edit for read-only tasks), so one shell's rules apply
 * --permission-mode acceptEdits approves Edit inside the worktree only; edits elsewhere would
 *                   need a prompt, and prompts are answered "no" (--permission-prompts none).
 *                   There is deliberately no tool-wide Read or Edit allow rule, which would
 *                   reach files outside the worktree such as the key folder.
 * --setting-sources user  with the isolated config dir this loads no settings at all, so the
 *                   repo's checked-in allow rules (`git push origin master`, Railway deploy) never apply
 * --settings        the runner's own deny list (runner-settings.json)
 * --strict-mcp-config     no MCP servers (no GitHub, Railway, Neon, Vercel tools)
 * The prompt goes in on stdin, so the variadic --allowedTools can safely come last.
 */
export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  return [
    "-p",
    "--bare",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    input.model,
    "--effort",
    input.effort,
    "--max-budget-usd",
    input.budgetUsd.toFixed(2),
    "--tools",
    input.readOnly ? "Bash,Read" : "Bash,Edit,Read",
    "--permission-mode",
    input.readOnly ? "default" : "acceptEdits",
    "--permission-prompts",
    "none",
    "--setting-sources",
    "user",
    "--settings",
    input.settingsFile,
    "--strict-mcp-config",
    "--append-system-prompt-file",
    input.systemPromptFile,
    input.session.kind === "new" ? "--session-id" : "--resume",
    input.session.id,
    "--allowedTools",
    ...input.allowedTools,
  ];
}

export interface ClaudeRunInput {
  /** Executable plus leading arguments, from the config's claudeCommand. */
  readonly command: readonly string[];
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: ChildEnv;
  /** Every org key, so no key can reach a log even if a run prints another org's. */
  readonly secrets: readonly string[];
  readonly prompt: string;
  readonly timeoutMs: number;
  readonly logFile: string;
}

export interface ClaudeRunOutcome {
  readonly init: InitMessage | null;
  readonly result: ResultMessage | null;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  /**
   * Set when the run was killed because its credential could not be confirmed:
   * the init reported another apiKeySource, or other output came before a
   * readable init. Either way the night stops.
   */
  readonly credentialMismatch: string | null;
  readonly stop: StopSignal | null;
  readonly killedReason: string | null;
  readonly stderrTail: string;
  readonly durationMs: number;
}

export async function runClaude(input: ClaudeRunInput): Promise<ClaudeRunOutcome> {
  const [command, ...prefix] = input.command;
  if (command === undefined) throw new Error("claudeCommand is empty");
  const seen: { init: InitMessage | null; result: ResultMessage | null; mismatch: string | null } = {
    init: null,
    result: null,
    mismatch: null,
  };

  const run = await runProcess({
    command,
    args: [...prefix, ...input.args],
    cwd: input.cwd,
    env: input.env,
    timeoutMs: input.timeoutMs,
    logFile: input.logFile,
    stdin: input.prompt,
    redact: input.secrets,
    onStdoutLine: (line, kill) => {
      const event = classifyLine(line);
      if (event.kind === "not-json" || seen.mismatch !== null) return;
      if (seen.init === null) {
        // The init message arrives before the first model request. Until a
        // readable one says the org's key is in use, nothing else may happen:
        // a run that cannot be confirmed is stopped before it can bill anything.
        if (event.kind !== "init") {
          seen.mismatch = "unconfirmed (output arrived before a readable init message)";
          kill("no readable init message before other output");
          return;
        }
        seen.init = event.init;
        if (event.init.apiKeySource !== EXPECTED_API_KEY_SOURCE) {
          seen.mismatch = event.init.apiKeySource;
          kill(`credential source was '${event.init.apiKeySource}', expected '${EXPECTED_API_KEY_SOURCE}'`);
        }
        return;
      }
      if (event.kind === "result") seen.result = event.result;
    },
  });

  // Only an API-level error result (or a crash with no result) can mean "this org
  // cannot pay". A normal final message is never scanned, so an agent writing
  // about auth errors in tests cannot trip the org switch.
  let stop: StopSignal | null = null;
  if (seen.mismatch === null) {
    if (seen.result === null) stop = detectStopSignal(run.stderrTail);
    else if (seen.result.is_error) stop = detectStopSignal(seen.result.result, run.stderrTail);
  }

  return {
    init: seen.init,
    result: seen.result,
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    credentialMismatch: seen.mismatch,
    stop,
    killedReason: run.killedReason,
    stderrTail: run.stderrTail,
    durationMs: run.durationMs,
  };
}
