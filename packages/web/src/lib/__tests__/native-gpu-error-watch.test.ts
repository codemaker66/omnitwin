import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NATIVE_GPU_ERROR_GRACE_MS, NATIVE_GPU_ERROR_REPORT_LIMIT, NATIVE_GPU_HEALTHY_FRAME_MS, createNativeGpuErrorWatch,
} from "../native-gpu-error-watch.js";

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }); });
afterEach(() => { vi.useRealTimers(); });

function watch(hidden = { value: false }) {
  const onBroken = vi.fn<(message: string) => void>();
  const redraw = vi.fn();
  return { onBroken, redraw, hidden, watch: createNativeGpuErrorWatch({ onBroken, redraw, isHidden: () => hidden.value }) };
}

/** A frame's GPU work, completed (or failed) when the test says. */
function frameWork() {
  let complete = (): void => undefined;
  let fail = (): void => undefined;
  const completion = new Promise<void>((resolve, reject) => {
    complete = resolve;
    fail = () => { reject(new Error("Work aborted")); };
  });
  completion.catch(() => undefined);
  const start = vi.fn(() => completion);
  return { start, complete, fail };
}

const done = () => Promise.resolve();

async function advance(ms: number): Promise<void> { await vi.advanceTimersByTimeAsync(ms); }

