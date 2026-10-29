import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configApi from "../../../api/configurations.js";
import type { PlacedObject } from "../../../api/configurations.js";
import { useAuthStore, type AuthUser } from "../../../stores/auth-store.js";
import { placedObjectToEditor, useEditorStore } from "../../../stores/editor-store.js";
import { EditorBridge, __resetEditorBridgeMountCountForTests } from "../EditorBridge.js";

// ---------------------------------------------------------------------------
// Work kept on this device restores as the layout loads, and the load asks for
// a save. The planner page shows its loading screen during the load, so the
// bridge that schedules saves mounts only afterwards: in production (no
// StrictMode remount to flush it) the request went nowhere, the restored work
// never left this device, and the receipt said "Saving" over nothing in
// flight. Found by the adversarial review of the D-01 fix; the request now
// waits for the bridge.
// ---------------------------------------------------------------------------

vi.mock("../../../api/configurations.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/configurations.js")>();
  return { ...actual, getConfig: vi.fn(), getPublicConfig: vi.fn(), authBatchSave: vi.fn(), publicBatchSave: vi.fn() };
});
vi.mock("../../../api/spaces.js", () => ({ getSpace: vi.fn(async () => Promise.reject(new Error("no space in tests"))) }));
vi.mock("../../../api/action-log.js", () => ({ postActionBatch: vi.fn(() => Promise.resolve({ accepted: 0, duplicates: 0 })) }));

const LAYOUT = "00000000-0000-4000-8000-00000000c0f1";
const SPACE = "00000000-0000-4000-8000-000000000051";
const VENUE = "00000000-0000-4000-8000-0000000000a1";
const ASSET = "9a6c1f3e-0000-4000-8000-0000000000aa";
const T1 = "00000000-0000-4000-8000-000000000001";
const ME: AuthUser = { id: "user-fiona", email: "planner@example.test", role: "planner", platformRole: "none", venueId: VENUE, name: "Fiona" };

function wire(positionX: number): PlacedObject {
  return { id: T1, configurationId: LAYOUT, assetDefinitionId: ASSET, positionX: positionX.toFixed(3), positionY: "0.000", positionZ: "1.000",
    rotationX: "0.00000", rotationY: "0.00000", rotationZ: "0.00000", scale: "1.000", sortOrder: 0, metadata: null };
}

function layout(revision: number, positionX: number): configApi.Configuration {
  return { id: LAYOUT, spaceId: SPACE, venueId: VENUE, userId: ME.id, name: "Wedding breakfast", isPublicPreview: false,
    revision, objects: [wire(positionX)], updatedAt: "2026-10-27T20:00:00.000Z" };
}

/** The person moved a table; the tab closed before the save. A new page opens. */
function keepWorkThenClose(): void {
  const base = [placedObjectToEditor(wire(5))];
  useEditorStore.setState({ configId: LAYOUT, spaceId: SPACE, venueId: VENUE, configRevision: 2, isPublicPreview: false,
    objects: base, baseObjects: base, isDirty: false });
  useEditorStore.getState().updateObject(T1, { positionX: 7.25 });
  expect(useEditorStore.getState().keptOnDevice).toBe(true);
  useEditorStore.getState().reset();
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useAuthStore.getState().setUser(ME);
  useEditorStore.getState().reset();
  __resetEditorBridgeMountCountForTests();
  vi.mocked(configApi.getConfig).mockReset();
  vi.mocked(configApi.authBatchSave).mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useEditorStore.getState().reset();
  useAuthStore.getState().setUser(null);
});

describe("work restored before the planner shows", () => {
  for (const strict of [false, true]) {
    it(`is sent once the bridge mounts${strict ? " (StrictMode)" : ""}`, async () => {
      keepWorkThenClose();
      vi.mocked(configApi.getConfig).mockResolvedValue(layout(2, 5));
      vi.mocked(configApi.authBatchSave).mockResolvedValue({ objects: [wire(7.25)], revision: 3 });

      // The page shows its loading screen while it loads: no bridge yet.
      await useEditorStore.getState().loadConfiguration(LAYOUT, true);
      expect(useEditorStore.getState()).toMatchObject({ isDirty: true, restoredFromDevice: { changes: 1 } });

      render(strict ? <StrictMode><EditorBridge /></StrictMode> : <EditorBridge />);
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });

      expect(configApi.authBatchSave).toHaveBeenCalledTimes(1);
      expect(useEditorStore.getState()).toMatchObject({ isDirty: false, configRevision: 3 });
    });
  }

  it("sends nothing when the restored work meets a conflict: the person chooses first", async () => {
    keepWorkThenClose();
    // Someone else saved revision 3 meanwhile.
    vi.mocked(configApi.getConfig).mockResolvedValue(layout(3, 9));
    await useEditorStore.getState().loadConfiguration(LAYOUT, true);
    expect(useEditorStore.getState().saveConflict).not.toBeNull();

    render(<EditorBridge />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
  });
});
