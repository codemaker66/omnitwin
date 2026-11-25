import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { JobState, SelfTestResult, StuckJob, StuckWork as StuckWorkReading } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { StuckWork } from "../StuckWork.js";

const mocks = vi.hoisted(() => ({
  getStuckWork: vi.fn<(signal?: AbortSignal) => Promise<StuckWorkReading>>(),
  retryStuckJob: vi.fn<(id: string) => Promise<void>>(),
  closeStuckJob: vi.fn<(id: string, note: string) => Promise<void>>(),
  runSelfTest: vi.fn<() => Promise<SelfTestResult>>(),
}));

vi.mock("../../../api/jobs.js", () => ({
  getStuckWork: mocks.getStuckWork,
  retryStuckJob: mocks.retryStuckJob,
  closeStuckJob: mocks.closeStuckJob,
  runSelfTest: mocks.runSelfTest,
}));

const THREE_MINUTES_MS = 3 * 60_000;

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const J1 = uuid(1);
const J2 = uuid(2);
const STALE = uuid(9);
const SELF_TEST = uuid(100);
const VENUE = uuid(900);

function job(id: string, overrides: Partial<StuckJob> = {}): StuckJob {
  return {
    id,
    kind: "email.send",
    venueId: VENUE,
    venueName: "Test Hall",
    attempts: 6,
    lostClaims: 0,
    reason: "The address was refused.",
    dueAt: "2026-11-10T11:00:00.000Z",
    gaveUpAt: "2026-11-10T12:00:00.000Z",
    ...overrides,
  };
}

