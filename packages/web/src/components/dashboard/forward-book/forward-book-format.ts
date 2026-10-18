import type { ForwardBookCheck, RoomForwardBook } from "@omnitwin/types";
import { venueDate } from "../enquiries/enquiry-desk-format.js";

// ---------------------------------------------------------------------------
// Words for the forward-book section (Blake, 17 October 2026: "hide date
// status until checked"). Pure: the section renders what these return, and
// the tests pin them. Each line says who stated a thing and when.
// ---------------------------------------------------------------------------

export type RoomDateState = "shown" | "hidden";

export interface RoomWords {
  readonly state: RoomDateState;
  /** What assistants and the website do for this room. */
  readonly label: string;
  /** Who said so, and when. */
  readonly provenance: string;
  /** The recorder's note, when the standing record has one. */
  readonly note: string | null;
}

function byWhom(name: string, iso: string): string {
  const when = venueDate(iso);
  return when === null ? name : `${name}, ${when}`;
}

/** Where a room stands, in words. */
export function roomWords(room: RoomForwardBook): RoomWords {
  if (room.current !== null) {
    return {
      state: "shown",
      label: "Dates shown",
      provenance: `Checked by ${byWhom(room.current.recordedByName, room.current.recordedAt)}`,
      note: room.current.note,
    };
  }
  const cleared = room.previous;
  if (cleared !== null && cleared.clearedAt !== null && cleared.clearedByName !== null) {
    return {
      state: "hidden",
      label: "Dates hidden",
      provenance: `Hidden by ${byWhom(cleared.clearedByName, cleared.clearedAt)}`,
      note: null,
    };
  }
  return { state: "hidden", label: "Dates hidden", provenance: "Not checked yet", note: null };
}

/** What recording a room's check does, said before it is saved. */
export function recordConsequence(roomName: string): string {
  return `Assistants and the website will start saying whether the ${roomName} has bookings on a date: booked, held, or nothing on our diary, within a minute of saving. `
    + `Record this once every booking and option the venue holds for the ${roomName}, wherever it is kept, is on the Diary here.`;
}

/** What hiding a room's dates does, said before it is done. */
export function clearConsequence(roomName: string): string {
  return `Assistants and the website will stop saying whether the ${roomName} has bookings on a date, within a minute, and will tell people to ask the team instead. The record of the check is kept.`;
}

/** What a colleague did a moment ago, from the record a refusal carries. */
export function refusalWords(check: ForwardBookCheck): string {
  if (check.clearedAt !== null && check.clearedByName !== null) {
    return `${check.clearedByName} hid these dates a moment ago.`;
  }
  return `${check.recordedByName} recorded this check a moment ago.`;
}