describe("createNativeGpuErrorWatch", () => {
  it("keeps a view that draws cleanly after one error, and asks for that frame", async () => {
    const { watch: errors, onBroken, redraw } = watch();
    expect(errors.error("Invalid texture view")).toBe(true);
    expect(redraw).toHaveBeenCalledOnce();
    await advance(16);
    errors.drawn(done);
    await advance(NATIVE_GPU_ERROR_GRACE_MS * 2);
    expect(onBroken).not.toHaveBeenCalled();
  });

  it("asks for a frame's GPU work only while errors are being judged", async () => {
    const { watch: errors } = watch();
    const quiet = frameWork();
    errors.drawn(quiet.start);
    expect(quiet.start).not.toHaveBeenCalled();
    errors.error("Invalid texture view");
    const judged = frameWork();
    errors.drawn(judged.start);
    expect(judged.start).toHaveBeenCalledOnce();
    await advance(NATIVE_GPU_ERROR_GRACE_MS);
  });

  it("reports each distinct message once, across episodes", async () => {
    const { watch: errors } = watch();
    expect(errors.error("Invalid texture view")).toBe(true);
    expect(errors.error("Invalid texture view")).toBe(false);
    expect(errors.error("Out of memory")).toBe(true);
    errors.drawn(done);
    await advance(NATIVE_GPU_HEALTHY_FRAME_MS);
    expect(errors.error("Invalid texture view")).toBe(false);
  });

  it("stops reporting after a few distinct messages, which one broken scene can produce", () => {
    const { watch: errors } = watch();
    const reported = Array.from({ length: NATIVE_GPU_ERROR_REPORT_LIMIT + 2 }, (_, index) => errors.error(`Fault ${String(index)}`));
    expect(reported.filter(Boolean)).toHaveLength(NATIVE_GPU_ERROR_REPORT_LIMIT);
  });

  it("breaks a view whose every frame keeps failing for the grace period", async () => {
    const { watch: errors, onBroken } = watch();
    for (let at = 0; at <= NATIVE_GPU_ERROR_GRACE_MS + 32; at += 16) {
      errors.error("Invalid bind group");
      errors.drawn(done);
      await advance(16);
    }
    expect(onBroken).toHaveBeenCalledExactlyOnceWith("Invalid bind group");
  });

  it("does not count a frame healthy before its own GPU work has finished, however long that takes", async () => {
    // A busy GPU process (pipeline compiles on a phone) can return a frame's error late.
    const { watch: errors, onBroken } = watch();
    errors.error("First");
    const slow = frameWork();
    errors.drawn(slow.start);
    await advance(NATIVE_GPU_HEALTHY_FRAME_MS * 4);
    errors.error("That frame's own error, late");
    slow.complete();
    // Still the episode that began at 0: it breaks at the grace, not a fresh grace after the late error.
    await advance(NATIVE_GPU_ERROR_GRACE_MS - NATIVE_GPU_HEALTHY_FRAME_MS * 4);
    expect(onBroken).toHaveBeenCalledExactlyOnceWith("That frame's own error, late");
  });

  it("counts nothing from a frame whose GPU work never completed", async () => {
    const { watch: errors, onBroken } = watch();
    errors.error("First");
    const aborted = frameWork();
    errors.drawn(aborted.start);
    aborted.fail();
    await advance(NATIVE_GPU_ERROR_GRACE_MS);
    expect(onBroken).toHaveBeenCalledExactlyOnceWith("First");
  });

  it("breaks a view that draws nothing after the errors began", async () => {
    const { watch: errors, onBroken } = watch();
    errors.error("Device creation failed validation");
    await advance(NATIVE_GPU_ERROR_GRACE_MS - 1);
    expect(onBroken).not.toHaveBeenCalled();
    await advance(1);
    expect(onBroken).toHaveBeenCalledExactlyOnceWith("Device creation failed validation");
  });

  it("waits out a hidden page, which draws nothing, and judges again once it is shown", async () => {
    const { watch: errors, onBroken, hidden } = watch();
    hidden.value = true;
    errors.error("The last frame before the page was hidden");
    await advance(NATIVE_GPU_ERROR_GRACE_MS * 5);
    expect(onBroken).not.toHaveBeenCalled();
    hidden.value = false;
    // Shown again: the asked-for frame draws and gets through.
    errors.drawn(done);
    await advance(NATIVE_GPU_ERROR_GRACE_MS * 2);
    expect(onBroken).not.toHaveBeenCalled();
  });

  it("still breaks a view that stays broken once the page is shown", async () => {
    const { watch: errors, onBroken, hidden } = watch();
    hidden.value = true;
    errors.error("Persistent");
    await advance(NATIVE_GPU_ERROR_GRACE_MS * 2);
    hidden.value = false;
    await advance(NATIVE_GPU_ERROR_GRACE_MS);
    expect(onBroken).toHaveBeenCalledExactlyOnceWith("Persistent");
  });

  it("lets a frame drawn just before the grace ends prove itself, and breaks on its error", async () => {
    const { watch: errors, onBroken } = watch();
    errors.error("First");
    await advance(NATIVE_GPU_ERROR_GRACE_MS - 10);
    errors.drawn(done);
    await advance(20);
    expect(onBroken).not.toHaveBeenCalled();
    errors.error("Second");
    expect(onBroken).toHaveBeenCalledExactlyOnceWith("Second");
  });

  it("forgets an episode once a frame has drawn without a further error", async () => {
    const { watch: errors, onBroken } = watch();
    errors.error("Early");
    errors.drawn(done);
    await advance(NATIVE_GPU_HEALTHY_FRAME_MS);
    // A second, unrelated error starts its own grace period.
    await advance(NATIVE_GPU_ERROR_GRACE_MS - 500);
    errors.error("Later");
    await advance(NATIVE_GPU_ERROR_GRACE_MS - 1);
    expect(onBroken).not.toHaveBeenCalled();
  });

  it("starts over for a new renderer and is silent after dispose", async () => {
    const { watch: errors, onBroken } = watch();
    errors.error("Old renderer");
    const late = frameWork();
    errors.drawn(late.start);
    errors.reset();
    late.complete();
    await advance(NATIVE_GPU_ERROR_GRACE_MS);
    expect(onBroken).not.toHaveBeenCalled();
    errors.error("New renderer");
    errors.dispose();
    await advance(NATIVE_GPU_ERROR_GRACE_MS);
    expect(onBroken).not.toHaveBeenCalled();
  });
});
