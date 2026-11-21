import { z } from "zod";

/**
 * The `apiKeySource` a run must report in its init message. A bare run with
 * ANTHROPIC_API_KEY set reports this value; anything else (for example "none"
 * when a stored login would be used) means the run is not billing the org's key,
 * and the runner kills it before the model is called.
 */
export const EXPECTED_API_KEY_SOURCE = "ANTHROPIC_API_KEY";

const initSchema = z.object({
  type: z.literal("system"),
  subtype: z.literal("init"),
  apiKeySource: z.string(),
  model: z.string(),
  session_id: z.string(),
});

const resultSchema = z.object({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  total_cost_usd: z.number(),
  num_turns: z.number(),
  duration_ms: z.number(),
  session_id: z.string(),
  permission_denials: z.array(z.object({ tool_name: z.string() })).optional(),
});

export type InitMessage = z.infer<typeof initSchema>;
export type ResultMessage = z.infer<typeof resultSchema>;

export type StreamEvent =
  | { readonly kind: "init"; readonly init: InitMessage }
  | { readonly kind: "result"; readonly result: ResultMessage }
  | { readonly kind: "other" }
  | { readonly kind: "not-json" };

export function classifyLine(line: string): StreamEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { kind: "not-json" };
  }
  const init = initSchema.safeParse(value);
  if (init.success) return { kind: "init", init: init.data };
  const result = resultSchema.safeParse(value);
  if (result.success) return { kind: "result", result: result.data };
  return { kind: "other" };
}

export type StopSignal = "credit-exhausted" | "auth-failed";

/**
 * Reads the final result text and stderr for the two errors that mean "this org
 * cannot pay for more work": an exhausted balance (no payment method on file) and
 * a rejected key. Both are clean stops for the org, not task failures.
 */
export function detectStopSignal(...texts: readonly (string | undefined)[]): StopSignal | null {
  const text = texts.filter((part): part is string => part !== undefined).join("\n");
  if (/credit balance (?:is )?too low|billing_error|reached your specified (?:workspace )?api usage limits?/iu.test(text)) {
    return "credit-exhausted";
  }
  if (/invalid (?:x-)?api[ -]?key|authentication_error|failed to authenticate|401 unauthorized/iu.test(text)) {
    return "auth-failed";
  }
  return null;
}

/**
 * The agent is told to end with a "## Summary" section. Use it when present;
 * otherwise keep the tail of the final message, which is where conclusions sit.
 */
export function extractSummary(resultText: string | undefined, maxChars = 900): string {
  if (resultText === undefined || resultText.trim() === "") return "(the agent produced no final message)";
  const heading = /^#{1,3}\s*Summary\s*$/imu.exec(resultText);
  const text = heading === null ? resultText : resultText.slice(heading.index + heading[0].length);
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return heading === null ? `…${trimmed.slice(-maxChars)}` : `${trimmed.slice(0, maxChars)}…`;
}
