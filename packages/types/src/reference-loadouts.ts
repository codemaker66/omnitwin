import { z } from "zod";

// ---------------------------------------------------------------------------
// A room's reference loadout as the API writes it back: the row a create
// (POST .../loadouts) or a change (PATCH .../loadouts/:id) answers with. The
// detail read adds its photos; the web parses both, and the API's own test
// parses its replies with this schema, so the two cannot drift.
// ---------------------------------------------------------------------------

export const ReferenceLoadoutRowSchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  venueId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReferenceLoadoutRow = z.infer<typeof ReferenceLoadoutRowSchema>;
