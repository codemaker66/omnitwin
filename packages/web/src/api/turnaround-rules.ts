import {
  TurnaroundRuleSettingSchema,
  TurnaroundRulesResponseSchema,
  type CreateTurnaroundRule,
  type TurnaroundRuleSetting,
  type TurnaroundRulesResponse,
} from "@omnitwin/types";
import { ApiError, api } from "./client.js";

// ---------------------------------------------------------------------------
// Turnaround rules staff can set (T-637, slice A): how long a room needs
// between two functions. Everyone who reads the Diary may read them; the
// venue's administrators set them.
// ---------------------------------------------------------------------------

function rulesPath(venueId: string): string {
  return `/venues/${encodeURIComponent(venueId)}/turnaround-rules`;
}

export function listTurnaroundRules(venueId: string, signal?: AbortSignal): Promise<TurnaroundRulesResponse> {
  return api.get(rulesPath(venueId), TurnaroundRulesResponseSchema, signal);
}

export function createTurnaroundRule(venueId: string, input: CreateTurnaroundRule): Promise<TurnaroundRuleSetting> {
  return api.post(rulesPath(venueId), input, undefined, TurnaroundRuleSettingSchema);
}

/** Saves the minutes, changed or not: either way a person has confirmed them. */
export function updateTurnaroundRule(
  venueId: string,
  rule: Pick<TurnaroundRuleSetting, "id" | "updatedAt">,
  minutes: number,
): Promise<TurnaroundRuleSetting> {
  return api.patch(`${rulesPath(venueId)}/${encodeURIComponent(rule.id)}`,
    { minutes, expectedUpdatedAt: rule.updatedAt }, TurnaroundRuleSettingSchema);
}

export function retireTurnaroundRule(venueId: string, id: string): Promise<void> {
  return api.delete(`${rulesPath(venueId)}/${encodeURIComponent(id)}`);
}

/** The rule as it stands, from a refusal that carries it: a stale edit
 *  (RULE_CHANGED) or a scope that already has a rule (RULE_EXISTS). */
export function ruleFromRefusal(error: unknown): TurnaroundRuleSetting | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const parsed = TurnaroundRuleSettingSchema.safeParse(error.details);
  return parsed.success ? parsed.data : null;
}
