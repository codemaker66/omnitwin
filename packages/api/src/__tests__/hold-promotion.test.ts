import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { composePromotionDraft, composePromotionNotice } from "../services/hold-promotion.js";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

// ---------------------------------------------------------------------------
// The promoted 2nd option's words (Blake, 26 September 2026). The database
// behaviour — same transaction, every exit, the office fallback, who may read
// the draft — is proven in hold-promotion-postgres.test.ts; these pin the copy
// and the route's boundary without a database.
// ---------------------------------------------------------------------------

describe("composePromotionNotice", () => {
  const base = {
    holdTitle: "MacLeod wedding",
    spaceName: "Grand Hall",
    venueDay: "Saturday 15 June 2030",
    joint: false,
    exit: "released" as const,
    movedBy: "Moira Stewart",
    officeContact: null,
    owned: true,
  };

  it("says what happened, who did it, and that nothing was sent", () => {
    expect(composePromotionNotice(base)).toEqual({
      title: "Now 1st option: Saturday 15 June 2030, Grand Hall",
      body: "MacLeod wedding has moved up. The hold ahead of it was released by Moira Stewart. "
        + "A drafted email to your client is ready for you to read, change and send from your own email. Nothing has been sent.",
    });
  });

  it("names who in the office confirms or releases it for an owner who cannot", () => {
    const text = composePromotionNotice({ ...base, exit: "expired", officeContact: "Moira Stewart" });
    expect(text.body).toContain("The hold ahead of it was marked as lapsed by Moira Stewart.");
    expect(text.body).toContain("When the client answers, Moira Stewart in the office will confirm or release the hold.");
  });

  it("says joint 1st option, and gives an unowned hold a way forward", () => {
    expect(composePromotionNotice({ ...base, joint: true }).title).toBe("Now joint 1st option: Saturday 15 June 2030, Grand Hall");
    const unowned = composePromotionNotice({ ...base, owned: false, exit: "lost" });
    expect(unowned.title).toBe("1st option, no owner: Saturday 15 June 2030, Grand Hall");
    expect(unowned.body).toContain("Give it an owner in the Diary");
    expect(unowned.body).toContain("Nothing has been sent.");
  });

  it("uses no system words", () => {
    const text = JSON.stringify(composePromotionNotice({ ...base, officeContact: "Moira Stewart" }));
    for (const word of ["rank", "ladder", "pencil", " ink", "resequence", "hash", "snapshot", "token"]) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });
});

describe("composePromotionDraft", () => {
  const base = {
    contactName: "Jane MacLeod",
    spaceName: "Grand Hall",
    venueName: "Trades Hall",
    venueDay: "Saturday 15 June 2030",
    joint: false,
    decisionDay: "Thursday 30 May 2030",
    senderName: "Sam Morrison",
  };

  it("writes a plain, signed email with the decision date", () => {
    const draft = composePromotionDraft(base);
    expect(draft.subject).toBe("Your date at Trades Hall: Saturday 15 June 2030, Grand Hall");
    expect(draft.body.split("\n")[0]).toBe("Dear Jane,");
    expect(draft.body).toContain("Your provisional booking of the Grand Hall on Saturday 15 June 2030 is now 1st option.");
    expect(draft.body).toContain("I can hold the date for you until Thursday 30 May 2030.");
    expect(draft.body.endsWith("Sam Morrison\nTrades Hall")).toBe(true);
  });

  it("falls back plainly when there is no name, no date ahead, or the room already says 'the'", () => {
    const draft = composePromotionDraft({ ...base, contactName: null, decisionDay: null, spaceName: "The Saloon", senderName: null, joint: true });
    expect(draft.body.split("\n")[0]).toBe("Hello,");
    expect(draft.body).toContain("Your provisional booking of The Saloon on Saturday 15 June 2030 is now joint 1st option.");
    expect(draft.body).toContain("Please let me know whether you would like to confirm, and I will take you through the next steps.");
    expect(draft.body.endsWith("Kind regards,\n\nTrades Hall")).toBe(true);
  });

  it("carries no praise or cheerleading", () => {
    const body = composePromotionDraft(base).body.toLowerCase();
    for (const word of ["great news", "good news", "congratulations", "exciting", "!"]) expect(body).not.toContain(word);
  });
});

describe("GET /bookings/:id/promotion-draft", () => {
  let server: FastifyInstance;
  beforeAll(async () => { server = await buildServer(); });
  afterAll(async () => { await server.close(); });

  const token = JSON.stringify({ id: "00000000-0000-4000-8000-000000000099", email: "sales@test.com", role: "sales",
    venueId: "00000000-0000-4000-8000-000000000001" });

  it("needs a signed-in person", async () => {
    const res = await server.inject({ method: "GET", url: "/bookings/00000000-0000-4000-8000-000000000003/promotion-draft" });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a booking id that is not a uuid", async () => {
    const res = await server.inject({
      method: "GET", url: "/bookings/not-a-booking/promotion-draft", headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });
});
