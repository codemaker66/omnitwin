import { expect, test, type Page } from "@playwright/test";
import { PlannerSaveServer, SAVE_GRAND_HALL, signInAs, type SeedUser } from "./support/planner-save-server.js";

// ---------------------------------------------------------------------------
// E2E: a table holding a note this browser is not shown (review of #388).
//
// A guest plan's notes go only to the browser that made it; any other reader
// is told which pieces hold one and nothing of what they say. Such a piece is
// never destroyed from here: Delete leaves it and says so, "Keep mine" over a
// newer version keeps a table someone has since written a note on, and Undo
// will not take away a table that has come to hold one.
//
// Where the person reads it: today's chrome (v1) shows the planner's
// placement notice under the room. "Keep mine" is offered only by the new
// chrome's slate (v2), and only to someone signed in; the new chrome mounts no
// placement notice yet, so there the line is read from the planner's notice
// store, the line it would show.
//
// Edits go through the planner's own stores and commands, by importing the
// modules Vite serves to the app (one module instance per URL), as
// planner-work-survives.spec.ts does. The plan lives in an in-memory server
// given the API's rules for held notes.
// ---------------------------------------------------------------------------

interface StoreApi<S> { getState(): S }
interface EditorObjectLike { readonly id: string; readonly positionX: number }
interface EditorStateLike {
  readonly configId: string | null;
  readonly objects: readonly EditorObjectLike[];
  readonly history: { readonly past: readonly unknown[] };
  saveToServer(isAuthenticated?: boolean): Promise<boolean>;
  beginHistoryGesture(): symbol | null;
  endHistoryGesture(token: symbol): void;
  updateObject(id: string, patch: { positionX: number }): void;
  undo(): void;
}
interface EditorModule { readonly useEditorStore: StoreApi<EditorStateLike> }
interface SelectionModule { readonly useSelectionStore: StoreApi<{ selectMultiple(ids: readonly string[]): void }> }
interface KeymapModule {
  removeSelection(): boolean;
  copySelection(): boolean;
  pasteAt(at: { readonly x: number; readonly z: number } | null): boolean;
}
interface NoticeModule { readonly usePlacementNoticeStore: StoreApi<{ readonly notice: { readonly text: string } | null }> }
interface NotesModule { heldNoteIds(state: EditorStateLike): ReadonlySet<string> }
interface BridgeModule { setAutoSaveDelayOverride(delayMs: number | null): void }
interface PlacementModule { readonly usePlacementStore: StoreApi<{ readonly placedItems: readonly { readonly id: string }[] }> }

const PLAN = "e2e-held-notes-plan";
const TABLE_1 = `${PLAN}-table-1`;
const TABLE_2 = `${PLAN}-table-2`;
const THEIR_NOTE = "TEST ONLY nut allergy, seat by the door";
/** Signed in and off the venue's floor: a guest plan reaches them by the public route, without its notes. */
const CLIENT: SeedUser = {
  id: "00000000-0000-4000-8000-000000007101",
  email: "client@fixture.test",
  role: "client",
  platformRole: "none",
  venueId: null,
  name: "Fixture Client",
};

test.describe.configure({ timeout: 120_000 });

/** A guest's plan, made in another browser: Table 1 and Table 2, in the Grand Hall. */
function guestPlan(): PlannerSaveServer {
  const server = new PlannerSaveServer();
  server.seedLayout({ id: PLAN, spaceId: SAVE_GRAND_HALL.id, userId: "maker", name: "TEST ONLY guest plan", tablesAtX: [5, 9] });
  const layout = server.layout(PLAN);
  if (layout === undefined) throw new Error("no plan");
  layout.isPublicPreview = true;
  layout.userId = null;
  layout.objects = layout.objects.map((object, index) => ({ ...object, metadata: { ...object.metadata, displayLabel: `Table ${String(index + 1)}` } }));
  server.previewsOffTheFloor = true;
  return server;
}

/** Someone with the plan's notes writes one on this row: a newer version. */
function theyWriteANoteOn(server: PlannerSaveServer, rowId: string): void {
  const layout = server.layout(PLAN);
  if (layout === undefined) throw new Error("no plan");
  server.heldNotes.set(rowId, THEIR_NOTE);
  layout.revision += 1;
  layout.updatedAt = new Date().toISOString();
}

