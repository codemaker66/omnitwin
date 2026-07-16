import { describe, expect, it } from "vitest";
import type { CalendarBookingEntry } from "@omnitwin/types";
import {
  allowedTransitionTargets,
  formToConvertPayload,
  formToCreatePayload,
  formToUpdatePayload,
  hiddenFieldError,
  initialDrawerForm,
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
});
