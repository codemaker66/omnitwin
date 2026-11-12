import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configApi from "../../../api/configurations.js";
import type { BatchObjectInput, Configuration, ObjectMetadata, PlacedObject } from "../../../api/configurations.js";
import { toRealWorld } from "../../../constants/scale.js";
import { noteHeldOn } from "../../../lib/guest-plan-notes.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { NOTE_HELD_MESSAGE, serveNotesAsTheApiDoes, type PlanOnServer } from "../../../test/guest-plan-api.js";
import { flushAutoSave, scheduleAutoSave } from "../../editor/EditorBridge.js";
import { Slate } from "../Slate.js";
import type { SlateAudience } from "../slate-data.js";

// ---------------------------------------------------------------------------
// A refused clear of a note, on the slate (ruling R1(b) on #388, 12 November
// 2026). "Keep mine" carries the person's own note onto a newer version; the
// maker had rewritten it there, so the person's clear of it is refused while
// the rest of their work lands (R1, 6c4db97c). That refusal's notice stays
// until the person dismisses it: no later save says the layout saved over it,
// the autosave goes on landing their other work, and after Dismiss the slate
// says where saving really stands. The slate is where Keep mine is offered.
//
// The real slate and store; the network is the API's model of the store
// tests (src/test/guest-plan-api.ts), answering a moment later as a network
// does, so the person can act while Keep mine's saves are out.
// ---------------------------------------------------------------------------

vi.mock("../../../api/configurations.js", () => ({
  getConfig: vi.fn(),
  getPublicConfig: vi.fn(),
  createPublicConfig: vi.fn(),
  authBatchSave: vi.fn(),
  publicBatchSave: vi.fn(),
  updatePublicThumbnail: vi.fn(),
  claimConfig: vi.fn(),
  patchConfigMetadata: vi.fn(),
  submitGuestEnquiry: vi.fn(),
}));
vi.mock("../../../api/spaces.js", () => ({
  getSpace: vi.fn(async () => Promise.reject(new Error("no space in tests"))),
}));
vi.mock("../../../api/action-log.js", () => ({
  postActionBatch: vi.fn(() => Promise.resolve({ accepted: 0, duplicates: 0 })),
}));
const audience = vi.hoisted(() => ({ value: null as null | SlateAudience }));
vi.mock("../slate-data.js", () => ({
  useSlateAudience: () => audience.value,
  useEventHold: () => null,
}));
vi.mock("../../../hooks/use-planner-venue-identity.js", () => ({
  usePlannerVenueIdentity: () => ({ name: "Trades Hall", logoUrl: null, loading: false, known: true }),
}));

const PLAN = "0f0f0f0f-0000-4000-8000-000000000001";
const SPACE = "0f0f0f0f-0000-4000-8000-00000000005a";
const VENUE = "0f0f0f0f-0000-4000-8000-0000000000fe";
const A = "0a0a0a0a-0000-4000-8000-00000000000a";
const TABLE_7 = "0b0b0b0b-0000-4000-8000-000000000007";
const CHAIR = "banquet-chair";
const MINE = "TEST ONLY by the window";
const THEIRS = "TEST ONLY nut allergy, table by the door";
/** What the slate says of the clear the API refused. */
const REFUSED_CLEAR = NOTE_HELD_MESSAGE;

function store(): ReturnType<typeof useEditorStore.getState> {
  return useEditorStore.getState();
}

/** A piece as the API returns it, standing at `x`. */
function placed(id: string, metadata: ObjectMetadata = {}, x = 0): PlacedObject {
  return {
    id, configurationId: PLAN, assetDefinitionId: CHAIR,
    positionX: x.toFixed(3), positionY: "0.000", positionZ: "0.000",
    rotationX: "0.00000", rotationY: "0.00000", rotationZ: "0.00000", scale: "1.000", sortOrder: 0,
    metadata: { clothed: false, groupId: null, ...metadata },
  };
}

