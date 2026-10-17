import { z } from "zod";
import {
  DIETARY_MEMORY_CONSENT,
  RememberedDietaryNoteSchema,
  type RememberDietaryNoteRequest,
  type RememberedDietaryNote,
} from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// The signed-in client's remembered allergy notes ("ask once, then
// remember"). The API answers for the caller's own account only; the note is
// never sent from here, because the API copies it from the client's own
// saved layout.
// ---------------------------------------------------------------------------

const RememberedNotesSchema = z.array(RememberedDietaryNoteSchema);

/** The account's remembered notes, one per venue. */
export async function listRememberedDietaryNotes(signal?: AbortSignal): Promise<RememberedDietaryNote[]> {
  return api.get("/account/dietary-notes", RememberedNotesSchema, signal);
}

/** Remember the note on one of the account's own saved layouts, under the
 *  wording this page showed beside the box. */
export async function rememberDietaryNote(configurationId: string): Promise<RememberedDietaryNote> {
  const body: RememberDietaryNoteRequest = { configurationId, consentVersion: DIETARY_MEMORY_CONSENT.version };
  return api.put("/account/dietary-notes", body, RememberedDietaryNoteSchema);
}

/** Remove a remembered note. Its consent record stays, without the note. */
export async function removeRememberedDietaryNote(id: string): Promise<void> {
  await api.delete(`/account/dietary-notes/${encodeURIComponent(id)}`);
}
