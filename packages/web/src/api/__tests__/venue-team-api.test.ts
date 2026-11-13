import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VenueTeam } from "@omnitwin/types";
import { API_URL } from "../../config/env.js";
import { _resetTokenGetterForTests } from "../auth-bridge.js";
import { cancelVenueTeamInvitation, getVenueTeam, inviteVenueTeamMember } from "../venue-team.js";

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
const venueId = "00000000-0000-4000-8000-000000007101";
const invitationId = "00000000-0000-4000-8000-000000007102";
const invitation = {
  id: invitationId,
  email: "anna@tradeshall.test",
  role: "sales",
  invitedAt: "2026-10-20T12:00:00.000Z",
  expiresAt: "2026-11-19T12:00:00.000Z",
  invitedByName: "Elaine Campbell",
} as const;
const team: VenueTeam = {
  members: [{ id: "00000000-0000-4000-8000-000000007103", name: "Elaine Campbell", email: "elaine@tradeshall.test", role: "admin", joinedAt: "2025-03-03T12:00:00.000Z" }],
  invitations: [invitation],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); _resetTokenGetterForTests(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("the venue team API boundary", () => {
  it("reads the team from the venue's own address and validates it", async () => {
    fetchMock.mockResolvedValue(json({ data: team }));
    await expect(getVenueTeam(venueId)).resolves.toEqual(team);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API_URL}/venues/${venueId}/team`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it("refuses a team the contract does not describe", async () => {
    fetchMock.mockResolvedValue(json({ data: { ...team, invitations: [{ ...invitation, role: "owner" }] } }));
    await expect(getVenueTeam(venueId)).rejects.toMatchObject({ code: "RESPONSE_VALIDATION_ERROR" });
  });

  it("posts the email and role, and returns what became of the email", async () => {
    fetchMock.mockResolvedValue(json({ data: { invitation, emailDelivery: "not_configured" } }, 201));
    await expect(inviteVenueTeamMember(venueId, { email: "anna@tradeshall.test", role: "sales" }))
      .resolves.toEqual({ invitation, emailDelivery: "not_configured" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${API_URL}/venues/${venueId}/team/invitations`);
    expect(init?.method).toBe("POST");
    const body = init?.body;
    if (typeof body !== "string") throw new Error("The invitation was not sent as JSON text");
    expect(JSON.parse(body)).toEqual({ email: "anna@tradeshall.test", role: "sales" });
  });

  it("refuses an email delivery the contract does not name", async () => {
    fetchMock.mockResolvedValue(json({ data: { invitation, emailDelivery: "queued" } }, 201));
    await expect(inviteVenueTeamMember(venueId, { email: "anna@tradeshall.test", role: "sales" }))
      .rejects.toMatchObject({ code: "RESPONSE_VALIDATION_ERROR" });
  });

  it("keeps a refusal's own words and code", async () => {
    fetchMock.mockResolvedValue(json({ error: "This person already has this access at the venue.", code: "ALREADY_HAS_ACCESS" }, 409));
    await expect(inviteVenueTeamMember(venueId, { email: "anna@tradeshall.test", role: "sales" }))
      .rejects.toMatchObject({ status: 409, code: "ALREADY_HAS_ACCESS", message: "This person already has this access at the venue." });
  });

  it("sends nothing for an invitation the contract would refuse", async () => {
    await expect(inviteVenueTeamMember(venueId, { email: "not an address", role: "sales" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels with DELETE and accepts the 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(cancelVenueTeamInvitation(venueId, invitationId)).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${API_URL}/venues/${venueId}/team/invitations/${invitationId}`);
    expect(init?.method).toBe("DELETE");
  });
});