function plan(objects: readonly PlacedObject[], revision: number): Configuration {
  return {
    id: PLAN, spaceId: SPACE, venueId: VENUE, userId: null, name: "TEST ONLY plan", isPublicPreview: true, revision,
    objects: [...objects], notesIncluded: false,
  };
}

function table7(marks: ObjectMetadata = {}): PlacedObject {
  return placed(TABLE_7, { displayLabel: "Table 7", ...marks }, 2);
}

function savesSent(): number {
  return vi.mocked(configApi.publicBatchSave).mock.calls.length;
}

/** Piece `id` in the last save sent. */
function lastSent(id: string): BatchObjectInput | undefined {
  return vi.mocked(configApi.publicBatchSave).mock.calls.at(-1)?.[1].find((piece) => piece.id === id);
}

/**
 * This browser, shown no notes, writes its own note on Table 7 and the server
 * confirms it. The maker rewrites that note. The person clears theirs and
 * moves the chair, and the save meets the maker's version, which says only
 * that Table 7 holds a note.
 */
async function clearedWhatTheMakerRewrote(server: PlanOnServer): Promise<void> {
  serveNotesAsTheApiDoes(server, placed);
  vi.mocked(configApi.getPublicConfig).mockResolvedValue(plan([placed(A), table7()], server.revision));
  await store().loadConfiguration(PLAN, false);
  store().setObjectNotes(TABLE_7, MINE);
  expect(await store().saveToServer(false)).toBe(true);
  server.notes.set(TABLE_7, THEIRS);
  server.revision += 1;
  vi.mocked(configApi.getPublicConfig).mockResolvedValue(plan([placed(A), table7({ noteHeld: true })], server.revision));
  store().setObjectNotes(TABLE_7, "");
  store().updateObject(A, { positionX: 3 });
  expect(await store().saveToServer(false)).toBe(false);
  expect(store().saveConflict?.currentRevision).toBe(server.revision);
}

/** From here the API answers a moment later, as over a network. */
function answerLater(): void {
  const api = vi.mocked(configApi.publicBatchSave).getMockImplementation();
  if (api === undefined) throw new Error("no API model");
  vi.mocked(configApi.publicBatchSave).mockImplementation((...sent) => new Promise((resolve, reject) => {
    setTimeout(() => { api(...sent).then(resolve, reject); }, 0);
  }));
}

function openSlate(): void {
  render(
    <MemoryRouter initialEntries={[`/plan/${PLAN}?chrome=v2`]}>
      <Routes><Route path="*" element={<Slate />} /></Routes>
    </MemoryRouter>,
  );
}

/** Every text the slate's save line shows from now on, as it changes. */
function watchLine(): { readonly seen: string[]; readonly stop: () => void } {
  const line = screen.getByTestId("slate-line");
  const seen = [line.textContent ?? ""];
  const observer = new MutationObserver(() => { seen.push(line.textContent ?? ""); });
  observer.observe(line, { subtree: true, childList: true, characterData: true });
  return { seen, stop: () => { observer.disconnect(); } };
}

/** "Saved", the slate's word for a saved layout ("Not saved" is not it). */
function saysSaved(text: string): boolean {
  return /\bSaved\b/u.test(text);
}

/** Keep mine, with the person moving the chair to 5 and pressing Send while its saves are out. */
async function keepMineThenSend(): Promise<{ readonly kept: boolean; readonly sent: boolean }> {
  let keeping: Promise<boolean> = Promise.resolve(false);
  let flushing: Promise<boolean> = Promise.resolve(false);
  act(() => {
    keeping = store().keepMine(false);
    store().updateObject(A, { positionX: 5 });
    flushing = flushAutoSave();
  });
  let kept = false;
  let sent = false;
  await act(async () => { kept = await keeping; sent = await flushing; });
  return { kept, sent };
}