function storedIds(server: PlannerSaveServer): readonly string[] {
  return server.layout(PLAN)?.objects.map((object) => object.id) ?? [];
}

/**
 * Open the plan, wait until the planner holds it, and leave saving to the
 * spec. The commands act on the scene's pieces, which the scene bridge copies
 * from the editor's document after it loads, so it waits for those too.
 */
async function openPlan(page: Page, chrome: "v1" | "v2"): Promise<void> {
  await page.goto(`/plan/${PLAN}?chrome=${chrome}`);
  await expect.poll(() => page.evaluate(async (id) => {
    const editor = await import("/src/stores/editor-store.ts") as EditorModule;
    const placement = await import("/src/stores/placement-store.ts") as PlacementModule;
    const state = editor.useEditorStore.getState();
    const placed = new Set(placement.usePlacementStore.getState().placedItems.map((piece) => piece.id));
    return state.configId === id && state.objects.length > 0 && state.objects.every((object) => placed.has(object.id));
  }, PLAN), { timeout: 60_000 }).toBe(true);
  await page.evaluate(async () => {
    const bridge = await import("/src/components/editor/EditorBridge.tsx") as BridgeModule;
    bridge.setAutoSaveDelayOverride(600_000);
  });
}

async function pieceIds(page: Page): Promise<readonly string[]> {
  return page.evaluate(async () => {
    const editor = await import("/src/stores/editor-store.ts") as EditorModule;
    return editor.useEditorStore.getState().objects.map((object) => object.id);
  });
}

async function heldIds(page: Page): Promise<readonly string[]> {
  return page.evaluate(async () => {
    const editor = await import("/src/stores/editor-store.ts") as EditorModule;
    const notes = await import("/src/lib/guest-plan-notes.ts") as NotesModule;
    return [...notes.heldNoteIds(editor.useEditorStore.getState())].sort();
  });
}

async function tableX(page: Page, id: string): Promise<number | null> {
  return page.evaluate(async (tableId) => {
    const editor = await import("/src/stores/editor-store.ts") as EditorModule;
    return editor.useEditorStore.getState().objects.find((object) => object.id === tableId)?.positionX ?? null;
  }, id);
}

async function undoSteps(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const editor = await import("/src/stores/editor-store.ts") as EditorModule;
    return editor.useEditorStore.getState().history.past.length;
  });
}

/** The planner's placement notice, as the new chrome would show it. */
async function noticeLine(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const notices = await import("/src/stores/placement-notice-store.ts") as NoticeModule;
    return notices.usePlacementNoticeStore.getState().notice?.text ?? null;
  });
}

/** Selects these pieces and runs a selection command, as its key does. */
async function onSelection(page: Page, ids: readonly string[], command: "removeSelection" | "copySelection"): Promise<boolean> {
  return page.evaluate(async ({ selected, name }) => {
    const selection = await import("/src/stores/selection-store.ts") as SelectionModule;
    const keymap = await import("/src/lib/planner-keymap.ts") as KeymapModule;
    selection.useSelectionStore.getState().selectMultiple(selected);
    return keymap[name]();
  }, { selected: ids, name: command });
}

/** Pastes the copied pieces at the middle of the room. */
async function pasteInTheMiddle(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const keymap = await import("/src/lib/planner-keymap.ts") as KeymapModule;
    return keymap.pasteAt({ x: 0, z: 0 });
  });
}

/** The move a drag ends in: one gesture, released. */
async function moveTable(page: Page, id: string, x: number): Promise<void> {
  await page.evaluate(async ({ tableId, to }) => {
    const editor = await import("/src/stores/editor-store.ts") as EditorModule;
    const state = editor.useEditorStore.getState();
    const token = state.beginHistoryGesture();
    state.updateObject(tableId, { positionX: to });
    if (token !== null) editor.useEditorStore.getState().endHistoryGesture(token);
  }, { tableId: id, to: x });
}

async function saveByHand(page: Page, signedIn: boolean): Promise<boolean> {
  return page.evaluate(async (authenticated) => {
    const editor = await import("/src/stores/editor-store.ts") as EditorModule;
    return editor.useEditorStore.getState().saveToServer(authenticated);
  }, signedIn);
}

