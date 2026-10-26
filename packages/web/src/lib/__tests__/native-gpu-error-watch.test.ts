import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NATIVE_GPU_ERROR_GRACE_MS, NATIVE_GPU_ERROR_REPORT_LIMIT, NATIVE_GPU_HEALTHY_FRAME_MS, createNativeGpuErrorWatch,
} from "../native-gpu-error-watch.js";

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }); });
afterEach(() => { vi.useRealTimers(); });

function watch() {
  const onBroken = vi.fn<(message: string) => void>();
  const redraw = vi.fn();
  return { onBroken, redraw, watch: createNativeGpuErrorWatch({ onBroken, redraw }) };
}

describe("createNativeGpuErrorWatch", () => {
  it("keeps a view that draws cleanly after one error, and asks for that frame", () => {
    const { watch: errors, onBroken, redraw } = watch();
    expect(errors.error("Invalid texture view")).toBe(true);
    expect(redraw).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(16);
    errors.drawn();
    vi.advanceTimersByTime(NATIVE_GPU_ERROR_GRACE_MS * 2);
    expect(onBroken).not.toHaveBeenCalled();
  });

  it("reports each distinct message once, across episodes", () => {
    const { watch: errors } = watch();
    expect(errors.error("Invalid texture view")).toBe(true);
    expect(errors.error("Invalid texture view")).toBe(false);
    expect(errors.error("Out of memory")).toBe(true);
    errors.drawn();
    vi.advanceTimersByTime(NATIVE_GPU_HEALTHY_FRAME_MS);
    expect(errors.error("Invalid texture view")).toBe(false);
  });

  it("stops reporting after a few distinct messages, which one broken scene can produce", () => {
    const { watch: errors } = watch();
    const reported = Array.from({ length: NATIVE_GPU_ERROR_REPORT_LIMIT + 2 }, (_, index) => errors.error(`Fault ${String(index)}`));
    expect(reported.filter(Boolean)).toHaveLength(NATIVE_GPU_ERROR_REPORT_LIMIT);
  });

  it("breaks a view whose every frame keeps failing for the grace period", () => {
    const { watch: errors, onBroken } = watch();
    for (let at = 0; at < NATIVE_GPU_ERROR_GRACE_MS; at += 16) {
      errors.error("Invalid bind group");
      vi.advanceTimersByTime(8);
      errors.drawn();
      vi.advanceTimersByTime(8);
    }
    expect(onBroken).toHaveBeenCalledExactlyOnceWith("Invalid bind group");
  });

  it("breaks a view that draws nothing after the errors began", () => {
    const { watch: errors, onBroken } = watch();
    errors.error("Device creation failed validation");
    vi.advanceTimersByTime(NATIVE_GPU_ERROR_GRACE_MS - 1);
    expect(onBroken).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onBroken).toHaveBeenCalledExactlyOnceWith("Device creation failed validation");
  });

  it("lets a frame drawn just before the grace ends prove itself, and breaks on its error", () => {
    const { watch: errors, onBroken } = watch();
    errors.error("First");
    vi.advanceTimersByTime(NATIVE_GPU_ERROR_GRACE_MS - 10);
    errors.drawn();
    vi.advanceTimersByTime(20);
    expect(onBroken).not.toHaveBeenCalled();
    errors.error("Second");
    expect(onBroken).toHaveBeenCalledExactlyOnceWith("Second");
  });

  it("forgets an episode once a frame has drawn without a further error", () => {
    const { watch: errors, onBroken } = watch();
    errors.error("Early");
    errors.drawn();
    vi.advanceTimersByTime(NATIVE_GPU_HEALTHY_FRAME_MS);
    // A second, unrelated error starts its own grace period.
    vi.advanceTimersByTime(NATIVE_GPU_ERROR_GRACE_MS - 500);
    errors.error("Later");
    vi.advanceTimersByTime(NATIVE_GPU_ERROR_GRACE_MS - 1);
    expect(onBroken).not.toHaveBeenCalled();
  });

  it("starts over for a new renderer and is silent after dispose", () => {
    const { watch: errors, onBroken } = watch();
    errors.error("Old renderer");
    errors.reset();
    vi.advanceTimersByTime(NATIVE_GPU_ERROR_GRACE_MS);
    expect(onBroken).not.toHaveBeenCalled();
    errors.error("New renderer");
    errors.dispose();
    vi.advanceTimersByTime(NATIVE_GPU_ERROR_GRACE_MS);
    expect(onBroken).not.toHaveBeenCalled();
  });
});
