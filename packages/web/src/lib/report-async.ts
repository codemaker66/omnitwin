/**
 * Reports an error that has no caller to throw to, never swallowing it (as the
 * furniture's landing listeners are reported, R86): to the page's error
 * reporting, or thrown again on a microtask where there is none, so it still
 * reaches the console and Sentry's global handlers.
 */
export function reportAsync(error: unknown): void {
  const host: { reportError?: (error: unknown) => void } = globalThis;
  if (typeof host.reportError === "function") host.reportError(error);
  else queueMicrotask(() => { throw error; });
}

/**
 * Runs `work`, reporting anything it throws (reportAsync) instead of letting
 * it reach the caller: a store's listener, a frame loop or a timer, which must
 * go on whatever the sound does.
 */
export function shielded(work: () => void): void {
  try {
    work();
  } catch (error: unknown) {
    reportAsync(error);
  }
}
