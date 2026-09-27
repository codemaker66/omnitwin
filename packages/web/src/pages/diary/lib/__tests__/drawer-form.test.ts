import { describe, expect, it } from "vitest";
import type { CalendarBookingEntry } from "@omnitwin/types";
import {
  allowedTransitionTargets,
  formToConvertPayload,
  formToCreatePayload,
  formToUpdatePayload,
  hiddenFieldError,
  initialDrawerForm,
  initialPromotionForm,
  promotionPayload,
  type DrawerForm,
} from "../drawer-form.js";

// ---------------------------------------------------------------------------
// Drawer form mapping (T-495/T-496) — venue wall-time inputs ⇄ shared Zod
// payloads, with field-level errors surfaced from the same schemas the
// server enforces. No parallel validation logic.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";
const SPACE = "00000000-0000-4000-8000-0000000000b1";
const OWNER = "00000000-0000-4000-8000-0000000000cc";
const ENQUIRY = "00000000-0000-4000-8000-0000000000e1";

function holdForm(overrides: Partial<DrawerForm> = {}): DrawerForm {
  return {
    kind: "hold",
    spaceId: SPACE,
    title: "MacLeod wedding",
    eventType: "wedding",
    startsAt: "2026-09-19T18:00",
    endsAt: "2026-09-19T23:30",
    rank: "1",
    jointFlag: false,
    decisionAt: "2026-08-01T12:00",
    ownerUserId: OWNER,
    nextAction: "Call Fiona MacLeod.",
    nextActionDueAt: "2026-07-25T09:00",
    notes: "",
    ...overrides,
  };
}

function bookingEntry(): CalendarBookingEntry {
  return {
    entryType: "booking",
    id: "00000000-0000-4000-8000-0000000000c2",
    spaceId: SPACE,
    kind: "hold",
    status: "active",
    state: "hold",
    title: "MacLeod wedding",
    eventType: "wedding",
    startsAt: "2026-09-19T17:00:00.000Z",
    endsAt: "2026-09-19T22:30:00.000Z",
    rank: 1,
    jointFlag: false,
    decisionAt: "2026-08-01T11:00:00.000Z",
    ownerUserId: OWNER,
    nextAction: "Call Fiona MacLeod.",
    nextActionDueAt: "2026-07-25T08:00:00.000Z",
    eventId: null,
    seriesId: null,
  };
}

describe("formToCreatePayload", () => {
  it("maps wall inputs to UTC instants and passes the shared schema", () => {
    const result = formToCreatePayload(holdForm(), VENUE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.startsAt).toBe("2026-09-19T17:00:00.000Z"); // BST → UTC
    expect(result.payload.kind).toBe("hold");
    expect(result.payload.rank).toBe(1);
  });

  it("surfaces hold hygiene as field errors from the schema itself", () => {
    const result = formToCreatePayload(holdForm({ decisionAt: "", nextAction: "  " }), VENUE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors["decisionAt"]).toBeDefined();
    expect(result.fieldErrors["nextAction"]).toBeDefined();
  });

  it("rejects malformed times before the schema sees them", () => {
    const result = formToCreatePayload(holdForm({ startsAt: "garbage" }), VENUE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors["startsAt"]).toBeDefined();
  });

  it("hiddenFieldError surfaces messages for fields without a visible slot", () => {
    // Non-hold drawer: a rank error has no inline slot → must surface.
    expect(hiddenFieldError({ rank: "Only holds carry an option-ladder rank." }, false)).toBe(
      "Only holds carry an option-ladder rank.",
    );
    // Hold drawer renders the hygiene slots → same key stays inline.
    expect(hiddenFieldError({ rank: "Rank must be a positive integer." }, true)).toBeNull();
    // Slotted fields never escalate.
    expect(hiddenFieldError({ title: "Required." }, false)).toBeNull();
  });

  it("switching kind away from hold strips the stale hold-only defaults (Slice 4 live regression)", () => {
    // The create drawer opens with hold defaults (rank "1", the signed-in
    // owner). Choosing House block hides those fields — so they must also
    // leave the payload, or the schema rejects on fields the user cannot
    // see and the submit button goes silently dead (found live, T-518).
    const result = formToCreatePayload(holdForm({ kind: "internal_block" }), VENUE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.kind).toBe("internal_block");
    expect(result.payload.rank).toBeUndefined();
    expect(result.payload.ownerUserId).toBeUndefined();
    expect(result.payload.decisionAt).toBeUndefined();
    expect(result.payload.nextAction).toBeUndefined();
  });

  it("an ink needs no hygiene but keeps the interval rule", () => {
    const ink = formToCreatePayload(
      holdForm({ kind: "ink", rank: "", decisionAt: "", nextAction: "", nextActionDueAt: "", ownerUserId: "" }),
      VENUE,
    );
    expect(ink.ok).toBe(true);
    const inverted = formToCreatePayload(
      holdForm({ kind: "ink", rank: "", decisionAt: "", nextAction: "", nextActionDueAt: "", ownerUserId: "", endsAt: "2026-09-19T17:00" }),
      VENUE,
    );
    expect(inverted.ok).toBe(false);
  });
});

