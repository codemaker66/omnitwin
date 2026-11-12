import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client.js";
import * as configApi from "../api/configurations.js";
import type { ObjectMetadata, PlacedObject } from "../api/configurations.js";
import { getCatalogueItemBySlug } from "../lib/catalogue.js";
import { plannerChairSlug } from "../lib/furniture-defaults.js";
import { PLANNER_CHROME_STORAGE_KEY } from "../lib/planner-chrome-flag.js";
import { EditorPage } from "../pages/EditorPage.js";
import { useEditorStore, type EditorObject } from "../stores/editor-store.js";
import { serveNotesAsTheApiDoes, type PlanOnServer } from "../test/guest-plan-api.js";

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

// ---------------------------------------------------------------------------
// A refused clear (rulings R1(b) and C3 on #388, 12 November 2026). Keep mine
// carried the person's own notes onto a newer version, where the maker had
// rewritten them, and work kept on this device brings that back here. The
// person cleared one note and wrote over another; the API refuses both, and
// the rest lands. The clear is said in the web's own sentence, naming the
// piece as the other held-note lines do; the words over a held note keep the
// API's sentence. The clear's notice stays until it is dismissed.
//
// The network is the API's model of the store tests (src/test/guest-plan-api.ts).
// ---------------------------------------------------------------------------

const CHAIR = getCatalogueItemBySlug(plannerChairSlug())?.id ?? "missing-chair";
const TABLE_2 = "0a0a0a02-0000-4000-8000-000000000000";
const CHAIR_AT_3 = "0a0a0a03-0000-4000-8000-0000000000c1";
const GROUP_3 = "0e0e0e03-0000-4000-8000-000000000000";
const MINE = "TEST ONLY by the window";
const THEIRS = "TEST ONLY nut allergy, table by the door";
const CHAIR_NOT_REMOVED = "A chair at Table 3's note was not removed: it was changed somewhere else, and that note cannot be shown here.";
const TABLE_3_NOT_REMOVED = "Table 3's note was not removed: it was changed somewhere else, and that note cannot be shown here.";

/** A piece of this plan: its id, catalogue item, name, group and place. */
function piece(id: string, asset: string, label: string | undefined, groupId: string | null, x: number): EditorObject {
  return {
    id, assetDefinitionId: asset, ...(label === undefined ? {} : { label }), notes: "",
    positionX: x, positionY: 0, positionZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0,
    scale: 1, sortOrder: 0, clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null, groupId,
  };
}

/** The API's answer for one of `pieces`. */
function answeredAs(pieces: readonly EditorObject[]): (id: string, metadata: ObjectMetadata, x: number) => PlacedObject {
  return (id, metadata, x) => ({
    id, configurationId: "cfg-1", assetDefinitionId: pieces.find((one) => one.id === id)?.assetDefinitionId ?? ROUND,
    positionX: x.toFixed(3), positionY: "0.000", positionZ: "0.000",
    rotationX: "0.00000", rotationY: "0.00000", rotationZ: "0.00000", scale: "1.000", sortOrder: 0,
    metadata: { clothed: false, groupId: pieces.find((one) => one.id === id)?.groupId ?? null, ...metadata },
  });
}

/**
 * `pieces` as the person has them, and the notes this browser carried onto them
 * (noteHeld, not yet confirmed); the maker has rewritten each of those on the server.
 */
function carriedOver(pieces: readonly EditorObject[], carried: ReadonlyMap<string, string>): PlanOnServer {
  const server: PlanOnServer = { revision: 4, notes: new Map([...carried.keys()].map((id) => [id, THEIRS])) };
  serveNotesAsTheApiDoes(server, answeredAs(pieces));
  useEditorStore.setState({
    baseObjects: pieces.map((one) => {
      const note = carried.get(one.id);
      return note === undefined ? { ...one, notes: "" } : { ...one, notes: note, noteHeld: true };
    }),
    objects: pieces,
    isDirty: true,
  });
  return server;
}

async function openThePage(): Promise<void> {
  render(
    <MemoryRouter initialEntries={["/plan/cfg-1"]}>
      <Routes><Route path="/plan/:code" element={<EditorPage />} /></Routes>
    </MemoryRouter>,
  );
  await waitFor(() => { expect(screen.getByTestId("planner-cockpit")).toBeTruthy(); });
}

describe("the page's notice of a refused clear of a note", () => {
  it("says it in its own sentence, naming a chair by its table, and keeps it through the next save until it is dismissed", async () => {
    const table = piece(TABLE_3, ROUND, "Table 3", GROUP_3, 0);
    const chair = piece(CHAIR_AT_3, CHAIR, undefined, GROUP_3, 0.5);
    const server = carriedOver([table, chair], new Map([[CHAIR_AT_3, MINE]]));
    await openThePage();

    await saveByHand();
    const shown = screen.getByText(CHAIR_NOT_REMOVED);
    // The API's sentence asks the person to clear what they wrote: it is for words over a held note, not this.
    expect(document.body.textContent).not.toContain(REFUSAL);
    expect(server.notes.get(CHAIR_AT_3)).toBe(THEIRS);

    // The next save lands, and does not put the notice away.
    await saveByHand();
    expect(server.revision).toBe(6);
    expect(screen.getByText(CHAIR_NOT_REMOVED)).toBe(shown);

    const toast = shown.closest<HTMLElement>("[role='status']");
    if (toast === null) throw new Error("no notice");
    fireEvent.click(within(toast).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(CHAIR_NOT_REMOVED)).toBeNull();
    expect(useEditorStore.getState()).toMatchObject({ saveError: null, saveErrorCode: null, noteClearsRefused: [] });
  });

  it("keeps the API's sentence for words written over a held note, named, beside the clear's own", async () => {
    const written = { ...piece(TABLE_2, ROUND, "Table 2", null, 2), notes: "TEST ONLY by the stage" };
    const cleared = piece(TABLE_3, ROUND, "Table 3", null, 0);
    carriedOver([written, cleared], new Map([[TABLE_2, MINE], [TABLE_3, MINE]]));
    await openThePage();

    await saveByHand();
    const shown = screen.getByText(`Table 2: ${REFUSAL} ${TABLE_3_NOT_REMOVED}`);
    const toast = shown.closest<HTMLElement>("[role='status']");
    if (toast === null) throw new Error("no notice");

    // Dismissed, the clear's notice goes; the refusal of the words over Table 2's note stands, as the header and slate say it.
    fireEvent.click(within(toast).getByRole("button", { name: "Dismiss" }));
    expect(document.body.textContent).not.toContain(TABLE_3_NOT_REMOVED);
    expect(useEditorStore.getState()).toMatchObject({ saveError: REFUSAL, saveErrorCode: "NOTE_HELD", noteClearsRefused: [] });
  });
});
