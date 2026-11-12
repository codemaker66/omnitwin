import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client.js";
import * as configApi from "../api/configurations.js";
import { getCatalogueItemBySlug } from "../lib/catalogue.js";
import { PLANNER_CHROME_STORAGE_KEY } from "../lib/planner-chrome-flag.js";
import { EditorPage } from "../pages/EditorPage.js";
import { useEditorStore, type EditorObject } from "../stores/editor-store.js";

// ---------------------------------------------------------------------------
// The notice of a save refused over a note this browser is not shown, on the
// page (review of #388). Dismiss puts that notice away and leaves the refusal
// standing (bc993330), so the header and the slate go on saying it. The page
// mounts the notice for each failed save (saveError !== null), and a save
// clears saveError as it starts, so the next refusal is a notice of its own:
// it is shown again, though the last one was dismissed.
//
// The real page and store; the 3D room, the panels and the network are
// replaced. The API's refusal arrives as an answer from the network does, in
// a later task.
// ---------------------------------------------------------------------------

vi.mock("../App.js", () => ({ App: () => <div data-testid="mock-editor-3d" /> }));
vi.mock("../components/editor/cockpit/PlannerCockpit.js", () => ({ PlannerCockpit: () => <div data-testid="planner-cockpit" /> }));
vi.mock("../pages/BlueprintPage.js", () => ({ BlueprintPage: () => null }));
vi.mock("../components/editor/MobilePlannerTopBar.js", () => ({ MobilePlannerTopBar: () => null }));
vi.mock("../components/editor/SaveSendPanel.js", () => ({ SaveSendPanel: () => null }));
vi.mock("../components/editor/SubmitForReviewPanel.js", () => ({ SubmitForReviewPanel: () => null }));
vi.mock("../components/editor/EditorBridge.js", () => ({ EditorBridge: () => null }));
vi.mock("../components/editor/ObjectNotePanel.js", () => ({ ObjectNotePanel: () => null }));
vi.mock("../components/editor/EventDetailsPanel.js", () => ({ EventDetailsPanel: () => null }));
vi.mock("../hooks/use-media-query.js", () => ({ useIsCoarsePointer: () => false, useIsNarrowViewport: () => false }));
vi.mock("../api/action-log.js", () => ({
  postActionBatch: vi.fn(() => Promise.resolve({ accepted: 0, duplicates: 0 })),
}));
vi.mock("../api/configurations.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api/configurations.js")>(),
  getPublicConfig: vi.fn(),
  getConfig: vi.fn(),
  publicBatchSave: vi.fn(),
  authBatchSave: vi.fn(),
}));

const REFUSAL = "A note on this plan cannot be changed from here, and this save tried to change it. Clear the note you wrote on that piece.";
const ROUND = getCatalogueItemBySlug("round-table-6ft-white")?.id ?? "missing-round";
const TABLE_3 = "0a0a0a03-0000-4000-8000-000000000000";
/** The notice names the one piece the person's words stand over (lib/guest-plan-notes pieceNamedForRefusedSave). */
const NOTICE = `Table 3: ${REFUSAL}`;

/** Table 3 holds a note this browser is not shown, and the person has written their own words over it. */
function writtenOverHeldNote(): EditorObject {
  return {
    id: TABLE_3, assetDefinitionId: ROUND, label: "Table 3", notes: "TEST ONLY typed over",
    positionX: 0, positionY: 0, positionZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0,
    scale: 1, sortOrder: 0, clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null, groupId: null,
  };
}

/** The API refuses the next save (409 NOTE_HELD), answering in a later task as the network does. */
function refuseNextSave(): void {
  vi.mocked(configApi.publicBatchSave).mockImplementationOnce(() => new Promise((_resolve, reject) => {
    setTimeout(() => { reject(new ApiError(409, REFUSAL, "NOTE_HELD")); }, 0);
  }));
}

/** A save by hand, as the header's Save sends it, through to its answer. */
async function saveByHand(): Promise<void> {
  let saving: Promise<boolean> = Promise.resolve(false);
  act(() => { saving = useEditorStore.getState().saveToServer(false); });
  await act(async () => { await saving; });
}

function notice(): HTMLElement | null {
  return screen.queryByText(NOTICE);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.removeItem(PLANNER_CHROME_STORAGE_KEY);
  useEditorStore.getState().reset();
  const written = writtenOverHeldNote();
  useEditorStore.setState({
    configId: "cfg-1", configRevision: 4, isLoading: false, error: null,
    isPublicPreview: true, notesIncluded: false,
    baseObjects: [{ ...written, notes: "", noteHeld: true }],
    objects: [written],
    isDirty: true,
  });
});

afterEach(() => {
  cleanup();
  useEditorStore.getState().reset();
});

describe("the page's notice of a save refused over a held note", () => {
  it("comes back at the next refused save after it was dismissed", async () => {
    render(
      <MemoryRouter initialEntries={["/plan/cfg-1"]}>
        <Routes><Route path="/plan/:code" element={<EditorPage />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => { expect(screen.getByTestId("planner-cockpit")).toBeTruthy(); });

    refuseNextSave();
    await saveByHand();
    const shown = notice();
    expect(shown).not.toBeNull();
    const toast = shown?.closest<HTMLElement>("[role='status']");
    if (toast === null || toast === undefined) throw new Error("no notice");
    fireEvent.click(within(toast).getByRole("button", { name: "Dismiss" }));
    expect(notice()).toBeNull();
    // Put away, not forgotten.
    expect(useEditorStore.getState()).toMatchObject({ saveError: REFUSAL, saveErrorCode: "NOTE_HELD" });

    refuseNextSave();
    await saveByHand();
    expect(configApi.publicBatchSave).toHaveBeenCalledTimes(2);
    expect(notice()).not.toBeNull();
  });
});
