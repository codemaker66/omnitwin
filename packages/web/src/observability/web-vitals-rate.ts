// ---------------------------------------------------------------------------
// The share of page loads that report field web vitals (goal 07). Kept apart
// from the reporter so the entry module can ask it without loading the
// reporter, which only a sampling build ever fetches.
// ---------------------------------------------------------------------------

export interface WebVitalsEnv {
  readonly MODE?: string;
  readonly VITE_WEB_VITALS_SAMPLE_RATE?: string;
}

/** 0 (the default, off) to 1; always 0 in tests. */
export function webVitalsSampleRate(env: WebVitalsEnv): number {
  if (env.MODE === "test") return 0;
  const raw = env.VITE_WEB_VITALS_SAMPLE_RATE?.trim();
  if (raw === undefined || raw === "") return 0;
  const rate = Number(raw);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0;
}
