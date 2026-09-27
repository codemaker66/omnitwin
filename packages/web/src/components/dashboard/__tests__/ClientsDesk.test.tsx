import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import type { ContactProfile, LeadProfile, RecentEnquiry, SearchResults } from "../../../api/clients.js";
import { ApiError } from "../../../api/client.js";
import { ClientsDesk } from "../ClientsDesk.js";
import type { ClientRef } from "../clients/clients-desk-format.js";

// ---------------------------------------------------------------------------
// The Clients desk (roadmap X1): one search over people, organisations,
// deals, proposals and layouts; whose events come next before anything is
// typed; a client open in the forest panel beside the list, and the address
// (?q=, ?client=) holding both, as the dashboard page does.
// ---------------------------------------------------------------------------

const AILSA = "00000000-0000-4000-8000-000000008001";
const ACCOUNT = "00000000-0000-4000-8000-000000008002";
const DEAL = "00000000-0000-4000-8000-000000008003";
const PROPOSAL = "00000000-0000-4000-8000-000000008004";
const LEAD = "00000000-0000-4000-8000-000000008005";
const LAYOUT = "00000000-0000-4000-8000-000000008006";
const ENQUIRY = "00000000-0000-4000-8000-000000008007";
/** 11:00 in Glasgow on Friday 19 June 2026. */
const NOW = "2026-06-19T10:00:00.000Z";

const mocks = vi.hoisted(() => ({
  searchClients: vi.fn(),
  getUpcomingClients: vi.fn(),
  getRecentEnquiries: vi.fn(),
  getClientProfile: vi.fn(),
  getLeadProfile: vi.fn(),
  getContactProfile: vi.fn(),
}));

vi.mock("../../../api/clients.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../api/clients.js")>(),
  searchClients: mocks.searchClients,
  getUpcomingClients: mocks.getUpcomingClients,
  getRecentEnquiries: mocks.getRecentEnquiries,
  getClientProfile: mocks.getClientProfile,
  getLeadProfile: mocks.getLeadProfile,
  getContactProfile: mocks.getContactProfile,
}));

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

function results(overrides: Partial<SearchResults> = {}): SearchResults {
  return { users: [], guestLeads: [], configurations: [], contacts: [], accounts: [], deals: [], proposals: [], ...overrides };
}

const HENDERSON = results({
  contacts: [{ id: AILSA, name: "Ailsa Henderson", email: "ailsa@example.test", phone: null, accountName: "Henderson Family" }],
  accounts: [
    { id: ACCOUNT, name: "Henderson Family", accountType: "individual", primaryContactId: AILSA },
    { id: "00000000-0000-4000-8000-000000008012", name: "Henderson Trust", accountType: "company", primaryContactId: null },
  ],
  deals: [{ id: DEAL, title: "Wedding reception", stage: "proposal_sent", preferredDate: "2026-09-05", guestCount: 160, contactName: "Ailsa Henderson" }],
  proposals: [{ id: PROPOSAL, title: "Henderson wedding proposal", status: "sent", currentVersion: 2, opportunityId: DEAL, sentAt: "2026-06-12T09:00:00.000Z" }],
  configurations: [{ id: LAYOUT, name: "Henderson top table", spaceName: "Grand Hall", userName: null, createdAt: "2026-06-01T09:00:00.000Z" }],
});

function contactProfile(overrides: Partial<ContactProfile> = {}): ContactProfile {
  return {
    contact: {
      id: AILSA, venueId: "venue-1", name: "Ailsa Henderson", email: "ailsa@example.test", phone: "0141 555 0100",
      roleLabel: "Bride", sourceEnquiryId: ENQUIRY, createdAt: "2026-03-02T09:00:00.000Z",
      account: { id: ACCOUNT, name: "Henderson Family" },
    },
    deals: [
      { id: DEAL, title: "Wedding reception", stage: "won", preferredDate: "2026-09-05", guestCount: 160, estimatedValueMinor: 1_250_000, currency: "GBP", updatedAt: "2026-06-15T09:00:00.000Z" },
    ],
    proposals: [
      { id: PROPOSAL, opportunityId: DEAL, title: "Henderson wedding proposal", status: "accepted", currentVersion: 2, sentAt: "2026-06-12T09:00:00.000Z" },
    ],
    ...overrides,
  };
}