/** A reading of the list. Counts follow the jobs unless a test sets them. */
function stuck(overrides: Partial<StuckWorkReading> = {}): StuckWorkReading {
  const jobs = overrides.jobs ?? [];
  return {
    jobs,
    counts: { queued: 0, running: 0, dead: jobs.length, oldPendingSends: 0 },
    // A little over three minutes, so that "3 minutes" survives a slow machine.
    worker: {
      started: true, lastPassAt: Date.now() - THREE_MINUTES_MS - 5_000, nextWakeAt: null,
      currentJob: null, abandonedHandlers: 0, fault: null, passRunning: false,
    },
    ...overrides,
  };
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function selfTestAnswer(state: JobState): SelfTestResult {
  return { id: SELF_TEST, state };
}

beforeEach(() => {
  mocks.getStuckWork.mockReset();
  mocks.retryStuckJob.mockReset();
  mocks.closeStuckJob.mockReset();
  mocks.runSelfTest.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StuckWork", () => {
  it("says nothing is stuck when the list is empty", async () => {
    mocks.getStuckWork.mockResolvedValue(stuck());
    render(<StuckWork />);
    expect(await screen.findByText("Nothing is stuck.")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("The worker last ran 3 minutes ago.")).toBeDefined();
  });

  it("counts in a sentence, and lists each job with its venue and reason", async () => {
    mocks.getStuckWork.mockResolvedValue(stuck({
      jobs: [job(J1, { kind: "email.send", venueName: "Test Hall", reason: "The address was refused." })],
      counts: { queued: 1, running: 0, dead: 1, oldPendingSends: 0 },
    }));
    render(<StuckWork />);
    expect(await screen.findByText("1 job gave up.")).toBeDefined();
    expect(screen.getByText("1 is waiting.")).toBeDefined();
    expect(screen.getByText("The worker last ran 3 minutes ago.")).toBeDefined();
    const row = screen.getByRole("row", { name: /email\.send/ });
    expect(within(row).getByText("Test Hall")).toBeDefined();
    expect(within(row).getByText("The address was refused.")).toBeDefined();
    expect(within(row).getByText("6")).toBeDefined();
    expect(within(row).getByText(/10 Nov 2026/)).toBeDefined();
  });

  it("is a real table with a caption and column headings", async () => {
    mocks.getStuckWork.mockResolvedValue(stuck({ jobs: [job(J1)] }));
    render(<StuckWork />);
    const table = await screen.findByRole("table", { name: "Jobs that gave up, newest first" });
    const headings = within(table).getAllByRole("columnheader");
    expect(headings.map((heading) => heading.textContent)).toEqual(["What kind", "Venue", "Gave up", "Tries", "Reason", "Actions"]);
    for (const heading of headings) {
      expect(heading.getAttribute("scope")).toBe("col");
    }
  });

  it("names a job with no venue and no reason in plain words, and says 2 jobs gave up", async () => {
    mocks.getStuckWork.mockResolvedValue(stuck({
      jobs: [job(J1, { kind: "sheet.send", venueName: null, venueId: null, reason: null }), job(J2)],
    }));
    render(<StuckWork />);
    expect(await screen.findByText("2 jobs gave up.")).toBeDefined();
    const row = screen.getByRole("row", { name: /sheet\.send/ });
    expect(within(row).getByText("The platform")).toBeDefined();
    expect(within(row).getByText("No reason was recorded.")).toBeDefined();
  });

  it.each([
    ["off", { worker: "off" as const }, "The worker is switched off."],
    ["a database fault", { started: true, lastPassAt: 1, nextWakeAt: null, currentJob: null, abandonedHandlers: 0, fault: "database" as const, passRunning: false }, "The worker cannot reach the database."],
    ["a loop fault", { started: true, lastPassAt: 1, nextWakeAt: null, currentJob: null, abandonedHandlers: 0, fault: "loop" as const, passRunning: false }, "The worker has stopped after an error."],
    ["not yet run", { started: true, lastPassAt: null, nextWakeAt: null, currentJob: null, abandonedHandlers: 0, fault: null, passRunning: false }, "The worker has not run yet."],
  ])("says when the worker is %s", async (_state, worker, sentence) => {
    mocks.getStuckWork.mockResolvedValue(stuck({ worker }));
    render(<StuckWork />);
    expect(await screen.findByText(sentence)).toBeDefined();
    expect(screen.queryByText(/The worker last ran/)).toBeNull();
  });

  it("Try again calls the route, reads the list again, and the row is gone", async () => {
    mocks.getStuckWork.mockResolvedValueOnce(stuck({ jobs: [job(J1)] })).mockResolvedValueOnce(stuck({ jobs: [] }));
    mocks.retryStuckJob.mockResolvedValue(undefined);
    render(<StuckWork />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(mocks.retryStuckJob).toHaveBeenCalledWith(J1); });
    expect(await screen.findByText("Nothing is stuck.")).toBeDefined();
    expect(screen.queryByRole("row", { name: /email\.send/ })).toBeNull();
    expect(mocks.getStuckWork).toHaveBeenCalledTimes(2);
  });

  it("a job someone else already put back says so, and the list is read again", async () => {
    mocks.getStuckWork.mockResolvedValue(stuck({ jobs: [job(J1)] }));
    mocks.retryStuckJob.mockRejectedValue(new ApiError(409, "This job is already back on the list.", "JOB_NOT_STUCK"));
    render(<StuckWork />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("This job is already back on the list.")).toBeDefined();
    await waitFor(() => { expect(mocks.getStuckWork).toHaveBeenCalledTimes(2); });
  });

  it("says so, still naming the job's kind, when the job has left the list by the time it is read again", async () => {
    mocks.getStuckWork.mockResolvedValueOnce(stuck({ jobs: [job(J1)] })).mockResolvedValueOnce(stuck({ jobs: [] }));
    mocks.retryStuckJob.mockRejectedValue(new ApiError(409, "This job is already back on the list.", "JOB_NOT_STUCK"));
    render(<StuckWork />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nothing is stuck.")).toBeDefined();
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("This job is already back on the list.")).toBeDefined();
    expect(within(alert).getByText(/email\.send/)).toBeDefined();
  });

  it("after a refusal because the server cannot run the kind, the row stays and Close with a note works", async () => {
    mocks.getStuckWork.mockResolvedValue(stuck({ jobs: [job(J1)] }));
    mocks.retryStuckJob.mockRejectedValue(new ApiError(
      409, "This server can no longer run this kind of job. Close it with a note.", "JOB_KIND_UNREADABLE",
    ));
    mocks.closeStuckJob.mockResolvedValue(undefined);
    render(<StuckWork />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("This server can no longer run this kind of job. Close it with a note.")).toBeDefined();
    await waitFor(() => { expect(mocks.getStuckWork).toHaveBeenCalledTimes(2); });
    expect(screen.getByRole("row", { name: /email\.send/ })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Close with a note" }));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Retired kind" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => { expect(mocks.closeStuckJob).toHaveBeenCalledWith(J1, "Retired kind"); });
  });

  it("a 500 from Try again shows the server's words and the row is still there", async () => {
    mocks.getStuckWork.mockResolvedValue(stuck({ jobs: [job(J1)] }));
    mocks.retryStuckJob.mockRejectedValue(new ApiError(
      500, "This job could not be made ready for another try. It is still stuck.", "JOB_RETRY_PREPARATION_FAILED",
    ));
    render(<StuckWork />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("This job could not be made ready for another try. It is still stuck.")).toBeDefined();
    await waitFor(() => { expect(mocks.getStuckWork).toHaveBeenCalledTimes(2); });
    expect(screen.getByRole("row", { name: /email\.send/ })).toBeDefined();
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Try again" }).disabled).toBe(false);
    });
  });

  it("Close asks for a note and will not send an empty one", async () => {
    mocks.getStuckWork.mockResolvedValueOnce(stuck({ jobs: [job(J1)] })).mockResolvedValueOnce(stuck({ jobs: [] }));
    mocks.closeStuckJob.mockResolvedValue(undefined);
    render(<StuckWork />);
    fireEvent.click(await screen.findByRole("button", { name: "Close with a note" }));
    const note = screen.getByLabelText("Note");
    expect(document.activeElement).toBe(note);
    const close = screen.getByRole<HTMLButtonElement>("button", { name: "Close" });
    expect(close.disabled).toBe(true);
    fireEvent.change(note, { target: { value: "   " } });
    expect(close.disabled).toBe(true);
    fireEvent.change(note, { target: { value: "  Sent by hand " } });
    expect(close.disabled).toBe(false);
    fireEvent.click(close);
    await waitFor(() => { expect(mocks.closeStuckJob).toHaveBeenCalledWith(J1, "Sent by hand"); });
    expect(await screen.findByText("Nothing is stuck.")).toBeDefined();
    expect(screen.queryByLabelText("Note")).toBeNull();
  });

  it("a note can be no longer than 500 characters", async () => {
    mocks.getStuckWork.mockResolvedValue(stuck({ jobs: [job(J1)] }));
    render(<StuckWork />);
    fireEvent.click(await screen.findByRole("button", { name: "Close with a note" }));
    const note = screen.getByLabelText<HTMLInputElement>("Note");
    expect(note.maxLength).toBe(500);
    fireEvent.change(note, { target: { value: "x".repeat(501) } });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Close" }).disabled).toBe(true);
    fireEvent.change(note, { target: { value: "x".repeat(500) } });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Close" }).disabled).toBe(false);
  });

  it("Escape and Cancel put the row back and return focus to its button", async () => {
    mocks.getStuckWork.mockResolvedValue(stuck({ jobs: [job(J1)] }));
    render(<StuckWork />);
    const open = await screen.findByRole("button", { name: "Close with a note" });
    const leaveByEscape = (): void => { fireEvent.keyDown(screen.getByLabelText("Note"), { key: "Escape" }); };
    const leaveByCancel = (): void => { fireEvent.click(screen.getByRole("button", { name: "Cancel" })); };
    for (const leave of [leaveByEscape, leaveByCancel]) {
      fireEvent.click(open);
      fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Half written" } });
      leave();
      expect(screen.queryByLabelText("Note")).toBeNull();
      expect(document.activeElement).toBe(open);
    }
    expect(mocks.closeStuckJob).not.toHaveBeenCalled();
    // Opened again, the note starts empty.
    fireEvent.click(open);
    expect(screen.getByLabelText<HTMLInputElement>("Note").value).toBe("");
  });

  it("shows the server's words when Close is refused, and keeps the note", async () => {
    mocks.getStuckWork.mockResolvedValue(stuck({ jobs: [job(J1)] }));
    mocks.closeStuckJob.mockRejectedValue(new ApiError(404, "There is no such job.", "JOB_NOT_FOUND"));
    render(<StuckWork />);
    fireEvent.click(await screen.findByRole("button", { name: "Close with a note" }));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Sent by hand" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText("There is no such job.")).toBeDefined();
    await waitFor(() => { expect(mocks.getStuckWork).toHaveBeenCalledTimes(2); });
    expect(screen.getByLabelText<HTMLInputElement>("Note").value).toBe("Sent by hand");
  });

  it("puts focus back in the note when a Close is refused and focus never left the row", async () => {
    const refused = deferred<undefined>();
    mocks.getStuckWork.mockResolvedValue(stuck({ jobs: [job(J1)] }));
    mocks.closeStuckJob.mockReturnValueOnce(refused.promise.then(() => {
      throw new ApiError(409, "This job is already back on the list.", "JOB_NOT_STUCK");
    }));
    render(<StuckWork />);
    const row = await screen.findByRole("row", { name: /email\.send/ });
    fireEvent.click(within(row).getByRole("button", { name: "Close with a note" }));
    const note = screen.getByLabelText<HTMLInputElement>("Note");
    fireEvent.change(note, { target: { value: "Sent by hand" } });
    const detail = note.closest("tr");
    if (detail === null) throw new Error("the note is not in a row");
    // Focus on the form's own Close button, and pressed from there: focus never goes to the body.
    const close = within(detail).getByRole<HTMLButtonElement>("button", { name: "Close" });
    close.focus();
    fireEvent.click(close);
    // The check on the test itself: before the refusal lands, focus is still in this job's rows. Were it on
    // the body, the page would refocus by the "focus is lost" rule, and this test would prove nothing.
    const pressedFrom = document.activeElement;
    expect(pressedFrom).not.toBe(document.body);
    expect(pressedFrom !== null && (row.contains(pressedFrom) || detail.contains(pressedFrom))).toBe(true);

    await act(async () => { refused.resolve(undefined); await refused.promise; });
    await screen.findByText("This job is already back on the list.");
    await waitFor(() => {
      expect(within(screen.getByRole("row", { name: /email\.send/ })).getByRole<HTMLButtonElement>("button", { name: "Close with a note" }).disabled).toBe(false);
    });
    expect(document.activeElement).toBe(screen.getByLabelText("Note"));
    expect(screen.getByLabelText<HTMLInputElement>("Note").value).toBe("Sent by hand");
  });

  it("keeps each row's note to itself while another row's Close is in flight", async () => {
    const closing = deferred<undefined>();
    mocks.getStuckWork
      .mockResolvedValueOnce(stuck({ jobs: [job(J1, { kind: "alpha.send" }), job(J2, { kind: "beta.send" })] }))
      .mockResolvedValue(stuck({ jobs: [job(J2, { kind: "beta.send" })] }));
    mocks.closeStuckJob.mockReturnValueOnce(closing.promise).mockResolvedValue(undefined);
    render(<StuckWork />);
    const alpha = await screen.findByRole("row", { name: /alpha\.send/ });
    const beta = screen.getByRole("row", { name: /beta\.send/ });
    fireEvent.click(within(alpha).getByRole("button", { name: "Close with a note" }));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Alpha is done" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => { expect(mocks.closeStuckJob).toHaveBeenCalledWith(J1, "Alpha is done"); });

    // While alpha's Close is out, beta's note is opened and typed.
    fireEvent.click(within(beta).getByRole("button", { name: "Close with a note" }));
    const [, betaNote] = screen.getAllByLabelText<HTMLInputElement>("Note");
    if (betaNote === undefined) throw new Error("beta's note did not open");
    fireEvent.change(betaNote, { target: { value: "Beta draft" } });

    await act(async () => { closing.resolve(undefined); await closing.promise; });
    await waitFor(() => { expect(screen.queryByRole("row", { name: /alpha\.send/ })).toBeNull(); });
    const kept = screen.getByLabelText<HTMLInputElement>("Note");
    expect(kept.value).toBe("Beta draft");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => { expect(mocks.closeStuckJob).toHaveBeenLastCalledWith(J2, "Beta draft"); });
  });

  it("shows the count of old sends only when there are some", async () => {
    mocks.getStuckWork.mockResolvedValue(stuck({ counts: { queued: 0, running: 0, dead: 0, oldPendingSends: 14 } }));
    const first = render(<StuckWork />);
    expect(await screen.findByText("14 old sends were never recorded as sent or failed.")).toBeDefined();
    first.unmount();

    mocks.getStuckWork.mockResolvedValue(stuck({ counts: { queued: 0, running: 0, dead: 0, oldPendingSends: 1 } }));
    const second = render(<StuckWork />);
    expect(await screen.findByText("1 old send was never recorded as sent or failed.")).toBeDefined();
    second.unmount();

    mocks.getStuckWork.mockResolvedValue(stuck());
    render(<StuckWork />);
    expect(await screen.findByText("Nothing is stuck.")).toBeDefined();
    expect(screen.queryByText(/never recorded as sent or failed/)).toBeNull();
  });

  it("shows its loading state through ActivityStatus until the list is read", async () => {
    const reading = deferred<StuckWorkReading>();
    mocks.getStuckWork.mockReturnValue(reading.promise);
    render(<StuckWork />);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    expect(screen.queryByText("Nothing is stuck.")).toBeNull();
    reading.resolve(stuck());
    expect(await screen.findByText("Nothing is stuck.")).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the server's words when the list cannot be read, and Try again reads it again", async () => {
    mocks.getStuckWork
      .mockRejectedValueOnce(new ApiError(500, "The list could not be read.", "X"))
      .mockResolvedValueOnce(stuck());
    render(<StuckWork />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("The list could not be read.")).toBeDefined();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nothing is stuck.")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the list it has, with the server's words, when a later read fails", async () => {
    mocks.getStuckWork
      .mockResolvedValueOnce(stuck({ jobs: [job(J1)] }))
      .mockRejectedValueOnce(new ApiError(500, "The list could not be read.", "X"));
    mocks.retryStuckJob.mockResolvedValue(undefined);
    render(<StuckWork />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("The list could not be read.")).toBeDefined();
    expect(screen.getByRole("row", { name: /email\.send/ })).toBeDefined();
  });

  it("shows the newest reading when an older one answers last, and aborts the older read", async () => {
    const older = deferred<StuckWorkReading>();
    mocks.getStuckWork.mockReturnValueOnce(older.promise).mockResolvedValueOnce(stuck());
    mocks.runSelfTest.mockResolvedValue(selfTestAnswer("done"));
    render(<StuckWork />);
    // A second read begins while the first is still out: the self-test reads the list again.
    fireEvent.click(screen.getByRole("button", { name: "Run the self-test" }));
    expect(await screen.findByText("The self-test ran.")).toBeDefined();
    expect(screen.getByText("Nothing is stuck.")).toBeDefined();
    expect(mocks.getStuckWork.mock.calls[0]?.[0]?.aborted).toBe(true);

    // The older answer ends last, inside act so that anything it drew would be on screen at once.
    await act(async () => {
      older.resolve(stuck({ jobs: [job(STALE, { kind: "stale.kind" })] }));
      await older.promise;
    });
    expect(screen.queryByRole("row", { name: /stale\.kind/ })).toBeNull();
    expect(screen.queryByText("stale.kind")).toBeNull();
    expect(screen.getByText("Nothing is stuck.")).toBeDefined();
  });

  it("aborts its read when it goes away, and starts no other", async () => {
    const reading = deferred<StuckWorkReading>();
    mocks.getStuckWork.mockReturnValue(reading.promise);
    const view = render(<StuckWork />);
    const signal = mocks.getStuckWork.mock.calls[0]?.[0];
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
    reading.resolve(stuck());
    await Promise.resolve();
    expect(mocks.getStuckWork).toHaveBeenCalledTimes(1);
  });

  it("starts no read after the page has gone, when a Try again was out", async () => {
    const retrying = deferred<undefined>();
    mocks.getStuckWork.mockResolvedValue(stuck({ jobs: [job(J1)] }));
    mocks.retryStuckJob.mockReturnValue(retrying.promise);
    const view = render(<StuckWork />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    const readsBefore = mocks.getStuckWork.mock.calls.length;
    view.unmount();
    await act(async () => { retrying.resolve(undefined); await retrying.promise; });
    expect(mocks.getStuckWork).toHaveBeenCalledTimes(readsBefore);
  });

  it("starts no read after the page has gone, when a Close was out", async () => {
    const closing = deferred<undefined>();
    mocks.getStuckWork.mockResolvedValue(stuck({ jobs: [job(J1)] }));
    mocks.closeStuckJob.mockReturnValue(closing.promise);
    const view = render(<StuckWork />);
    fireEvent.click(await screen.findByRole("button", { name: "Close with a note" }));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Sent by hand" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const readsBefore = mocks.getStuckWork.mock.calls.length;
    view.unmount();
    await act(async () => { closing.resolve(undefined); await closing.promise; });
    expect(mocks.getStuckWork).toHaveBeenCalledTimes(readsBefore);
  });

  it("starts no read after the page has gone, when the self-test was out", async () => {
    const running = deferred<SelfTestResult>();
    mocks.getStuckWork.mockResolvedValue(stuck());
    mocks.runSelfTest.mockReturnValue(running.promise);
    const view = render(<StuckWork />);
    await screen.findByText("Nothing is stuck.");
    fireEvent.click(screen.getByRole("button", { name: "Run the self-test" }));
    const readsBefore = mocks.getStuckWork.mock.calls.length;
    view.unmount();
    await act(async () => { running.resolve(selfTestAnswer("done")); await running.promise; });
    expect(mocks.getStuckWork).toHaveBeenCalledTimes(readsBefore);
  });

  it("sends one Try again however many times the button is pressed, and shows the work as it goes", async () => {
    const retrying = deferred<undefined>();
    mocks.getStuckWork.mockResolvedValueOnce(stuck({ jobs: [job(J1)] })).mockResolvedValueOnce(stuck({ jobs: [] }));
    mocks.retryStuckJob.mockReturnValue(retrying.promise);
    render(<StuckWork />);
    const button = await screen.findByRole<HTMLButtonElement>("button", { name: "Try again" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Close with a note" }).disabled).toBe(true);
    expect(screen.getByRole("status")).toBeDefined();
    expect(mocks.retryStuckJob).toHaveBeenCalledTimes(1);
    retrying.resolve(undefined);
    expect(await screen.findByText("Nothing is stuck.")).toBeDefined();
    expect(mocks.retryStuckJob).toHaveBeenCalledTimes(1);
  });

  it("keeps a row busy until the newest read lands, when two rows act at once", async () => {
    const retryAlpha = deferred<undefined>();
    const retryBeta = deferred<undefined>();
    const afterAlpha = deferred<StuckWorkReading>();
    const afterBeta = deferred<StuckWorkReading>();
    const both = stuck({ jobs: [job(J1, { kind: "alpha.send" }), job(J2, { kind: "beta.send" })] });
    mocks.getStuckWork
      .mockResolvedValueOnce(both)
      .mockReturnValueOnce(afterAlpha.promise)
      .mockReturnValueOnce(afterBeta.promise);
    mocks.retryStuckJob.mockReturnValueOnce(retryAlpha.promise).mockReturnValueOnce(retryBeta.promise);
    render(<StuckWork />);
    const alpha = await screen.findByRole("row", { name: /alpha\.send/ });
    const beta = screen.getByRole("row", { name: /beta\.send/ });
    fireEvent.click(within(alpha).getByRole("button", { name: "Try again" }));
    fireEvent.click(within(beta).getByRole("button", { name: "Try again" }));
    // Alpha's read begins, and is replaced when beta's begins.
    await act(async () => { retryAlpha.resolve(undefined); await retryAlpha.promise; });
    await act(async () => { retryBeta.resolve(undefined); await retryBeta.promise; });
    await waitFor(() => { expect(mocks.getStuckWork).toHaveBeenCalledTimes(3); });
    await act(async () => { afterAlpha.resolve(both); await afterAlpha.promise; });
    // The older read has ended; the list on screen is still the old one, so alpha stays busy.
    expect(within(screen.getByRole("row", { name: /alpha\.send/ })).getByRole<HTMLButtonElement>("button", { name: "Try again" }).disabled).toBe(true);
    await act(async () => { afterBeta.resolve(both); await afterBeta.promise; });
    await waitFor(() => {
      expect(within(screen.getByRole("row", { name: /alpha\.send/ })).getByRole<HTMLButtonElement>("button", { name: "Try again" }).disabled).toBe(false);
    });
    expect(within(screen.getByRole("row", { name: /beta\.send/ })).getByRole<HTMLButtonElement>("button", { name: "Try again" }).disabled).toBe(false);
  });

  it("puts focus back on the button pressed when focus was lost and the job is still listed after a refusal", async () => {
    mocks.getStuckWork.mockResolvedValue(stuck({ jobs: [job(J1)] }));
    mocks.retryStuckJob.mockRejectedValue(new ApiError(
      409, "This server can no longer run this kind of job. Close it with a note.", "JOB_KIND_UNREADABLE",
    ));
    render(<StuckWork />);
    const button = await screen.findByRole("button", { name: "Try again" });
    // Focus is lost: nothing holds it, as when the pressed button goes disabled and the browser lets go.
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(button);
    await screen.findByText("This server can no longer run this kind of job. Close it with a note.");
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole("button", { name: "Try again" })); });
  });

  it("moves focus to the heading only when it was lost and the row has gone", async () => {
    mocks.getStuckWork.mockResolvedValueOnce(stuck({ jobs: [job(J1)] })).mockResolvedValueOnce(stuck());
    mocks.retryStuckJob.mockResolvedValue(undefined);
    render(<StuckWork />);
    const button = await screen.findByRole("button", { name: "Try again" });
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(button);
    await screen.findByText("Nothing is stuck.");
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Stuck work" })); });
  });

  it("moves focus nowhere when it was lost and the list cannot be read again after an action", async () => {
    mocks.getStuckWork
      .mockResolvedValueOnce(stuck({ jobs: [job(J1)] }))
      .mockRejectedValueOnce(new ApiError(500, "The list could not be read.", "X"));
    mocks.retryStuckJob.mockResolvedValue(undefined);
    render(<StuckWork />);
    const button = await screen.findByRole("button", { name: "Try again" });
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(button);
    await screen.findByText("The list could not be read.");
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves the caret in another row's note when a Close that was out is refused", async () => {
    const refused = deferred<undefined>();
    const both = stuck({ jobs: [job(J1, { kind: "alpha.send" }), job(J2, { kind: "beta.send" })] });
    mocks.getStuckWork.mockResolvedValue(both);
    mocks.closeStuckJob.mockReturnValueOnce(refused.promise.then(() => {
      throw new ApiError(409, "This job is already back on the list.", "JOB_NOT_STUCK");
    }));
    render(<StuckWork />);
    const alpha = await screen.findByRole("row", { name: /alpha\.send/ });
    const beta = screen.getByRole("row", { name: /beta\.send/ });
    fireEvent.click(within(alpha).getByRole("button", { name: "Close with a note" }));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Alpha text" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(within(beta).getByRole("button", { name: "Close with a note" }));
    const [alphaNote, betaNote] = screen.getAllByLabelText<HTMLInputElement>("Note");
    if (alphaNote === undefined || betaNote === undefined) throw new Error("both notes should be open");
    fireEvent.change(betaNote, { target: { value: "Beta draft" } });
    expect(document.activeElement).toBe(betaNote);

    await act(async () => { refused.resolve(undefined); await refused.promise; });
    await screen.findByText("This job is already back on the list.");
    // Alpha's buttons come back in the same render that hands alpha its refocus request (as in the twin below).
    await waitFor(() => {
      expect(within(screen.getByRole("row", { name: /alpha\.send/ })).getByRole<HTMLButtonElement>("button", { name: "Close with a note" }).disabled).toBe(false);
    });
    expect(document.activeElement).toBe(betaNote);
    expect(betaNote.value).toBe("Beta draft");
    expect(alphaNote.value).toBe("Alpha text");
  });

  it("leaves the caret in another row's note when a Try again that was out finishes", async () => {
    const retrying = deferred<undefined>();
    const both = stuck({ jobs: [job(J1, { kind: "alpha.send" }), job(J2, { kind: "beta.send" })] });
    mocks.getStuckWork.mockResolvedValue(both);
    mocks.retryStuckJob.mockReturnValueOnce(retrying.promise);
    render(<StuckWork />);
    const alpha = await screen.findByRole("row", { name: /alpha\.send/ });
    const beta = screen.getByRole("row", { name: /beta\.send/ });
    fireEvent.click(within(alpha).getByRole("button", { name: "Try again" }));
    fireEvent.click(within(beta).getByRole("button", { name: "Close with a note" }));
    const betaNote = screen.getByLabelText<HTMLInputElement>("Note");
    fireEvent.change(betaNote, { target: { value: "Beta draft" } });
    expect(document.activeElement).toBe(betaNote);

    await act(async () => { retrying.resolve(undefined); await retrying.promise; });
    await waitFor(() => { expect(mocks.getStuckWork).toHaveBeenCalledTimes(2); });
    await waitFor(() => {
      expect(within(screen.getByRole("row", { name: /alpha\.send/ })).getByRole<HTMLButtonElement>("button", { name: "Try again" }).disabled).toBe(false);
    });
    expect(document.activeElement).toBe(betaNote);
    expect(betaNote.value).toBe("Beta draft");
  });

  it("does not take focus from a button in another row when a row has gone", async () => {
    const retrying = deferred<undefined>();
    mocks.getStuckWork
      .mockResolvedValueOnce(stuck({ jobs: [job(J1, { kind: "alpha.send" }), job(J2, { kind: "beta.send" })] }))
      .mockResolvedValue(stuck({ jobs: [job(J2, { kind: "beta.send" })] }));
    mocks.retryStuckJob.mockReturnValueOnce(retrying.promise).mockReturnValueOnce(new Promise<void>(() => undefined));
    render(<StuckWork />);
    const alpha = await screen.findByRole("row", { name: /alpha\.send/ });
    const beta = screen.getByRole("row", { name: /beta\.send/ });
    fireEvent.click(within(alpha).getByRole("button", { name: "Try again" }));
    // Beta's own Try again is out and holds focus, disabled: that is not focus lost.
    const betaButton = within(beta).getByRole<HTMLButtonElement>("button", { name: "Try again" });
    betaButton.focus();
    fireEvent.click(betaButton);
    await act(async () => { retrying.resolve(undefined); await retrying.promise; });
    await waitFor(() => { expect(screen.queryByRole("row", { name: /alpha\.send/ })).toBeNull(); });
    expect(document.activeElement).toBe(betaButton);
  });

  it("sends focus to Close with a note after a Close that went through while the job is still listed", async () => {
    mocks.getStuckWork.mockResolvedValue(stuck({ jobs: [job(J1)] }));
    mocks.closeStuckJob.mockResolvedValue(undefined);
    render(<StuckWork />);
    fireEvent.click(await screen.findByRole("button", { name: "Close with a note" }));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Sent by hand" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => { expect(screen.queryByLabelText("Note")).toBeNull(); });
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close with a note" })); });
  });

  it("uses a request to put focus back once: a row that goes and comes back is not focused again", async () => {
    const jobA = job(J1, { kind: "alpha.send" });
    mocks.getStuckWork
      .mockResolvedValueOnce(stuck({ jobs: [jobA] }))
      .mockResolvedValueOnce(stuck({ jobs: [jobA] }))
      .mockResolvedValueOnce(stuck())
      .mockResolvedValueOnce(stuck({ jobs: [jobA] }));
    mocks.retryStuckJob.mockRejectedValue(new ApiError(409, "This job is already back on the list.", "JOB_NOT_STUCK"));
    mocks.runSelfTest.mockResolvedValue(selfTestAnswer("done"));
    render(<StuckWork />);
    const button = await screen.findByRole("button", { name: "Try again" });
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(button);
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole("button", { name: "Try again" })); });

    // The person moves on; the list then drops the job and lists it again.
    screen.getByRole("button", { name: "Try again" }).blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByRole("button", { name: "Run the self-test" }));
    await screen.findByText("Nothing is stuck.");
    await screen.findByText("The self-test ran.");
    fireEvent.click(screen.getByRole("button", { name: "Run the self-test" }));
    await screen.findByRole("row", { name: /alpha\.send/ });
    await waitFor(() => { expect(mocks.getStuckWork).toHaveBeenCalledTimes(4); });
    expect(document.activeElement).toBe(document.body);
  });

  it("keeps the newer list and shows no error when the older read fails last", async () => {
    let failOlder: (reason: Error) => void = () => undefined;
    const olderRead = new Promise<StuckWorkReading>((_resolve, reject) => { failOlder = reject; });
    mocks.getStuckWork.mockReturnValueOnce(olderRead).mockResolvedValueOnce(stuck());
    mocks.runSelfTest.mockResolvedValue(selfTestAnswer("done"));
    render(<StuckWork />);
    fireEvent.click(screen.getByRole("button", { name: "Run the self-test" }));
    expect(await screen.findByText("The self-test ran.")).toBeDefined();
    await act(async () => {
      failOlder(new ApiError(500, "The older read failed.", "X"));
      await olderRead.catch(() => undefined);
    });
    expect(screen.queryByText("The older read failed.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Nothing is stuck.")).toBeDefined();
  });

  it("gives the verdict when there has been no reading at all", async () => {
    mocks.getStuckWork.mockRejectedValue(new ApiError(500, "The list could not be read.", "X"));
    mocks.runSelfTest.mockResolvedValue(selfTestAnswer("queued"));
    render(<StuckWork />);
    await screen.findByText("The list could not be read.");
    fireEvent.click(screen.getByRole("button", { name: "Run the self-test" }));
    expect(await screen.findByText("The self-test has not run yet. It is still waiting.")).toBeDefined();
  });

  it("sends one self-test however many times the button is pressed", async () => {
    const running = deferred<SelfTestResult>();
    mocks.getStuckWork.mockResolvedValue(stuck());
    mocks.runSelfTest.mockReturnValue(running.promise);
    render(<StuckWork />);
    await screen.findByText("Nothing is stuck.");
    const button = screen.getByRole("button", { name: "Run the self-test" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.runSelfTest).toHaveBeenCalledTimes(1);
    running.resolve(selfTestAnswer("done"));
    expect(await screen.findByText("The self-test ran.")).toBeDefined();
    expect(mocks.runSelfTest).toHaveBeenCalledTimes(1);
  });

  it("shows the self-test as running, and its verdict when it has run", async () => {
    const running = deferred<SelfTestResult>();
    mocks.getStuckWork.mockResolvedValue(stuck());
    mocks.runSelfTest.mockReturnValue(running.promise);
    render(<StuckWork />);
    await screen.findByText("Nothing is stuck.");
    fireEvent.click(screen.getByRole("button", { name: "Run the self-test" }));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Run the self-test" }).disabled).toBe(true);
    expect(screen.getByRole("status")).toBeDefined();
    expect(screen.queryByText("The self-test ran.")).toBeNull();
    running.resolve(selfTestAnswer("done"));
    expect(await screen.findByText("The self-test ran.")).toBeDefined();
    expect(mocks.getStuckWork).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["done", false, "The self-test ran."],
    ["dead", false, "The self-test did not finish. It is on the list above."],
    ["abandoned", false, "The self-test did not finish. It is on the list above."],
    ["queued", false, "The self-test has not run yet. It is still waiting."],
    ["running", false, "The self-test has not run yet. It is still waiting."],
    ["queued", true, "The self-test is waiting. The worker is switched off."],
    ["running", true, "The self-test is waiting. The worker is switched off."],
  ] as const)("says what became of the self-test's job: %s, worker off %s", async (state, workerOff, sentence) => {
    // The list never holds the self-test's job here: the verdict comes from the server's answer alone.
    mocks.getStuckWork.mockResolvedValue(workerOff ? stuck({ worker: { worker: "off" } }) : stuck());
    mocks.runSelfTest.mockResolvedValue(selfTestAnswer(state));
    render(<StuckWork />);
    await screen.findByText("Nothing is stuck.");
    fireEvent.click(screen.getByRole("button", { name: "Run the self-test" }));
    expect(await screen.findByText(sentence)).toBeDefined();
    expect(mocks.getStuckWork).toHaveBeenCalledTimes(2);
  });

  it("still gives the verdict when the list cannot be read again afterwards", async () => {
    mocks.getStuckWork
      .mockResolvedValueOnce(stuck())
      .mockRejectedValueOnce(new ApiError(500, "The list could not be read.", "X"));
    mocks.runSelfTest.mockResolvedValue(selfTestAnswer("done"));
    render(<StuckWork />);
    await screen.findByText("Nothing is stuck.");
    fireEvent.click(screen.getByRole("button", { name: "Run the self-test" }));
    expect(await screen.findByText("The self-test ran.")).toBeDefined();
    expect(screen.getByText("The list could not be read.")).toBeDefined();
  });

  it("shows the server's words when the self-test is refused", async () => {
    mocks.getStuckWork.mockResolvedValue(stuck());
    mocks.runSelfTest.mockRejectedValue(new ApiError(403, "Platform administrators only.", "FORBIDDEN"));
    render(<StuckWork />);
    await screen.findByText("Nothing is stuck.");
    fireEvent.click(screen.getByRole("button", { name: "Run the self-test" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Platform administrators only.")).toBeDefined();
    expect(screen.queryByText("The self-test ran.")).toBeNull();
  });
});