describe("formToUpdatePayload", () => {
  it("emits only changed fields and reports unchanged forms honestly", () => {
    const original = bookingEntry();
    const untouched = formToUpdatePayload(initialDrawerForm({ kind: "edit", booking: original }), original);
    expect(untouched.ok).toBe(true);
    if (!untouched.ok) return;
    expect(untouched.changed).toBe(false);

    const moved = formToUpdatePayload(
      { ...initialDrawerForm({ kind: "edit", booking: original }), title: "MacLeod wedding (final)" },
      original,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.changed).toBe(true);
    expect(moved.payload).toEqual({ title: "MacLeod wedding (final)" });
  });
});

describe("formToConvertPayload", () => {
  it("builds a hygienic conversion payload carrying the enquiry id", () => {
    const result = formToConvertPayload(holdForm(), ENQUIRY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.enquiryId).toBe(ENQUIRY);
    expect(result.payload.nextAction).toBe("Call Fiona MacLeod.");
    expect(result.payload.startsAt).toBe("2026-09-19T17:00:00.000Z");
  });

  it("hygiene is unconditional for conversions", () => {
    const result = formToConvertPayload(holdForm({ ownerUserId: "" }), ENQUIRY);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors["ownerUserId"]).toBeDefined();
  });
});

describe("initialDrawerForm", () => {
  it("edit mode mirrors the booking in venue wall time", () => {
    const form = initialDrawerForm({ kind: "edit", booking: bookingEntry() });
    expect(form.startsAt).toBe("2026-09-19T18:00"); // 17:00Z shown as BST wall
    expect(form.rank).toBe("1");
    expect(form.kind).toBe("hold");
  });

  it("convert mode prefills from the enquiry and locks the kind to hold", () => {
    const form = initialDrawerForm({
      kind: "convert",
      enquiry: {
        id: ENQUIRY,
        spaceId: SPACE,
        name: "Fiona MacLeod",
        eventType: "wedding",
        preferredDate: "2026-09-19",
      },
      ownerUserId: OWNER,
    });
    expect(form.kind).toBe("hold");
    expect(form.spaceId).toBe(SPACE);
    expect(form.title).toBe("Fiona MacLeod — wedding");
    expect(form.startsAt).toBe("2026-09-19T17:00");
    expect(form.ownerUserId).toBe(OWNER);
  });

  it("create mode seeds a sensible evening window", () => {
    const form = initialDrawerForm({
      kind: "create",
      spaceId: SPACE,
      dayStartMs: Date.parse("2026-09-18T23:00:00.000Z"), // local midnight Sep 19 BST
      ownerUserId: OWNER,
    });
    expect(form.startsAt).toBe("2026-09-19T17:00");
    expect(form.endsAt).toBe("2026-09-19T23:00");
  });
});

