import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const NOW = "2026-06-15T09:00:00.000Z";

function fixturePack(overrides: Partial<SupplierSafePackView> = {}): SupplierSafePackView {
  return {
    title: "Technical supplier coordination pack",
    venueName: "Trades Hall of Glasgow",
    supplierName: "Technical Partner",
    contactName: "Venue Operations",
    contactEmail: "ops@tradeshall.co.uk",
    contactPhone: "+44 141 552 2418",
    status: "issued",
    safeStatus: "supplier_safe_operations_handoff",
    issuedAt: NOW,
    expiresAt: null,
    source: {
      sourceLabel: "Approved configuration snapshot v3",
      handoffVersion: 3,
      compiledAt: NOW,
      snapshotHashPrefix: "abcdef123456",
      sourceDigest: "a".repeat(64),
    },
    changesSincePreviousHandoff: {
      summary: "Round tables changed and one lectern was removed since the previous approved snapshot.",
      addedCount: 1,
      changedCount: 1,
      removedCount: 1,
    },
    items: [
      {
        title: "Technical supplier handoff",
        detail: "Confirm delivery, setup order, and removal timing against the handoff pack.",
        kind: "requirement",
        arrivalWindow: "08:00-10:00",
        sourceRef: "snapshot.totals",
        sortOrder: 0,
      },
      {
        title: "Load-in access notes",
        detail: "Use the service entrance before guest arrival.",
        kind: "load_in_window",
        arrivalWindow: null,
        sourceRef: "snapshot.instructions.accessNotes",
        sortOrder: 1,
      },
    ],
    acknowledgements: [],
    supplierNotice: "Supplier-facing planning handoff from venue operations data. Confirm details with the venue team before arrival.",
    ...overrides,
  };
}

function fixtureAcknowledgement(): SupplierAcknowledgement {
  return {
    id: "00000000-0000-4000-8000-000000000701",
    packId: "00000000-0000-4000-8000-000000000702",
    shareTokenId: "00000000-0000-4000-8000-000000000703",
    status: "acknowledged",
    acknowledgedByName: "Sam Supplier",
    acknowledgedByEmail: "sam@example.com",
    note: "Received and confirmed.",
    createdAt: "2026-06-15T10:00:00.000Z",
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
  it("renders supplier-safe handoff details, changes, arrival windows, and source references", async () => {
    mockGetSupplierShare.mockResolvedValue(fixturePack());
    renderSupplierPortal();

    expect(await screen.findByText("Technical supplier coordination pack")).toBeTruthy();
    expect(screen.getByText("Trades Hall of Glasgow")).toBeTruthy();
    expect(screen.getByText("Technical Partner")).toBeTruthy();
    expect(screen.getByText("08:00-10:00")).toBeTruthy();
    expect(screen.getByText(/Round tables changed/)).toBeTruthy();
    expect(screen.getByText("abcdef123456")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Acknowledge handoff" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/packId|shareTokenId|tokenHash|createdBy|internal/i);
  });

  it("submits an acknowledgement and refreshes the visible acknowledgement state", async () => {
    mockGetSupplierShare
      .mockResolvedValueOnce(fixturePack())
      .mockResolvedValueOnce(fixturePack({
        status: "acknowledged",
        acknowledgements: [{
          status: "acknowledged",
          acknowledgedByName: "Sam Supplier",
          note: "Received and confirmed.",
          createdAt: "2026-06-15T10:00:00.000Z",
        }],
      }));
    mockAcknowledgeSupplierShare.mockResolvedValue(fixtureAcknowledgement());
    renderSupplierPortal();

    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Sam Supplier" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@example.com" } });
    fireEvent.change(screen.getByLabelText("Note for the venue team"), { target: { value: "Received and confirmed." } });
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge handoff" }));

    await waitFor(() => {
      expect(mockAcknowledgeSupplierShare).toHaveBeenCalledWith("supplier-token", {
        status: "acknowledged",
        acknowledgedByName: "Sam Supplier",
        acknowledgedByEmail: "sam@example.com",
        note: "Received and confirmed.",
      });
    });
    expect(await screen.findByText("Latest response")).toBeTruthy();
    expect(screen.getByText("Received and confirmed.")).toBeTruthy();
    expect(screen.getByText("Response closed")).toBeTruthy();
  });

  it("requires a clarification note before sending a clarification request", async () => {
    mockGetSupplierShare.mockResolvedValue(fixturePack());
    renderSupplierPortal();

    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Sam Supplier" } });
    fireEvent.click(screen.getByLabelText("Need clarification"));
    expect(screen.getByRole("button", { name: "Send clarification request" })).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Clarification needed"), { target: { value: "Please confirm lift access." } });
    expect(screen.getByRole("button", { name: "Send clarification request" })).toHaveProperty("disabled", false);
  });

  it("hides the acknowledgement form when the pack is already acknowledged", async () => {
    mockGetSupplierShare.mockResolvedValue(fixturePack({
      status: "acknowledged",
      acknowledgements: [{
        status: "acknowledged",
        acknowledgedByName: "Sam Supplier",
        note: null,
        createdAt: "2026-06-15T10:00:00.000Z",
      }],
    }));
    renderSupplierPortal();

    expect(await screen.findByText("Latest response")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Acknowledge handoff" })).toBeNull();
    expect(screen.getByText("Response closed")).toBeTruthy();
  });

  it("shows an unavailable state when the supplier link cannot be resolved", async () => {
    mockGetSupplierShare.mockRejectedValue(new Error("404"));
    renderSupplierPortal();

    expect(await screen.findByText("This supplier link is not available")).toBeTruthy();
  });
});

describe("SupplierSafePackViewSchema boundary validation", () => {
  it("accepts the portal fixture and rejects malformed supplier-safe payloads", () => {
    expect(SupplierSafePackViewSchema.safeParse(fixturePack()).success).toBe(true);
    expect(SupplierSafePackViewSchema.safeParse({ ...fixturePack(), status: "sent" }).success).toBe(false);
    expect(SupplierSafePackViewSchema.safeParse({ ...fixturePack(), createdBy: "00000000-0000-4000-8000-000000000704" }).success).toBe(false);
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
