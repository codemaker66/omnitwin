import { beforeEach, describe, expect, it, vi } from "vitest";
import { HallkeeperSheetSummarySchema } from "@omnitwin/types";

const client = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../client.js", () => ({ api: { get: client.get } }));

const { getSheetSummary } = await import("../hallkeeper-summary.js");

const CONFIG = "33333333-3333-4333-8333-333333333333";
const EVENT = "11111111-1111-4111-8111-111111111111";

beforeEach(() => { client.get.mockReset(); });

// The summary carries when setup starts only when asked (#454 round 1): older
// web code reads it with a strict schema, so the server sends the key only to
// the code that knows it. This page knows it, so it always asks.
describe("getSheetSummary", () => {
  it("asks for when setup starts, with the event the board arrived from", async () => {
    const signal = new AbortController().signal;
    await getSheetSummary(CONFIG, EVENT, signal);
    expect(client.get).toHaveBeenCalledWith(`/hallkeeper/${CONFIG}/summary?eventId=${EVENT}&setupFrom=true`, HallkeeperSheetSummarySchema, signal);
  });

  it("asks for when setup starts with no event too", async () => {
    await getSheetSummary(CONFIG, null);
    expect(client.get).toHaveBeenCalledWith(`/hallkeeper/${CONFIG}/summary?setupFrom=true`, HallkeeperSheetSummarySchema, undefined);
  });
});
