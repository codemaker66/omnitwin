import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";

// The daily scheduled cleanup (.github/workflows/cleanup.yml runs
// `pnpm --filter @omnitwin/api cleanup`). The privacy policy and the planner
// promise that a guest's allergy note leaves a layout and its event sheets 30
// days after the event, and the words beside the "remember" box promise that
// a remembered note unused for the agreed period is removed. Both passes must
// run on the schedule, report counts only, and fail the job (rather than pass
// silently) when they cannot run. The job's log is public with the repository.
// The enquiry funnel's engagement events (migration 0100) are kept no longer
// than the privacy page keeps an enquiry, so their retention pass runs here too.

const { previewMock, orphanMock, lapsedMock, rememberedMock, engagementMock } = vi.hoisted(() => ({
  previewMock: vi.fn(),
  orphanMock: vi.fn(),
  lapsedMock: vi.fn(),
  rememberedMock: vi.fn(),
  engagementMock: vi.fn(),
}));

vi.mock("../services/cleanup.js", () => ({
  cleanupPreviewConfigurations: previewMock,
  cleanupOrphanedFiles: orphanMock,
}));
vi.mock("../services/dietary-memory.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/dietary-memory.js")>(),
  removeUnusedRememberedNotes: rememberedMock,
}));
vi.mock("../services/dietary-retention.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/dietary-retention.js")>(),
  removeLapsedDietaryNotes: lapsedMock,
}));
vi.mock("../services/enquiry-funnel.js", () => ({
  removeExpiredEngagementEvents: engagementMock,
}));

const { runScheduledCleanup } = await import("../scripts/run-cleanup.js");
const { DietaryMemoryWriteError } = await import("../services/dietary-memory.js");
const { DietaryRetentionError } = await import("../services/dietary-retention.js");

const db = {} as Database;

beforeEach(() => {
  vi.clearAllMocks();
  previewMock.mockResolvedValue(2);
  orphanMock.mockResolvedValue(1);
  lapsedMock.mockResolvedValue({ dryRun: false, layouts: 4, sheets: 5, actionLog: 6 });
  rememberedMock.mockResolvedValue({ dryRun: false, removed: 3 });
  engagementMock.mockResolvedValue(4);
});

describe("runScheduledCleanup", () => {
  it("does not run on import: only the script's own entry calls main", () => {
    expect(previewMock).not.toHaveBeenCalled();
    expect(lapsedMock).not.toHaveBeenCalled();
    expect(rememberedMock).not.toHaveBeenCalled();
  });

  it("runs both allergy-note passes for real, after the existing passes, and logs counts only", async () => {
    const lines: string[] = [];
    const result = await runScheduledCleanup(db, (line) => { lines.push(line); });

    expect(result).toEqual({
      deletedConfigs: 2,
      deletedFiles: 1,
      lapsedNoteLayouts: 4,
      lapsedNoteSheets: 5,
      loggedNotesRemoved: 6,
      rememberedNotesRemoved: 3,
      engagementEventsRemoved: 4,
    });
    // Called with the database alone: no dry run, so the notes really go.
    expect(lapsedMock).toHaveBeenCalledTimes(1);
    expect(lapsedMock).toHaveBeenCalledWith(db);
    expect(rememberedMock).toHaveBeenCalledTimes(1);
    expect(rememberedMock).toHaveBeenCalledWith(db);
    const order = (mock: typeof previewMock): number => mock.mock.invocationCallOrder[0] ?? 0;
    expect(order(orphanMock)).toBeLessThan(order(lapsedMock));
    expect(order(lapsedMock)).toBeLessThan(order(rememberedMock));
    expect(lines).toEqual([
      "[cleanup] Deleted 2 stale preview configuration(s)",
      "[cleanup] Deleted 1 orphaned file(s)",
      "[cleanup] Removed the allergy note from 4 layout(s) and 5 event sheet(s) past their retention, and from 6 logged change(s)",
      "[cleanup] Removed 3 remembered allergy note(s) unused for the agreed period",
      "[cleanup] Removed 4 engagement event(s) past their retention period",
    ]);
  });

  it("runs the engagement retention pass once, last, and fails the job when it cannot run", async () => {
    await runScheduledCleanup(db, () => undefined);
    expect(engagementMock).toHaveBeenCalledTimes(1);
    expect(engagementMock).toHaveBeenCalledWith(db);
    expect(rememberedMock.mock.invocationCallOrder[0]).toBeLessThan(engagementMock.mock.invocationCallOrder[0] ?? 0);

    const failure = new Error("connection terminated");
    engagementMock.mockRejectedValue(failure);
    await expect(runScheduledCleanup(db, () => undefined)).rejects.toBe(failure);
  });

  it("fails the job when the retention pass fails, with nothing from the note in the error", async () => {
    const failure = new DietaryRetentionError(
      Object.assign(new Error("Failing row contains (Two guests: sesame)"), { code: "23514" }),
    );
    lapsedMock.mockRejectedValue(failure);
    const lines: string[] = [];

    await expect(runScheduledCleanup(db, (line) => { lines.push(line); })).rejects.toBe(failure);
    expect(failure.message).toBe("Allergy note retention pass failed (SQLSTATE 23514)");
    expect(lines.join("\n")).not.toContain("sesame");
  });

  it("fails the job when the remembered-note pass fails, with nothing from the note in the error", async () => {
    const failure = new DietaryMemoryWriteError(
      Object.assign(new Error("Failing row contains (Two guests: sesame)"), { code: "23514" }),
    );
    rememberedMock.mockRejectedValue(failure);
    const lines: string[] = [];

    await expect(runScheduledCleanup(db, (line) => { lines.push(line); })).rejects.toBe(failure);
    expect(failure.message).toBe("Remembered dietary note write failed (SQLSTATE 23514)");
    expect(lines.join("\n")).not.toContain("sesame");
  });
});
