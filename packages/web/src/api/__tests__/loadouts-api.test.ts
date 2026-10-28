import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetTokenGetterForTests } from "../auth-bridge.js";
import { createLoadout, updateLoadout } from "../loadouts.js";

// The create and the change answer with the loadout row as the route writes
// it back (routes/reference-loadouts.ts: `.returning()`), which has no photos.
// Parsed as a detail, a create or rename that succeeded was reported as a
// failure (dash-ops-4).

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
const VENUE = "00000000-0000-4000-8000-000000008101";
const SPACE = "00000000-0000-4000-8000-000000008102";
const LOADOUT = "00000000-0000-4000-8000-000000008103";

/** The row exactly as the API sends it, its private columns included. */
const row = {
  id: LOADOUT, spaceId: SPACE, venueId: VENUE, name: "Wedding reset", description: null,
  createdBy: "00000000-0000-4000-8000-000000008104",
  createdAt: "2026-10-28T10:00:00.000Z", updatedAt: "2026-10-28T10:00:00.000Z", deletedAt: null,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); _resetTokenGetterForTests(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("the loadout create and change replies", () => {
  it("resolves a create on the row the route returns, without photos", async () => {
    fetchMock.mockResolvedValue(json({ data: row }, 201));
    await expect(createLoadout(VENUE, SPACE, "Wedding reset")).resolves.toEqual({
      id: LOADOUT, spaceId: SPACE, venueId: VENUE, name: "Wedding reset", description: null,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    });
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("resolves a rename on the row the route returns", async () => {
    fetchMock.mockResolvedValue(json({ data: { ...row, name: "Dinner reset" } }));
    await expect(updateLoadout(VENUE, SPACE, LOADOUT, { name: "Dinner reset" })).resolves.toMatchObject({ name: "Dinner reset" });
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PATCH");
  });

  it("still refuses a reply the contract does not describe", async () => {
    fetchMock.mockResolvedValue(json({ data: { ...row, name: 42 } }, 201));
    await expect(createLoadout(VENUE, SPACE, "Wedding reset")).rejects.toMatchObject({ code: "RESPONSE_VALIDATION_ERROR" });
  });
});
