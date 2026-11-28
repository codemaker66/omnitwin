import { MAX_BUDGET_USD, MAX_TIMEOUT_MINUTES } from "../task.js";

/** A command-line number: positive, finite and, when `max` is given, no greater than it. */
export function boundedNumber(value: string | undefined, name: string, max?: number): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  if (max !== undefined && parsed > max) throw new Error(`${name} must be at most ${String(max)}`);
  return parsed;
}

/** `--budget` obeys the spec's ceiling (task.ts), so a typo cannot pass the per-task limit. */
export function budgetOverride(value: string | undefined): number | undefined {
  return boundedNumber(value, "--budget", MAX_BUDGET_USD);
}

/** `--timeout` obeys the spec's limit: a whole number of minutes, at most 240. */
export function timeoutOverride(value: string | undefined): number | undefined {
  const parsed = boundedNumber(value, "--timeout", MAX_TIMEOUT_MINUTES);
  if (parsed !== undefined && !Number.isInteger(parsed)) throw new Error("--timeout must be a whole number of minutes");
  return parsed;
}
