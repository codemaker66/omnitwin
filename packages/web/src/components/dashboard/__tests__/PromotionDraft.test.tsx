import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdPromotionActionPath, type Notification, type PromotionDraft as Draft } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { useAuthStore, type AuthUser } from "../../../stores/auth-store.js";
import { NotificationCenter } from "../NotificationCenter.js";
import { draftMailto } from "../PromotionDraft.js";

// The promoted 2nd option's notice (Blake, 26 September 2026): the owner reads
// the drafted email in place, can change it, and sends it from their own
// email. Nothing here sends anything.

const mocks = vi.hoisted(() => ({ list: vi.fn(), markRead: vi.fn(), subscribe: vi.fn(), draft: vi.fn() }));
vi.mock("../../../api/notifications.js", () => ({
  listNotifications: mocks.list,
  markNotificationRead: mocks.markRead,
}));
vi.mock("../../../api/diary.js", () => ({ getPromotionDraft: mocks.draft }));
vi.mock("../../../lib/requests-live.js", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/requests-live.js")>("../../../lib/requests-live.js");
  return { listensForFloorRequests: actual.listensForFloorRequests, subscribeRequestsLive: mocks.subscribe };
});

const sales: AuthUser = {
  id: "00000000-0000-4000-8000-0000000000c1", name: "Sam", email: "sam@example.test",
  role: "sales", platformRole: "none", venueId: "00000000-0000-4000-8000-00000000a001",
};

const HOLD = "00000000-0000-4000-8000-00000000b0b0";

function notice(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "00000000-0000-4000-8000-00000000d001",
    changeId: null,
    eventId: null,
    venueId: "00000000-0000-4000-8000-00000000a001",
    audienceRole: "sales",
    recipientUserId: sales.id,
    title: "Now 1st option: Saturday 15 June 2030, Grand Hall",
    body: "MacLeod wedding has moved up. The hold ahead of it was released by Moira Stewart.",
    severity: "attention",
    actionPath: holdPromotionActionPath("2030-06-15", HOLD),
    readAt: null,
    createdAt: "2030-05-01T09:00:00.000Z",
    ...overrides,
  };
}

const DRAFT: Draft = {
  bookingId: HOLD,
  to: { name: "Jane MacLeod", email: "jane.macleod@example.test", source: "enquiry" },
  subject: "Your date at Trades Hall: Saturday 15 June 2030, Grand Hall",
  body: "Dear Jane,\n\nYour provisional booking of the Grand Hall on Saturday 15 June 2030 is now 1st option.",
};

function Shell(): ReactElement {
  const [expanded, setExpanded] = useState(true);
  return <NotificationCenter unreadCount={1} onUnreadChanged={() => undefined} expanded={expanded} onExpandedChange={setExpanded} />;
}

function renderCenter(): void {
  render(<MemoryRouter><Shell /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.subscribe.mockReturnValue(() => undefined);
  useAuthStore.setState({ user: sales });
});
afterEach(() => { cleanup(); });

describe("draftMailto", () => {
  it("carries the address, subject and body, with spaces as %20", () => {
    expect(draftMailto("jane@example.test", "Your date", "Dear Jane,\nYes & no"))
      .toBe("mailto:jane%40example.test?subject=Your%20date&body=Dear%20Jane%2C%0AYes%20%26%20no");
    expect(draftMailto(null, "S", "B")).toBe("mailto:?subject=S&body=B");
  });
});

describe("a promoted hold's notice", () => {
  it("opens the drafted email in place, with whom it goes to and what happens next", async () => {
    mocks.list.mockResolvedValue([notice()]);
    mocks.draft.mockResolvedValue(DRAFT);
    renderCenter();

    const open = await screen.findByRole("button", { name: /Read the draft: Now 1st option/u });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    expect(mocks.draft).not.toHaveBeenCalled();
    fireEvent.click(open);
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(mocks.draft).toHaveBeenCalledWith(HOLD, expect.any(AbortSignal));

    await screen.findByText("Jane MacLeod, jane.macleod@example.test (from the enquiry)");
    screen.getByText(DRAFT.subject);
    screen.getByText("Open in your email starts a new message with these words. Nothing is sent until you send it.");
    const body = screen.getByLabelText<HTMLTextAreaElement>("Email");
    expect(body.value).toBe(DRAFT.body);

    // The person's own changes are what their email opens with.
    fireEvent.change(body, { target: { value: "Dear Jane,\n\nShort note." } });
    const link = screen.getByRole("link", { name: "Open in your email" });
    expect(link.getAttribute("href")).toBe(draftMailto("jane.macleod@example.test", DRAFT.subject, "Dear Jane,\n\nShort note."));

    // Reading the draft marks nothing and sends nothing.
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it("says when no client email is recorded, and still offers the words", async () => {
    mocks.list.mockResolvedValue([notice()]);
    mocks.draft.mockResolvedValue({ ...DRAFT, to: null });
    renderCenter();
    fireEvent.click(await screen.findByRole("button", { name: /Read the draft/u }));
    await screen.findByText(/No client email is recorded on this hold\. Add one to the enquiry/u);
    expect(screen.getByRole("link", { name: "Open in your email" }).getAttribute("href")).toMatch(/^mailto:\?subject=/u);
  });

  it("says, in the server's words, when the hold has moved on, and offers another try for anything else", async () => {
    mocks.list.mockResolvedValue([notice()]);
    mocks.draft.mockRejectedValueOnce(new ApiError(409,
      "This hold is no longer 1st option, so there is nothing to send. Open it in the Diary to see where it stands.",
      "NOT_FIRST_OPTION"));
    renderCenter();
    fireEvent.click(await screen.findByRole("button", { name: /Read the draft/u }));
    expect((await screen.findByRole("alert")).textContent).toContain("This hold is no longer 1st option");

    mocks.draft.mockRejectedValueOnce(new Error("network"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(screen.getByRole("alert").textContent).toContain("The draft could not be prepared."); });
    mocks.draft.mockResolvedValueOnce(DRAFT);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByLabelText<HTMLTextAreaElement>("Email")).value).toBe(DRAFT.body);
  });

  it("offers no draft on any other notification", async () => {
    mocks.list.mockResolvedValue([notice({ actionPath: "/dashboard?view=enquiries", title: "A new enquiry" })]);
    renderCenter();
    const item = (await screen.findByText("A new enquiry")).closest("li");
    if (item === null) throw new Error("notification item missing");
    expect(within(item).queryByRole("button", { name: /Read the draft/u })).toBeNull();
  });
});
