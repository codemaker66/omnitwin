import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordFirstResponseResult, ReplyAlarm } from "@omnitwin/types";
import type { Enquiry, EnquiryPage, EnquiryStageCounts } from "../../../api/enquiries.js";
import type { VenueDetail } from "../../../api/spaces.js";
import { ApiError } from "../../../api/client.js";
import { EnquiriesView } from "../EnquiriesView.js";

// ---------------------------------------------------------------------------
// The Enquiries desk's first reply (migration 0100, run-first item 3): the
// reply-time alarm under the summary and on each row it flags, and the
// "Record a reply" control for a reply made outside Venviewer. Both are the
// venue's commercial team's alone, as the API's isVenueCommercialMember is.
// ---------------------------------------------------------------------------

const { mocks } = vi.hoisted(() => ({
  mocks: {
    addToast: vi.fn(),
    countEnquiryStages: vi.fn(),
    getEnquiry: vi.fn(),
    getEnquiryHistory: vi.fn(),
    getReplyAlarm: vi.fn(),
    getVenue: vi.fn(),
    listEnquiryPage: vi.fn(),
    recordFirstResponse: vi.fn(),
    transitionEnquiry: vi.fn(),
  },
}));

vi.mock("../../../api/enquiries.js", () => ({
  COUNTED_ENQUIRY_STATES: ["submitted", "under_review", "approved", "rejected", "withdrawn"],
  countEnquiryStages: mocks.countEnquiryStages,
  getEnquiry: mocks.getEnquiry,
  getEnquiryHistory: mocks.getEnquiryHistory,
  getReplyAlarm: mocks.getReplyAlarm,
  listEnquiryPage: mocks.listEnquiryPage,
  recordFirstResponse: mocks.recordFirstResponse,
  transitionEnquiry: mocks.transitionEnquiry,
}));

vi.mock("../../../api/spaces.js", () => ({ getVenue: mocks.getVenue }));
vi.mock("../../../api/crm.js", () => ({ createOpportunityFromEnquiry: vi.fn() }));
vi.mock("../../../api/diary.js", () => ({ getCalendar: vi.fn(), listEnquiryBookings: vi.fn() }));

vi.mock("../../../stores/toast-store.js", () => ({
  useToastStore: (selector: (state: { readonly addToast: typeof mocks.addToast }) => unknown): unknown => selector({ addToast: mocks.addToast }),
}));

vi.mock("../../../stores/auth-store.js", () => ({
  useAuthStore: (selector: (state: { readonly user: { readonly id: string; readonly name: string } }) => unknown): unknown =>
    selector({ user: { id: "user-elaine", name: "Elaine MacGregor" } }),
}));

vi.mock("../../ai/AIDraftPanel.js", () => ({ AIDraftPanel: () => <div>AI draft</div> }));
vi.mock("../../../hooks/use-ai-drafts-available.js", () => ({ useAIDraftsAvailable: () => false }));

// Thursday 24 September 2026, 15:00 in Glasgow (BST).
const NOW = Date.parse("2026-09-24T14:00:00.000Z");
const HOUR = 3_600_000;

