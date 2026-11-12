import { describe, expect, it } from "vitest";
import { heldLayoutChange, leftBehindWords, restoreReceipt, type RestoreReceiptInput } from "../editor-save-status.js";

// ---------------------------------------------------------------------------
// What the planner says when work outlives the page or the layout it was made
// in (QoL D-01, D-X3): the restore receipt, the note left when another layout
// opens before the last changes arrived, and what holds a switch when the
// changes could be neither saved nor kept. Plain words; times in the venue's
// zone; "kept on this device" only when the device holds the work.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-27T21:43:00Z");

const restoring: RestoreReceiptInput = {
  restored: { changes: 3, editedAt: new Date("2026-10-27T21:41:00Z") },
  isSaving: false,
  isDirty: true,
  isOnline: true,
  keptOnDevice: true,
  lastSavedAt: new Date("2026-10-26T18:00:00Z"),
  now: NOW,
};

describe("the restore receipt", () => {
  it("says how many changes came back, when they were made, and that they are saving", () => {
    expect(restoreReceipt(restoring)).toEqual({
      lead: "Restored 3 changes you made at 21:41 on this device",
      status: "Saving",
      working: true,
    });
    expect(restoreReceipt({ ...restoring, isSaving: true, isDirty: true })).toMatchObject({ status: "Saving", working: true });
  });

  it("then says when they were saved", () => {
    expect(restoreReceipt({ ...restoring, isDirty: false, lastSavedAt: new Date("2026-10-27T21:42:00Z") })).toEqual({
      lead: "Restored 3 changes you made at 21:41 on this device",
      status: "Saved 21:42",
      working: false,
    });
  });

  it("counts one change as one", () => {
    expect(restoreReceipt({ ...restoring, restored: { changes: 1, editedAt: restoring.restored.editedAt } }).lead)
      .toBe("Restored 1 change you made at 21:41 on this device");
  });

  it("names the day when the changes were not made today, in the venue's zone", () => {
    expect(restoreReceipt({ ...restoring, restored: { changes: 2, editedAt: new Date("2026-10-26T21:41:00Z") } }).lead)
      .toBe("Restored 2 changes you made yesterday at 21:41 on this device");
    expect(restoreReceipt({ ...restoring, restored: { changes: 2, editedAt: new Date("2026-10-24T20:41:00Z") } }).lead)
      .toBe("Restored 2 changes you made on Sat 24 Oct at 21:41 on this device");
    // 23:30 in London on the 26th is still the 26th there, though the 27th in some zones.
    expect(restoreReceipt({ ...restoring, restored: { changes: 2, editedAt: new Date("2026-10-26T23:30:00Z") }, now: new Date("2026-10-27T00:10:00Z") }).lead)
      .toBe("Restored 2 changes you made yesterday at 23:30 on this device");
  });

  it("says where the work waits while offline", () => {
    expect(restoreReceipt({ ...restoring, isOnline: false })).toMatchObject({ status: "Offline · kept on this device", working: false });
    expect(restoreReceipt({ ...restoring, isOnline: false, keptOnDevice: false })).toMatchObject({ status: "Offline · kept in this tab" });
  });
});

describe("the note left by another layout opening", () => {
  it("says the changes are kept here and save when that layout opens again", () => {
    expect(leftBehindWords({ roomName: "Grand Hall", kept: true, savesOnReturn: true }))
      .toBe("Your changes to the Grand Hall layout are kept on this device and save when you open it again.");
  });

  it("names the room without a doubled article, and copes without one", () => {
    expect(leftBehindWords({ roomName: "The Saloon", kept: true, savesOnReturn: true }))
      .toBe("Your changes to the Saloon layout are kept on this device and save when you open it again.");
    expect(leftBehindWords({ roomName: null, kept: true, savesOnReturn: true }))
      .toBe("Your changes to that layout are kept on this device and save when you open it again.");
  });

  it("promises no save it cannot make", () => {
    expect(leftBehindWords({ roomName: "Grand Hall", kept: true, savesOnReturn: false }))
      .toBe("Your changes to the Grand Hall layout are kept on this device.");
    expect(leftBehindWords({ roomName: "Grand Hall", kept: false, savesOnReturn: false }))
      .toBe("Your changes to the Grand Hall layout did not reach Venviewer, and this browser could not keep them.");
  });
});

describe("a switch held for changes that are neither saved nor kept", () => {
  it("says why, and offers to try again or to go without them", () => {
    expect(heldLayoutChange("the Saloon")).toEqual({
      heading: "Your changes to this layout have not reached Venviewer yet.",
      body: "This browser cannot keep them on this device, so the Saloon waits until they are saved.",
      actions: [{ id: "try-again", label: "Try again" }, { id: "leave-anyway", label: "Open the Saloon without them" }],
    });
  });
});
