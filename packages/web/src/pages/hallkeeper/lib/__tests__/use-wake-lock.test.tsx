import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useWakeLock, type WakeLockSentinelLike, type WakeLockSurface } from "../use-wake-lock.js";

// The wall never sleeps (goal 19 S8 item 14): the Screen Wake Lock is held
// while the wall register is on screen, asked for again when the tab comes
// back, released when the wall is left, and absent without fuss where the
// browser has no such thing.

function fakeSurface(outcome: "grant" | "refuse" = "grant"): { readonly surface: WakeLockSurface; readonly sentinels: WakeLockSentinelLike[]; readonly requests: number[] } {
  const sentinels: WakeLockSentinelLike[] = [];
  const requests: number[] = [];
  const surface: WakeLockSurface = {
    request: (type) => {
      requests.push(type === "screen" ? 1 : 0);
      if (outcome === "refuse") return Promise.reject(new Error("NotAllowedError"));
      let released = false;
      const sentinel: WakeLockSentinelLike = {
        get released() { return released; },
        release: () => { released = true; return Promise.resolve(); },
      };
      sentinels.push(sentinel);
      return Promise.resolve(sentinel);
    },
  };
  return { surface, sentinels, requests };
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  cleanup();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

describe("useWakeLock", () => {
  it("requests the screen lock when active and releases it when not", async () => {
    const fake = fakeSurface();
    const hook = renderHook(({ active }: { active: boolean }) => { useWakeLock(active, fake.surface); }, { initialProps: { active: true } });
    await act(async () => { await Promise.resolve(); });
    expect(fake.requests).toEqual([1]);
    expect(fake.sentinels[0]?.released).toBe(false);

    hook.rerender({ active: false });
    await act(async () => { await Promise.resolve(); });
    expect(fake.sentinels[0]?.released).toBe(true);
    expect(fake.requests).toHaveLength(1);
  });

  it("asks again when the tab is shown after being hidden", async () => {
    const fake = fakeSurface();
    renderHook(() => { useWakeLock(true, fake.surface); });
    await act(async () => { await Promise.resolve(); });
    // The system drops the lock when the page is hidden; the sentinel reads released.
    await act(async () => { await fake.sentinels[0]?.release(); });
    await act(async () => { setVisibility("hidden"); await Promise.resolve(); });
    expect(fake.requests).toHaveLength(1);
    await act(async () => { setVisibility("visible"); await Promise.resolve(); });
    expect(fake.requests).toHaveLength(2);
  });

  it("a browser without the API does nothing and throws nothing; a refusal is asked once and dropped", async () => {
    expect(() => renderHook(() => { useWakeLock(true, null); })).not.toThrow();
    const refusing = fakeSurface("refuse");
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    renderHook(() => { useWakeLock(true, refusing.surface); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    process.off("unhandledRejection", unhandled);
    expect(refusing.requests).toEqual([1]);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
