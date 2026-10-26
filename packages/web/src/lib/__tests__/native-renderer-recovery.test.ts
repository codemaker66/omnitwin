import { describe, expect, it } from "vitest";
import {
  NATIVE_RECOVERY_ATTEMPT_TIMEOUT_MS, NATIVE_RECOVERY_CONTEXT_WAIT_MS, NATIVE_RECOVERY_LOSS_LIMIT, NATIVE_RECOVERY_LOSS_WINDOW_MS,
  createNativeRendererRecovery, type NativeRecoveryEnvironment, type NativeRecoveryPhase,
  type NativeRestoreMode,
} from "../native-renderer-recovery.js";

interface Timer { readonly at: number; readonly callback: () => void; cancelled: boolean }

/** A page whose clock, timers and visibility the test moves by hand. */
function page(initiallyVisible = true): NativeRecoveryEnvironment & {
  advance(ms: number): Promise<void>;
  show(): void;
  hide(): void;
  readonly pendingTimers: () => number;
  readonly listeners: () => number;
} {
  let time = 0;
  let visible = initiallyVisible;
  const timers: Timer[] = [];
  const visibleListeners = new Set<() => void>();
  return {
    now: () => time,
    visible: () => visible,
    onVisible: (listener) => {
      visibleListeners.add(listener);
      return () => { visibleListeners.delete(listener); };
    },
    setTimer: (callback, ms) => {
      const timer: Timer = { at: time + ms, callback, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
    async advance(ms) {
      // Attempts settle on microtasks; let them schedule their timers first.
      await settle();
      const until = time + ms;
      for (;;) {
        const next = timers.filter((timer) => !timer.cancelled && timer.at <= until).sort((a, b) => a.at - b.at)[0];
        if (next === undefined) break;
        time = next.at;
        next.cancelled = true;
        next.callback();
        await settle();
      }
      time = until;
      await settle();
    },
    show() { visible = true; for (const listener of [...visibleListeners]) listener(); },
    hide() { visible = false; },
    pendingTimers: () => timers.filter((timer) => !timer.cancelled).length,
    listeners: () => visibleListeners.size,
  };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}

interface Attempt { readonly mode: NativeRestoreMode; readonly attempt: number; resolve(): void; reject(error: Error): void }

function harness(environment: NativeRecoveryEnvironment) {
  const phases: NativeRecoveryPhase[] = [];
  const attempts: Attempt[] = [];
  const recovery = createNativeRendererRecovery({
    environment,
    onPhase: (phase) => { phases.push(phase); },
    restore: (mode, attempt) => new Promise<void>((resolve, reject) => {
      attempts.push({ mode, attempt, resolve, reject });
    }),
  });
  return { recovery, phases, attempts, last: () => phases.at(-1) };
}

describe("native renderer recovery", () => {
  it("swaps a fresh renderer onto the same canvas as soon as a visible WebGPU view loses its device", async () => {
    const environment = page();
    const { recovery, attempts, last } = harness(environment);
    recovery.lost("WebGPU");
    await settle();
    expect(attempts.map(({ mode, attempt }) => [mode, attempt])).toEqual([["swap", 1]]);
    expect(last()).toEqual({ kind: "restoring", attempt: 1 });
    attempts[0]?.resolve();
    await settle();
    expect(last()).toEqual({ kind: "running" });
  });

  it("reports the loss at once, before it has decided how to restore, so a dead canvas is never left showing", () => {
    const { recovery, last } = harness(page());
    recovery.lost("WebGPU");
    expect(last()).toEqual({ kind: "lost" });
  });

  it("waits for the page to be shown again before asking a backgrounded browser for a device", async () => {
    const environment = page(false);
    const { recovery, attempts, last } = harness(environment);
    recovery.lost("WebGPU");
    await environment.advance(60_000);
    expect(attempts).toHaveLength(0);
    expect(last()).toEqual({ kind: "waiting", for: "visible" });
    environment.show();
    await settle();
    expect(attempts.map(({ mode }) => mode)).toEqual(["swap"]);
  });

  it("backs off between failed attempts and remounts a new canvas before giving up", async () => {
    const environment = page();
    const { recovery, attempts, last } = harness(environment);
    recovery.lost("WebGPU");
    await settle();
    attempts[0]?.reject(new Error("No adapter yet"));
    await environment.advance(999);
    expect(attempts).toHaveLength(1);
    await environment.advance(1);
    expect(attempts.map(({ mode, attempt }) => [mode, attempt])).toEqual([["swap", 1], ["swap", 2]]);
    attempts[1]?.reject(new Error("No adapter yet"));
    await environment.advance(2_999);
    expect(attempts).toHaveLength(2);
    await environment.advance(1);
    expect(attempts.map(({ mode }) => mode)).toEqual(["swap", "swap", "remount"]);
    attempts[2]?.reject(new Error("Still no adapter"));
    await settle();
    const phase = last();
    expect(phase?.kind).toBe("failed");
    expect(phase?.kind === "failed" ? phase.error.message : "").toBe("Still no adapter");
    expect(environment.pendingTimers()).toBe(0);
  });

  it("treats an attempt that never settles as failed instead of restoring forever", async () => {
    const environment = page();
    const { recovery, attempts } = harness(environment);
    recovery.lost("WebGPU");
    await settle();
    await environment.advance(NATIVE_RECOVERY_ATTEMPT_TIMEOUT_MS - 1);
    expect(attempts).toHaveLength(1);
    await environment.advance(1 + 1_000);
    expect(attempts.map(({ attempt }) => attempt)).toEqual([1, 2]);
    // The abandoned attempt settling late changes nothing.
    attempts[0]?.resolve();
    await settle();
    expect(attempts).toHaveLength(2);
  });

  it("swaps onto a WebGL canvas only after the browser hands its context back", async () => {
    const environment = page();
    const { recovery, attempts, last } = harness(environment);
    recovery.lost("WebGL");
    await environment.advance(NATIVE_RECOVERY_CONTEXT_WAIT_MS - 1);
    expect(attempts).toHaveLength(0);
    expect(last()).toEqual({ kind: "waiting", for: "context" });
    recovery.contextRestored();
    await settle();
    expect(attempts.map(({ mode }) => mode)).toEqual(["swap"]);
    attempts[0]?.resolve();
    await settle();
    expect(last()).toEqual({ kind: "running" });
    expect(environment.pendingTimers()).toBe(0);
  });

  it("remounts a new canvas when a lost WebGL context is never handed back", async () => {
    const environment = page();
    const { recovery, attempts } = harness(environment);
    recovery.lost("WebGL");
    await environment.advance(NATIVE_RECOVERY_CONTEXT_WAIT_MS);
    expect(attempts.map(({ mode }) => mode)).toEqual(["remount"]);
  });

  it("counts the restore wait only while the page is visible, and remembers a restore that came while hidden", async () => {
    const environment = page(false);
    const { recovery, attempts, last } = harness(environment);
    recovery.lost("WebGL");
    await environment.advance(NATIVE_RECOVERY_CONTEXT_WAIT_MS * 3);
    expect(last()).toEqual({ kind: "waiting", for: "visible" });
    recovery.contextRestored();
    environment.show();
    await settle();
    expect(attempts.map(({ mode }) => mode)).toEqual(["swap"]);
  });

  it("gives a page hidden during the context wait no new canvas; the wait resumes once it is shown", async () => {
    const environment = page();
    const { recovery, attempts, last } = harness(environment);
    recovery.lost("WebGL");
    await settle();
    expect(last()).toEqual({ kind: "waiting", for: "context" });
    environment.hide();
    await environment.advance(NATIVE_RECOVERY_CONTEXT_WAIT_MS * 3);
    expect(attempts).toHaveLength(0);
    expect(last()).toEqual({ kind: "waiting", for: "visible" });
    environment.show();
    await settle();
    expect(last()).toEqual({ kind: "waiting", for: "context" });
    recovery.contextRestored();
    await settle();
    expect(attempts.map(({ mode }) => mode)).toEqual(["swap"]);
  });

  it("stops trying when the device keeps resetting instead of looping against the driver", async () => {
    const environment = page();
    const { recovery, attempts, last } = harness(environment);
    for (let loss = 1; loss < NATIVE_RECOVERY_LOSS_LIMIT; loss++) {
      recovery.lost("WebGPU");
      await settle();
      attempts.at(-1)?.resolve();
      await environment.advance(1_000);
      expect(last()).toEqual({ kind: "running" });
    }
    const attemptsBeforeStorm = attempts.length;
    recovery.lost("WebGPU");
    await settle();
    expect(attempts).toHaveLength(attemptsBeforeStorm);
    expect(last()?.kind).toBe("failed");
  });

  it("forgets losses older than the storm window", async () => {
    const environment = page();
    const { recovery, attempts, last } = harness(environment);
    for (let loss = 0; loss < NATIVE_RECOVERY_LOSS_LIMIT + 2; loss++) {
      recovery.lost("WebGPU");
      await settle();
      attempts.at(-1)?.resolve();
      await environment.advance(NATIVE_RECOVERY_LOSS_WINDOW_MS / (NATIVE_RECOVERY_LOSS_LIMIT - 1) + 1);
      expect(last()).toEqual({ kind: "running" });
    }
  });

  it("coalesces the reports of one loss and does not trust an attempt the device was lost during", async () => {
    const environment = page();
    const { recovery, attempts, last } = harness(environment);
    recovery.lost("WebGPU");
    recovery.lost("WebGPU");
    await settle();
    expect(attempts).toHaveLength(1);
    recovery.lost("WebGPU");
    attempts[0]?.resolve();
    await settle();
    expect(last()).not.toEqual({ kind: "running" });
    await environment.advance(1_000);
    expect(attempts.map(({ attempt }) => attempt)).toEqual([1, 2]);
    attempts[1]?.resolve();
    await settle();
    expect(last()).toEqual({ kind: "running" });
  });

  it("releases its timers and visibility listener when disposed and reports nothing afterwards", async () => {
    const environment = page(false);
    const { recovery, phases } = harness(environment);
    recovery.lost("WebGL");
    await settle();
    expect(environment.listeners()).toBe(1);
    recovery.dispose();
    const reported = phases.length;
    environment.show();
    await environment.advance(60_000);
    expect(phases).toHaveLength(reported);
    expect(environment.listeners()).toBe(0);
    expect(environment.pendingTimers()).toBe(0);
  });

  it("starts afresh after a person asks for the view again", async () => {
    const environment = page();
    const { recovery, attempts, last } = harness(environment);
    for (let loss = 0; loss < NATIVE_RECOVERY_LOSS_LIMIT; loss++) {
      recovery.lost("WebGPU");
      await settle();
      attempts.at(-1)?.resolve();
      await settle();
    }
    expect(last()?.kind).toBe("failed");
    recovery.reset();
    expect(last()).toEqual({ kind: "running" });
    recovery.lost("WebGPU");
    await settle();
    expect(last()).toEqual({ kind: "restoring", attempt: 1 });
  });
});
