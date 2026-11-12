import { vi } from "vitest";
import { ApiError } from "../api/client.js";
import * as configApi from "../api/configurations.js";
import type { ObjectMetadata, PlacedObject } from "../api/configurations.js";

// ---------------------------------------------------------------------------
// The API of #389 as a browser without a guest plan's secret meets it, for the
// planner's tests of a guest plan's notes (review of #388): its rule
// (packages/api routes/public-configs.ts in #389: settledNotes, and
// withoutUnsentNotes for the answer) over the notes a PlanOnServer holds. A
// test file that uses it mocks api/configurations.js, so this answers that
// file's publicBatchSave.
// ---------------------------------------------------------------------------

export const NOTE_HELD_MESSAGE = "A note on this plan cannot be changed from here, and this save tried to change it. Clear the note you wrote on that piece.";
export const OMITTED_MESSAGE = "Nothing was saved: this save would remove a piece with a note that cannot be shown here. Reload the page to put it back.";

export interface PlanOnServer {
  revision: number;
  /** The note each piece holds. */
  readonly notes: Map<string, string>;
}

/** A piece as the calling test's API returns it: its id, its metadata and where it stands. */
export type PlacedPiece = (id: string, metadata: ObjectMetadata, x: number) => PlacedObject;

/** The API of #389 as a browser without the plan's secret meets it: revision first, then a piece left out, then each note sent. */
export function serveNotesAsTheApiDoes(server: PlanOnServer, placed: PlacedPiece): void {
  vi.mocked(configApi.publicBatchSave).mockImplementation((_id, batch, expectedRevision) => {
    if (expectedRevision !== server.revision) {
      return Promise.reject(new ApiError(409, "Layout changed on the server. Reload before saving again.", "REVISION_CONFLICT", {
        expectedRevision, currentRevision: server.revision,
      }));
    }
    // A save that leaves out a piece holding a note is refused, whoever wrote the note: the API cannot tell.
    const sentIds = new Set(batch.map((piece) => piece.id));
    if ([...server.notes.keys()].some((id) => !sentIds.has(id))) return Promise.reject(new ApiError(409, OMITTED_MESSAGE, "HELD_PIECE_OMITTED"));
    const settled: { readonly id: string; readonly x: number; readonly name: ObjectMetadata; readonly sent: string | null; readonly note: string | null }[] = [];
    for (const piece of batch) {
      // A piece sent without an id is placed: it takes a new row, and holds what was sent.
      const id = piece.id ?? `0c0c0c0c-0000-4000-8000-${String(server.revision).padStart(6, "0")}${String(settled.length).padStart(6, "0")}`;
      const name: ObjectMetadata = piece.metadata?.displayLabel === undefined ? {} : { displayLabel: piece.metadata.displayLabel };
      const held = server.notes.get(id) ?? null;
      const sent = piece.metadata?.notes ?? null;
      if (held === null || sent === held || piece.replacesNote === held) settled.push({ id, x: piece.positionX, name, sent, note: sent });
      else if (sent === null && piece.replacesNote === undefined) settled.push({ id, x: piece.positionX, name, sent, note: held });
      else return Promise.reject(new ApiError(409, NOTE_HELD_MESSAGE, "NOTE_HELD"));
    }
    server.revision += 1;
    server.notes.clear();
    for (const piece of settled) {
      if (piece.note !== null) server.notes.set(piece.id, piece.note);
    }
    return Promise.resolve({
      revision: server.revision,
      // A note goes back only where this save itself sent that very note.
      objects: settled.map((piece) => placed(piece.id, { ...piece.name, ...(piece.note === null ? {} : piece.sent === piece.note ? { notes: piece.note } : { noteHeld: true }) }, piece.x)),
    });
  });
}
