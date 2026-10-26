// ---------------------------------------------------------------------------
// One save at a time, the latest value last (T-674 slice 19; critic C-X2).
//
// Event details save as you type. The layout's metadata PATCH on the server is
// an unlocked read-modify-write that replaces the whole of `instructions`, so
// two requests in flight at once can land out of order and the older one wins.
// This queue sends one value at a time for its target: typing waits for a
// pause (`delayMs`), a value typed while a request is out is held and
// coalesced with anything typed after it, and it goes only once the reply to
// the previous one has come back. Nothing typed is dropped: a failed send puts
// its value back unless a newer one is already waiting, and stays unsent until
// `retry()`, a new edit, or the connection coming back.
// ---------------------------------------------------------------------------

export type SavePhase = "idle" | "waiting" | "sending" | "failed" | "held";

export interface SaveSnapshot<T> {
  readonly phase: SavePhase;
  /** The last value the server acknowledged. */
  readonly saved: T | undefined;
  /** When it acknowledged it, as epoch milliseconds. */
  readonly savedAt: number | null;
  /** Why the last send failed, while unsent work remains. */
  readonly error: unknown;
  /** A value typed and not yet acknowledged (waiting, sending or failed). */
  readonly unsent: boolean;
}

export interface SaveQueueOptions<T> {
  readonly send: (value: T) => Promise<void>;
  /** The pause after typing before a save goes. */
  readonly delayMs: number;
  /** Whether a send may go now (online, not locked). A held value goes when `retry()` is called. */
  readonly canSend?: () => boolean;
  readonly now?: () => number;
}

export interface SaveQueue<T> {
  /** A new value: sent after the pause, after any request already out. */
  readonly set: (value: T) => void;
  /** Send what is waiting now; resolves when nothing is waiting or in flight, or the send failed or is held. */
  readonly flush: () => Promise<void>;
  /** Try a failed or held value again. */
  readonly retry: () => void;
  readonly snapshot: () => SaveSnapshot<T>;
  readonly subscribe: (listener: () => void) => () => void;
}

export function createSaveQueue<T>(options: SaveQueueOptions<T>): SaveQueue<T> {
  const now = options.now ?? Date.now;
  const canSend = options.canSend ?? ((): boolean => true);
  const listeners = new Set<() => void>();
  const settled = new Set<() => void>();

  let pending: { readonly value: T } | null = null;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failed = false;
  let error: unknown = null;
  let saved: T | undefined;
  let savedAt: number | null = null;
  let snapshot: SaveSnapshot<T> = { phase: "idle", saved, savedAt, error, unsent: false };

  const phase = (): SavePhase => {
    if (inFlight) return "sending";
    if (pending === null) return "idle";
    if (failed) return "failed";
    if (timer === null && !canSend()) return "held";
    return "waiting";
  };

  const emit = (): void => {
    snapshot = { phase: phase(), saved, savedAt, error: failed ? error : null, unsent: pending !== null || inFlight };
    for (const listener of listeners) listener();
    if (!inFlight && (pending === null || failed || !canSend())) {
      for (const resolve of [...settled]) resolve();
      settled.clear();
    }
  };

  const clear = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const pump = (): void => {
    clear();
    if (inFlight || pending === null || !canSend()) {
      emit();
      return;
    }
    const { value } = pending;
    pending = null;
    inFlight = true;
    failed = false;
    emit();
    options.send(value).then(
      () => {
        inFlight = false;
        saved = value;
        savedAt = now();
        // Something typed while this was out goes next, straight away: its pause has run.
        if (pending !== null) pump();
        else emit();
      },
      (reason: unknown) => {
        inFlight = false;
        if (pending === null) pending = { value };
        failed = true;
        error = reason;
        emit();
      },
    );
  };

  return {
    set: (value) => {
      pending = { value };
      failed = false;
      clear();
      // While a request is out the value waits for its reply, not for a timer.
      if (!inFlight) timer = setTimeout(() => { timer = null; pump(); }, options.delayMs);
      emit();
    },
    flush: () => new Promise<void>((resolve) => {
      settled.add(resolve);
      failed = false;
      pump();
    }),
    retry: () => {
      failed = false;
      pump();
    },
    snapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