function enquiry(n: number, overrides: Partial<Enquiry> = {}): Enquiry {
  return {
    id: `enquiry-${String(n)}`, venueId: "venue-1", spaceId: "space-1", configurationId: null, userId: null,
    guestEmail: null, guestPhone: null, guestName: null, state: "submitted", name: `Client ${String(n)}`,
    email: `client${String(n)}@example.com`, preferredDate: null, eventType: null, estimatedGuests: null,
    message: null, firstResponseAt: null, firstResponseBy: null, firstResponseChannel: null,
    createdAt: new Date(NOW - n * 10 * HOUR).toISOString(), updatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

function page(rows: readonly Enquiry[]): EnquiryPage {
  return { rows, total: rows.length, limit: 20, offset: 0, order: "created_desc" };
}

function counts(submitted: number): EnquiryStageCounts {
  return { all: submitted, byState: { submitted, under_review: 0, approved: 0, rejected: 0, withdrawn: 0 }, longestWaiting: null };
}

const VENUE: VenueDetail = {
  id: "venue-1", name: "Trades Hall Glasgow", slug: "trades-hall", address: "85 Glassford Street", logoUrl: null, brandColour: null,
  spaces: [{ id: "space-1", venueId: "venue-1", name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10.5", heightM: "7", floorPlanOutline: [] }],
};

/** Client 3 arrived 30 hours ago, and Client 9 (not on the first page) 90. */
const ALARM: ReplyAlarm = {
  thresholdHours: 24,
  overdue: 2,
  enquiries: [
    { id: "enquiry-9", arrivedAt: new Date(NOW - 90 * HOUR).toISOString() },
    { id: "enquiry-3", arrivedAt: new Date(NOW - 30 * HOUR).toISOString() },
  ],
  nextDueAt: null,
};

function recorded(id: string, overrides: Partial<RecordFirstResponseResult["firstResponse"]> = {}, changed = true): RecordFirstResponseResult {
  return {
    enquiryId: id,
    changed,
    firstResponse: { at: new Date(NOW).toISOString(), byUserId: "user-elaine", channel: "phone", recordedAt: new Date(NOW).toISOString(), ...overrides },
  };
}

function row(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${name},`, "u") });
}

/** The First reply section's one line, its parts read as one sentence. */
function replyLine(reply: HTMLElement): string {
  return reply.querySelector(".enq-reply__line")?.textContent ?? "";
}

async function openClient(n: number): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^Client ${String(n)},`, "u") }));
  return screen.findByRole("region", { name: "First reply" });
}

