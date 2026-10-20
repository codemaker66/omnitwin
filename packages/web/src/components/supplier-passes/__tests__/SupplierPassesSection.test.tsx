import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupplierCoordinationPack, SupplierCoordinationPackBundle, SupplierCoordinationShareTokenResult } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import type { SupplierPassBoard, SupplierPassSummary } from "../../../api/supplier-coordination.js";
import { SupplierPassesSection } from "../SupplierPassesSection.js";

const { mockGetBoard, mockCreate, mockLink, mockWithdraw } = vi.hoisted(() => ({
  mockGetBoard: vi.fn(),
  mockCreate: vi.fn(),
  mockLink: vi.fn(),
  mockWithdraw: vi.fn(),
}));

vi.mock("../../../api/supplier-coordination.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/supplier-coordination.js")>();
  return {
    ...actual,
    getEventSupplierPasses: mockGetBoard,
    createSupplierPass: mockCreate,
    makeSupplierPassLink: mockLink,
    withdrawSupplierPass: mockWithdraw,
  };
});

// December, so the venue's clock (Europe/London) reads the same as UTC.
const EVENT_ID = "00000000-0000-4000-8000-00000000e001";
const VENUE_ID = "00000000-0000-4000-8000-00000000e002";
const HANDOFF_ID = "00000000-0000-4000-8000-00000000d001";
const FLORIST = "00000000-0000-4000-8000-000000005001";
const BAND = "00000000-0000-4000-8000-000000005002";
const HARBOUR = "00000000-0000-4000-8000-000000005003";
const INS_FLORIST = "00000000-0000-4000-8000-000000006001";
const INS_BAND = "00000000-0000-4000-8000-000000006002";
const INS_NOTE = "00000000-0000-4000-8000-000000006003";
const FLORIST_PASS = "00000000-0000-4000-8000-000000007001";
const NEW_PASS = "00000000-0000-4000-8000-000000007002";
const MADE = "2026-12-01T14:02:00.000Z";
const KERRY = { name: "Kerry Mackay", phone: "0141 496 0100" } as const;

function pass(overrides: Partial<SupplierPassSummary> = {}): SupplierPassSummary {
  return {
    id: FLORIST_PASS,
    title: "Bloom & Co",
    supplierId: FLORIST,
    supplierName: "Bloom & Co",
    contactName: "Sam",
    contactEmail: null,
    contactPhone: null,
    status: "issued",
    live: true,
    createdAt: MADE,
    issuedAt: MADE,
    expiresAt: "2026-12-12T23:00:00.000Z",
    expiryAssumed: false,
    revokedAt: null,
    builtFromCompiledAt: "2026-12-01T09:00:00.000Z",
    planChangedAt: null,
    madeBy: KERRY,
    items: [{ title: "Table centrepieces", arrivalWindow: "07:00-08:00" }],
    link: { tokenPrefix: "abcdefgh", createdAt: MADE, expiresAt: "2026-12-12T23:00:00.000Z", revokedAt: null, lastViewedAt: null },
    openedAt: null,
    acknowledgements: [],
    ...overrides,
  };
}

function board(overrides: Partial<SupplierPassBoard> = {}): SupplierPassBoard {
  return {
    eventId: EVENT_ID,
    venueName: "Trades Hall Glasgow",
    venueAddress: "85 Glassford Street, Glasgow G1 1UH",
    venueTimeZone: "Europe/London",
    eventStartsAt: "2026-12-05T13:00:00.000Z",
    eventLastMomentAt: "2026-12-05T23:00:00.000Z",
    rooms: ["Grand Hall"],
    defaultExpiresAt: "2026-12-12T23:00:00.000Z",
    latestExpiresAt: "2027-01-04T23:00:00.000Z",
    canIssue: true,
    handoff: { id: HANDOFF_ID, compiledAt: "2026-12-01T09:00:00.000Z" },
    issuer: KERRY,
    scope: [
      { instructionId: INS_FLORIST, supplierId: FLORIST, category: "florist", title: "Table centrepieces", detail: "Twelve low arrangements.", arrivalWindow: "07:00-08:00" },
      { instructionId: INS_BAND, supplierId: BAND, category: "music", title: "Band load-in", detail: "Use the service lift.", arrivalWindow: "15:00-15:30" },
      { instructionId: INS_NOTE, supplierId: null, category: "logistics", title: "Load-in access notes", detail: "Side door; clear the pavement by 08:30.", arrivalWindow: null },
    ],
    suppliers: [
      { id: FLORIST, name: "Bloom & Co", category: "florist", contactName: "Sam", email: null, phone: null },
      { id: HARBOUR, name: "Harbour Lights", category: "lighting", contactName: null, email: null, phone: null },
      { id: BAND, name: "The Ceilidh Collective", category: "music", contactName: "Ali", email: null, phone: null },
    ],
    passes: [pass()],
    ...overrides,
  };
}