describe("allowedTransitionTargets", () => {
  it("staff drive the structural matrix; hallkeeper gets nothing", () => {
    expect([...allowedTransitionTargets("hold", "staff")].sort()).toEqual(
      ["expired", "ink", "lost", "released"].sort(),
    );
    expect(allowedTransitionTargets("hold", "hallkeeper")).toEqual([]);
    expect(allowedTransitionTargets("released", "staff")).toEqual([]);
  });

  it("offers the matrix to every role the API lets move the diary (T-619)", () => {
    for (const role of ["admin", "manager", "staff", "sales"]) {
      expect(allowedTransitionTargets("hold", role).length, role).toBeGreaterThan(0);
    }
    for (const role of ["hallkeeper", "planner", "client", "caterer", ""]) {
      expect(allowedTransitionTargets("hold", role), role).toEqual([]);
    }
  });
});

describe("the edit drawer's room and note (T-619)", () => {
  it("seeds the booking's note, so reopening it is not an edit", () => {
    const original = { ...bookingEntry(), notes: "Cake table by the north door." };
    const form = initialDrawerForm({ kind: "edit", booking: original });
    expect(form.notes).toBe("Cake table by the north door.");
    const result = formToUpdatePayload(form, original);
    expect(result.ok && result.changed).toBe(false);
  });

  it("patches a changed note, and clears it to null", () => {
    const original = { ...bookingEntry(), notes: "Cake table by the north door." };
    const form = initialDrawerForm({ kind: "edit", booking: original });
    const edited = formToUpdatePayload({ ...form, notes: "By the south door." }, original);
    expect(edited.ok && edited.payload).toEqual({ notes: "By the south door." });
    const cleared = formToUpdatePayload({ ...form, notes: "  " }, original);
    expect(cleared.ok && cleared.payload).toEqual({ notes: null });
  });

  it("treats a note missing from an older server's entry as no note", () => {
    const original = bookingEntry();
    const form = initialDrawerForm({ kind: "edit", booking: original });
    expect(form.notes).toBe("");
    expect(formToUpdatePayload({ ...form, notes: "New note." }, original)).toMatchObject({
      ok: true, payload: { notes: "New note." },
    });
  });

  it("patches a room change as the drag would", () => {
    const original = bookingEntry();
    const other = "00000000-0000-4000-8000-0000000000b2";
    const moved = formToUpdatePayload({ ...initialDrawerForm({ kind: "edit", booking: original }), spaceId: other }, original);
    expect(moved.ok && moved.payload).toEqual({ spaceId: other });
  });

  it("surfaces a room or note error in its own slot rather than as a hidden one", () => {
    expect(hiddenFieldError({ spaceId: "Choose a room." }, false)).toBeNull();
    expect(hiddenFieldError({ notes: "Too long." }, false)).toBeNull();
  });
});

describe("create at a clicked instant (T-619)", () => {
  it("starts at the instant and keeps the house window's length", () => {
    const form = initialDrawerForm({
      kind: "create",
      spaceId: SPACE,
      dayStartMs: Date.parse("2026-09-19T09:15:00.000Z"),
      startMs: Date.parse("2026-09-19T09:15:00.000Z"), // 10:15 BST
      ownerUserId: OWNER,
    });
    expect(form.startsAt).toBe("2026-09-19T10:15");
    expect(form.endsAt).toBe("2026-09-19T16:15");
  });
});

// ---------------------------------------------------------------------------
// Plain words (roadmap N3): the booker reads what a field needs, never the
// schema's own wording ("endsAt must be after startsAt", "Invalid uuid",
// "String must contain at least 1 character(s)").
// ---------------------------------------------------------------------------

