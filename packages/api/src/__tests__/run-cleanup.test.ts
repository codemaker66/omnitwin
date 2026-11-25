import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";

// The daily scheduled cleanup (.github/workflows/cleanup.yml runs
// `pnpm --filter @omnitwin/api cleanup`). The privacy policy and the planner
// promise that a guest's allergy note leaves a layout and its event sheets 30
// days after the event, and the words beside the "remember" box promise that
// a remembered note unused for the agreed period is removed. Both passes must
// run on the schedule, report counts only, and fail the job (rather than pass
// silently) when they cannot run. The job's log is public with the repository.
// The enquiry funnel's engagement events (migration 0100) are kept no longer
// than the privacy page keeps an enquiry, so their retention pass runs here too,
// and so does the field web vitals' (goal 07).

const { previewMock, orphanMock, lapsedMock, rememberedMock, peopleMock, engagementMock, vitalsMock } = vi.hoisted(() => ({
  peopleMock: vi.fn(),
  previewMock: vi.fn(),
  orphanMock: vi.fn(),
  lapsedMock: vi.fn(),
  rememberedMock: vi.fn(),
  engagementMock: vi.fn(),
  vitalsMock: vi.fn(),
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
vi.mock("../services/people-retention.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/people-retention.js")>(),
  eraseLapsedPeople: peopleMock,
}));
vi.mock("../services/enquiry-funnel.js", () => ({
  removeExpiredEngagementEvents: engagementMock,
}));
vi.mock("../services/web-vitals.js", () => ({
  removeExpiredWebVitalSamples: vitalsMock,
}));

const { describeFailure, runScheduledCleanup } = await import("../scripts/run-cleanup.js");
const { DietaryMemoryWriteError } = await import("../services/dietary-memory.js");
const { DietaryRetentionError } = await import("../services/dietary-retention.js");
const { PeopleRetentionError, peopleRetentionStartsOn } = await import("../services/people-retention.js");

/** The people pass's result, as eraseLapsedPeople returns it. */
function peopleResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dryRun: false, off: false, people: 1, keptForBooking: 2, inTouch: 0, enquiries: 3, failed: 0, failedStates: [],
    deferred: { people: 0, enquiries: 0 }, outOfTime: false, kept: [], ...overrides,
  };
}

const db = {} as Database;