function packFor(id: string, expiresAt = "2026-12-12T23:00:00.000Z"): SupplierCoordinationPack {
  return {
    id,
    venueId: VENUE_ID,
    handoffPackId: HANDOFF_ID,
    eventId: EVENT_ID,
    supplierId: BAND,
    title: "The Ceilidh Collective",
    contactName: "Ali",
    contactEmail: null,
    contactPhone: null,
    status: "issued",
    sourceSnapshotHash: "a".repeat(64),
    sourceDigest: "b".repeat(64),
    sourceLabel: "Approved snapshot v1",
    safeStatus: "supplier_safe_operations_handoff",
    createdBy: null,
    issuedAt: MADE,
    acknowledgedAt: null,
    expiresAt,
    revokedAt: null,
    createdAt: MADE,
    updatedAt: MADE,
  };
}

function bundleFor(id: string): SupplierCoordinationPackBundle {
  return { pack: { ...packFor(id), status: "draft", issuedAt: null }, items: [], shareTokens: [], acknowledgements: [] };
}

function linkFor(id: string, expiresAt?: string): SupplierCoordinationShareTokenResult {
  return { token: "t".repeat(43), shareUrl: `/supplier-share/${"t".repeat(43)}`, tokenPrefix: "tttttttt", pack: packFor(id, expiresAt) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T10:00:00.000Z"));
  mockGetBoard.mockReset();
  mockCreate.mockReset();
  mockLink.mockReset();
  mockWithdraw.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function openReady(data: SupplierPassBoard = board()): Promise<void> {
  mockGetBoard.mockResolvedValue(data);
  render(<SupplierPassesSection eventId={EVENT_ID} />);
  await screen.findByRole("heading", { name: "Supplier passes" });
  await waitFor(() => { expect(screen.queryByText("Reading the supplier passes…")).toBeNull(); });
}

describe("the supplier passes board", () => {
  it("reads the event's passes with the shared activity status, then shows who has read what", async () => {
    let land: ((value: SupplierPassBoard) => void) | undefined;
    mockGetBoard.mockImplementation(() => new Promise<SupplierPassBoard>((resolve) => { land = resolve; }));
    render(<SupplierPassesSection eventId={EVENT_ID} />);
    expect(screen.getByText("Reading the supplier passes…")).toBeTruthy();
    expect(mockGetBoard).toHaveBeenCalledWith(EVENT_ID, expect.any(AbortSignal));

    const read = { status: "acknowledged" as const, acknowledgedByName: "Sam", note: null, createdAt: "2026-12-02T10:00:00.000Z" };
    const question = { status: "needs_clarification" as const, acknowledgedByName: "Ali", note: "Which lift?", createdAt: "2026-12-02T11:30:00.000Z" };
    await act(async () => {
      land?.(board({
        passes: [
          pass({ acknowledgements: [read], openedAt: "2026-12-02T09:58:00.000Z" }),
          pass({ id: NEW_PASS, title: "The Ceilidh Collective", supplierId: BAND, acknowledgements: [question] }),
        ],
      }));
      await Promise.resolve();
    });

    expect(screen.queryByText("Reading the supplier passes…")).toBeNull();
    expect(screen.getByText("2 passes · 1 read · 1 question waiting")).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    const first = items[0] as HTMLElement;
    const second = items[1] as HTMLElement;
    expect(within(first).getByText("Read")).toBeTruthy();
    expect(within(first).getByText("Read Wed 2 Dec, 10:00. Name given: Sam.")).toBeTruthy();
    expect(within(first).getByText(/Made Tue 1 Dec, 14:02 by Kerry Mackay\. Works until Sat 12 Dec\./u)).toBeTruthy();
    expect(within(second).getByText("Question waiting")).toBeTruthy();
    expect(within(second).getByText("Which lift?")).toBeTruthy();
    expect(within(second).getByText(/Name given on the link: Ali\./u)).toBeTruthy();
  });

  it("says the passes could not be read, and reads them again on request", async () => {
    mockGetBoard.mockRejectedValueOnce(new ApiError(500, "boom", "INTERNAL")).mockResolvedValueOnce(board());
    render(<SupplierPassesSection eventId={EVENT_ID} />);
    expect(await screen.findByText("Couldn't read the supplier passes. Nothing about them has changed.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Read the passes again" }));
    expect(await screen.findByText("Bloom & Co")).toBeTruthy();
    expect(mockGetBoard).toHaveBeenCalledTimes(2);
  });

  it("stays out of the way of someone who may not see the passes", async () => {
    mockGetBoard.mockRejectedValue(new ApiError(403, "Insufficient permissions", "FORBIDDEN"));
    const { container } = render(<SupplierPassesSection eventId={EVENT_ID} />);
    await waitFor(() => { expect(container.textContent).toBe(""); });
  });

  it("lets a hallkeeper read the board but offers nothing to issue or withdraw", async () => {
    await openReady(board({ canIssue: false, issuer: null }));
    expect(screen.getByText("Bloom & Co")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Issue pass" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Withdraw/u })).toBeNull();
    expect(screen.getByText("The events team issue and withdraw passes. Ask them for a change.")).toBeTruthy();
  });

  it("says passes wait for the approved layout, and why Issue pass cannot be pressed yet", async () => {
    await openReady(board({ handoff: null, scope: [], passes: [] }));
    expect(screen.getByText("Passes open once the layout is approved and compiled for this event.")).toBeTruthy();
    const issue = screen.getByRole("button", { name: "Issue pass" });
    expect(issue).toHaveProperty("disabled", true);
    expect(document.getElementById(issue.getAttribute("aria-describedby") ?? "")?.textContent)
      .toBe("A pass shows a supplier their part of the approved layout, so there is nothing to send until it is approved and compiled.");
  });

  it("withdraws a pass in one tap, says the link no longer opens, and reads the board again", async () => {
    await openReady();
    mockWithdraw.mockResolvedValue({ ...packFor(FLORIST_PASS), status: "revoked", revokedAt: MADE });
    mockGetBoard.mockResolvedValue(board({ passes: [pass({ status: "revoked", revokedAt: "2026-12-03T09:00:00.000Z", live: false })] }));
    fireEvent.click(screen.getByRole("button", { name: "Withdraw Bloom & Co's pass" }));

    expect(mockWithdraw).toHaveBeenCalledWith(FLORIST_PASS);
    expect((await screen.findByRole("status")).textContent)
      .toBe("Bloom & Co: pass withdrawn. The link no longer opens; what they confirmed stays on record.");
    expect(await screen.findByText(/Withdrawn Thu 3 Dec, 09:00\. The link no longer opens\./u)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "No longer open" })).toBeTruthy();
  });

  it("reads the board again after a withdrawal even while the minute's read is still out, and keeps the newer answer", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-11-20T10:00:00.000Z"));
    await openReady();
    let landPoll: ((value: SupplierPassBoard) => void) | undefined;
    mockGetBoard.mockImplementationOnce(() => new Promise<SupplierPassBoard>((resolve) => { landPoll = resolve; }));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(mockGetBoard).toHaveBeenCalledTimes(2);

    mockWithdraw.mockResolvedValue({ ...packFor(FLORIST_PASS), status: "revoked", revokedAt: MADE });
    mockGetBoard.mockResolvedValueOnce(board({ passes: [pass({ status: "revoked", revokedAt: "2026-12-03T09:00:00.000Z", live: false })] }));
    fireEvent.click(screen.getByRole("button", { name: "Withdraw Bloom & Co's pass" }));
    await waitFor(() => { expect(mockGetBoard).toHaveBeenCalledTimes(3); });
    expect(await screen.findByRole("heading", { name: "No longer open" })).toBeTruthy();

    // The older read, answering late with the pass still open, changes nothing.
    await act(async () => { landPoll?.(board()); await Promise.resolve(); });
    expect(screen.getByRole("heading", { name: "No longer open" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Withdraw Bloom & Co's pass" })).toBeNull();
  });

  it("says a withdrawal that failed left the link open", async () => {
    await openReady();
    mockWithdraw.mockRejectedValue(new ApiError(0, "Network error", "NETWORK_ERROR"));
    fireEvent.click(screen.getByRole("button", { name: "Withdraw Bloom & Co's pass" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The pass could not be withdrawn, so its link still opens. Try again.");
  });

  it("says when the plan changed after a pass was made, and offers a fresh pass for that supplier", async () => {
    await openReady(board({ passes: [pass({ planChangedAt: "2026-12-03T16:10:00.000Z" })] }));
    expect(screen.getByText("The plan changed on Thu 3 Dec at 16:10, after this pass was made. Make a fresh pass so they see it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Make a fresh pass" }));
    const dialog = await screen.findByRole("dialog", { name: "Fresh pass for Bloom & Co" });
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Supplier").value).toBe(`supplier:${FLORIST}`);
    expect(within(dialog).getByRole<HTMLInputElement>("checkbox", { name: /Table centrepieces/u }).checked).toBe(true);
  });
});

describe("the Issue pass sheet", () => {
  async function openSheet(data: SupplierPassBoard = board()): Promise<HTMLElement> {
    await openReady(data);
    fireEvent.click(screen.getByRole("button", { name: "Issue pass" }));
    return screen.findByRole("dialog", { name: "Issue pass" });
  }

  it("opens on the supplier on the plan who has no pass yet, with their part ticked and what they will see said", async () => {
    const dialog = await openSheet();
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Supplier").value).toBe(`supplier:${BAND}`);
    expect(within(dialog).getByLabelText<HTMLInputElement>("Addressed to").value).toBe("Ali");
    expect(within(dialog).getByRole<HTMLInputElement>("checkbox", { name: /Band load-in/u }).checked).toBe(true);
    expect(within(dialog).getByRole<HTMLInputElement>("checkbox", { name: /Load-in access notes/u }).checked).toBe(false);
    // Another supplier's part is never offered.
    expect(within(dialog).queryByRole("checkbox", { name: /Table centrepieces/u })).toBeNull();
    expect(within(dialog).getByLabelText<HTMLInputElement>("Last day the link opens").value).toBe("2026-12-12");
    expect(within(dialog).getByText("The Ceilidh Collective will see Saturday 5 December, Grand Hall, the 1 part you ticked, with any arrival times, the venue's address and you as their contact (Kerry Mackay, 0141 496 0100).")).toBeTruthy();
    expect(within(dialog).getByText("They will not see prices, the client's details, other suppliers' parts or anything you did not tick.")).toBeTruthy();
  });

  it("makes the pass and its link, hands back a message that carries the essentials, and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const dialog = await openSheet();
    mockCreate.mockResolvedValue(bundleFor(NEW_PASS));
    mockLink.mockResolvedValue(linkFor(NEW_PASS));
    fireEvent.click(within(dialog).getByRole("button", { name: "Make the pass" }));

    await waitFor(() => { expect(mockLink).toHaveBeenCalledWith(NEW_PASS, {}); });
    expect(mockCreate).toHaveBeenCalledWith({
      handoffPackId: HANDOFF_ID,
      supplierInstructionIds: [INS_BAND],
      supplierId: BAND,
      title: "The Ceilidh Collective",
      contactName: "Ali",
    });
    expect(await screen.findByRole("heading", { name: "Pass ready for The Ceilidh Collective" })).toBeTruthy();
    const message = screen.getByLabelText<HTMLTextAreaElement>("Message to send").value;
    expect(message).toBe([
      "Trades Hall Glasgow: your brief for Saturday 5 December, Grand Hall.",
      "Arrive 15:00-15:30 (Band load-in).",
      "Address: 85 Glassford Street, Glasgow G1 1UH.",
      "Questions: Kerry Mackay, 0141 496 0100.",
      `Your brief: ${window.location.origin}/supplier-share/${"t".repeat(43)}`,
      "The link works until Sat 12 Dec.",
    ].join("\n"));

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    expect(await screen.findByText("Message copied.")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(message);

    mockGetBoard.mockResolvedValue(board());
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });
    await waitFor(() => { expect(mockGetBoard).toHaveBeenCalledTimes(2); });
  });

  it("replaces the supplier's open pass, saying so first, so one supplier never holds two", async () => {
    const dialog = await openSheet();
    fireEvent.change(within(dialog).getByLabelText("Supplier"), { target: { value: `supplier:${FLORIST}` } });
    expect(within(dialog).getByText("Their earlier pass, made Tue 1 Dec, 14:02, stops working when this one is made. What they confirmed on it stays on record, and their page will say what changed for them.")).toBeTruthy();
    mockCreate.mockResolvedValue(bundleFor(NEW_PASS));
    mockLink.mockResolvedValue(linkFor(NEW_PASS));
    fireEvent.click(within(dialog).getByRole("button", { name: "Make the pass" }));
    await waitFor(() => { expect(mockLink).toHaveBeenCalledWith(NEW_PASS, { supersedesPackId: FLORIST_PASS }); });
  });

  it("sends a chosen stop date as the end of that day on the venue's clock", async () => {
    const dialog = await openSheet();
    fireEvent.change(within(dialog).getByLabelText("Last day the link opens"), { target: { value: "2026-12-08" } });
    mockCreate.mockResolvedValue(bundleFor(NEW_PASS));
    mockLink.mockResolvedValue(linkFor(NEW_PASS, "2026-12-08T23:59:00.000Z"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Make the pass" }));
    await waitFor(() => { expect(mockCreate).toHaveBeenCalled(); });
    expect(mockCreate.mock.calls[0]?.[0]).toMatchObject({ expiresAt: "2026-12-08T23:59:00.000Z" });
  });

  it("will not make a pass with nothing on it, or past the latest stop date, and says why", async () => {
    const dialog = await openSheet();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Band load-in/u }));
    expect(within(dialog).getByRole("button", { name: "Make the pass" })).toHaveProperty("disabled", true);
    expect(within(dialog).getByText("Tick at least one part to put on the pass.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Band load-in/u }));
    fireEvent.change(within(dialog).getByLabelText("Last day the link opens"), { target: { value: "2027-02-01" } });
    expect(within(dialog).getByText("A pass can stay open until Mon 4 Jan at the latest.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Make the pass" })).toHaveProperty("disabled", true);
  });

  it("asks for a stop date when the event has no date in the Diary", async () => {
    const dialog = await openSheet(board({ eventStartsAt: null, eventLastMomentAt: null, defaultExpiresAt: null, latestExpiresAt: "2026-12-20T10:00:00.000Z", rooms: [] }));
    expect(within(dialog).getByText("The event has no date in the Diary yet, so choose the day this pass stops working.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Make the pass" })).toHaveProperty("disabled", true);
  });

  it("keeps the form and says the refusal in the API's own plain words", async () => {
    const dialog = await openSheet();
    mockCreate.mockRejectedValue(new ApiError(422, "That day has already passed. Choose a later day for the pass to stop working.", "PASS_EXPIRY_PAST"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Make the pass" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("That day has already passed. Choose a later day for the pass to stop working.");
    expect(within(dialog).getByRole("button", { name: "Make the pass" })).toBeTruthy();
    expect(mockLink).not.toHaveBeenCalled();
  });

  it("says a pass made without its link waits as Not sent, and makes the link on request", async () => {
    const dialog = await openSheet();
    mockCreate.mockResolvedValue(bundleFor(NEW_PASS));
    mockLink.mockRejectedValueOnce(new ApiError(0, "Network error", "NETWORK_ERROR")).mockResolvedValueOnce(linkFor(NEW_PASS));
    fireEvent.click(within(dialog).getByRole("button", { name: "Make the pass" }));
    expect((await within(dialog).findByRole("alert")).textContent)
      .toBe("The pass for The Ceilidh Collective was made, but its link was not. Nothing was sent.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Make the link" }));
    expect(await screen.findByRole("heading", { name: "Pass ready for The Ceilidh Collective" })).toBeTruthy();
    expect(mockLink).toHaveBeenCalledTimes(2);
  });

  it("selects the message when the device will not copy", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    const dialog = await openSheet();
    mockCreate.mockResolvedValue(bundleFor(NEW_PASS));
    mockLink.mockResolvedValue(linkFor(NEW_PASS));
    fireEvent.click(within(dialog).getByRole("button", { name: "Make the pass" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy link only" }));
    expect(await screen.findByText("This device would not copy. The message is selected: copy it with your keyboard, or press and hold.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Message to send"));
  });

  it("closes on Escape before anything is made, and changes nothing", async () => {
    const dialog = await openSheet();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockGetBoard).toHaveBeenCalledTimes(1);
  });

  it("makes a new link to an existing pass after saying the old link stops, naming the pass's own maker", async () => {
    await openReady(board({ issuer: { name: "Rory Bell", phone: null } }));
    fireEvent.click(screen.getByRole("button", { name: "New link" }));
    const dialog = await screen.findByRole("dialog", { name: "New link for Bloom & Co" });
    expect(within(dialog).getByText("This makes a new link to Bloom & Co's pass. The link sent before stops working as soon as this one is made.")).toBeTruthy();
    mockLink.mockResolvedValue(linkFor(FLORIST_PASS));
    fireEvent.click(within(dialog).getByRole("button", { name: "Make the new link" }));
    await waitFor(() => { expect(mockLink).toHaveBeenCalledWith(FLORIST_PASS, {}); });
    const message = (await screen.findByLabelText<HTMLTextAreaElement>("Message to send")).value;
    expect(message).toContain("Questions: Kerry Mackay, 0141 496 0100.");
    expect(message).toContain("Arrive 07:00-08:00 (Table centrepieces).");
  });
});