/** Lays the desk out as a wide screen does: the list and the panel side by side. */
function wideDesk(): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string): MediaQueryList => ({
    matches: query === "(min-width: 1180px)",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  wideDesk();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.getEnquiryHistory.mockResolvedValue([]);
  mocks.countEnquiryStages.mockResolvedValue(counts(3));
  mocks.getVenue.mockResolvedValue(VENUE);
  mocks.listEnquiryPage.mockResolvedValue(page([enquiry(1), enquiry(3), enquiry(5, { state: "under_review" })]));
  mocks.getReplyAlarm.mockResolvedValue(ALARM);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the reply-time alarm on the Enquiries desk", () => {
  it("says how many have waited past the mark, marks each listed one, and opens the longest", async () => {
    mocks.getEnquiry.mockResolvedValue(enquiry(9, { createdAt: new Date(NOW - 90 * HOUR).toISOString() }));
    render(<EnquiriesView replyVenueId="venue-1" />);

    const alarm = await screen.findByTestId("reply-alarm");
    expect(alarm.querySelector("p")?.textContent).toBe("2 enquiries have waited more than 24 hours for a first reply; the longest, 3 days.");
    // The flagged row says so, in its mark and in what is read out; the others do not.
    expect(within(row("Client 3")).getByTestId("reply-alarm-mark").textContent).toBe("No reply · 30 hours");
    expect(row("Client 3").getAttribute("aria-label")).toContain("no reply after 30 hours");
    expect(within(row("Client 1")).queryByTestId("reply-alarm-mark")).toBeNull();
    expect(within(row("Client 5")).queryByTestId("reply-alarm-mark")).toBeNull();

    // The longest-waiting is not on this page: it is read and opened.
    fireEvent.click(within(alarm).getByRole("button", { name: "Open the longest unanswered" }));
    const reply = await screen.findByRole("region", { name: "First reply" });
    expect(mocks.getEnquiry).toHaveBeenCalledWith("enquiry-9");
    expect(replyLine(reply)).toBe("No reply recorded after 3 days, past the 24-hour mark.");
  });

  it("says nothing, and reads no alarm, for someone who does not record replies", async () => {
    render(<EnquiriesView />);
    fireEvent.click(await screen.findByRole("button", { name: /^Client 3,/u }));
    await screen.findByRole("heading", { name: "Client 3", level: 2 });
    expect(mocks.getReplyAlarm).not.toHaveBeenCalled();
    expect(screen.queryByTestId("reply-alarm")).toBeNull();
    expect(screen.queryByRole("region", { name: "First reply" })).toBeNull();
    expect(screen.queryByTestId("reply-alarm-mark")).toBeNull();
  });

  it("offers no reply control for another venue's enquiry", async () => {
    mocks.listEnquiryPage.mockResolvedValue(page([enquiry(3, { venueId: "venue-2" })]));
    render(<EnquiriesView replyVenueId="venue-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /^Client 3,/u }));
    await screen.findByRole("heading", { name: "Client 3", level: 2 });
    expect(screen.queryByRole("region", { name: "First reply" })).toBeNull();
  });

  it("shows no alarm when it cannot be read, and the desk works on", async () => {
    mocks.getReplyAlarm.mockRejectedValue(new Error("Unavailable"));
    render(<EnquiriesView replyVenueId="venue-1" />);
    const reply = await openClient(3);
    expect(screen.queryByTestId("reply-alarm")).toBeNull();
    expect(within(reply).getByText("No reply recorded yet.")).toBeDefined();
    expect(within(reply).getByRole("button", { name: "Record a reply" })).toBeDefined();
  });
});

describe("recording a reply made outside Venviewer", () => {
  it("records a call made just now, says so, clears the mark and reads the alarm again", async () => {
    mocks.recordFirstResponse.mockResolvedValue(recorded("enquiry-3"));
    render(<EnquiriesView replyVenueId="venue-1" />);
    const reply = await openClient(3);
    expect(replyLine(reply)).toBe("No reply recorded after 30 hours, past the 24-hour mark.");

    fireEvent.click(within(reply).getByRole("button", { name: "Record a reply" }));
    const form = within(reply).getByRole("group", { name: "Record a reply" });
    expect(within(form).getByText("Only your team sees this. Nothing is sent to the client.")).toBeDefined();
    // How is asked, never assumed.
    fireEvent.click(within(form).getByRole("button", { name: "Record reply" }));
    expect(within(form).getByRole("alert").textContent).toBe("Choose how you replied.");
    expect(mocks.recordFirstResponse).not.toHaveBeenCalled();

    mocks.getReplyAlarm.mockResolvedValue({ ...ALARM, overdue: 1, enquiries: [ALARM.enquiries[0]] });
    fireEvent.click(within(form).getByRole("radio", { name: "Phone call" }));
    fireEvent.click(within(form).getByRole("button", { name: "Record reply" }));

    await waitFor(() => { expect(mocks.recordFirstResponse).toHaveBeenCalledWith("enquiry-3", { channel: "phone" }); });
    expect(await within(reply).findByText("By phone · Thu 24 Sep, 15:00 · by you")).toBeDefined();
    expect(within(reply).getByText("Reply recorded.")).toBeDefined();
    expect(document.activeElement).toBe(within(reply).getByRole("heading", { name: "First reply" }));
    expect(within(reply).queryByRole("group", { name: "Record a reply" })).toBeNull();
    expect(within(reply).getByRole("button", { name: "Record an earlier reply" })).toBeDefined();
    expect(within(row("Client 3")).queryByTestId("reply-alarm-mark")).toBeNull();
    await waitFor(() => { expect(mocks.getReplyAlarm).toHaveBeenCalledTimes(2); });
    expect((await screen.findByTestId("reply-alarm")).querySelector("p")?.textContent)
      .toBe("1 enquiry has waited more than 24 hours for a first reply.");
  });

  it("records an earlier reply at the venue's wall time", async () => {
    mocks.recordFirstResponse.mockResolvedValue(recorded("enquiry-3", { at: "2026-09-24T08:30:00.000Z", channel: "email" }));
    render(<EnquiriesView replyVenueId="venue-1" />);
    const reply = await openClient(3);
    fireEvent.click(within(reply).getByRole("button", { name: "Record a reply" }));
    const form = within(reply).getByRole("group", { name: "Record a reply" });
    fireEvent.click(within(form).getByRole("radio", { name: "Email" }));
    fireEvent.click(within(form).getByRole("radio", { name: "Earlier" }));
    // 09:30 in Glasgow in September is 08:30 UTC.
    fireEvent.change(within(form).getByLabelText("Day and time (venue time)"), { target: { value: "2026-09-24T09:30" } });
    fireEvent.click(within(form).getByRole("button", { name: "Record reply" }));
    await waitFor(() => {
      expect(mocks.recordFirstResponse).toHaveBeenCalledWith("enquiry-3", { channel: "email", respondedAt: "2026-09-24T08:30:00.000Z" });
    });
    expect(await within(reply).findByText("By email · Thu 24 Sep, 09:30 · by you")).toBeDefined();
  });

  it("refuses a time later than now before sending anything", async () => {
    render(<EnquiriesView replyVenueId="venue-1" />);
    const reply = await openClient(3);
    fireEvent.click(within(reply).getByRole("button", { name: "Record a reply" }));
    const form = within(reply).getByRole("group", { name: "Record a reply" });
    fireEvent.click(within(form).getByRole("radio", { name: "Phone call" }));
    fireEvent.click(within(form).getByRole("radio", { name: "Earlier" }));
    fireEvent.change(within(form).getByLabelText("Day and time (venue time)"), { target: { value: "2026-09-24T18:00" } });
    fireEvent.click(within(form).getByRole("button", { name: "Record reply" }));
    expect(within(form).getByRole("alert").textContent).toBe("A reply cannot be later than now.");
    expect(mocks.recordFirstResponse).not.toHaveBeenCalled();
  });

  it("says an earlier reply stands when the one recorded is later", async () => {
    const answered = enquiry(1, { firstResponseAt: "2026-09-24T09:05:00.000Z", firstResponseBy: "user-colleague", firstResponseChannel: "email" });
    mocks.listEnquiryPage.mockResolvedValue(page([answered]));
    mocks.recordFirstResponse.mockResolvedValue(recorded("enquiry-1", { at: answered.firstResponseAt ?? "", byUserId: "user-colleague", channel: "email" }, false));
    render(<EnquiriesView replyVenueId="venue-1" />);
    const reply = await openClient(1);
    expect(within(reply).getByText("By email · Thu 24 Sep, 10:05")).toBeDefined();
    fireEvent.click(within(reply).getByRole("button", { name: "Record an earlier reply" }));
    fireEvent.click(within(reply).getByRole("radio", { name: "Phone call" }));
    fireEvent.click(within(reply).getByRole("button", { name: "Record reply" }));
    expect(await within(reply).findByText("An earlier reply is already recorded, so it stands.")).toBeDefined();
    expect(within(reply).getByText("By email · Thu 24 Sep, 10:05")).toBeDefined();
  });

  it("gives the server's reason for a refusal, keeps the form, and Escape closes the form, not the enquiry", async () => {
    mocks.recordFirstResponse.mockRejectedValue(new ApiError(422, "A reply more than 7 days ago is recorded by the venue's admin or manager.", "FIRST_RESPONSE_TOO_OLD"));
    render(<EnquiriesView replyVenueId="venue-1" />);
    const reply = await openClient(3);
    fireEvent.click(within(reply).getByRole("button", { name: "Record a reply" }));
    const form = within(reply).getByRole("group", { name: "Record a reply" });
    fireEvent.click(within(form).getByRole("radio", { name: "In person" }));
    fireEvent.click(within(form).getByRole("button", { name: "Record reply" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("A reply more than 7 days ago is recorded by the venue's admin or manager.");

    // Anything else is said without the server's words, and nothing changed.
    mocks.recordFirstResponse.mockRejectedValue(new ApiError(500, "Internal", "SERVER_ERROR"));
    fireEvent.click(within(form).getByRole("button", { name: "Record reply" }));
    await waitFor(() => { expect(within(form).getByRole("alert").textContent).toBe("The reply could not be recorded. Nothing was changed; try again."); });

    fireEvent.keyDown(within(form).getByRole("radio", { name: "In person" }), { key: "Escape" });
    expect(within(reply).queryByRole("group", { name: "Record a reply" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Client 3", level: 2 })).toBeDefined();
    expect(document.activeElement).toBe(within(reply).getByRole("button", { name: "Record a reply" }));
  });

  it("reads the alarm again after a status change made on the desk", async () => {
    mocks.listEnquiryPage.mockResolvedValue(page([enquiry(5)]));
    mocks.transitionEnquiry.mockResolvedValue({ ...enquiry(5), state: "under_review" });
    render(<EnquiriesView replyVenueId="venue-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /^Client 5,/u }));
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Start review" })); });
    await waitFor(() => { expect(mocks.transitionEnquiry).toHaveBeenCalled(); });
    await waitFor(() => { expect(mocks.getReplyAlarm).toHaveBeenCalledTimes(2); });
  });
});
