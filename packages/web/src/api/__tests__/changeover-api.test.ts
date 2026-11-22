import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeoverFailure, getChangeover, type ChangeoverFailure } from "../changeover.js";
import { _resetTokenGetterForTests } from "../auth-bridge.js";

// ---------------------------------------------------------------------------
// Why the floor could not read what moves, from the client's side. The
// changeover route names the layouts on each refusal of its own (routes/
// hallkeeper-sheet.ts), and the panel says those once, with no retry. An
// answer that names none is not about these layouts: an API that does not
// serve the route yet answers a plain not-found, and the sign-in gate a
// plain refusal, so the panel offers Try again rather than a removed layout.
// ---------------------------------------------------------------------------

const FROM = "00000000-0000-4000-8000-0000000000c7";
const TO = "00000000-0000-4000-8000-0000000000c8";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  _resetTokenGetterForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** What the floor makes of the API's answer to a changeover read. */
async function failureOf(status: number, body: unknown): Promise<ChangeoverFailure> {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  const error = await getChangeover({ from: FROM, to: TO }).then(() => null, (reason: unknown) => reason);
  return changeoverFailure(error);
}

describe("changeoverFailure", () => {
  it("reads an answer that names no layouts as for now: an API without the route, the sign-in gate", async () => {
    // The web can be served before the API that answers it, or the API rolled
    // back alone: its not-found handler answers the route itself.
    expect(await failureOf(404, { error: `Route GET /hallkeeper/changeover?from=${FROM}&to=${TO} not found.`, code: "NOT_FOUND" }))
      .toEqual({ lasting: false });
    expect(await failureOf(403, { error: "Invitation required", code: "INVITATION_REQUIRED" })).toEqual({ lasting: false });
  });

  it("keeps each refusal of the route's own lasting, with the layouts it names", async () => {
    expect(await failureOf(404, { error: "Configuration not found", code: "NOT_FOUND", details: { configIds: [TO] } }))
      .toEqual({ lasting: true, reason: "removed", configIds: [TO] });
    expect(await failureOf(403, { error: "Insufficient permissions", code: "FORBIDDEN", details: { configIds: [FROM] } }))
      .toEqual({ lasting: true, reason: "no-access", configIds: [FROM] });
    expect(await failureOf(409, { error: "A changeover runs between two layouts of one room", code: "NOT_ONE_ROOM", details: { configIds: [FROM, TO] } }))
      .toEqual({ lasting: true, reason: "rooms", configIds: [FROM, TO] });
    expect(await failureOf(503, {
      error: "The approved setup sheet is unavailable. Contact venue staff before using a replacement.",
      code: "APPROVED_SNAPSHOT_UNAVAILABLE",
      details: { configIds: [TO] },
    })).toEqual({ lasting: true, reason: "unreadable", configIds: [TO] });
  });
});