// The 24-month switch unset here, whatever the developer's own environment says.
afterEach(() => { vi.unstubAllEnvs(); });
beforeEach(() => {
  vi.stubEnv("PEOPLE_RETENTION_STARTS_ON", "");
  vi.clearAllMocks();
  previewMock.mockResolvedValue(2);
  orphanMock.mockResolvedValue(1);
  lapsedMock.mockResolvedValue({ dryRun: false, layouts: 4, sheets: 5, actionLog: 6,
    pieceNotes: { layouts: 2, pieces: 7, revisions: 3, sheets: 1, actionLog: 4, opsTasks: 2 } });
  rememberedMock.mockResolvedValue({ dryRun: false, removed: 3 });
  peopleMock.mockResolvedValue(peopleResult());
  engagementMock.mockResolvedValue(4);
  vitalsMock.mockResolvedValue(6);
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
      lapsedPieceNoteLayouts: 2,
      rememberedNotesRemoved: 3,
      peopleErased: 1,
      peopleKeptForBooking: 2,
      enquiriesErased: 3,
      peopleDeferred: 0,
      peopleStepsFailed: 0,
      engagementEventsRemoved: 4,
      webVitalSamplesRemoved: 6,
    });
    // Called with the database alone: no dry run, so the notes really go.
    expect(lapsedMock).toHaveBeenCalledTimes(1);
    expect(lapsedMock).toHaveBeenCalledWith(db);
    expect(rememberedMock).toHaveBeenCalledTimes(1);
    expect(rememberedMock).toHaveBeenCalledWith(db);
    const order = (mock: typeof previewMock): number => mock.mock.invocationCallOrder[0] ?? 0;
    expect(order(orphanMock)).toBeLessThan(order(lapsedMock));
    expect(order(lapsedMock)).toBeLessThan(order(rememberedMock));
    // The 24-month pass runs for real too, before the engagement pass.
    expect(peopleMock).toHaveBeenCalledWith(db);
    expect(order(rememberedMock)).toBeLessThan(order(peopleMock));
    expect(order(peopleMock)).toBeLessThan(order(engagementMock));
    expect(lines).toEqual([
      "[cleanup] Deleted 2 stale preview configuration(s)",
      "[cleanup] Deleted 1 orphaned file(s)",
      "[cleanup] Removed the allergy note from 4 layout(s) and 5 event sheet(s) past their retention, and from 6 logged change(s)",
      "[cleanup] Removed the notes on single pieces from 2 layout(s) past their retention",
      "[cleanup] Removed 3 remembered allergy note(s) unused for the agreed period",
      "[cleanup] Erased 1 person(s) and 3 enquiry(ies) 24 months after the last contact; kept 2 person(s) for a booking; left 0 for the next night",
      "[cleanup] Removed 4 engagement event(s) past their retention period",
      "[cleanup] Removed 6 web vital sample(s) past their retention period",
    ]);
  });

  it("runs the engagement retention pass once, after the notes, and fails the job when it cannot run", async () => {
    await runScheduledCleanup(db, () => undefined);
    expect(engagementMock).toHaveBeenCalledTimes(1);
    expect(engagementMock).toHaveBeenCalledWith(db);
    expect(rememberedMock.mock.invocationCallOrder[0]).toBeLessThan(engagementMock.mock.invocationCallOrder[0] ?? 0);

    const failure = new Error("connection terminated");
    engagementMock.mockRejectedValue(failure);
    await expect(runScheduledCleanup(db, () => undefined)).rejects.toBe(failure);
  });

  it("runs the web vitals retention pass once, last, and fails the job when it cannot run", async () => {
    await runScheduledCleanup(db, () => undefined);
    expect(vitalsMock).toHaveBeenCalledTimes(1);
    expect(vitalsMock).toHaveBeenCalledWith(db);
    expect(engagementMock.mock.invocationCallOrder[0]).toBeLessThan(vitalsMock.mock.invocationCallOrder[0] ?? 0);

    const failure = new Error("connection terminated");
    vitalsMock.mockRejectedValue(failure);
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

  it("runs every later pass when one fails, then fails the job", async () => {
    const failure = new DietaryRetentionError(Object.assign(new Error("Failing row contains (sesame)"), { code: "57014" }));
    lapsedMock.mockRejectedValue(failure);
    const lines: string[] = [];

    await expect(runScheduledCleanup(db, (line) => { lines.push(line); })).rejects.toBe(failure);
    expect(rememberedMock).toHaveBeenCalledTimes(1);
    expect(peopleMock).toHaveBeenCalledTimes(1);
    expect(engagementMock).toHaveBeenCalledTimes(1);
    expect(lines).toContain("[cleanup] The allergy note retention pass failed; the passes after it still run");
  });

  it("keeps the people being erased out of the public log when the people pass fails", async () => {
    // Drizzle's own message quotes the query and its parameters: the very
    // addresses the pass was erasing.
    const driver = Object.assign(
      new Error("Failed query: delete from \"guest_leads\" where lower(\"email\") in ($1)\nparams: jane.smith@example.test"),
      { code: "40P01" },
    );
    const failure = new PeopleRetentionError(driver);
    peopleMock.mockRejectedValue(failure);
    const lines: string[] = [];

    await expect(runScheduledCleanup(db, (line) => { lines.push(line); })).rejects.toBe(failure);
    expect(failure.message).toBe("The 24-month people pass failed (SQLSTATE 40P01)");
    expect(lines.join("\n")).not.toContain("jane");
    expect(engagementMock).toHaveBeenCalledTimes(1);
    // What the script's last line prints: names and SQLSTATEs, never a message.
    expect(describeFailure(failure)).toBe("PeopleRetentionError (SQLSTATE 40P01)");
    expect(describeFailure(driver)).toBe("Error (SQLSTATE 40P01)");
    expect(describeFailure(new AggregateError([failure, new Error("params: jane.smith@example.test")])))
      .toBe("PeopleRetentionError (SQLSTATE 40P01); Error");
  });

  it("fails the job, after every pass, when people steps failed, logging counts and SQLSTATEs only", async () => {
    peopleMock.mockResolvedValue(peopleResult({ failed: 2, failedStates: ["40P01", "40P01"], deferred: { people: 3, enquiries: 1 } }));
    const lines: string[] = [];

    await expect(runScheduledCleanup(db, (line) => { lines.push(line); })).rejects.toThrow("2 people step(s) failed");
    expect(engagementMock).toHaveBeenCalledTimes(1);
    expect(lines).toContain(
      "[cleanup] Erased 1 person(s) and 3 enquiry(ies) 24 months after the last contact; kept 2 person(s) for a booking; left 4 for the next night",
    );
    expect(lines).toContain("[cleanup] 2 person or enquiry step(s) failed (SQLSTATE 40P01); the next night tries them again");
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

  it("runs every later pass when one fails, then fails the job with that failure", async () => {
    const failure = new DietaryRetentionError(
      Object.assign(new Error("Failing row contains (Two guests: sesame)"), { code: "23514" }),
    );
    lapsedMock.mockRejectedValue(failure);
    const lines: string[] = [];

    await expect(runScheduledCleanup(db, (line) => { lines.push(line); })).rejects.toBe(failure);
    // One broken pass holds back no other's retention promise: the 90-day
    // web vitals deletion, and every pass between, still ran.
    for (const later of [rememberedMock, engagementMock, vitalsMock]) expect(later).toHaveBeenCalledTimes(1);
    expect(lines).toContain("[cleanup] The allergy note retention pass failed; the passes after it still run");
    expect(lines).toContain("[cleanup] Removed 6 web vital sample(s) past their retention period");
    expect(lines.join("\n")).not.toContain("sesame");
  });

  it("names every failure when more than one pass fails", async () => {
    const first = new Error("connection terminated");
    const second = new Error("canceling statement due to statement timeout");
    previewMock.mockRejectedValue(first);
    engagementMock.mockRejectedValue(second);

    const outcome = await runScheduledCleanup(db, () => undefined).then(() => undefined, (error: unknown) => error);
    expect(outcome).toBeInstanceOf(AggregateError);
    expect((outcome as AggregateError).errors).toEqual([first, second]);
    expect(vitalsMock).toHaveBeenCalledTimes(1);
  });

  // The release lead's M2 (13 November 2026), as #247 prints it: the job's
  // last line is in a public log, and a database error's message quotes the
  // query's parameters.
  it("prints a failed job's errors by name and SQLSTATE only, never their messages", () => {
    const driver = Object.assign(
      new Error("Failed query: update \"configurations\" set \"dietary_note\" = null\nparams: Severe walnut allergy"),
      { code: "57014" },
    );
    const failure = new DietaryRetentionError(driver);
    expect(describeFailure(failure)).toBe("DietaryRetentionError (SQLSTATE 57014)");
    expect(describeFailure(driver)).toBe("Error (SQLSTATE 57014)");
    expect(describeFailure(new AggregateError([failure, new Error("params: jane.smith@example.test")])))
      .toBe("DietaryRetentionError (SQLSTATE 57014); Error");
    expect(describeFailure("a string")).toBe("string");
  });
});

describe("the 24-month pass's switch (Blake, 18 Nov 2026: off until a first day is named)", () => {
  it("reads a first day only as a real YYYY-MM-DD date; anything else keeps the pass off", () => {
    expect(peopleRetentionStartsOn(undefined)).toBeNull();
    expect(peopleRetentionStartsOn("")).toBeNull();
    expect(peopleRetentionStartsOn("soon")).toBeNull();
    expect(peopleRetentionStartsOn("2027-1-5")).toBeNull();
    expect(peopleRetentionStartsOn("2027-02-30")).toBeNull();
    expect(peopleRetentionStartsOn("2027-13-01")).toBeNull();
    expect(peopleRetentionStartsOn(" 2027-01-05 ")?.toISOString()).toBe("2027-01-05T00:00:00.000Z");
  });

  it("says the pass is off and counts nothing as erased or failed while it is", async () => {
    peopleMock.mockResolvedValue(peopleResult({ off: true, people: 0, keptForBooking: 0, enquiries: 0 }));
    const lines: string[] = [];
    const result = await runScheduledCleanup(db, (line) => { lines.push(line); });
    expect(lines).toContain(
      "[cleanup] The 24-month people pass is off (PEOPLE_RETENTION_STARTS_ON is unset); nothing was looked at or erased");
    expect(lines.some((line) => line.includes("24 months after the last contact"))).toBe(false);
    expect(result).toMatchObject({ peopleErased: 0, peopleKeptForBooking: 0, enquiriesErased: 0, peopleDeferred: 0, peopleStepsFailed: 0 });
  });
});
