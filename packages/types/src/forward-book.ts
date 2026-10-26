import { z } from "zod";

// ---------------------------------------------------------------------------
// The forward book on the Diary, room by room (Blake, 17 October 2026: "hide
// date status until checked").
//
// A venue's forward book still lives partly outside Venviewer (other systems,
// email, paper), so an empty Diary day says nothing certain about a room. The
// public MCP and every public web surface therefore show a room's date status
// only once the venue's admin or manager has recorded that the room's whole
// forward book is on the Diary. Each record says who made it, when, and an
// optional note; clearing it hides the room's dates again and says who
// cleared it and when. Records are never deleted, so the room keeps its
// history. The public rule itself is publicRoomAnswer in booking.ts.
// ---------------------------------------------------------------------------

const IsoInstantSchema = z.iso.datetime({ offset: true });

/** Who may record or clear a room's check: the venue's own admin or manager.
 *  It is the venue's word about its own book, so a Venviewer platform
 *  administrator who is not one of them cannot make it. The API's
 *  canRecordForwardBook and the web's controls both read this set. */
export const FORWARD_BOOK_RECORD_ROLES = ["admin", "manager"] as const;

/** The longest note a record may carry. */
export const FORWARD_BOOK_NOTE_MAX_LENGTH = 500;

/** One record that a room's forward book is on the Diary, as staff read it. */
export const ForwardBookCheckSchema = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  recordedAt: IsoInstantSchema,
  /** The name of the person who recorded it, as it was when they did. */
  recordedByName: z.string(),
  note: z.string().nullable(),
  /** When the record was cleared, which hid the room's dates again. */
  clearedAt: IsoInstantSchema.nullable(),
  clearedByName: z.string().nullable(),
});
export type ForwardBookCheck = z.infer<typeof ForwardBookCheckSchema>;

/** A room and where its record stands. */
export const RoomForwardBookSchema = z.object({
  spaceId: z.uuid(),
  name: z.string(),
  /** The standing record: while it exists, the room's dates are public. */
  current: ForwardBookCheckSchema.nullable(),
  /** The most recently cleared record, shown when none stands. */
  previous: ForwardBookCheckSchema.nullable(),
});
export type RoomForwardBook = z.infer<typeof RoomForwardBookSchema>;

export const ForwardBookResponseSchema = z.object({
  /** The venue's rooms, in the venue's own order. */
  rooms: z.array(RoomForwardBookSchema),
});
export type ForwardBookResponse = z.infer<typeof ForwardBookResponseSchema>;

/** A blank or whitespace note is no note. */
const NoteSchema = z
  .string()
  .max(FORWARD_BOOK_NOTE_MAX_LENGTH * 2)
  .transform((value) => value.trim())
  .refine((value) => value.length <= FORWARD_BOOK_NOTE_MAX_LENGTH, {
    message: `Keep the note to ${String(FORWARD_BOOK_NOTE_MAX_LENGTH)} characters.`,
  })
  .transform((value) => (value === "" ? null : value));

export const RecordForwardBookCheckSchema = z.object({
  spaceId: z.uuid(),
  note: NoteSchema.nullable().optional().transform((value) => value ?? null),
}).strict();
export type RecordForwardBookCheck = z.input<typeof RecordForwardBookCheckSchema>;
