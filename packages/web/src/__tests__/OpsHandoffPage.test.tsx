import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { OpsHandoffPage } from "../pages/OpsHandoffPage.js";
import type { OpsHandoffPackBundle } from "@omnitwin/types";

const { mockGetOpsHandoffPack } = vi.hoisted(() => ({
  mockGetOpsHandoffPack: vi.fn(),
}));

vi.mock("../api/ops-handoff.js", () => ({
  getOpsHandoffPack: mockGetOpsHandoffPack,
}));

vi.mock("../components/ai/AIDraftPanel.js", () => ({
  AIDraftPanel: ({ title }: { readonly title: string }) => (
    <section aria-label={title}>AI draft panel mocked for ops handoff tests.</section>
  ),
}));

const NOW = "2026-06-12T09:00:00.000Z";
const HASH = "f".repeat(64);

function fixtureBundle(): OpsHandoffPackBundle {
  return {
    pack: {
      id: "00000000-0000-4000-8000-000000000401",
      eventId: null,
      configId: "00000000-0000-4000-8000-000000000402",
      snapshotId: "00000000-0000-4000-8000-000000000403",
      snapshotHash: HASH,
      version: 1,
      status: "compiled",
      sourceLabel: "Approved configuration snapshot v1",
      summary: "Grand Hall handoff compiled from approved snapshot v1: 2 pick-list lines, 4 tasks, 1 supplier note.",
      createdBy: null,
      compiledAt: NOW,
      updatedAt: NOW,
    },
    taskGroups: [
      {
        id: "00000000-0000-4000-8000-000000000404",
        handoffPackId: "00000000-0000-4000-8000-000000000401",
        title: "Setup tasks",
        kind: "setup",
        sortOrder: 0,
        createdAt: NOW,
      },
      {
        id: "00000000-0000-4000-8000-000000000405",
        handoffPackId: "00000000-0000-4000-8000-000000000401",
        title: "Room flip tasks",
        kind: "room_flip",
        sortOrder: 1,
        createdAt: NOW,
      },
      {
        id: "00000000-0000-4000-8000-000000000406",
        handoffPackId: "00000000-0000-4000-8000-000000000401",
        title: "Supplier notes",
        kind: "supplier",
        sortOrder: 2,
        createdAt: NOW,
      },
      {
        id: "00000000-0000-4000-8000-000000000407",
        handoffPackId: "00000000-0000-4000-8000-000000000401",
        title: "Breakdown tasks",
        kind: "breakdown",
        sortOrder: 3,
        createdAt: NOW,
      },
    ],
    opsTasks: [
      {
        id: "00000000-0000-4000-8000-000000000408",
        handoffPackId: "00000000-0000-4000-8000-000000000401",
        taskGroupId: "00000000-0000-4000-8000-000000000404",
        phaseId: null,
        kind: "setup",
        title: "Set 12 x Round Table",
        detail: "Place in Centre during Furniture.",
        status: "todo",
        sortOrder: 0,
        dueLabel: null,
        sourceRef: "furniture|Centre|Round Table|0",
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "00000000-0000-4000-8000-000000000409",
        handoffPackId: "00000000-0000-4000-8000-000000000401",
        taskGroupId: "00000000-0000-4000-8000-000000000405",
        phaseId: null,
        kind: "room_flip",
        title: "Prepare room flip 1",
        detail: "Ceremony -> Dinner; target duration 45 min.",
        status: "todo",
        sortOrder: 1,
        dueLabel: "45 min planning window",
        sourceRef: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "00000000-0000-4000-8000-000000000410",
        handoffPackId: "00000000-0000-4000-8000-000000000401",
        taskGroupId: "00000000-0000-4000-8000-000000000406",
        phaseId: null,
        kind: "supplier",
        title: "Supplier coordination check",
        detail: "Confirm supplier scope before dispatch.",
        status: "todo",
        sortOrder: 2,
        dueLabel: null,
        sourceRef: "snapshot",
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "00000000-0000-4000-8000-000000000411",
        handoffPackId: "00000000-0000-4000-8000-000000000401",
        taskGroupId: "00000000-0000-4000-8000-000000000407",
        phaseId: null,
        kind: "breakdown",
        title: "Break down Round Table",
        detail: "Account for 12 x Round Table from the approved handoff pack.",
        status: "todo",
        sortOrder: 3,
        dueLabel: null,
        sourceRef: "table:Round Table",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    furniturePickList: {
      id: "00000000-0000-4000-8000-000000000412",
      handoffPackId: "00000000-0000-4000-8000-000000000401",
      title: "Grand Hall furniture pick list",
      totalItems: 24,
      createdAt: NOW,
    },
    pickListItems: [
      {
        id: "00000000-0000-4000-8000-000000000413",
        pickListId: "00000000-0000-4000-8000-000000000412",
        name: "Round Table",
        category: "table",
        quantity: 12,
        sourcePhase: null,
        sourceZone: null,
        notes: null,
        sortOrder: 0,
        createdAt: NOW,
      },
      {
        id: "00000000-0000-4000-8000-000000000414",
        pickListId: "00000000-0000-4000-8000-000000000412",
        name: "Ivory Tablecloth",
        category: "linen",
        quantity: 12,
        sourcePhase: null,
        sourceZone: null,
        notes: null,
        sortOrder: 1,
        createdAt: NOW,
      },
    ],
    supplierInstructions: [{
      id: "00000000-0000-4000-8000-000000000415",
      handoffPackId: "00000000-0000-4000-8000-000000000401",
      supplierId: null,
      category: "operations",
      title: "Supplier coordination check",
      detail: "Confirm supplier scope before dispatch.",
      arrivalWindow: null,
      sourceRef: "snapshot",
      sortOrder: 0,
      createdAt: NOW,
    }],
    loadInSequence: [{
      id: "00000000-0000-4000-8000-000000000416",
      handoffPackId: "00000000-0000-4000-8000-000000000401",
      kind: "load_in",
      stepNumber: 1,
      title: "Load in Furniture",
      detail: "One row from the approved snapshot is grouped in this phase.",
      sortOrder: 0,
      createdAt: NOW,
    }],
    breakdownSequence: [{
      id: "00000000-0000-4000-8000-000000000417",
      handoffPackId: "00000000-0000-4000-8000-000000000401",
      kind: "breakdown",
      stepNumber: 1,
      title: "Break down Furniture",
      detail: "One row from the approved snapshot is grouped in this phase.",
      sortOrder: 0,
      createdAt: NOW,
    }],
    roomFlipPlans: [{
      id: "00000000-0000-4000-8000-000000000418",
      handoffPackId: "00000000-0000-4000-8000-000000000401",
      phaseId: null,
      fromPhaseLabel: "Ceremony",
      toPhaseLabel: "Dinner",
      durationMinutes: 45,
      taskCount: 1,
      reviewGateCount: 0,
      notes: "Room flip is an internal planning handoff phase.",
      createdAt: NOW,
    }],
    beoDocument: {
      id: "00000000-0000-4000-8000-000000000419",
      handoffPackId: "00000000-0000-4000-8000-000000000401",
      title: "Grand Hall BEO internal handoff",
      body: "BEO internal operations handoff from approved planning data.",
      sourceSnapshotHash: HASH,
      safeStatus: "internal_operations_handoff",
      createdAt: NOW,
    },
    snapshotDiff: {
      id: "00000000-0000-4000-8000-000000000420",
      handoffPackId: "00000000-0000-4000-8000-000000000401",
      previousSnapshotHash: null,
      currentSnapshotHash: HASH,
      addedCount: 1,
      removedCount: 0,
      changedCount: 1,
      summary: "1 added, 0 removed, 1 quantity changed since the previous approved snapshot.",
      payload: {
        added: ["12 x Ivory Tablecloth"],
        removed: [],
        changed: ["Round Table: 10 -> 12"],
      },
      createdAt: NOW,
    },
  };
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/ops/handoff/00000000-0000-4000-8000-000000000401"]}>
      <Routes>
        <Route path="/ops/handoff/:handoffPackId" element={<OpsHandoffPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockGetOpsHandoffPack.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OpsHandoffPage", () => {
  it("renders the handoff dashboard sections", async () => {
    mockGetOpsHandoffPack.mockResolvedValue(fixtureBundle());
    renderPage();

    expect(await screen.findByText("Ops handoff pack")).toBeTruthy();
    expect(screen.getByRole("main", { name: "Operations handoff pack" })).toBeTruthy();
    expect(screen.getByText("Pick list")).toBeTruthy();
    expect(screen.getByText("Round Table")).toBeTruthy();
    expect(screen.getByText("Setup tasks")).toBeTruthy();
    expect(screen.getByText("Room flip tasks")).toBeTruthy();
    expect(screen.getAllByText("Supplier coordination check").length).toBeGreaterThan(0);
    expect(screen.getByText("What changed")).toBeTruthy();
    expect(screen.getByText("BEO internal operations handoff from approved planning data.")).toBeTruthy();
  });

  it("prints the pack for export", async () => {
    mockGetOpsHandoffPack.mockResolvedValue(fixtureBundle());
    const print = vi.fn();
    Object.defineProperty(window, "print", {
      configurable: true,
      value: print,
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Print / export" }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable error state", async () => {
    mockGetOpsHandoffPack.mockRejectedValue(new Error("404"));
    renderPage();

    expect(await screen.findByText("Handoff pack unavailable")).toBeTruthy();
    expect(screen.getByRole("main", { name: "Operations handoff unavailable" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("renders safe internal operations language", async () => {
    mockGetOpsHandoffPack.mockResolvedValue(fixtureBundle());
    renderPage();

    await screen.findByText("Ops handoff pack");
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\bfire approved\b/iu);
    expect(text).not.toMatch(/\bcertified safe\b/iu);
    expect(text).not.toMatch(/\blegally compliant\b/iu);
    expect(text).not.toMatch(/\bsurvey-grade\b/iu);
    expect(text).not.toMatch(/\bapproved for occupancy\b/iu);
    expect(text).not.toMatch(/\bguaranteed accessible\b/iu);
    expect(text).not.toMatch(/\bBlack Label\b/u);
    expect(text).not.toMatch(/\bphotoreal digital twin\b/iu);
  });
});
