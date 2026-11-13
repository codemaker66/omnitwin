import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  VENUE_TEAM_ROLE_LABELS,
  VENUE_TEAM_ROLE_SUMMARIES,
  VENUE_TEAM_ROLES,
  type InviteVenueTeamMemberResult,
  type VenueTeam,
  type VenueTeamEmailDelivery,
  type VenueTeamInvitation,
} from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { TeamView } from "../TeamView.js";

const VENUE_ID = "00000000-0000-4000-8000-000000007001";
const ADMIN_ID = "00000000-0000-4000-8000-000000007002";
const HALLKEEPER_ID = "00000000-0000-4000-8000-000000007003";
const INVITE_ID = "00000000-0000-4000-8000-000000007004";
const NEW_INVITE_ID = "00000000-0000-4000-8000-000000007005";

const mocks = vi.hoisted(() => ({
  getVenueTeam: vi.fn(),
  inviteVenueTeamMember: vi.fn(),
  cancelVenueTeamInvitation: vi.fn(),
  authState: {
    user: {
      id: "00000000-0000-4000-8000-000000007002",
      email: "elaine@tradeshall.test",
      role: "admin",
      platformRole: "none" as "none" | "operator" | "admin",
      venueId: "00000000-0000-4000-8000-000000007001" as string | null,
      name: "Elaine Campbell",
    },
  },
}));

vi.mock("../../../api/venue-team.js", () => ({
  getVenueTeam: mocks.getVenueTeam,
  inviteVenueTeamMember: mocks.inviteVenueTeamMember,
  cancelVenueTeamInvitation: mocks.cancelVenueTeamInvitation,
}));

vi.mock("../../../stores/auth-store.js", () => ({
  useAuthStore: (selector: (state: typeof mocks.authState) => unknown): unknown => selector(mocks.authState),
}));

const ANNA: VenueTeamInvitation = {
  id: INVITE_ID,
  email: "anna@tradeshall.test",
  role: "sales",
  invitedAt: "2026-10-20T12:00:00.000Z",
  expiresAt: "2026-11-19T12:00:00.000Z",
  invitedByName: "Elaine Campbell",
};

const NEWCOMER: VenueTeamInvitation = {
  id: NEW_INVITE_ID,
  email: "new@tradeshall.test",
  role: "manager",
  invitedAt: "2026-10-25T12:00:00.000Z",
  expiresAt: "2026-11-24T12:00:00.000Z",
  invitedByName: "Elaine Campbell",
};

function team(overrides: Partial<VenueTeam> = {}): VenueTeam {
  return {
    members: [
      { id: ADMIN_ID, name: "Elaine Campbell", email: "elaine@tradeshall.test", role: "admin", joinedAt: "2025-03-03T12:00:00.000Z" },
      { id: HALLKEEPER_ID, name: "Rory Douglas", email: "rory@tradeshall.test", role: "hallkeeper", joinedAt: "2025-06-10T12:00:00.000Z" },
    ],
    invitations: [ANNA],
    ...overrides,
  };
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void; readonly reject: (error: unknown) => void } {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((settle, fail) => { resolve = settle; reject = fail; });
  return { promise, resolve, reject };
}

function statusWith(text: string): HTMLElement | undefined {
  return screen.queryAllByRole("status").find((node) => node.textContent === text);
}

async function fillInvite(email: string, roleName: string): Promise<void> {
  fireEvent.change(await screen.findByLabelText("Email address"), { target: { value: email } });
  fireEvent.click(screen.getByRole("radio", { name: roleName }));
}

function emailField(): HTMLInputElement {
  const field = screen.getByLabelText("Email address");
  if (!(field instanceof HTMLInputElement)) throw new Error("The email field is not an input");
  return field;
}

/** The inline confirm for Anna's invitation (the role choice is a group too). */
const ANNA_CONFIRM = { name: "Cancel the invitation for anna@tradeshall.test?" } as const;

function radio(name: string): HTMLInputElement {
  const option = screen.getByRole("radio", { name });
  if (!(option instanceof HTMLInputElement)) throw new Error(`${name} is not an input`);
  return option;
}

