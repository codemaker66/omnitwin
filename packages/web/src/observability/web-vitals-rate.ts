// ---------------------------------------------------------------------------
// The share of page loads that report field web vitals (goal 07). Kept apart
// from the reporter, and importing nothing, so the entry module can ask it
// without loading the reporter, which only a sampling build ever fetches.
// ---------------------------------------------------------------------------

export interface WebVitalsEnv {
  readonly MODE?: string;
  readonly VITE_WEB_VITALS_SAMPLE_RATE?: string;
}

/** A fraction written as a decimal: "0.5", ".25", "0". */
const DECIMAL_FRACTION = /^(?:0|0?\.\d+)$/u;

/**
 * The share of page loads measured: a decimal fraction below 1, such as
 * "0.5". Anything else (unset, "1" or more, "1e-1", "0x1") is 0, off. Below
 * 1 because the privacy page says the browser "may" measure a page load:
 * only a sample of them is (docs/engineering/web-vitals.md). Always 0 in
 * tests.
 */
export function webVitalsSampleRate(env: WebVitalsEnv): number {
  if (env.MODE === "test") return 0;
  const raw = env.VITE_WEB_VITALS_SAMPLE_RATE?.trim() ?? "";
  if (!DECIMAL_FRACTION.test(raw)) return 0;
  const rate = Number(raw);
  // Enough nines ("0.99999999999999999") read as 1.
  return rate < 1 ? rate : 0;
}
