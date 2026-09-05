import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assessVenueInventory, approveInventoryReservation, getInventoryReservationHistory, INVENTORY_ACTION_TIMEOUT_MS } from "../venue-inventory-demand.js";
import { _resetTokenGetterForTests } from "../auth-bridge.js";
import { demandAssessment, demandIds, demandRelease } from "../../components/dashboard/inventory/__tests__/inventory-demand-fixtures.js";

const fetchMock = vi.fn();
const venueId = "00000000-0000-4000-8000-000000000001";
const window = { startsAt: "2026-09-06T10:00:00.000Z", endsAt: "2026-09-06T20:00:00.000Z" };
const assessment = { venueId, timeZone: "Europe/London", window, assessedAt: "2026-09-05T10:00:00.000Z",
  assessmentDigest: "a".repeat(64), coverage: "partial", demandScope: "frozen_placed_catalogue_objects_only",
  scopeDisclosure: "Placed catalogue objects only", issues: [], sources: [], items: [], remedies: [] };
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); _resetTokenGetterForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("inventory assessment transport", () => {
  it("rejects an approval receipt for different source evidence in the same room", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { release: { ...demandRelease, sourceDigest: "e".repeat(64) }, assessment: demandAssessment, replayed: false } }), { status: 200 }));
    await expect(approveInventoryReservation(venueId, { commandId: demandIds.remedy, eventId: demandIds.event, spaceId: demandIds.space,
      window, expectedSourceDigest: demandRelease.sourceDigest, expectedAssessmentDigest: demandAssessment.assessmentDigest,
      reason: "Reviewed", occupiedWindowConfirmed: true })).rejects.toMatchObject({ code: "INVENTORY_RESPONSE_SCOPE_MISMATCH" });
  });
  it("rejects cross-venue reservation history even when its envelope is valid", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ ...demandRelease, venueId: demandIds.space }] }), { status: 200 }));
    await expect(getInventoryReservationHistory(venueId, demandIds.event, demandIds.space))
      .rejects.toMatchObject({ code: "INVENTORY_RESPONSE_SCOPE_MISMATCH" });
  });
  it("loads and validates a dated assessment", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: assessment }), { status: 200 }));
    await expect(assessVenueInventory(venueId, window)).resolves.toEqual(assessment);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe(`/venues/${venueId}/inventory/assessment`);
    expect(url.searchParams.get("from")).toBe(window.startsAt);
  });

  it("rejects a validly shaped assessment for a different observation window", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { ...assessment, window: { ...window, endsAt: "2026-09-06T21:00:00.000Z" } } }), { status: 200 }));
    await expect(assessVenueInventory(venueId, window)).rejects.toMatchObject({ code: "INVENTORY_RESPONSE_SCOPE_MISMATCH" });
  });

  it("bounds an unconfirmed reservation approval without replacing its command", async () => {
    vi.useFakeTimers(); fetchMock.mockImplementation(() => new Promise<Response>(() => { /* Unresponsive server. */ }));
    const command = { commandId: venueId, eventId: venueId, spaceId: venueId, window,
      expectedSourceDigest: "b".repeat(64), expectedAssessmentDigest: "a".repeat(64), reason: "Reviewed", occupiedWindowConfirmed: true as const };
    const promise = approveInventoryReservation(venueId, command);
    const rejected = expect(promise).rejects.toMatchObject({ status: 0, code: "INVENTORY_ACTION_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(INVENTORY_ACTION_TIMEOUT_MS); await rejected;
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(options?.signal?.aborted).toBe(true);
    expect(typeof options?.body).toBe("string");
    if (typeof options?.body !== "string") throw new Error("Expected a JSON command body");
    expect(JSON.parse(options.body)).toEqual(command);
  });
});
