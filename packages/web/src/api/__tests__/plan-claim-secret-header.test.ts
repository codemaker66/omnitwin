import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchObjectInput } from "../configurations.js";

// ---------------------------------------------------------------------------
// The API returns a guest plan's notes only to the browser that made the plan,
// which proves it with the claim secret it was given (final review,
// TENANCY-3). So every anonymous read and save of a plan this browser made
// carries that secret, in a header, and a plan it did not make carries none.
// Without the header the maker would open their own plan and find its notes
// gone from view.
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const configurations = await import("../configurations.js");

const MADE_HERE = "0f0f0f0f-0000-4000-8000-000000000001";
const FROM_A_LINK = "0f0f0f0f-0000-4000-8000-000000000002";
const SECRET = "made-here-secret-0123456789abcdefghijklmnop";
const HEADER = "X-Plan-Claim-Secret";

function plan(id: string): Record<string, unknown> {
  return { id, spaceId: "space", venueId: "venue", userId: null, name: "Plan", isPublicPreview: true, revision: 2, objects: [] };
}

function answer(data: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve({ data }), headers: new Headers() } as Response;
}

function chair(): BatchObjectInput {
  return {
    assetDefinitionId: "a1ef4d89-7786-5878-bee1-87b3fac28200",
    positionX: 1, positionY: 0, positionZ: 1,
    rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, sortOrder: 0,
    metadata: { clothed: false, groupId: null, notes: "Top table" },
  };
}

/** The headers of the last request, as the client passed them to fetch. */
function lastHeaders(): Record<string, string> {
  const init: unknown = fetchMock.mock.calls.at(-1)?.[1];
  if (typeof init !== "object" || init === null) throw new Error("fetch was not called with options");
  const headers = (init as RequestInit).headers;
  if (typeof headers !== "object" || headers === null || headers instanceof Headers || Array.isArray(headers)) {
    throw new Error("fetch was not called with plain headers");
  }
  return headers;
}

beforeEach(() => {
  fetchMock.mockReset();
  window.localStorage.clear();
  // The tracked list as stores/editor-store.ts writes it: this browser made one
  // plan and has opened another from a link.
  window.localStorage.setItem("omnitwin_my_configs", JSON.stringify([
    { configId: MADE_HERE, spaceId: "space", createdAt: "2026-11-11T12:00:00.000Z", claimSecret: SECRET },
    { configId: FROM_A_LINK, spaceId: "space", createdAt: "2026-11-11T12:05:00.000Z" },
  ]));
});

describe("reading and saving a guest plan as the browser that made it", () => {
  it("presents the plan's claim secret when it opens a plan made here", async () => {
    fetchMock.mockResolvedValue(answer(plan(MADE_HERE)));
    await configurations.getPublicConfig(MADE_HERE);
    expect(lastHeaders()[HEADER]).toBe(SECRET);
  });

  it("presents it with every save and with the plan's picture", async () => {
    fetchMock.mockResolvedValue(answer({ objects: [], revision: 3 }));
    await configurations.publicBatchSave(MADE_HERE, [chair()], 2);
    expect(lastHeaders()[HEADER]).toBe(SECRET);
    await configurations.publicBatchSave(MADE_HERE, [chair()], 3, { keepalive: true });
    expect(lastHeaders()[HEADER]).toBe(SECRET);

    fetchMock.mockResolvedValue(answer(plan(MADE_HERE)));
    await configurations.updatePublicThumbnail(MADE_HERE, "data:image/jpeg;base64,/9j/");
    expect(lastHeaders()[HEADER]).toBe(SECRET);
  });

  it("presents nothing for a plan opened from a link, and never another plan's secret", async () => {
    fetchMock.mockResolvedValue(answer(plan(FROM_A_LINK)));
    await configurations.getPublicConfig(FROM_A_LINK);
    expect(HEADER in lastHeaders()).toBe(false);

    fetchMock.mockResolvedValue(answer({ objects: [], revision: 3 }));
    await configurations.publicBatchSave(FROM_A_LINK, [chair()], 2);
    expect(HEADER in lastHeaders()).toBe(false);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(SECRET);
  });

  it("keeps the secret out of the address it asks", async () => {
    fetchMock.mockResolvedValue(answer(plan(MADE_HERE)));
    await configurations.getPublicConfig(MADE_HERE);
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).not.toContain(SECRET);
  });
});
