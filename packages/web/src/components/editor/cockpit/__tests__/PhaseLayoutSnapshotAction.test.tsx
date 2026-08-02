import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FreezePhaseLayoutSnapshotResponse } from "../../../../api/room-layout-timeline.js";
import {
  canFreezePhaseLayoutForVenue,
  PhaseLayoutSnapshotAction,
} from "../PhaseLayoutSnapshotAction.js";
import { useLayoutTimelinePreviewStore } from "../../../../stores/layout-timeline-preview-store.js";

const mocks = vi.hoisted(() => ({ freeze: vi.fn(), useFreeze: vi.fn() }));
vi.mock("../../../../hooks/use-freeze-phase-layout-snapshot.js", () => ({
  useFreezePhaseLayoutSnapshot: mocks.useFreeze,
}));

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const PHASE_ID = "22222222-2222-4222-8222-222222222222";
const CONFIGURATION_ID = "33333333-3333-4333-8333-333333333333";
const VENUE_ID = "77777777-7777-4777-8777-777777777777";
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

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | undefined;
  return {
    promise: new Promise<T>((resolve) => { resolvePromise = resolve; }),
    resolve: (value) => { resolvePromise?.(value); },
  };
}

beforeEach(() => {
  useLayoutTimelinePreviewStore.getState().clear();
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
  useLayoutTimelinePreviewStore.getState().clear();
});

describe("PhaseLayoutSnapshotAction", () => {
  it("freezes only the supplied saved configuration on explicit action", async () => {
    mocks.freeze.mockResolvedValue(RESULT);
    const onFrozen = vi.fn();
    render(
      <PhaseLayoutSnapshotAction
        eventId={EVENT_ID}
        phaseId={PHASE_ID}
        configurationId={CONFIGURATION_ID}
        onFrozen={onFrozen}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Freeze current saved plan" }));
    await waitFor(() => {
      expect(mocks.freeze).toHaveBeenCalledWith(
        { eventId: EVENT_ID, phaseId: PHASE_ID },
        { configurationId: CONFIGURATION_ID },
      );
    });
    expect(onFrozen).toHaveBeenCalledWith(RESULT);
    expect(screen.getByText("Frozen layout saved.")).toBeTruthy();
  });

  it("surfaces the server's exact 409 without a success claim", () => {
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
        onFrozen={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "This saved plan has no canonical planning snapshot.",
    );
    expect(screen.queryByText("Frozen layout saved.")).toBeNull();
    expect(screen.queryByText("This frozen layout is already current.")).toBeNull();
  });

  it("disables the action and makes no hook call while timeline preview is locked", () => {
    useLayoutTimelinePreviewStore.getState().showPending("Loading timeline…");
    render(
      <PhaseLayoutSnapshotAction
        eventId={EVENT_ID}
        phaseId={PHASE_ID}
        configurationId={CONFIGURATION_ID}
        onFrozen={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Exit preview to freeze" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(mocks.freeze).not.toHaveBeenCalled();
  });

  it("reports an already-dispatched success if preview starts while freeze is in flight", async () => {
    const pending = deferred<FreezePhaseLayoutSnapshotResponse>();
    mocks.freeze.mockReturnValueOnce(pending.promise);
    const onFrozen = vi.fn();
    render(
      <PhaseLayoutSnapshotAction
        eventId={EVENT_ID}
        phaseId={PHASE_ID}
        configurationId={CONFIGURATION_ID}
        onFrozen={onFrozen}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Freeze current saved plan" }));
    useLayoutTimelinePreviewStore.getState().showPending("Loading timeline…");
    pending.resolve(RESULT);

    await waitFor(() => { expect(onFrozen).toHaveBeenCalledWith(RESULT); });
    expect(screen.getByText("Frozen layout saved.")).toBeTruthy();
  });

  it("authorizes only same-venue staff/admin or platform admin", () => {
    const user = (role: string, venueId: string | null, platformRole: "none" | "operator" | "admin" = "none") => ({
      id: `user-${role}`,
      email: `${role}@example.test`,
      role,
      platformRole,
      venueId,
      name: role,
    });
    expect(canFreezePhaseLayoutForVenue(user("staff", VENUE_ID), VENUE_ID)).toBe(true);
    expect(canFreezePhaseLayoutForVenue(user("admin", VENUE_ID), VENUE_ID)).toBe(true);
    expect(canFreezePhaseLayoutForVenue(user("admin", "other-venue"), VENUE_ID)).toBe(false);
    expect(canFreezePhaseLayoutForVenue(user("planner", VENUE_ID), VENUE_ID)).toBe(false);
    expect(canFreezePhaseLayoutForVenue(user("hallkeeper", VENUE_ID), VENUE_ID)).toBe(false);
    expect(canFreezePhaseLayoutForVenue(user("client", VENUE_ID), VENUE_ID)).toBe(false);
    expect(canFreezePhaseLayoutForVenue(user("staff", VENUE_ID, "operator"), VENUE_ID)).toBe(true);
    expect(canFreezePhaseLayoutForVenue(user("client", null, "admin"), VENUE_ID)).toBe(true);
    expect(canFreezePhaseLayoutForVenue(null, VENUE_ID)).toBe(false);
  });
});
