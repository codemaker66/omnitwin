/** Local calendar date as YYYY-MM-DD: the "night" a run belongs to is the day it started. */
export function localDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isExpired(org: { readonly expires?: string | undefined }, night: string): boolean {
  return org.expires !== undefined && org.expires < night;
}

/**
 * Credit that expires first is spent first; orgs without an expiry come last.
 * The sort is stable, so ties keep their config order.
 */
export function orderOrgs<T extends { readonly expires?: string | undefined }>(orgs: readonly T[]): T[] {
  return [...orgs].sort((a, b) => {
    if (a.expires === b.expires) return 0;
    if (a.expires === undefined) return 1;
    if (b.expires === undefined) return -1;
    return a.expires < b.expires ? -1 : 1;
  });
}

/**
 * A task starts only if its whole budget fits under the nightly cap. A task that
 * does not fit is skipped (it stays queued for another night) and smaller tasks
 * later in the queue can still run.
 */
export function canAfford(spentUsd: number, taskBudgetUsd: number, capUsd: number): boolean {
  return spentUsd + taskBudgetUsd <= capUsd + 1e-9;
}

export function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}