function enquiry(overrides: Partial<RecentEnquiry> = {}): RecentEnquiry {
  return {
    id: ENQUIRY, state: "submitted", name: "Kirsty Fraser", email: "kirsty@example.test", guestEmail: "kirsty@example.test",
    guestPhone: null, guestName: "Kirsty Fraser", userId: null, eventType: "wedding", preferredDate: "2026-07-18",
    createdAt: "2026-06-18T09:00:00.000Z", leadId: LEAD, ...overrides,
  };
}

function leadProfile(enquiries: LeadProfile["enquiries"]): LeadProfile {
  return {
    lead: { id: LEAD, email: "kirsty@example.test", phone: null, name: "Kirsty Fraser", convertedToUserId: null, createdAt: "2026-06-18T09:00:00.000Z" },
    enquiries,
  };
}

interface Seen {
  readonly queries: string[];
  readonly clients: (ClientRef | null)[];
}

/** The desk with its address, as the dashboard page holds it. */
function Desk({ seen, initialQuery = "", initialClient = null, commercial = true, handlers }: {
  readonly seen: Seen;
  readonly initialQuery?: string;
  readonly initialClient?: ClientRef | null;
  readonly commercial?: boolean;
  readonly handlers: { onOpenDeal: (id: string) => void; onOpenProposal: (id: string) => void; onViewEnquiry: (id: string) => void };
}): ReactElement {
  const [query, setQuery] = useState(initialQuery);
  const [client, setClient] = useState<ClientRef | null>(initialClient);
  return (
    <ClientsDesk
      query={query}
      client={client}
      onQueryChange={(next) => { seen.queries.push(next); setQuery(next.trim()); }}
      onClientChange={(next) => { seen.clients.push(next); setClient(next); }}
      canSeeCommercial={commercial}
      onOpenDeal={handlers.onOpenDeal}
      onOpenProposal={handlers.onOpenProposal}
      onViewEnquiry={handlers.onViewEnquiry}
    />
  );
}

const handlers = { onOpenDeal: vi.fn(), onOpenProposal: vi.fn(), onViewEnquiry: vi.fn() };

function renderDesk(options: { initialQuery?: string; initialClient?: ClientRef | null; commercial?: boolean } = {}): Seen {
  const seen: Seen = { queries: [], clients: [] };
  render(<Desk seen={seen} handlers={handlers} {...options} />);
  return seen;
}

function row(name: RegExp): HTMLElement {
  const match = [...document.querySelectorAll<HTMLElement>("[data-row-key]")]
    .find((element) => name.test(element.getAttribute("aria-label") ?? ""));
  if (match === undefined) throw new Error(`No row for ${String(name)}`);
  return match;
}

async function findRow(name: RegExp): Promise<HTMLElement> {
  return waitFor(() => row(name));
}

