import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { BuildingCheck, BuildingCheckKind, BuildingChecksDay, ReplaceBuildingChecks } from "@omnitwin/types";
import { ApiError } from "../../../../api/client.js";
import { listKey, useBuildingChecks, type CheckOutcome } from "../use-building-checks.js";

// ---------------------------------------------------------------------------
// The building's checks for a board day: a list is saved from the ids its
// editor opened on, and a colleague's newer list is refused as stale; a tick
// answers with the check as it now stands, and a read from before it is read
// again rather than painted; why a change failed stays with its check, for
// that day only.
// ---------------------------------------------------------------------------

const api = vi.hoisted(() => ({
  get: vi.fn<(venueId: string, day: string) => Promise<BuildingChecksDay>>(),
  replace: vi.fn<(venueId: string, kind: BuildingCheckKind, body: ReplaceBuildingChecks) => Promise<BuildingCheck[]>>(),
  mark: vi.fn<(venueId: string, checkId: string, day: string) => Promise<BuildingCheck>>(),
  unmark: vi.fn<(venueId: string, checkId: string, day: string) => Promise<BuildingCheck>>(),
}));
vi.mock("../../../../api/building-checks.js", () => ({
  getBuildingChecks: (venueId: string, day: string) => api.get(venueId, day),
  replaceBuildingChecks: (venueId: string, kind: BuildingCheckKind, body: ReplaceBuildingChecks) => api.replace(venueId, kind, body),
  markBuildingCheck: (venueId: string, checkId: string, day: string) => api.mark(venueId, checkId, day),
  unmarkBuildingCheck: (venueId: string, checkId: string, day: string) => api.unmark(venueId, checkId, day),
}));

const VENUE = "00000000-0000-4000-8000-000000000001";
const DOORS = "00000000-0000-4000-8000-0000000000c1";
const ALARM = "00000000-0000-4000-8000-0000000000c2";
const KEYS = "00000000-0000-4000-8000-0000000000c3";

function check(id: string, label: string, mark: BuildingCheck["mark"] = null): BuildingCheck {
  return { id, kind: "lockup", label, retired: false, mark };
}

function day(date: string, lockup: readonly BuildingCheck[]): BuildingChecksDay {
  return { day: date, opening: [], lockup: [...lockup] };
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const TICKED = check(ALARM, "Alarm set", { doneAt: "2026-11-14T23:40:00.000Z", doneByUserId: null, doneByName: "Jamie" });

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
});
afterEach(() => { cleanup(); });

describe("useBuildingChecks", () => {
  it("saves a list from the ids its editor opened on, not the latest read", async () => {
    api.get.mockResolvedValueOnce(day("2026-11-14", [check(DOORS, "Fire doors shut"), check(ALARM, "Alarm set")]));
    // A colleague's newer list, read while the editor was open.
    api.get.mockResolvedValue(day("2026-11-14", [check(DOORS, "Fire doors shut"), check(ALARM, "Alarm set"), check(KEYS, "Keys back")]));
    api.replace.mockResolvedValue([]);
    const { result } = renderHook(() => useBuildingChecks(VENUE, "2026-11-14", true));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    act(() => { result.current.refresh(); });
    await waitFor(() => { expect(result.current.day?.lockup).toHaveLength(3); });
    let outcome: CheckOutcome | null = null;
    await act(async () => { outcome = await result.current.replace("lockup", [{ id: ALARM, label: "Alarm set" }], [DOORS, ALARM]); });
    expect(outcome).toBe("saved");
    expect(api.replace).toHaveBeenCalledWith(VENUE, "lockup", { expected: [DOORS, ALARM], items: [{ id: ALARM, label: "Alarm set" }] });
  });

  it("calls a refusal from a colleague's newer list stale, says so in the board's words, and reads again", async () => {
    api.get.mockResolvedValue(day("2026-11-14", [check(DOORS, "Fire doors shut")]));
    api.replace.mockRejectedValue(new ApiError(409, "Someone changed this list since you opened it.", "STALE_CHECKS"));
    const { result } = renderHook(() => useBuildingChecks(VENUE, "2026-11-14", true));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    let outcome: CheckOutcome | null = null;
    await act(async () => { outcome = await result.current.replace("lockup", [], [DOORS]); });
    expect(outcome).toBe("stale");
    expect(result.current.failures.get(listKey("lockup"))).toBe("Couldn’t save the list: someone else changed this list meanwhile, so it now shows as it stands.");
    await waitFor(() => { expect(api.get).toHaveBeenCalledTimes(2); });
  });

  it("keeps why a tick failed against its own check, and forgets it on another day", async () => {
    api.get.mockImplementation((_venue, date) => Promise.resolve(day(date, [check(ALARM, "Alarm set")])));
    api.mark.mockRejectedValue(new Error("Network error — check your connection"));
    const { result, rerender } = renderHook(({ date }) => useBuildingChecks(VENUE, date, true), { initialProps: { date: "2026-11-14" } });
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    let outcome: CheckOutcome | null = null;
    await act(async () => { outcome = await result.current.tick(check(ALARM, "Alarm set"), true); });
    expect(outcome).toBe("failed");
    expect([...result.current.failures]).toEqual([[ALARM, "Couldn’t tick that: Network error — check your connection."]]);
    rerender({ date: "2026-11-15" });
    await waitFor(() => { expect(result.current.day?.day).toBe("2026-11-15"); });
    expect(result.current.failures.size).toBe(0);
  });

  it("never paints a read that set out before a tick landed, and reads the day again", async () => {
    api.get.mockResolvedValueOnce(day("2026-11-14", [check(ALARM, "Alarm set")]));
    const { result } = renderHook(() => useBuildingChecks(VENUE, "2026-11-14", true));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    const slow = deferred<BuildingChecksDay>();
    api.get.mockReturnValueOnce(slow.promise);
    act(() => { result.current.refresh(); });
    await waitFor(() => { expect(api.get).toHaveBeenCalledTimes(2); });
    api.mark.mockResolvedValue(TICKED);
    api.get.mockResolvedValue(day("2026-11-14", [TICKED]));
    await act(async () => { await result.current.tick(check(ALARM, "Alarm set"), true); });
    expect(result.current.day?.lockup[0]?.mark?.doneByName).toBe("Jamie");
    await act(async () => { slow.resolve(day("2026-11-14", [check(ALARM, "Alarm set")])); await slow.promise; });
    expect(result.current.day?.lockup[0]?.mark?.doneByName).toBe("Jamie");
    await waitFor(() => { expect(api.get).toHaveBeenCalledTimes(3); });
    expect(result.current.day?.lockup[0]?.mark?.doneByName).toBe("Jamie");
  });

  it("reads nothing without a day, and says when a read is on its way", async () => {
    const { result, rerender } = renderHook(({ date }) => useBuildingChecks(VENUE, date, true), { initialProps: { date: "" } });
    expect(result.current.status).toBe("idle");
    expect(api.get).not.toHaveBeenCalled();
    const read = deferred<BuildingChecksDay>();
    api.get.mockReturnValueOnce(read.promise);
    rerender({ date: "2026-11-13" });
    await waitFor(() => { expect(result.current.reading).toBe(true); });
    await act(async () => { read.resolve(day("2026-11-13", [])); await read.promise; });
    expect([result.current.status, result.current.reading]).toEqual(["ready", false]);
  });
});