/** The bridge's autosave tick after the person moves the chair to `x`, through to its answer. */
async function moveAndAutosave(x: number): Promise<void> {
  const before = savesSent();
  act(() => {
    store().updateObject(A, { positionX: x });
    scheduleAutoSave(false, 0);
  });
  await waitFor(() => { expect(savesSent()).toBe(before + 1); });
  await waitFor(() => { expect(store().isSaving).toBe(false); });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  store().reset();
  // Venue staff reading a guest's plan from its link: signed in, and not shown its notes.
  audience.value = { event: null, graph: null, staff: false, signedIn: true, eventId: null };
});

afterEach(() => {
  cleanup();
  store().reset();
});

describe("the slate's notice of a refused clear of a note (ruling R1(b) on #388)", () => {
  it("stands through the save Send makes while Keep mine's saves are out and through the next autosave, and the line never says Saved", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    await clearedWhatTheMakerRewrote(server);
    openSlate();
    const line = watchLine();
    answerLater();

    const { kept, sent } = await keepMineThenSend();
    // Keep mine is refused its clear; Send's save then carries the move made meanwhile, and lands.
    expect({ kept, sent }).toEqual({ kept: false, sent: true });
    expect(lastSent(A)?.positionX).toBe(toRealWorld(5));
    expect(within(screen.getByRole("alert")).getByText(REFUSED_CLEAR)).toBeTruthy();

    await moveAndAutosave(7);
    line.stop();
    expect(line.seen.filter(saysSaved)).toEqual([]);
    expect(within(screen.getByRole("alert")).getByText(REFUSED_CLEAR)).toBeTruthy();
    expect(screen.getByTestId("slate-line").textContent).toContain("Not saved");
    // The maker's note is untouched, and Table 7 still shows the held line.
    expect(server.notes.get(TABLE_7)).toBe(THEIRS);
    expect(noteHeldOn(store(), TABLE_7)).toBe(true);
  });

  it("does not stop the autosave: the person's other edits reach the server while it stands", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    await clearedWhatTheMakerRewrote(server);
    openSlate();
    answerLater();
    await keepMineThenSend();
    const revision = server.revision;

    await moveAndAutosave(7);
    // The API's model took the batch: the chair where the person put it, Table 7 sent with no word on its note.
    expect(lastSent(A)?.positionX).toBe(toRealWorld(7));
    expect(lastSent(TABLE_7)?.metadata?.notes).toBeUndefined();
    expect(lastSent(TABLE_7)?.replacesNote).toBeUndefined();
    expect(server.revision).toBe(revision + 1);
    expect(store()).toMatchObject({ configRevision: server.revision, isDirty: false, isSaving: false });
    expect(within(screen.getByRole("alert")).getByText(REFUSED_CLEAR)).toBeTruthy();

    await moveAndAutosave(9);
    expect(lastSent(A)?.positionX).toBe(toRealWorld(9));
    expect(server.revision).toBe(revision + 2);
  });

  it("goes when the person dismisses it, and the slate then says Saved; Table 7 keeps its held line", async () => {
    const server: PlanOnServer = { revision: 4, notes: new Map() };
    await clearedWhatTheMakerRewrote(server);
    openSlate();
    let kept = true;
    await act(async () => { kept = await store().keepMine(false); });
    // The move landed with Keep mine; nothing else waits to be saved.
    expect(kept).toBe(false);
    expect(server.notes.get(TABLE_7)).toBe(THEIRS);

    const notice = screen.getByRole("alert");
    expect(within(notice).getByText(REFUSED_CLEAR)).toBeTruthy();
    fireEvent.click(within(notice).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => { expect(screen.queryByText(REFUSED_CLEAR)).toBeNull(); });
    expect(screen.getByTestId("slate-line").textContent).toContain("Saved");
    expect(screen.getByTestId("slate-line").textContent).not.toContain("Not saved");
    expect(store()).toMatchObject({ saveError: null, saveErrorCode: null, noteClearsRefused: [] });
    expect(noteHeldOn(store(), TABLE_7)).toBe(true);
  });
});