describe("drawer form — what a field needs, in plain words", () => {
  function createErrors(overrides: Partial<DrawerForm>): Readonly<Record<string, string>> {
    const result = formToCreatePayload(holdForm(overrides), VENUE);
    if (result.ok) throw new Error("expected the form to be refused");
    return result.fieldErrors;
  }

  it.each<[string, Partial<DrawerForm>, string, string]>([
    ["no room", { spaceId: "" }, "spaceId", "Choose a room."],
    ["no title", { title: "   " }, "title", "Give the booking a title."],
    ["a long title", { title: "x".repeat(201) }, "title", "Keep the title to 200 characters."],
    ["a long event type", { eventType: "x".repeat(81) }, "eventType", "Keep the event type to 80 characters."],
    ["no start", { startsAt: "" }, "startsAt", "Choose when it starts."],
    ["no end", { endsAt: "" }, "endsAt", "Choose when it ends."],
    ["an end before the start", { endsAt: "2026-09-19T17:00" }, "endsAt", "It must end after it starts."],
    ["option 0", { rank: "0" }, "rank", "The option is a whole number, 1 or more."],
    ["option 1.5", { rank: "1.5" }, "rank", "The option is a whole number, 1 or more."],
    ["a long next action", { nextAction: "x".repeat(501) }, "nextAction", "Keep the next action to 500 characters."],
    ["long notes", { notes: "x".repeat(2001) }, "notes", "Keep the notes to 2,000 characters."],
    ["no owner", { ownerUserId: "not-a-person" }, "ownerUserId", "Choose who owns the hold."],
    ["an unreadable time", { decisionAt: "someday" }, "decisionAt", "Enter a valid date and time."],
  ])("says what %s needs", (_case, overrides, field, words) => {
    expect(createErrors(overrides)[field]).toBe(words);
  });

  it("keeps the schema's own plain words for a hold's requirements", () => {
    expect(createErrors({ decisionAt: "" })["decisionAt"]).toBe("A provisional hold needs a decision date.");
    expect(createErrors({ nextAction: "" })["nextAction"]).toBe("A provisional hold needs a next action.");
    expect(createErrors({ nextActionDueAt: "" })["nextActionDueAt"]).toBe("A provisional hold needs a date for its next action.");
  });

  it("never shows the schema's wording, whatever is wrong", () => {
    const broken: readonly Partial<DrawerForm>[] = [
      { spaceId: "" }, { title: "" }, { endsAt: "2026-09-19T09:00" }, { rank: "-3" }, { ownerUserId: "x" },
      { title: "x".repeat(500), notes: "x".repeat(3000), nextAction: "x".repeat(900) },
    ];
    for (const overrides of broken) {
      for (const words of Object.values(createErrors(overrides))) {
        expect(words).not.toMatch(/must contain|Invalid|Expected|Required|endsAt|startsAt|uuid|greater than|characters?\(s\)/u);
      }
    }
  });
});

describe("drawer form — making interest only provisional (roadmap N3)", () => {
  const prospect = { ...bookingEntry(), kind: "prospect" as const, state: "prospect" as const, rank: null, decisionAt: null, nextAction: null, nextActionDueAt: null };

  it("seeds the place from the ladder and keeps what the booking already has", () => {
    expect(initialPromotionForm(prospect, 2)).toEqual({ rank: "2", decisionAt: "", nextAction: "", nextActionDueAt: "" });
    expect(initialPromotionForm(prospect, null).rank).toBe("");
    const withDetails = { ...prospect, nextAction: "Send the menus.", decisionAt: "2026-10-12T11:00:00.000Z" };
    expect(initialPromotionForm(withDetails, 3)).toMatchObject({ rank: "3", nextAction: "Send the menus.", decisionAt: "2026-10-12T12:00" });
  });

  it("says in plain words what the hold still needs", () => {
    const empty = promotionPayload({ rank: "0", decisionAt: "", nextAction: " ", nextActionDueAt: "soon" });
    expect(empty.ok ? null : empty.fieldErrors).toEqual({
      rank: "The option is a whole number, 1 or more.",
      decisionAt: "A provisional hold needs a decision date.",
      nextAction: "A provisional hold needs a next action.",
      nextActionDueAt: "Enter a valid date and time.",
    });
  });

  it("sends the hold's details as instants, the option as a number, and no option when none is set", () => {
    const full = promotionPayload({ rank: "2", decisionAt: "2026-10-12T12:00", nextAction: "Send the menus.", nextActionDueAt: "2026-10-01T10:00" });
    expect(full.ok ? full.hold : null).toEqual({
      rank: 2, decisionAt: "2026-10-12T11:00:00.000Z", nextAction: "Send the menus.", nextActionDueAt: "2026-10-01T09:00:00.000Z",
    });
    const unranked = promotionPayload({ rank: "", decisionAt: "2026-10-12T12:00", nextAction: "Send the menus.", nextActionDueAt: "2026-10-01T10:00" });
    expect(unranked.ok ? unranked.hold.rank : "refused").toBeUndefined();
  });
});
