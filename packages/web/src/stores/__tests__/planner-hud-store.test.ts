import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HUD_SENT_REMEMBERED, HUD_SENT_STORAGE_KEY, usePlannerHudStore } from "../planner-hud-store.js";

// ---------------------------------------------------------------------------
// Which layouts this device has sent (review of 189d0c52, HB7).
//
// "Sent" was kept only while the page was open. Opened again, the screen said
// "Send to the events team" for a plan that had already gone, and invited a
// second enquiry. The ids are now kept on the device: a short list, the newest
// kept, read back when the page opens.
// ---------------------------------------------------------------------------

function remembered(): unknown {
  return JSON.parse(window.localStorage.getItem(HUD_SENT_STORAGE_KEY) ?? "null");
}

/** The store as a page opened afresh makes it: its module evaluated again, reading the device. */
async function pageOpenedAgain(): Promise<typeof usePlannerHudStore> {
  vi.resetModules();
  return (await import("../planner-hud-store.js")).usePlannerHudStore;
}

beforeEach(() => {
  window.localStorage.removeItem(HUD_SENT_STORAGE_KEY);
  usePlannerHudStore.setState({ sheet: null, sentLayoutIds: [] });
});

afterEach(() => {
  window.localStorage.removeItem(HUD_SENT_STORAGE_KEY);
  usePlannerHudStore.setState({ sheet: null, sentLayoutIds: [] });
});

describe("the layouts this device has sent", () => {
  it("are none until one is sent", () => {
    expect(usePlannerHudStore.getState().sentLayoutIds).toEqual([]);
    expect(remembered()).toBeNull();
  });

  it("are kept on the device as each is sent, oldest first", () => {
    usePlannerHudStore.getState().markSent("layout-a");
    usePlannerHudStore.getState().markSent("layout-b");
    expect(usePlannerHudStore.getState().sentLayoutIds).toEqual(["layout-a", "layout-b"]);
    expect(remembered()).toEqual(["layout-a", "layout-b"]);
  });

  it("are still known when the page is opened again", async () => {
    usePlannerHudStore.getState().markSent("layout-a");
    const reopened = await pageOpenedAgain();
    expect(reopened).not.toBe(usePlannerHudStore);
    expect(reopened.getState().sentLayoutIds).toEqual(["layout-a"]);
    // And a layout that never went is not called sent because another did.
    expect(reopened.getState().sentLayoutIds.includes("layout-b")).toBe(false);
  });

  it("list a layout once, however often it is sent, as the newest", () => {
    for (const id of ["layout-a", "layout-b", "layout-a"]) usePlannerHudStore.getState().markSent(id);
    expect(usePlannerHudStore.getState().sentLayoutIds).toEqual(["layout-b", "layout-a"]);
    expect(remembered()).toEqual(["layout-b", "layout-a"]);
  });

  it("keep the newest, and let the oldest go, past the number remembered", () => {
    for (let index = 0; index < HUD_SENT_REMEMBERED + 3; index += 1) usePlannerHudStore.getState().markSent(`layout-${String(index)}`);
    const sent = usePlannerHudStore.getState().sentLayoutIds;
    expect(sent).toHaveLength(HUD_SENT_REMEMBERED);
    expect(sent[0]).toBe("layout-3");
    expect(sent[sent.length - 1]).toBe(`layout-${String(HUD_SENT_REMEMBERED + 2)}`);
    expect(remembered()).toEqual(sent);
  });

  it("keep what another tab has sent meanwhile", () => {
    usePlannerHudStore.getState().markSent("layout-a");
    // Another tab of the same browser sends its own layout: this tab's list has not heard of it.
    window.localStorage.setItem(HUD_SENT_STORAGE_KEY, JSON.stringify(["layout-a", "layout-other-tab"]));
    usePlannerHudStore.getState().markSent("layout-b");
    expect(remembered()).toEqual(["layout-a", "layout-other-tab", "layout-b"]);
    expect(usePlannerHudStore.getState().sentLayoutIds).toEqual(["layout-a", "layout-other-tab", "layout-b"]);
  });

  it("take nothing without an id", () => {
    usePlannerHudStore.getState().markSent("");
    expect(usePlannerHudStore.getState().sentLayoutIds).toEqual([]);
    expect(remembered()).toBeNull();
  });

  it("read as none where what the device holds is not a list of ids", async () => {
    for (const held of ["not json", "{\"a\":1}", "\"layout-a\"", "null"]) {
      window.localStorage.setItem(HUD_SENT_STORAGE_KEY, held);
      expect((await pageOpenedAgain()).getState().sentLayoutIds, held).toEqual([]);
    }
    // A list with other things in it keeps its ids and drops the rest.
    window.localStorage.setItem(HUD_SENT_STORAGE_KEY, JSON.stringify(["layout-a", 7, null, "", "layout-b"]));
    expect((await pageOpenedAgain()).getState().sentLayoutIds).toEqual(["layout-a", "layout-b"]);
  });

  it("still work for the page that is open where the device will not keep them", async () => {
    // The device holds one from before. With storage refused, the page can neither read it nor add to it.
    window.localStorage.setItem(HUD_SENT_STORAGE_KEY, JSON.stringify(["layout-earlier"]));
    // The whole object is stood in for, as chrome-presence-store.test.ts does: a spy on the page's own storage
    // object outlives restoreAllMocks here.
    const storage = window.localStorage;
    const refuse = (): never => { throw new Error("blocked"); };
    Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: refuse, setItem: refuse, removeItem: refuse } });
    try {
      const store = await pageOpenedAgain();
      expect(store.getState().sentLayoutIds).toEqual([]);
      store.getState().markSent("layout-a");
      expect(store.getState().sentLayoutIds).toEqual(["layout-a"]);
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
    }
    // Refused was refused: what the device held is as it was.
    expect(remembered()).toEqual(["layout-earlier"]);
  });
});
