import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RotaWeek } from "@omnitwin/types";
import { getRotaFloorWeek } from "../rota.js";
import { _resetTokenGetterForTests } from "../auth-bridge.js";

// ---------------------------------------------------------------------------
// The Day Board reads the rota as the venue floor does, whatever the reader's
// role (view=floor). An administrator's board on a shared office screen reads
// it every five minutes; without the view it would carry the manage view:
// drafts, staff records, leave and the team's accounts. Every other test
// stubs this client, so this one pins what it asks for.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";

function floorWeek(start: string): RotaWeek {
  return {
    venueId: VENUE, timeZone: "Europe/London", weekStart: start, from: `${start}T00:00:00.000Z`, to: `${start}T00:00:00.000Z`,
    access: "read", people: [], records: [], shifts: [], unavailability: [], rooms: [], accounts: [],
  };
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: floorWeek("2026-11-09") }))));
  vi.stubGlobal("fetch", fetchMock);
  _resetTokenGetterForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The one request the client made. */
function asked(): { readonly url: string; readonly method: string | undefined } {
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  return { url: typeof url === "string" ? url : url instanceof URL ? url.href : "", method: init?.method };
}

describe("getRotaFloorWeek", () => {
  it("asks for the floor's view of the week holding the day", async () => {
    const week = await getRotaFloorWeek(VENUE, "2026-11-09");
    expect(week.access).toBe("read");
    const { url, method } = asked();
    expect(method).toBe("GET");
    expect(url.endsWith(`/venues/${VENUE}/rota/week?start=2026-11-09&view=floor`)).toBe(true);
  });

  it("sends the day as one value, so nothing in it can change the view", async () => {
    await getRotaFloorWeek(VENUE, "2026-11-09&view=manage");
    const query = new URL(asked().url).searchParams;
    expect(query.get("start")).toBe("2026-11-09&view=manage");
    expect(query.getAll("view")).toEqual(["floor"]);
  });
});
