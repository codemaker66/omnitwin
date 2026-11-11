import { describe, expect, it } from "vitest";
import {
  HandoverShiftResultSchema,
  MessageReceiptSchema,
  MessageSchema,
  RequestStatusHistoryEntrySchema,
  SlotObservationSchema,
  VenueHandlerSchema,
  VenueRequestSchema,
} from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { RECORD_NAME_MAX, clipName } from "../utils/clip-name.js";

// A person's name as the floor's records keep it: whole when it fits,
// otherwise the longest run of whole characters within 160, counted as the
// column and the wire schema count them (code points, not UTF-16 units).

const J = (count: number): string => "J".repeat(count);
/** One character, two UTF-16 units. */
const SCRIPT_J = "\u{1D4D9}";
/** One character of five code points: man, joiner, woman, joiner, girl. */
const FAMILY = "\u{1F468}‍\u{1F469}‍\u{1F467}";
/** One character of two code points: the flag of the United Kingdom. */
const FLAG = "\u{1F1EC}\u{1F1E7}";
const characters = (text: string): number => Array.from(text).length;

describe("clipName", () => {
  it("keeps a name that fits, whole", () => {
    expect(clipName("Elaine")).toBe("Elaine");
    expect(clipName(J(160))).toBe(J(160));
    // 160 characters in 320 UTF-16 units: both limits count characters.
    expect(clipName(SCRIPT_J.repeat(160))).toBe(SCRIPT_J.repeat(160));
  });

  it("keeps the first 160 characters of a longer name", () => {
    expect(clipName(J(200))).toBe(J(160));
    expect(clipName(SCRIPT_J.repeat(200))).toBe(SCRIPT_J.repeat(160));
  });

  it("never leaves half of a surrogate pair at the cut", () => {
    const kept = clipName(`${J(159)}${SCRIPT_J.repeat(41)}`);
    expect(kept).toBe(`${J(159)}${SCRIPT_J}`);
    expect(/\p{Cs}/u.test(kept)).toBe(false);
  });

  it("cuts between whole characters: a family, a flag or an accented letter is kept whole or left out", () => {
    expect(clipName(`${J(158)}${FAMILY}${J(40)}`)).toBe(J(158));
    expect(clipName(`${J(150)}${FAMILY}${J(45)}`)).toBe(`${J(150)}${FAMILY}${J(5)}`);
    expect(clipName(`${J(159)}${FLAG}${J(40)}`)).toBe(J(159));
    expect(clipName(`${J(159)}é${J(40)}`)).toBe(J(159));
  });

  it("keeps whole code points where characters cannot be told apart, or the first is already too long", () => {
    expect(clipName(`${J(158)}${FAMILY}${J(40)}`, RECORD_NAME_MAX, null)).toBe(`${J(158)}\u{1F468}‍`);
    // One character of 200 code points: something is still kept, never nothing.
    expect(clipName(`e${"́".repeat(199)}`)).toBe(`e${"́".repeat(159)}`);
  });

  it("fits every floor column and wire schema that keeps a name", () => {
    const columns = [
      schema.bookingObservations.actorName,
      schema.requests.requestedByName,
      schema.requests.ownerName,
      schema.requests.handoverToName,
      schema.requestStatusHistory.actorName,
      schema.messages.authorName,
    ];
    for (const column of columns) expect(column.getSQLType()).toBe(`varchar(${String(RECORD_NAME_MAX)})`);
    const wire = [
      SlotObservationSchema.shape.actorName,
      VenueRequestSchema.shape.requestedByName,
      VenueRequestSchema.shape.ownerName.unwrap(),
      VenueRequestSchema.shape.handoverToName.unwrap(),
      RequestStatusHistoryEntrySchema.shape.actorName,
      VenueHandlerSchema.shape.name,
      HandoverShiftResultSchema.shape.toName,
      MessageSchema.shape.authorName,
      MessageReceiptSchema.shape.recipientName,
    ];
    for (const field of wire) expect(field.maxLength).toBe(RECORD_NAME_MAX);

    const names = [J(200), SCRIPT_J.repeat(200), `${J(159)}${SCRIPT_J.repeat(41)}`, `${J(158)}${FAMILY}${J(40)}`, `e${"́".repeat(199)}`];
    for (const name of names) {
      const kept = clipName(name);
      expect(characters(kept)).toBeLessThanOrEqual(RECORD_NAME_MAX);
      for (const field of wire) expect(field.safeParse(kept).success).toBe(true);
    }
  });
});
