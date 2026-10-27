import { afterEach, describe, expect, it, vi } from "vitest";

function setNavigatorOnline(value: boolean): void {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
}

async function freshModule(): Promise<typeof import("../online-status.js")> {
  vi.resetModules();
  return import("../online-status.js");
}

afterEach(() => {
  setNavigatorOnline(true);
  window.dispatchEvent(new Event("online"));
});

describe("online status", () => {
  it("follows the window's offline and online events", async () => {
    const { readOnlineStatus, subscribeOnlineStatus } = await freshModule();
    const seen: boolean[] = [];
    const stop = subscribeOnlineStatus((online) => { seen.push(online); });
    window.dispatchEvent(new Event("offline"));
    expect(readOnlineStatus()).toBe(false);
    window.dispatchEvent(new Event("online"));
    expect(readOnlineStatus()).toBe(true);
    stop();
    window.dispatchEvent(new Event("offline"));
    expect(seen).toEqual([false, true]);
  });

  it("tells a listener only of real changes", async () => {
    const { subscribeOnlineStatus } = await freshModule();
    const listener = vi.fn();
    const stop = subscribeOnlineStatus(listener);
    window.dispatchEvent(new Event("online"));
    expect(listener).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("offline"));
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("starts from what the browser says, before and when the first listener arrives", async () => {
    setNavigatorOnline(false);
    const { readOnlineStatus, subscribeOnlineStatus } = await freshModule();
    expect(readOnlineStatus()).toBe(false);
    const stop = subscribeOnlineStatus(() => undefined);
    expect(readOnlineStatus()).toBe(false);
    setNavigatorOnline(true);
    window.dispatchEvent(new Event("online"));
    expect(readOnlineStatus()).toBe(true);
    stop();
  });
});
