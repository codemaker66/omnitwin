import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchObjectInput } from "../configurations.js";

// ---------------------------------------------------------------------------
// A batch save sent as the planner hides or closes asks the browser to finish
// it after the page has gone (QoL D-01). Browsers refuse a keepalive body over
// 64 KiB outright, so a larger layout goes as an ordinary request instead: it
// still reaches the server while the page stays, and this device keeps the work
// for a close.
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { KEEPALIVE_BODY_LIMIT_BYTES } = await import("../client.js");
const configurations = await import("../configurations.js");

function saved(): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data: { objects: [], revision: 3 } }),
    headers: new Headers(),
  } as Response;
}

function table(index: number): BatchObjectInput {
  return {
    assetDefinitionId: "a1ef4d89-7786-5878-bee1-87b3fac28200",
    positionX: index, positionY: 0, positionZ: 1,
    rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, sortOrder: index,
    metadata: { clothed: true, clothStyle: "white", groupId: null, notes: "Top table" },
  };
}

function lastInit(): RequestInit {
  const init: unknown = fetchMock.mock.calls.at(-1)?.[1];
  if (typeof init !== "object" || init === null) throw new Error("fetch was not called with options");
  return init;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(saved());
});

describe("a batch save that outlives the page", () => {
  it("is a keepalive request when the layout is small enough", async () => {
    await configurations.authBatchSave("cfg-1", [table(1), table(2)], 2, { keepalive: true });
    expect(lastInit().keepalive).toBe(true);
    await configurations.publicBatchSave("cfg-1", [table(1)], 2, { keepalive: true });
    expect(lastInit().keepalive).toBe(true);
  });

  it("is an ordinary request when its body is over the browser's limit", async () => {
    const tables = Array.from({ length: 400 }, (_, index) => table(index));
    expect(JSON.stringify({ expectedRevision: 2, objects: tables }).length).toBeGreaterThan(KEEPALIVE_BODY_LIMIT_BYTES);
    await configurations.authBatchSave("cfg-1", tables, 2, { keepalive: true });
    expect(lastInit().keepalive).toBeUndefined();
  });

  it("is an ordinary request unless asked", async () => {
    await configurations.authBatchSave("cfg-1", [table(1)], 2);
    expect(lastInit().keepalive).toBeUndefined();
  });
});