function groupLabels(): string[] {
  return [...document.querySelectorAll(".enq-group")].map((heading) => heading.firstChild?.textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.getUpcomingClients.mockResolvedValue([]);
  mocks.getRecentEnquiries.mockResolvedValue([]);
  mocks.searchClients.mockResolvedValue(HENDERSON);
  mocks.getContactProfile.mockResolvedValue(contactProfile());
  wideDesk();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("before anything is typed", () => {
  it("shows whose events come next, then who was last in touch, without repeating anyone", async () => {
    mocks.getUpcomingClients.mockResolvedValue([enquiry()]);
    mocks.getRecentEnquiries.mockResolvedValue([
      enquiry(),
      enquiry({ id: "00000000-0000-4000-8000-000000008020", guestName: "Iain Robertson", name: "Iain Robertson", preferredDate: null, leadId: null, userId: null }),
    ]);
    renderDesk();

    await findRow(/^Iain Robertson, enquiry/u);
    expect(groupLabels()).toEqual(["Coming up", "Recently in touch"]);
    expect(document.querySelectorAll("[data-row-key]")).toHaveLength(2);
    expect(row(/^Kirsty Fraser, enquiry, Saturday 18 July 2026/u)).toBeDefined();
    expect(mocks.searchClients).not.toHaveBeenCalled();
  });

  it("opens a guest from the list on their own profile, and an enquiry with no client on the Enquiries desk", async () => {
    mocks.getRecentEnquiries.mockResolvedValue([
      enquiry(),
      enquiry({ id: "00000000-0000-4000-8000-000000008021", guestName: "Iain Robertson", name: "Iain Robertson", leadId: null }),
    ]);
    mocks.getLeadProfile.mockResolvedValue(leadProfile([]));
    const seen = renderDesk();

    fireEvent.click(await findRow(/^Iain Robertson/u));
    expect(handlers.onViewEnquiry).toHaveBeenCalledWith("00000000-0000-4000-8000-000000008021");

    fireEvent.click(row(/^Kirsty Fraser/u));
    expect(seen.clients).toEqual([{ kind: "lead", id: LEAD }]);
    expect(await screen.findByRole("heading", { level: 2, name: "Kirsty Fraser" })).toBeDefined();
  });

  it("says so plainly when the venue has no clients yet, and keeps the search when the lists cannot be read", async () => {
    renderDesk();
    expect(await screen.findByRole("heading", { name: "No clients yet" })).toBeDefined();
    cleanup();

    mocks.getUpcomingClients.mockRejectedValue(new Error("Unavailable"));
    renderDesk();
    expect(await screen.findByText("Who was last in touch could not be read. The search still works.")).toBeDefined();
    expect(screen.getByRole("searchbox", { name: "Search clients" })).toBeDefined();
  });
});

describe("the search", () => {
  it("settles what is typed into the address, then groups what it finds, people first", async () => {
    const seen = renderDesk();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search clients" }), { target: { value: "henderson " } });
    expect(mocks.searchClients).not.toHaveBeenCalled();

    await waitFor(() => { expect(mocks.searchClients).toHaveBeenCalledWith("henderson"); });
    expect(seen.queries).toEqual(["henderson "]);
    expect(await screen.findByText("6 found for “henderson”.")).toBeDefined();
    expect(groupLabels()).toEqual(["People", "Organisations", "Deals", "Proposals", "Layouts"]);
    expect(row(/^Ailsa Henderson, contact, Henderson Family · ailsa@example\.test$/u)).toBeDefined();
    expect(row(/^Wedding reception, deal, Saturday 5 September 2026, Proposal sent · Ailsa Henderson · 160 guests$/u)).toBeDefined();
    expect(row(/^Henderson wedding proposal, proposal, With the client · sent/u)).toBeDefined();
    expect(row(/^Henderson top table, layout, opens in a new tab/u).getAttribute("href")).toBe(`/plan/${LAYOUT}`);
    // An organisation with nobody recorded is shown, but opens nothing.
    const still = screen.getByRole("group", { name: /^Henderson Trust, organisation, No contact recorded yet$/u });
    expect(still.tagName).toBe("DIV");
  });

  it("does not search a single letter", async () => {
    const seen = renderDesk();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search clients" }), { target: { value: "h" } });
    await waitFor(() => { expect(seen.queries).toEqual(["h"]); });
    expect(mocks.searchClients).not.toHaveBeenCalled();
  });

  it("says nothing was found in words that suggest what to try", async () => {
    mocks.searchClients.mockResolvedValue(results());
    renderDesk({ initialQuery: "zzyzx" });
    expect(await screen.findByText("Nothing found for “zzyzx”. Check the spelling, or try an email address.")).toBeDefined();
  });

  it("offers the search again when it fails", async () => {
    mocks.searchClients.mockRejectedValueOnce(new Error("Unavailable"));
    renderDesk({ initialQuery: "henderson" });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The search could not be run.");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await findRow(/^Ailsa Henderson/u)).toBeDefined();
    expect(mocks.searchClients).toHaveBeenCalledTimes(2);
  });

  it("never lets an earlier, slower search replace a later one", async () => {
    let answerFirst: (value: SearchResults) => void = () => undefined;
    mocks.searchClients
      .mockImplementationOnce(() => new Promise<SearchResults>((resolve) => { answerFirst = resolve; }))
      .mockResolvedValueOnce(results({ contacts: [{ id: AILSA, name: "Fiona MacDonald", email: "fiona@example.test", phone: null, accountName: null }] }));
    renderDesk({ initialQuery: "henderson" });
    const input = screen.getByRole("searchbox", { name: "Search clients" });
    fireEvent.change(input, { target: { value: "mcdonald" } });

    await findRow(/^Fiona MacDonald/u);
    await act(async () => { answerFirst(HENDERSON); await Promise.resolve(); });
    expect(() => row(/^Ailsa Henderson/u)).toThrow();
    expect(screen.getByText("1 found for “mcdonald”.")).toBeDefined();
  });

  it("promises the commercial record only to the roles that work it", () => {
    renderDesk({ commercial: false });
    expect(screen.getByText("Names, emails and layouts. A near spelling finds them too.")).toBeDefined();
    cleanup();
    renderDesk();
    expect(screen.getByText("Names, emails, organisations, deals and proposals. A near spelling finds them too.")).toBeDefined();
  });
});

describe("opening what the search found", () => {
  it("opens a deal in the pipeline, a proposal in Proposals, and an organisation on its main contact", async () => {
    const seen = renderDesk({ initialQuery: "henderson" });
    fireEvent.click(await findRow(/^Wedding reception, deal/u));
    expect(handlers.onOpenDeal).toHaveBeenCalledWith(DEAL);
    fireEvent.click(row(/^Henderson wedding proposal, proposal/u));
    expect(handlers.onOpenProposal).toHaveBeenCalledWith(PROPOSAL);
    fireEvent.click(row(/^Henderson Family, organisation/u));
    expect(seen.clients).toEqual([{ kind: "contact", id: AILSA }]);
  });

  it("opens a contact beside the list with how to reach them, their lifetime and their record", async () => {
    const seen = renderDesk({ initialQuery: "henderson" });
    fireEvent.click(await findRow(/^Ailsa Henderson, contact/u));
    expect(seen.clients).toEqual([{ kind: "contact", id: AILSA }]);

    const heading = await screen.findByRole("heading", { level: 2, name: "Ailsa Henderson" });
    await waitFor(() => { expect(document.activeElement).toBe(heading); });
    const panel = heading.closest("section");
    if (panel === null) throw new Error("No panel");
    const inPanel = within(panel);
    expect(inPanel.getByText("Contact · Bride")).toBeDefined();
    expect(inPanel.getByText("Henderson Family")).toBeDefined();
    expect(inPanel.getByRole("link", { name: "ailsa@example.test" }).getAttribute("href")).toBe("mailto:ailsa@example.test");
    expect(inPanel.getByRole("link", { name: "0141 555 0100" }).getAttribute("href")).toBe("tel:01415550100");
    const facts = [...panel.querySelectorAll(".cl-facts > div")].map((fact) => fact.textContent);
    expect(facts).toEqual(["deal1", "proposal1", "won£12,500.00"]);
    expect(row(/^Ailsa Henderson, contact/u).getAttribute("aria-current")).toBe("true");
    // Her organisation opens her too, but only the row she was opened from is marked.
    expect(row(/^Henderson Family, organisation/u).getAttribute("aria-current")).toBeNull();

    fireEvent.click(inPanel.getByRole("button", { name: /^Wedding reception/u }));
    expect(handlers.onOpenDeal).toHaveBeenCalledWith(DEAL);
    fireEvent.click(inPanel.getByRole("button", { name: /^Henderson wedding proposal/u }));
    expect(handlers.onOpenProposal).toHaveBeenCalledWith(PROPOSAL);
    fireEvent.click(inPanel.getByRole("button", { name: "Open the enquiry they sent" }));
    expect(handlers.onViewEnquiry).toHaveBeenCalledWith(ENQUIRY);
    // Newest first: the deal's last move, the proposal sent, then the contact made.
    const timeline = [...panel.querySelectorAll(".enq-timeline strong")].map((moment) => moment.textContent);
    expect(timeline).toEqual(["Wedding reception: won.", "Henderson wedding proposal sent (version 2).", "Became a contact."]);
  });

  it("closes the client with Escape and puts the reader back on the row they opened", async () => {
    const seen = renderDesk({ initialQuery: "henderson" });
    const opened = await findRow(/^Ailsa Henderson, contact/u);
    fireEvent.click(opened);
    const heading = await screen.findByRole("heading", { level: 2, name: "Ailsa Henderson" });

    fireEvent.keyDown(heading, { key: "Escape" });
    expect(seen.clients).toEqual([{ kind: "contact", id: AILSA }, null]);
    await waitFor(() => { expect(document.activeElement).toBe(row(/^Ailsa Henderson, contact/u)); });
    expect(screen.getByRole("heading", { level: 2, name: "Find anyone in a few letters" })).toBeDefined();
  });

  it("says a client is not on the record, and offers to try again when it could not be read", async () => {
    mocks.getContactProfile.mockRejectedValueOnce(new ApiError(404, "Not found", "NOT_FOUND"));
    renderDesk({ initialClient: { kind: "contact", id: AILSA } });
    expect(await screen.findByRole("heading", { level: 2, name: "Not found" })).toBeDefined();
    cleanup();

    mocks.getContactProfile.mockRejectedValueOnce(new Error("Unavailable"));
    renderDesk({ initialClient: { kind: "contact", id: AILSA } });
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Ailsa Henderson" })).toBeDefined();
  });

  it("names the room a guest chose, says where they named none, and reads occasions as words", async () => {
    mocks.getLeadProfile.mockResolvedValue(leadProfile([
      { id: "e-1", state: "submitted", eventType: "wedding", preferredDate: "2027-05-14", spaceName: "Grand Hall", roomChosen: false, createdAt: "2026-06-18T09:00:00.000Z" },
      { id: "e-2", state: "approved", eventType: "corporate", preferredDate: null, spaceName: "Saloon", roomChosen: true, createdAt: "2026-06-10T09:00:00.000Z" },
      { id: "e-3", state: "under_review", eventType: "Burns supper", preferredDate: null, spaceName: "Reception Room", createdAt: "2026-06-01T09:00:00.000Z" },
    ]));
    renderDesk({ initialClient: { kind: "lead", id: LEAD } });
    await screen.findByRole("heading", { level: 2, name: "Kirsty Fraser" });

    const details = [...document.querySelectorAll(".cl-list .cl-item__detail")].map((detail) => detail.textContent);
    expect(details).toEqual(["New · room not chosen", "Approved · Saloon", "In review · Reception Room"]);
    const titles = [...document.querySelectorAll(".cl-list .cl-item__title")].map((title) => title.textContent);
    expect(titles).toEqual(["Wedding, Fri 14 May 2027", "Corporate event", "Burns supper"]);
    fireEvent.click(screen.getByRole("button", { name: /^Corporate event/u }));
    expect(handlers.onViewEnquiry).toHaveBeenCalledWith("e-2");
  });
});

describe("the keyboard", () => {
  it("puts the cursor in the search with /, except while typing elsewhere", () => {
    renderDesk();
    const input = screen.getByRole("searchbox", { name: "Search clients" });
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(input);

    const other = document.createElement("textarea");
    document.body.append(other);
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it("moves from the search into the results and through them with the arrows, j and k", async () => {
    renderDesk({ initialQuery: "henderson" });
    await findRow(/^Ailsa Henderson/u);
    const input = screen.getByRole("searchbox", { name: "Search clients" });
    input.focus();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(document.activeElement).toBe(row(/^Ailsa Henderson/u));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "j" });
    expect(document.activeElement).toBe(row(/^Henderson Family, organisation/u));
    // The organisation with nobody recorded is not a stop.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowDown" });
    expect(document.activeElement).toBe(row(/^Wedding reception, deal/u));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "k" });
    expect(document.activeElement).toBe(row(/^Henderson Family, organisation/u));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "End" });
    expect(document.activeElement).toBe(row(/^Henderson top table, layout/u));
  });

  it("clears what was typed with its own button, and puts the cursor back in the search", async () => {
    const seen = renderDesk({ initialQuery: "henderson" });
    await findRow(/^Ailsa Henderson/u);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    const input = screen.getByRole<HTMLInputElement>("searchbox", { name: "Search clients" });
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(seen.queries).toEqual([""]);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  it("clears what was typed with Escape", () => {
    const seen = renderDesk({ initialQuery: "henderson" });
    const input = screen.getByRole<HTMLInputElement>("searchbox", { name: "Search clients" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    expect(seen.queries).toEqual([""]);
  });
});
