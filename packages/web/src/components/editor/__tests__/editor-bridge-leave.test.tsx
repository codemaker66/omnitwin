import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useAuthStore, type AuthUser } from "../../../stores/auth-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import {
  EditorBridge,
  __resetEditorBridgeMountCountForTests,
  scheduleAutoSave,
  watchPlannerPageLeave,
} from "../EditorBridge.js";

// ---------------------------------------------------------------------------
// Leaving the planner (QoL D-01, release audit editor-save-2). Edits wait 3 s
// for the autosave; on master nothing sent them when the tab was hidden, the
// page closed or the planner's route unmounted, so the last few seconds of
// work were lost (or, for a guest, silently restored later). The planner now
// sends what is unsaved the moment the page goes out of sight, again as it
// closes, and when its route unmounts; and it asks the browser to hold the
// page only when the unsaved work is not kept on this device.
// ---------------------------------------------------------------------------

const ME: AuthUser = { id: "user-fiona", email: "planner@example.test", role: "planner", platformRole: "none", venueId: null, name: "Fiona" };

let visibility: DocumentVisibilityState = "visible";

function setVisibility(next: DocumentVisibilityState): void {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

type SaveToServer = ReturnType<typeof useEditorStore.getState>["saveToServer"];

function dirtyLayout(saveToServer: SaveToServer, patch: Partial<ReturnType<typeof useEditorStore.getState>> = {}): void {
  useEditorStore.setState({
    configId: "cfg-leave",
    configRevision: 1,
    isDirty: true,
    isSaving: false,
    isOnline: true,
    saveConflict: null,
    saveToServer,
    ...patch,
  });
}

/** beforeunload as the browser sends it: cancelable, with returnValue. */
function unload(): Event {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  useAuthStore.getState().setUser(ME);
  __resetEditorBridgeMountCountForTests();
});

afterEach(() => {
  cleanup();
  useEditorStore.getState().reset();
  useAuthStore.getState().setUser(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the page goes out of sight", () => {
  it("sends unsaved work at once, exactly once, as a request that outlives the page", async () => {
    const saveToServer = vi.fn(() => Promise.resolve(true));
    dirtyLayout(saveToServer);
    const stop = watchPlannerPageLeave();
    try {
      scheduleAutoSave(true);
      setVisibility("hidden");
      await vi.advanceTimersByTimeAsync(0);
      expect(saveToServer).toHaveBeenCalledTimes(1);
      expect(saveToServer).toHaveBeenCalledWith(true, { keepalive: true });

      // The autosave it replaced does not send it a second time.
      useEditorStore.setState({ isDirty: false });
      await vi.advanceTimersByTimeAsync(5000);
      expect(saveToServer).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("does not send it again as the page then closes", async () => {
    const saveToServer = vi.fn(() => {
      useEditorStore.setState({ isDirty: false });
      return Promise.resolve(true);
    });
    dirtyLayout(saveToServer);
    const stop = watchPlannerPageLeave();
    try {
      setVisibility("hidden");
      window.dispatchEvent(new Event("pagehide"));
      await vi.advanceTimersByTimeAsync(0);
      expect(saveToServer).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("sends nothing for a saved layout, on coming back into sight, or offline", async () => {
    const saveToServer = vi.fn(() => Promise.resolve(true));
    const stop = watchPlannerPageLeave();
    try {
      dirtyLayout(saveToServer, { isDirty: false });
      setVisibility("hidden");
      dirtyLayout(saveToServer);
      setVisibility("visible");
      dirtyLayout(saveToServer, { isOnline: false });
      setVisibility("hidden");
      await vi.advanceTimersByTimeAsync(5000);
      expect(saveToServer).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});

describe("the page closes", () => {
  it("sends unsaved work as it goes, when nothing sent it as the page hid", async () => {
    const saveToServer = vi.fn(() => Promise.resolve(true));
    dirtyLayout(saveToServer);
    const stop = watchPlannerPageLeave();
    try {
      window.dispatchEvent(new Event("pagehide"));
      await vi.advanceTimersByTimeAsync(0);
      expect(saveToServer).toHaveBeenCalledWith(true, { keepalive: true });
    } finally {
      stop();
    }
  });

  it("asks the browser to hold the page only for unsaved work this device does not keep", () => {
    const saveToServer = vi.fn(() => Promise.resolve(true));
    const stop = watchPlannerPageLeave();
    try {
      dirtyLayout(saveToServer, { keptOnDevice: false });
      expect(unload().defaultPrevented).toBe(true);

      dirtyLayout(saveToServer, { keptOnDevice: true });
      expect(unload().defaultPrevented).toBe(false);

      dirtyLayout(saveToServer, { isDirty: false, keptOnDevice: false });
      expect(unload().defaultPrevented).toBe(false);

      dirtyLayout(saveToServer, { configId: null, keptOnDevice: false });
      expect(unload().defaultPrevented).toBe(false);
    } finally {
      stop();
    }
  });

  it("stops listening when the planner goes", () => {
    const saveToServer = vi.fn(() => Promise.resolve(true));
    dirtyLayout(saveToServer, { keptOnDevice: false });
    watchPlannerPageLeave()();
    expect(unload().defaultPrevented).toBe(false);
  });
});

describe("the planner's route unmounts", () => {
  it("sends the unsaved work instead of dropping the waiting autosave", async () => {
    const saveToServer = vi.fn(() => Promise.resolve(true));
    const view = render(<EditorBridge />);
    dirtyLayout(saveToServer);
    scheduleAutoSave(true);
    view.unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(saveToServer).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(saveToServer).toHaveBeenCalledTimes(1);
  });

  it("listens for the page leaving while it is mounted", async () => {
    const saveToServer = vi.fn(() => Promise.resolve(true));
    const view = render(<EditorBridge />);
    dirtyLayout(saveToServer);
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(0);
    expect(saveToServer).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