beforeEach(() => {
  mocks.getVenueTeam.mockReset();
  mocks.inviteVenueTeamMember.mockReset();
  mocks.cancelVenueTeamInvitation.mockReset();
  mocks.authState.user = { ...mocks.authState.user, platformRole: "none", venueId: VENUE_ID };
  mocks.getVenueTeam.mockResolvedValue(team());
});

afterEach(() => {
  cleanup();
});

describe("TeamView: reading the team", () => {
  it("shows the working capsule while the team loads, then who has access and who is waiting", async () => {
    const pending = deferred<VenueTeam>();
    mocks.getVenueTeam.mockReset().mockReturnValueOnce(pending.promise);
    render(<TeamView />);

    expect(statusWith("Loading the team…")).toBeDefined();
    expect(mocks.getVenueTeam).toHaveBeenCalledWith(VENUE_ID, expect.any(AbortSignal));
    await act(async () => { pending.resolve(team()); await pending.promise; });

    expect(statusWith("Loading the team…")).toBeUndefined();
    const waiting = screen.getByRole("region", { name: "Waiting to join" });
    expect(within(waiting).getByText("anna@tradeshall.test")).toBeTruthy();
    expect(within(waiting).getByText("Sales")).toBeTruthy();
    expect(within(waiting).getByText("Invited by Elaine Campbell")).toBeTruthy();
    expect(within(waiting).getByText("Open until 19 November 2026")).toBeTruthy();

    const access = screen.getByRole("region", { name: "Has access" });
    expect(within(access).getByText("Rory Douglas")).toBeTruthy();
    expect(within(access).getByText("rory@tradeshall.test")).toBeTruthy();
    expect(within(access).getByText("Hallkeeper")).toBeTruthy();
    expect(within(access).getByText("Joined 10 June 2025")).toBeTruthy();
    expect(within(access).getByText("Venue administrator")).toBeTruthy();
    // The person looking is marked, once.
    expect(within(access).getAllByText("You")).toHaveLength(1);
  });

  it("says why the team could not be loaded and loads it again on Try again", async () => {
    const pending = deferred<VenueTeam>();
    mocks.getVenueTeam.mockReset()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(team());
    render(<TeamView />);
    expect(statusWith("Loading the team…")).toBeDefined();
    await act(async () => {
      pending.reject(new ApiError(403, "Only the venue's administrators manage its team", "FORBIDDEN"));
      await pending.promise.catch(() => undefined);
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The team could not be loaded. Nothing has changed.");
    expect(alert.textContent).toContain("Only the venue's administrators manage its team");
    expect(statusWith("Loading the team…")).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("anna@tradeshall.test")).toBeTruthy();
    expect(mocks.getVenueTeam).toHaveBeenCalledTimes(2);
  });

  it("says plainly when nobody is waiting to join", async () => {
    mocks.getVenueTeam.mockResolvedValue(team({ invitations: [] }));
    render(<TeamView />);
    expect(await screen.findByText("No invitations are waiting.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Cancel the invitation/u })).toBeNull();
  });

  it("tells a platform admin with no venue where each venue's access is managed, without asking the API", () => {
    mocks.authState.user = { ...mocks.authState.user, platformRole: "admin", venueId: null };
    render(<TeamView />);
    expect(screen.getByText(/Clients & access manages each venue's access/u)).toBeTruthy();
    expect(mocks.getVenueTeam).not.toHaveBeenCalled();
  });
});

describe("TeamView: inviting someone", () => {
  it("shows every role with what it opens", async () => {
    render(<TeamView />);
    await screen.findByRole("radio", { name: "Venue manager" });
    for (const role of VENUE_TEAM_ROLES) {
      const option = radio(VENUE_TEAM_ROLE_LABELS[role]);
      const described = (option.getAttribute("aria-describedby") ?? "").split(" ")
        .map((id) => document.getElementById(id)?.textContent);
      expect(described, role).toContain(VENUE_TEAM_ROLE_SUMMARIES[role]);
      // Nothing is chosen for them: each grant is a deliberate choice.
      expect(option.checked, role).toBe(false);
    }
  });

  it.each([
    ["sent", "The invitation went to new@tradeshall.test. They join by signing up with that address.", false],
    ["not_configured", "Access is recorded for new@tradeshall.test, but this site is not sending email yet. Share the sign-up link with them; they join by signing up with that address.", true],
    ["not_sent", "Access is recorded for new@tradeshall.test, but the email did not go out. Share the sign-up link with them; they join by signing up with that address.", true],
  ] as const satisfies readonly (readonly [VenueTeamEmailDelivery, string, boolean])[])(
    "invites by email and role, and says what became of the email when it was %s",
    async (delivery, line, offersLink) => {
      const result: InviteVenueTeamMemberResult = { invitation: NEWCOMER, emailDelivery: delivery };
      mocks.getVenueTeam.mockReset()
        .mockResolvedValueOnce(team())
        .mockResolvedValueOnce(team({ invitations: [NEWCOMER, ANNA] }));
      mocks.inviteVenueTeamMember.mockResolvedValue(result);
      render(<TeamView />);

      await fillInvite("new@tradeshall.test", "Venue manager");
      fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

      await waitFor(() => { expect(statusWith(line)).toBeDefined(); });
      expect(mocks.inviteVenueTeamMember).toHaveBeenCalledWith(VENUE_ID, { email: "new@tradeshall.test", role: "manager" });
      expect(within(screen.getByRole("region", { name: "Waiting to join" })).getByText("new@tradeshall.test")).toBeTruthy();
      // Ready for the next person, with no role carried over.
      expect(emailField().value).toBe("");
      expect(radio("Venue manager").checked).toBe(false);

      const link = screen.queryByLabelText("Sign-up link");
      if (offersLink) {
        expect(link).toBeInstanceOf(HTMLInputElement);
        expect((link as HTMLInputElement).value).toBe(`${window.location.origin}/register`);
        expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
      } else {
        expect(link).toBeNull();
      }
      // The list is read again for anything the send replaced.
      await waitFor(() => { expect(mocks.getVenueTeam).toHaveBeenCalledTimes(2); });
    },
  );

  it("shows the working state while the invitation is sending", async () => {
    const pending = deferred<InviteVenueTeamMemberResult>();
    mocks.inviteVenueTeamMember.mockReturnValueOnce(pending.promise);
    render(<TeamView />);
    await fillInvite("new@tradeshall.test", "Events staff");
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    const working = await screen.findByRole("button", { name: "Sending invitation…" });
    expect(working.getAttribute("aria-busy")).toBe("true");
    expect(working.querySelector("[data-activity-indicator]")).not.toBeNull();
    // A second press while it sends does not send twice.
    fireEvent.click(working);
    expect(mocks.inviteVenueTeamMember).toHaveBeenCalledTimes(1);

    await act(async () => { pending.resolve({ invitation: NEWCOMER, emailDelivery: "sent" }); await pending.promise; });
    expect(screen.getByRole("button", { name: "Send invitation" }).getAttribute("aria-busy")).toBe("false");
  });

  it("asks for the address and then the role before sending anything", async () => {
    render(<TeamView />);
    await screen.findByLabelText("Email address");

    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(screen.getAllByRole("alert").map((node) => node.textContent)).toEqual([
      "Enter the email address they will sign up with.",
      "Choose what they can open at the venue.",
    ]);
    expect(document.activeElement).toBe(emailField());
    expect(emailField().getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(emailField(), { target: { value: "not an address" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(screen.getByText("Enter a whole email address, such as name@example.com.")).toBeTruthy();

    fireEvent.change(emailField(), { target: { value: "new@tradeshall.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(screen.getAllByRole("alert").map((node) => node.textContent)).toEqual(["Choose what they can open at the venue."]);
    expect(document.activeElement).toBe(radio(VENUE_TEAM_ROLE_LABELS.admin));
    expect(mocks.inviteVenueTeamMember).not.toHaveBeenCalled();
  });

  it("shows a refusal in the API's own words and keeps what was typed", async () => {
    const refusal = "This account already belongs to another venue. Its access has not been changed.";
    mocks.inviteVenueTeamMember.mockRejectedValue(new ApiError(409, refusal, "ACCOUNT_VENUE_CONFLICT"));
    render(<TeamView />);
    await fillInvite("someone@elsewhere.test", "Sales");
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(refusal);
    expect(emailField().value).toBe("someone@elsewhere.test");
    expect(radio("Sales").checked).toBe(true);
    // A refusal recorded nothing, so the list is not read again and no outcome is claimed.
    expect(mocks.getVenueTeam).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Sign-up link")).toBeNull();
  });

  it("says when a send could not be confirmed, and reads the list again", async () => {
    mocks.inviteVenueTeamMember.mockRejectedValue(new ApiError(0, "Network error — check your connection", "NETWORK_ERROR"));
    render(<TeamView />);
    await fillInvite("new@tradeshall.test", "Hallkeeper");
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("The invitation could not be confirmed. It may have been recorded, so check the list below before sending again.");
    await waitFor(() => { expect(mocks.getVenueTeam).toHaveBeenCalledTimes(2); });
  });

  it("says what the list already knows about an address as it is typed", async () => {
    render(<TeamView />);
    fireEvent.change(await screen.findByLabelText("Email address"), { target: { value: "ANNA@tradeshall.test" } });
    expect(screen.getByText("anna@tradeshall.test is already waiting to join as Sales. Sending again replaces that invitation.")).toBeTruthy();
    fireEvent.change(emailField(), { target: { value: "rory@tradeshall.test" } });
    expect(screen.getByText("rory@tradeshall.test already has access as Hallkeeper.")).toBeTruthy();
    expect(emailField().getAttribute("aria-describedby")).not.toBeNull();
  });

  it("copies the sign-up link, and says how to copy it by hand when it cannot", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Clipboard blocked"))
      .mockResolvedValueOnce(undefined);
    // An own property shadows the environment's clipboard for this test only.
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      mocks.inviteVenueTeamMember.mockResolvedValue({ invitation: NEWCOMER, emailDelivery: "not_configured" });
      render(<TeamView />);
      await fillInvite("new@tradeshall.test", "Venue manager");
      fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

      fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));
      expect((await screen.findByRole("alert")).textContent).toBe("Copying is not available here. Select the link and copy it.");
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
      expect(await screen.findByRole("button", { name: "Link copied" })).toBeTruthy();
      expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/register`);
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });
});

describe("TeamView: cancelling an invitation", () => {
  it("asks inline first, keeps it on Keep it or Escape, and cancels only on confirm", async () => {
    mocks.getVenueTeam.mockReset()
      .mockResolvedValueOnce(team())
      .mockResolvedValueOnce(team({ invitations: [] }));
    mocks.cancelVenueTeamInvitation.mockResolvedValue(undefined);
    render(<TeamView />);

    const trigger = await screen.findByRole("button", { name: "Cancel the invitation for anna@tradeshall.test" });
    fireEvent.click(trigger);
    const question = screen.getByRole("group", ANNA_CONFIRM);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(question.textContent).toContain("They will no longer be able to join with it.");
    // It opens on the safe answer.
    expect(document.activeElement).toBe(within(question).getByRole("button", { name: "Keep it" }));

    fireEvent.click(within(question).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("group", ANNA_CONFIRM)).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.keyDown(within(screen.getByRole("group", ANNA_CONFIRM)).getByRole("button", { name: "Keep it" }), { key: "Escape" });
    expect(screen.queryByRole("group", ANNA_CONFIRM)).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(mocks.cancelVenueTeamInvitation).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole("group", ANNA_CONFIRM)).getByRole("button", { name: "Cancel invitation" }));
    await waitFor(() => { expect(mocks.cancelVenueTeamInvitation).toHaveBeenCalledWith(VENUE_ID, INVITE_ID); });

    expect(await screen.findByText("The invitation for anna@tradeshall.test is cancelled.")).toBeTruthy();
    expect(screen.getByText("No invitations are waiting.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Waiting to join" }));
    await waitFor(() => { expect(mocks.getVenueTeam).toHaveBeenCalledTimes(2); });
  });

  it("shows a cancel refusal as given and reads the list again when it was already used", async () => {
    const refusal = "This invitation has already been accepted or cancelled. Existing account access has not changed.";
    mocks.cancelVenueTeamInvitation.mockRejectedValue(new ApiError(409, refusal, "INVITATION_NOT_PENDING"));
    render(<TeamView />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel the invitation for anna@tradeshall.test" }));
    fireEvent.click(within(screen.getByRole("group", ANNA_CONFIRM)).getByRole("button", { name: "Cancel invitation" }));

    expect((await screen.findByRole("alert")).textContent).toBe(refusal);
    await waitFor(() => { expect(mocks.getVenueTeam).toHaveBeenCalledTimes(2); });
  });
});
