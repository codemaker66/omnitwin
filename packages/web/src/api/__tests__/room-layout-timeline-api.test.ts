import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ get: vi.fn(), getAuthToken: vi.fn() }));
vi.mock("../client.js", () => ({
  api: { get: client.get },
  getAuthToken: client.getAuthToken,
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly details: unknown;
    constructor(status: number, message: string, code: string, details?: unknown) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
}));

const {
  freezePhaseLayoutSnapshot,
  getRoomLayoutTimeline,
  RoomLayoutTimelineResponseSchema,
} = await import("../room-layout-timeline.js");

const FREEZE_RESULT = {
  outcome: "created",
  eventId: "11111111-1111-4111-8111-111111111111",
  phaseId: "22222222-2222-4222-8222-222222222222",
  configurationId: "33333333-3333-4333-8333-333333333333",
  snapshotId: "44444444-4444-4444-8444-444444444444",
  canonicalSnapshotId: "55555555-5555-4555-8555-555555555555",
  snapshotHash: "a".repeat(64),
  proofDigest: "b".repeat(64),
  frozenBy: "66666666-6666-4666-8666-666666666666",
  status: "frozen",
  coordinateSpace: "real_m_v1",
  objectCount: 42,
  guestCount: 180,
  createdAt: "2026-07-18T12:00:00.000Z",
  frozenAt: "2026-07-18T12:00:00.000Z",
  supersedesSnapshotId: null,
} as const;

beforeEach(() => {
  client.get.mockReset();
  client.getAuthToken.mockReset();
  client.getAuthToken.mockResolvedValue("e2e-token");
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("room layout timeline API client", () => {
  it("sends venue-local scope and anchor date with the caller's abort signal", async () => {
    const controller = new AbortController();
    client.get.mockResolvedValue({});
    await getRoomLayoutTimeline({
      venueId: "11111111-1111-4111-8111-111111111111",
      spaceId: "22222222-2222-4222-8222-222222222222",
      scope: "day",
      anchorDate: "2026-10-25",
    }, controller.signal);

    const call = client.get.mock.calls[0];
    expect(call?.[0]).toContain("venueId=11111111-1111-4111-8111-111111111111");
    expect(call?.[0]).toContain("scope=day");
    expect(call?.[0]).toContain("anchorDate=2026-10-25");
    expect(call?.[2]).toBe(controller.signal);
  });

  it("requires the authoritative top-level range to match the nested range", () => {
    const parsed = RoomLayoutTimelineResponseSchema.safeParse({
      venueId: "11111111-1111-4111-8111-111111111111",
      spaceId: "22222222-2222-4222-8222-222222222222",
      timeZone: "Europe/London",
      from: "2026-10-25T04:00:00.000Z",
      to: "2026-10-26T04:00:00.000Z",
      range: {
        scope: "day",
        anchorDate: "2026-10-25",
        from: "2026-10-25T04:00:00.000Z",
        to: "2026-10-26T05:00:00.000Z",
      },
      frames: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts only exact 200/201 freeze responses and attaches auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: FREEZE_RESULT }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(freezePhaseLayoutSnapshot(
      { eventId: FREEZE_RESULT.eventId, phaseId: FREEZE_RESULT.phaseId },
      { configurationId: FREEZE_RESULT.configurationId },
    )).resolves.toEqual(FREEZE_RESULT);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/events/${FREEZE_RESULT.eventId}/phases/${FREEZE_RESULT.phaseId}/layout-snapshots`),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer e2e-token" }),
      }),
    );

    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ data: FREEZE_RESULT }),
      { status: 202, headers: { "Content-Type": "application/json" } },
    ));
    await expect(freezePhaseLayoutSnapshot(
      { eventId: FREEZE_RESULT.eventId, phaseId: FREEZE_RESULT.phaseId },
      { configurationId: FREEZE_RESULT.configurationId },
    )).rejects.toMatchObject({ status: 202, code: "UNEXPECTED_RESPONSE_STATUS" });
  });

  it("couples the HTTP status to the typed freeze outcome", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ data: FREEZE_RESULT }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    await expect(freezePhaseLayoutSnapshot(
      { eventId: FREEZE_RESULT.eventId, phaseId: FREEZE_RESULT.phaseId },
      { configurationId: FREEZE_RESULT.configurationId },
    )).rejects.toMatchObject({ status: 200, code: "RESPONSE_STATUS_OUTCOME_MISMATCH" });

    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ data: { ...FREEZE_RESULT, outcome: "already_current" } }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    ));
    await expect(freezePhaseLayoutSnapshot(
      { eventId: FREEZE_RESULT.eventId, phaseId: FREEZE_RESULT.phaseId },
      { configurationId: FREEZE_RESULT.configurationId },
    )).rejects.toMatchObject({ status: 201, code: "RESPONSE_STATUS_OUTCOME_MISMATCH" });

    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ data: { ...FREEZE_RESULT, outcome: "already_current" } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    await expect(freezePhaseLayoutSnapshot(
      { eventId: FREEZE_RESULT.eventId, phaseId: FREEZE_RESULT.phaseId },
      { configurationId: FREEZE_RESULT.configurationId },
    )).resolves.toMatchObject({ outcome: "already_current" });
  });

  it.each([
    ["eventId", "77777777-7777-4777-8777-777777777777"],
    ["phaseId", "88888888-8888-4888-8888-888888888888"],
    ["configurationId", "99999999-9999-4999-8999-999999999999"],
  ] as const)("rejects a valid freeze payload for the wrong %s", async (field, value) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { ...FREEZE_RESULT, [field]: value } }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    )));

    await expect(freezePhaseLayoutSnapshot(
      { eventId: FREEZE_RESULT.eventId, phaseId: FREEZE_RESULT.phaseId },
      { configurationId: FREEZE_RESULT.configurationId },
    )).rejects.toMatchObject({ status: 201, code: "RESPONSE_TARGET_MISMATCH" });
  });

  it("preserves the exact 409 conflict payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "This saved plan has no canonical planning snapshot.",
      code: "CONFIGURATION_CANONICAL_SNAPSHOT_MISSING",
    }), { status: 409, headers: { "Content-Type": "application/json" } })));

    await expect(freezePhaseLayoutSnapshot(
      { eventId: FREEZE_RESULT.eventId, phaseId: FREEZE_RESULT.phaseId },
      { configurationId: FREEZE_RESULT.configurationId },
    )).rejects.toMatchObject({
      status: 409,
      code: "CONFIGURATION_CANONICAL_SNAPSHOT_MISSING",
      message: "This saved plan has no canonical planning snapshot.",
    });
  });
});