async function undo(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const editor = await import("/src/stores/editor-store.ts") as EditorModule;
    editor.useEditorStore.getState().undo();
  });
}

test("v1: Delete leaves a table holding a note this browser is not shown, and the notice under the room names it", async ({ page }) => {
  const server = guestPlan();
  server.heldNotes.set(TABLE_1, THEIR_NOTE);
  await server.attach(page);
  await openPlan(page, "v1");
  expect(await heldIds(page)).toEqual([TABLE_1]);

  await onSelection(page, [TABLE_1], "removeSelection");
  await expect(page.getByTestId("placement-notice")).toHaveText("Nothing was removed: Table 1 has a note that cannot be shown here.");
  expect(await pieceIds(page)).toContain(TABLE_1);

  // Table 2 holds none, and goes as asked.
  await onSelection(page, [TABLE_2], "removeSelection");
  await expect.poll(() => pieceIds(page), { timeout: 10_000 }).toEqual([TABLE_1]);
});

test("v2: Keep mine over a newer version keeps a table someone has since written a note on", async ({ page }) => {
  const server = guestPlan();
  await server.attach(page);
  await signInAs(page, CLIENT);
  await openPlan(page, "v2");
  expect(await heldIds(page)).toEqual([]);

  // Table 2 holds no note yet, so it goes as asked; meanwhile someone writes one on it.
  // The scene bridge carries the removal into the editor's document.
  await onSelection(page, [TABLE_2], "removeSelection");
  await expect.poll(() => pieceIds(page), { timeout: 10_000 }).toEqual([TABLE_1]);
  theyWriteANoteOn(server, TABLE_2);

  // The save meets the newer version, and the slate offers the choice.
  expect(await saveByHand(page, true)).toBe(false);
  await page.getByRole("button", { name: "Keep mine" }).first().click();

  await expect.poll(() => server.layout(PLAN)?.revision, { timeout: 15_000 }).toBe(3);
  expect(storedIds(server)).toContain(TABLE_2);
  expect(server.heldNotes.get(TABLE_2)).toBe(THEIR_NOTE);
  expect(await pieceIds(page)).toEqual(expect.arrayContaining([TABLE_1, TABLE_2]));
  expect(await heldIds(page)).toEqual([TABLE_2]);
  expect(await noticeLine(page)).toBe("Table 2 stayed where it is, because it has a note that cannot be shown here.");
});

test("v2: Undo will not take away a table that has come to hold a note this browser is not shown", async ({ page }) => {
  const server = guestPlan();
  await server.attach(page);
  await signInAs(page, CLIENT);
  await openPlan(page, "v2");

  // The person sets a copy of Table 1 down in the middle of the room, and it saves.
  expect(await onSelection(page, [TABLE_1], "copySelection")).toBe(true);
  expect(await pasteInTheMiddle(page)).toBe(true);
  await expect.poll(async () => (await pieceIds(page)).length, { timeout: 10_000 }).toBe(3);
  expect(await saveByHand(page, true)).toBe(true);
  const copy = (await pieceIds(page)).find((id) => id !== TABLE_1 && id !== TABLE_2);
  if (copy === undefined) throw new Error("no copy was set down");
  expect(storedIds(server)).toContain(copy);

  // Someone writes a note on the copy; the person's next save meets that version, and they keep theirs.
  theyWriteANoteOn(server, copy);
  await moveTable(page, TABLE_2, 8);
  expect(await saveByHand(page, true)).toBe(false);
  await page.getByRole("button", { name: "Keep mine" }).first().click();
  await expect.poll(() => heldIds(page), { timeout: 15_000 }).toEqual([copy]);

  // Undo takes back the move, which takes nothing away.
  await undo(page);
  expect(await tableX(page, TABLE_2)).toBe(9);
  // The step before set the copy down: undoing it would take the copy, and its note, away.
  const steps = await undoSteps(page);
  await undo(page);
  expect(await pieceIds(page)).toContain(copy);
  expect(await undoSteps(page)).toBe(steps);
  expect(await noticeLine(page)).toMatch(/^Nothing was undone: .+ has a note that cannot be shown here\.$/u);
  expect(storedIds(server)).toContain(copy);
  expect(server.heldNotes.get(copy)).toBe(THEIR_NOTE);
});
