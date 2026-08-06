import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FreezePhaseLayoutSnapshotResponse } from "@omnitwin/types";
import { PhaseLayoutSnapshotAction } from "../PhaseLayoutSnapshotAction.js";

const mocks = vi.hoisted(() => ({
  freeze: vi.fn(),
  useFreeze: vi.fn(),
}));

vi.mock("../../../../hooks/use-freeze-phase-layout-snapshot.js", () => ({
  useFreezePhaseLayoutSnapshot: mocks.useFreeze,
}));

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const PHASE_ID = "22222222-2222-4222-8222-222222222222";
const CONFIGURATION_ID = "33333333-3333-4333-8333-333333333333";

const RESULT: FreezePhaseLayoutSnapshotResponse = {
  outcome: "created",
  eventId: EVENT_ID,
  phaseId: PHASE_ID,
  configurationId: CONFIGURATION_ID,
  snapshotId: "44444444-4444-4444-8444-444444444444",
  canonicalSnapshotId: "55555555-5555-4555-8555-555555555555",
  snapshotHash: "a".repeat(64),
  proofDigest: "b".repeat(64),
  frozenBy: "66666666-6666-4666-8666-666666666666",
  status: "frozen",
  coordinateSpace: "real_m_v1",
  objectCount: 42,
  guestCount: 180,
  createdAt: "2026-07-18T12:00:00.000Z",
  frozenAt: "2026-07-18T12:00:00.000Z",
  supersedesSnapshotId: null,
};

beforeEach(() => {
  mocks.freeze.mockReset();
  mocks.useFreeze.mockReset();
  mocks.useFreeze.mockReturnValue({
    status: "idle",
    result: null,
    error: null,
    errorCode: null,
    freeze: mocks.freeze,
  });
});

afterEach(() => {
  cleanup();
});

describe("PhaseLayoutSnapshotAction", () => {
  it("links only the current configuration identity on explicit action", async () => {
    mocks.freeze.mockResolvedValue(RESULT);
    const onLinked = vi.fn();
    render(
      <PhaseLayoutSnapshotAction
        eventId={EVENT_ID}
        phaseId={PHASE_ID}
        configurationId={CONFIGURATION_ID}
        isDirty={false}
        isReadOnly={false}
        onLinked={onLinked}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Use current saved plan" }));
    await waitFor(() => {
      expect(mocks.freeze).toHaveBeenCalledWith(
        { eventId: EVENT_ID, phaseId: PHASE_ID },
        { configurationId: CONFIGURATION_ID },
      );
    });
    expect(onLinked).toHaveBeenCalledWith(RESULT);
    expect(screen.getByText("Saved plan linked.")).toBeTruthy();
  });

  it("requires a saved, clean configuration before linking", () => {
    const { rerender } = render(
      <PhaseLayoutSnapshotAction
        eventId={EVENT_ID}
        phaseId={PHASE_ID}
        configurationId={null}
        isDirty={false}
        isReadOnly={false}
        onLinked={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Use current saved plan" }).hasAttribute("disabled"))
      .toBe(true);
    expect(screen.getByText("Open a saved plan to link it.")).toBeTruthy();

    rerender(
      <PhaseLayoutSnapshotAction
        eventId={EVENT_ID}
        phaseId={PHASE_ID}
        configurationId={CONFIGURATION_ID}
        isDirty
        isReadOnly={false}
        onLinked={vi.fn()}
      />,
    );
    expect(screen.getByText("Save changes before using this plan.")).toBeTruthy();

    rerender(
      <PhaseLayoutSnapshotAction
        eventId={EVENT_ID}
        phaseId={PHASE_ID}
        configurationId={CONFIGURATION_ID}
        isDirty={false}
        isReadOnly
        onLinked={vi.fn()}
      />,
    );
    expect(screen.getByText("Sign in with edit access to link this plan.")).toBeTruthy();
  });

  it("shows the server's honest conflict instead of claiming a link", () => {
    mocks.useFreeze.mockReturnValue({
      status: "error",
      result: null,
      error: "This saved plan has no canonical planning snapshot.",
      errorCode: "CONFIGURATION_CANONICAL_SNAPSHOT_MISSING",
      freeze: mocks.freeze,
    });
    render(
      <PhaseLayoutSnapshotAction
        eventId={EVENT_ID}
        phaseId={PHASE_ID}
        configurationId={CONFIGURATION_ID}
        isDirty={false}
        isReadOnly={false}
        onLinked={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "This saved plan has no canonical planning snapshot.",
    );
  });
});
