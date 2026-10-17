import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupplierPortalPage } from "../pages/SupplierPortalPage.js";
import { SupplierSafePackViewSchema, type SupplierAcknowledgement, type SupplierSafePackView } from "../api/supplier-coordination.js";

const {
  mockAcknowledgeSupplierShare,
  mockGetSupplierShare,
} = vi.hoisted(() => ({
  mockAcknowledgeSupplierShare: vi.fn(),
  mockGetSupplierShare: vi.fn(),
}));

vi.mock("../api/supplier-coordination.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/supplier-coordination.js")>();
  return {
    ...actual,
    acknowledgeSupplierShare: mockAcknowledgeSupplierShare,
    getSupplierShare: mockGetSupplierShare,
  };
});

// December, so the venue's clock (Europe/London) reads the same as UTC.
const MADE = "2026-12-01T14:02:00.000Z";       // Tue 1 Dec, 14:02
const EARLIER = "2026-11-30T11:00:00.000Z";    // Mon 30 Nov, 11:00
const EVENT = "2026-12-05T13:00:00.000Z";      // Saturday 5 December
const UNTIL = "2026-12-12T23:00:00.000Z";      // Sat 12 Dec

type PassDetails = NonNullable<SupplierSafePackView["passDetails"]>;

function details(overrides: Partial<PassDetails> = {}): PassDetails {
  return {
    addressedTo: "Sam",
    eventStartsAt: EVENT,
    eventEndsAt: "2026-12-05T23:00:00.000Z",
    rooms: ["Grand Hall"],
    venueAddress: "85 Glassford Street, Glasgow G1 1UH",
    venueTimeZone: "Europe/London",
    updatedAt: MADE,
    planChangedAt: null,
    changesForYou: null,
    venueContact: { name: "Kerry Mackay", phone: "0141 496 0100" },
    ...overrides,
  };
}

function fixturePack(overrides: Partial<SupplierSafePackView> = {}): SupplierSafePackView {
  return {
    title: "Bloom & Co",
    venueName: "Trades Hall Glasgow",
    supplierName: "Bloom & Co",
    contactName: "Sam",
    contactEmail: "sam@bloom.example",
    contactPhone: null,
    status: "issued",
    safeStatus: "supplier_safe_operations_handoff",
    issuedAt: MADE,
    expiresAt: UNTIL,
    source: {
      sourceLabel: "Approved configuration snapshot v3",
      handoffVersion: 3,
      compiledAt: MADE,
      snapshotHashPrefix: "abcdef123456",
      sourceDigest: "a".repeat(64),
    },
    changesSincePreviousHandoff: {
      summary: "1 added, 0 removed, 1 quantity changed since the previous approved snapshot.",
      addedCount: 1,
      changedCount: 1,
      removedCount: 0,
    },
    items: [
      {
        title: "Table centrepieces",
        detail: "Twelve low arrangements, LED candles only.",
        kind: "requirement",
        arrivalWindow: "07:00-08:00",
        sourceRef: "snapshot.totals",
        sortOrder: 0,
      },
      {
        title: "Load-in access notes",
        detail: "Unload at the side door and clear the pavement by 08:30.",
        kind: "requirement",
        arrivalWindow: null,
        sourceRef: "snapshot.instructions.accessNotes",
        sortOrder: 1,
      },
    ],
    acknowledgements: [],
    supplierNotice: "Your part of the event, from the venue's approved plan. Check anything unclear with the venue before you arrive.",
    passDetails: details(),
    ...overrides,
  };
}

function fixtureAcknowledgement(status: SupplierAcknowledgement["status"] = "acknowledged"): SupplierAcknowledgement {
  return {
    id: "00000000-0000-4000-8000-000000000701",
    packId: "00000000-0000-4000-8000-000000000702",
    shareTokenId: "00000000-0000-4000-8000-000000000703",
    status,
    acknowledgedByName: "Sam",
    acknowledgedByEmail: null,
    note: status === "acknowledged" ? null : "Which door do we load through?",
    createdAt: "2026-12-02T10:00:00.000Z",
  };
}

