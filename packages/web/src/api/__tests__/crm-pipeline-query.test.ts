import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPipeline } from "../crm.js";
import { _resetTokenGetterForTests } from "../auth-bridge.js";

// ---------------------------------------------------------------------------
// The pipeline board pages, and the URL it pages with is load-bearing.
//
// `offset` only appears once it says something the server does not already
// assume. An ordinary first load must stay byte-identical to the request this
// client has always made: several e2e suites stand in for the API with a route
// handler registered on the exact path `/crm/pipeline`, and a stray `?offset=0`
// would slip past every one of them and leave the board on its error state.
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();

function pipelineBody(page?: Record<string, number>): Response {
  return new Response(JSON.stringify({
    data: {
      opportunities: [],
      todayTasks: [],
      stageCounts: { new: 0 },
      pipelineValueMinor: 0,
      currency: "GBP",
      ...(page === undefined ? {} : { page }),
    },
  }), { status: 200 });
}

function requestedUrl(call = 0): string {
  return String(fetchMock.mock.calls[call]?.[0] ?? "");
}

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); _resetTokenGetterForTests(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("pipeline request URL", () => {
  it("asks for the first page at the bare path, with no query string", async () => {
    fetchMock.mockResolvedValue(pipelineBody());
    await getPipeline();
    expect(requestedUrl().endsWith("/crm/pipeline")).toBe(true);
  });

  it("treats an explicit offset of zero as the first page, not as a parameter", async () => {
    // The board always passes its current offset, which starts at 0.
    fetchMock.mockResolvedValue(pipelineBody());
    await getPipeline({ offset: 0 });
    expect(requestedUrl().endsWith("/crm/pipeline")).toBe(true);
  });

  it("carries a real offset, and a limit whenever one is given", async () => {
    fetchMock.mockResolvedValue(pipelineBody());
    await getPipeline({ offset: 50 });
    expect(requestedUrl()).toContain("/crm/pipeline?offset=50");

    fetchMock.mockResolvedValue(pipelineBody());
    await getPipeline({ limit: 25, offset: 25 });
    expect(requestedUrl(1)).toContain("/crm/pipeline?limit=25&offset=25");
  });
});

describe("the pipeline desk's order and stage", () => {
  it("asks for the desk's order and one stage only when it says something", async () => {
    fetchMock.mockResolvedValue(pipelineBody());
    await getPipeline({ order: "due", limit: 50, stage: "qualified" });
    expect(requestedUrl()).toContain("/crm/pipeline?limit=50&order=due&stage=qualified");

    fetchMock.mockResolvedValue(pipelineBody());
    await getPipeline({ order: "recent" });
    expect(requestedUrl(1).endsWith("/crm/pipeline")).toBe(true);
  });

  it("reads the stage values, due counts and names, and still loads an API from before them", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: {
      opportunities: [{
        id: "o1", venueId: "v1", clientAccountId: null, primaryContactId: null, sourceEnquiryId: null, ownerUserId: null,
        title: "Henderson wedding", stage: "new", eventType: null, preferredDate: null, guestCount: null, estimatedValueMinor: 0,
        currency: "GBP", nextAction: "Confirm", nextActionDueAt: null, createdAt: "2026-10-01T09:00:00.000Z",
        updatedAt: "2026-10-01T09:00:00.000Z", closedAt: null, deletedAt: null,
      }],
      todayTasks: [], stageCounts: { new: 1 },
    } }), { status: 200 }));
    const older = await getPipeline();
    expect(older.opportunities[0]?.contactName).toBeNull();
    expect(older.stageValues).toBeUndefined();
    expect(older.due).toBeUndefined();

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: {
      opportunities: [], todayTasks: [], stageCounts: { new: 0 }, stageValues: { new: 0 }, due: { overdue: 2, today: 1 },
    } }), { status: 200 }));
    const newer = await getPipeline({ order: "due" });
    expect(newer.due).toEqual({ overdue: 2, today: 1 });
    expect(newer.stageValues).toEqual({ new: 0 });
  });
});

describe("pipeline paging block", () => {
  it("reads the page block through when the server sends one", async () => {
    fetchMock.mockResolvedValue(pipelineBody({
      total: 312, limit: 50, offset: 50, taskTotal: 4, taskLimit: 50, taskOffset: 0,
    }));
    const summary = await getPipeline({ offset: 50 });
    expect(summary.page).toEqual({
      total: 312, limit: 50, offset: 50, taskTotal: 4, taskLimit: 50, taskOffset: 0,
    });
  });

  it("still loads against an API that does not send one yet", async () => {
    // A web build briefly ahead of the API renders without paging controls
    // rather than failing the whole board at the response boundary.
    fetchMock.mockResolvedValue(pipelineBody());
    const summary = await getPipeline();
    expect(summary.page).toBeUndefined();
    expect(summary.stageCounts).toEqual({ new: 0 });
  });
});
