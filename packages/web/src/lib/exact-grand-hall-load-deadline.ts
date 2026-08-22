export const EXACT_GRAND_HALL_LOAD_DEADLINE_MS = 10 * 60_000;

export interface ExactGrandHallLoadDeadline {
  readonly signal: AbortSignal;
  complete: () => void;
  cancel: () => void;
}

function deadlineAbortError(): DOMException {
  return new DOMException("Exact Grand Hall load exceeded its absolute deadline.", "TimeoutError");
}

/** One absolute clock spanning authentication, transfer, verification, decode, and attach. */
export function beginExactGrandHallLoadDeadline(
  onTimeout: () => void,
  deadlineMs = EXACT_GRAND_HALL_LOAD_DEADLINE_MS,
): ExactGrandHallLoadDeadline {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
    throw new Error("Exact Grand Hall load deadline must be a positive safe integer.");
  }
  const controller = new AbortController();
  let active = true;
  const timer = globalThis.setTimeout(() => {
    if (!active) return;
    active = false;
    controller.abort(deadlineAbortError());
    onTimeout();
  }, deadlineMs);

  const settle = (abort: boolean): void => {
    if (!active) return;
    active = false;
    globalThis.clearTimeout(timer);
    if (abort) controller.abort(new DOMException("Exact Grand Hall load cancelled.", "AbortError"));
  };

  return {
    signal: controller.signal,
    complete: () => { settle(false); },
    cancel: () => { settle(true); },
  };
}