function renderSupplierPortal(): void {
  render(
    <MemoryRouter initialEntries={["/supplier-share/supplier-token"]}>
      <Routes>
        <Route path="/supplier-share/:token" element={<SupplierPortalPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockAcknowledgeSupplierShare.mockReset();
  mockGetSupplierShare.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("SupplierPortalPage", () => {
  it("opens with the name, day and room, then when to arrive, where to go, their part and who to ring", async () => {
    mockGetSupplierShare.mockResolvedValue(fixturePack());
    renderSupplierPortal();

    expect(await screen.findByRole("heading", { level: 1, name: "Bloom & Co" })).toBeTruthy();
    expect(screen.getByText("Trades Hall Glasgow")).toBeTruthy();
    expect(screen.getByText("For Sam")).toBeTruthy();
    expect(screen.getByText("Saturday 5 December · Grand Hall")).toBeTruthy();
    expect(screen.getByText("Updated 14:02, Tue 1 Dec")).toBeTruthy();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Before you come", "At the door", "Your part", "If something comes up", "Tell the venue"]);
    // Under "Before you come", and again beside the part it belongs to.
    expect(screen.getAllByText("Arrive 07:00-08:00")).toHaveLength(2);
    expect(screen.getByText("Trades Hall Glasgow, 85 Glassford Street, Glasgow G1 1UH")).toBeTruthy();
    expect(screen.getByText("Ask for Kerry Mackay.")).toBeTruthy();
    const call = screen.getByRole("link", { name: "Call Kerry Mackay, 0141 496 0100" });
    expect(call.getAttribute("href")).toBe("tel:01414960100");
    expect(screen.getByText(/works until Sat 12 Dec/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "I've read it" })).toBeTruthy();
  });

  it("never shows the venue's system words, versions or source references", async () => {
    mockGetSupplierShare.mockResolvedValue(fixturePack());
    renderSupplierPortal();
    await screen.findByRole("heading", { level: 1, name: "Bloom & Co" });

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/handoff|snapshot|hash|token|digest|v\d\b|supplier_safe|packId|createdBy|internal/iu);
    expect(text).not.toContain("abcdef123456");
    expect(text).not.toContain("snapshot.totals");
    expect(text).not.toContain("quantity changed");
  });

  it("says when the plan moved on after the brief was made, and who to check with", async () => {
    mockGetSupplierShare.mockResolvedValue(fixturePack({ passDetails: details({ planChangedAt: "2026-12-03T16:10:00.000Z" }) }));
    renderSupplierPortal();

    expect((await screen.findByRole("note")).textContent)
      .toBe("The venue's plan changed on Thu 3 Dec at 16:10, after this brief was made. Check with Kerry Mackay before you arrive.");
  });

  it("names what changed for them since their last brief, beside when it was updated", async () => {
    mockGetSupplierShare.mockResolvedValue(fixturePack({
      passDetails: details({ changesForYou: { since: EARLIER, added: ["Aisle candles"], removed: ["Load-in access notes"], changed: ["Table centrepieces"] } }),
    }));
    renderSupplierPortal();

    expect((await screen.findByRole("link", { name: "what changed for you" })).getAttribute("href")).toBe("#what-changed");
    const section = screen.getByRole("region", { name: "What changed for you" });
    expect(section.textContent).toContain("Since your last brief, made Mon 30 Nov, 11:00.");
    expect(section.textContent).toContain("NewAisle candles");
    expect(section.textContent).toContain("ChangedTable centrepieces");
    expect(section.textContent).toContain("No longer yoursLoad-in access notes");
  });

  it("sends 'I've read it' with the name it was addressed to, and says the venue can see it", async () => {
    const read = { status: "acknowledged" as const, acknowledgedByName: "Sam", note: null, createdAt: "2026-12-02T10:00:00.000Z" };
    mockGetSupplierShare
      .mockResolvedValueOnce(fixturePack())
      .mockResolvedValueOnce(fixturePack({ status: "acknowledged", acknowledgements: [read] }));
    mockAcknowledgeSupplierShare.mockResolvedValue(fixtureAcknowledgement());
    renderSupplierPortal();

    expect((await screen.findByLabelText<HTMLInputElement>("Your name")).value).toBe("Sam");
    fireEvent.click(screen.getByRole("button", { name: "I've read it" }));

    await waitFor(() => {
      expect(mockAcknowledgeSupplierShare).toHaveBeenCalledWith("supplier-token", {
        status: "acknowledged",
        acknowledgedByName: "Sam",
        acknowledgedByEmail: null,
        note: null,
      });
    });
    expect(await screen.findByText("Sent. Trades Hall Glasgow's team can see you have read this.")).toBeTruthy();
    expect(await screen.findByText("You marked this as read on Wed 2 Dec, 10:00, as Sam.")).toBeTruthy();
    // Read once: the main button goes, but a question can still be asked.
    expect(screen.queryByRole("button", { name: "I've read it" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ask a question" })).toBeTruthy();
    expect(screen.getByText("Your replies")).toBeTruthy();
  });

  it("works while the reply is on its way, with the shared activity indicator, and settles", async () => {
    mockGetSupplierShare.mockResolvedValue(fixturePack());
    let land: ((value: SupplierAcknowledgement) => void) | undefined;
    mockAcknowledgeSupplierShare.mockImplementation(() => new Promise<SupplierAcknowledgement>((resolve) => { land = resolve; }));
    renderSupplierPortal();

    fireEvent.click(await screen.findByRole("button", { name: "I've read it" }));
    const busy = await screen.findByRole("button", { name: /Sending/u });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.hasAttribute("disabled")).toBe(true);
    await act(async () => { land?.(fixtureAcknowledgement()); await Promise.resolve(); });
    await waitFor(() => { expect(screen.queryByRole("button", { name: /Sending/u })).toBeNull(); });
  });

  it("asks a question in their own words and says who to ring if it is urgent", async () => {
    mockGetSupplierShare.mockResolvedValue(fixturePack());
    mockAcknowledgeSupplierShare.mockResolvedValue(fixtureAcknowledgement("needs_clarification"));
    renderSupplierPortal();

    const toggle = await screen.findByRole("button", { name: "Ask a question" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Close the question" }).getAttribute("aria-expanded")).toBe("true");
    const send = screen.getByRole("button", { name: "Send my question" });
    expect(send).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Which door do we load through?" } });
    expect(send).toHaveProperty("disabled", false);
    fireEvent.click(send);

    await waitFor(() => {
      expect(mockAcknowledgeSupplierShare).toHaveBeenCalledWith("supplier-token", {
        status: "needs_clarification",
        acknowledgedByName: "Sam",
        acknowledgedByEmail: null,
        note: "Which door do we load through?",
      });
    });
    expect((await screen.findByText(/has your question/u)).textContent)
      .toBe("Sent. Trades Hall Glasgow's team has your question. If it is urgent, ring Kerry Mackay on 0141 496 0100.");
  });

  it("asks for a name before any reply, because the venue reads it with the reply", async () => {
    mockGetSupplierShare.mockResolvedValue(fixturePack({ contactName: null, passDetails: details({ addressedTo: null }) }));
    renderSupplierPortal();

    expect(await screen.findByText("Write your name first, so the venue knows who replied.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "I've read it" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Jordan" } });
    expect(screen.getByRole("button", { name: "I've read it" })).toHaveProperty("disabled", false);
    expect(screen.getByText("The venue sees this name with your reply, as given by whoever holds this link.")).toBeTruthy();
  });

  it("says the reply did not reach the venue and names who to ring instead", async () => {
    mockGetSupplierShare.mockResolvedValue(fixturePack());
    mockAcknowledgeSupplierShare.mockRejectedValue(new Error("offline"));
    renderSupplierPortal();

    fireEvent.click(await screen.findByRole("button", { name: "I've read it" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("Your reply did not reach the venue. Check your signal and try again, or ring Kerry Mackay on 0141 496 0100.");
    expect(screen.getByRole("button", { name: "I've read it" })).toHaveProperty("disabled", false);
  });

  it("still reads plainly when the page has no plain-words details, pointing to the venue team", async () => {
    mockGetSupplierShare.mockResolvedValue(fixturePack({ passDetails: undefined }));
    renderSupplierPortal();

    expect(await screen.findByRole("heading", { level: 1, name: "Bloom & Co" })).toBeTruthy();
    expect(screen.getByText("Tell the door who you are and what you are here for.")).toBeTruthy();
    expect(screen.getByText("Send the venue team a question below; it reaches the people running the day.")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Your name").value).toBe("Sam");
    expect(document.body.textContent).not.toMatch(/handoff|snapshot/iu);
  });

  it("says when no arrival time is on the brief, and who to agree one with", async () => {
    mockGetSupplierShare.mockResolvedValue(fixturePack({
      items: [{ title: "Load-in access notes", detail: "Side door.", kind: "requirement", arrivalWindow: null, sourceRef: null, sortOrder: 0 }],
    }));
    renderSupplierPortal();
    expect(await screen.findByText("No arrival time is on your brief yet. Agree one with Kerry Mackay.")).toBeTruthy();
  });

  it("shows the shared activity status while the brief opens, then the brief", async () => {
    let land: ((value: SupplierSafePackView) => void) | undefined;
    mockGetSupplierShare.mockImplementation(() => new Promise<SupplierSafePackView>((resolve) => { land = resolve; }));
    renderSupplierPortal();

    expect(screen.getByText("Opening your brief…")).toBeTruthy();
    await act(async () => { land?.(fixturePack()); await Promise.resolve(); });
    expect(await screen.findByRole("heading", { level: 1, name: "Bloom & Co" })).toBeTruthy();
    expect(screen.queryByText("Opening your brief…")).toBeNull();
  });

  it("says a link that no longer opens, and where to get the current one", async () => {
    mockGetSupplierShare.mockRejectedValue(new Error("404"));
    renderSupplierPortal();

    expect(await screen.findByRole("heading", { name: "This link no longer opens" })).toBeTruthy();
    expect(screen.getByText(/Ask the person at the venue who sent it for the current one/u)).toBeTruthy();
  });
});

describe("SupplierSafePackViewSchema boundary validation", () => {
  it("accepts the portal fixture and rejects malformed supplier-safe payloads", () => {
    expect(SupplierSafePackViewSchema.safeParse(fixturePack()).success).toBe(true);
    expect(SupplierSafePackViewSchema.safeParse(fixturePack({ passDetails: undefined })).success).toBe(true);
    expect(SupplierSafePackViewSchema.safeParse({ ...fixturePack(), status: "sent" }).success).toBe(false);
    expect(SupplierSafePackViewSchema.safeParse({ ...fixturePack(), createdBy: "00000000-0000-4000-8000-000000000704" }).success).toBe(false);
    expect(SupplierSafePackViewSchema.safeParse({ ...fixturePack(), passDetails: { ...details(), tokenHash: "a".repeat(64) } }).success).toBe(false);
    expect(SupplierSafePackViewSchema.safeParse({
      ...fixturePack(),
      changesSincePreviousHandoff: undefined,
    }).success).toBe(false);
  });
});

describe("supplier portal route registration", () => {
  it("mounts the token route in the public router", async () => {
    const source = await readFile(resolve("src/router.tsx"), "utf-8");
    expect(source).toContain("SupplierPortalPage");
    expect(source).toContain("path: \"/supplier-share/:token\"");
  });
});
