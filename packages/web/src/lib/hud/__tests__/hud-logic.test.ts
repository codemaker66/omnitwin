import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../../constants/scale.js";
import { BANQUET_CHAIR_CLEARANCE_M } from "../../auto-fill.js";
import { getCatalogueItem } from "../../catalogue.js";
import { GRAND_HALL_DOOR_CLEAR_SPACES } from "../../door-clear-spaces.js";
import { layoutGangwayReview } from "../../gangway-review-record.js";
import type { PlacedItem } from "../../placement.js";
import { setPlannerFeaturesForTesting } from "../../planner-features.js";
import { cardParamsFor, pieceCardId, stampSetup, type CardId, type CardParamsRequest } from "../../setup-cards.js";
import { usePlannerEventStore } from "../../../stores/planner-event-store.js";
import { floorCounts, handCardCounting, handCardIds, handCards } from "../hand-cards.js";
import { journeySteps, nextMove } from "../journey.js";
import { LAID_CLEARANCE_M, gapToOpenUp, roomFacts, roomStatus, seatLine, type RoomStatus, type RoomStatusId } from "../room-seals.js";

const TURINI = "burgess-turini-18-3";

let sequence = 0;
const newId = (): string => {
  sequence += 1;
  return `piece-${String(sequence)}`;
};

function stamp(id: CardId, x: number, z: number, asked: CardParamsRequest = {}): readonly PlacedItem[] {
  const params = cardParamsFor(id, asked);
  if (params === null) throw new Error(`no card ${id}`);
  return stampSetup(params, { x, z }, 0, newId, TURINI);
}

/**
 * Rounds of ten down the middle of the hall, clear of every door. Up to eight
 * stand apart (four to a row, two rows); past that they share places, which
 * only the seat counts may be asked about.
 */
function rounds(count: number, spacing = 4.5): PlacedItem[] {
  const pieces: PlacedItem[] = [];
  for (let index = 0; index < count; index += 1) {
    const column = index % 4;
    const row = Math.floor(index / 4);
    pieces.push(...stamp("round", -6.75 + column * spacing, -2.25 + (row % 2) * spacing, { seats: 10 }));
  }
  return pieces;
}

function facts(items: readonly PlacedItem[], guests: number | null, kind: "wedding" | "corporate" | null = null): ReturnType<typeof roomFacts> {
  return roomFacts({ items, guests, roomSlug: "grand-hall", doorSpaces: GRAND_HALL_DOOR_CLEAR_SPACES, kind, room: GRAND_HALL_RENDER_DIMENSIONS });
}

function said(facts: ReturnType<typeof roomFacts>, id: RoomStatusId): RoomStatus {
  const found = roomStatus(facts).find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`nothing said about ${id}`);
  return found;
}

beforeEach(() => {
  sequence = 0;
  setPlannerFeaturesForTesting({ tableSets: true, setupCards: true, seatsOnTheCard: true });
});

afterEach(() => {
  setPlannerFeaturesForTesting(null);
  usePlannerEventStore.getState().setEventKind(null);
});

describe("the hand", () => {
  it("deals a wedding's cards to an event nobody has described, and a conference its own", () => {
    expect(handCardIds(null)).toEqual(handCardIds("wedding"));
    expect(handCardIds("other")).toEqual(handCardIds("wedding"));
    expect(handCardIds("corporate")).toContain(pieceCardId("lectern"));
    expect(handCardIds("corporate")).not.toContain("top-table");
  });

  it("names each card as a guest would, with one fact under the name", () => {
    const hand = handCards("wedding", [], TURINI);
    expect(hand.map((card) => card.name)).toEqual([
      "Round of 10", "Top table", "Long table", "Dance floor", "Stage", "Bar", "Poseur table", "Cake table",
    ]);
    expect(hand.map((card) => card.detail).slice(0, 4)).toEqual(["10 seats", "12 seats", "24 seats", "4.6 m square"]);
    expect(hand.every((card) => card.placed === 0)).toBe(true);
  });

  it("gives every card of both hands a picture", () => {
    for (const kind of ["wedding", "corporate"] as const) {
      for (const card of handCards(kind, [], TURINI)) expect(card.art, card.name).not.toBeNull();
    }
  });

  it("counts what stands in the room the way the cards name it", () => {
    const items = [
      ...rounds(3),
      ...stamp("top-table", 0, 4.2),
      ...stamp("long-table", 0, -4.2),
      ...stamp("dance-floor", 7.5, 0),
      ...stamp(pieceCardId("bar-counter"), -9, 3),
    ];
    const counts = floorCounts(items);
    expect(counts.rounds).toBe(3);
    expect(counts.topTables).toBe(1);
    expect(counts.longTables).toBe(1);
    expect(counts.danceFloors).toBe(1);
    expect(counts.bySlug.get("bar-counter")).toBe(1);
    expect(counts.bySlug.get(TURINI)).toBeUndefined();

    const hand = handCards("wedding", items, TURINI);
    expect(hand.map((card) => card.placed)).toEqual([3, 1, 1, 1, 0, 1, 0, 0]);
  });

  // Where a piece put back has gone: the card whose number in the room falls when it leaves the floor.
  it("says which card of a hand counts a piece, by the same count the card shows", () => {
    const round = stamp("round", -6, 0, { seats: 10 });
    const top = stamp("top-table", 0, 4.2);
    const long = stamp("long-table", 0, -4.2);
    const floor = stamp("dance-floor", 7.5, 0);
    const bar = stamp(pieceCardId("bar-counter"), -9, 3);
    const lectern = stamp(pieceCardId("lectern"), 9, 3);
    const items = [...round, ...top, ...long, ...floor, ...bar, ...lectern];
    const ids = (pieces: readonly PlacedItem[]): ReadonlySet<string> => new Set(pieces.map((piece) => piece.id));
    const wedding = handCardIds("wedding");
    const corporate = handCardIds("corporate");

    expect(handCardCounting(wedding, items, ids(round))).toBe("round");
    expect(handCardCounting(wedding, items, ids(top))).toBe("top-table");
    expect(handCardCounting(wedding, items, ids(long))).toBe("long-table");
    expect(handCardCounting(wedding, items, ids(bar))).toBe(pieceCardId("bar-counter"));
    // The same floor is one card in a wedding's hand and another in a conference's.
    expect(handCardCounting(wedding, items, ids(floor))).toBe("dance-floor");
    expect(handCardCounting(corporate, items, ids(floor))).toBe(pieceCardId("dancefloor-panel"));
    // A table chosen without its chairs is still its card's; its chairs without it are no card's.
    const isTable = (piece: PlacedItem): boolean => getCatalogueItem(piece.catalogueItemId)?.category === "table";
    expect(handCardCounting(wedding, items, ids(round.filter(isTable)))).toBe("round");
    expect(handCardCounting(wedding, items, ids(round.filter((piece) => !isTable(piece))))).toBeNull();
    // A wedding's hand has no card for a lectern, and nothing chosen is no card's.
    expect(handCardCounting(wedding, items, ids(lectern))).toBeNull();
    expect(handCardCounting(corporate, items, ids(lectern))).toBe(pieceCardId("lectern"));
    expect(handCardCounting(wedding, items, new Set<string>())).toBeNull();
    // Of several kinds chosen together, the first card in the hand's order.
    expect(handCardCounting(wedding, items, ids([...bar, ...round]))).toBe("round");
  });
});

describe("the status line", () => {
  it("counts the seats placed while no guest count is known, and seats against guests once one is", () => {
    expect(seatLine(facts(rounds(1), null).plane)).toMatchObject({ text: "10 seats placed", attention: false });
    expect(seatLine(facts([], null).plane).text).toBe("0 seats placed");
    expect(seatLine(facts(rounds(8), 120).plane)).toMatchObject({ text: "80 of 120 seated", attention: false, detail: null });
    expect(seatLine(facts(rounds(8), 80).plane).text).toBe("80 of 80 seated");
  });

  it("names the venue's published figure when more seats are placed than it", () => {
    const over = seatLine(facts(rounds(19), 190).plane);
    expect(over.attention).toBe(true);
    expect(over.detail).toContain("The venue publishes 180");
  });

  it("says the doors are clear on an empty floor, and nothing of aisles until two pieces stand", () => {
    expect(roomStatus(facts([], null)).map((entry) => entry.id)).toEqual(["doors"]);
    expect(said(facts([], null), "doors")).toMatchObject({ text: "Doors clear", attention: false });
    expect(roomStatus(facts(rounds(2), 20)).map((entry) => entry.id)).toEqual(["doors", "aisles"]);
  });

  it("says a door is blocked, and which table stands in front of it", () => {
    const door = GRAND_HALL_DOOR_CLEAR_SPACES[0];
    if (door === undefined) throw new Error("the Grand Hall has recorded doors");
    const blocking = stamp("round", (door.rect.minX + door.rect.maxX) / 2, (door.rect.minZ + door.rect.maxZ) / 2);
    const doors = said(facts(blocking, 10), "doors");
    expect(doors).toMatchObject({ attention: true });
    expect(doors.text).toMatch(/^\d+ doors? blocked$/u);
    expect(doors.detail).toContain("is in front of");
  });

  it("says nothing about doors in a room with none recorded", () => {
    const status = roomStatus(roomFacts({ items: rounds(2), guests: 20, roomSlug: "saloon", doorSpaces: null, kind: null }));
    expect(status.some((entry) => entry.id === "doors")).toBe(false);
  });

  it("reads the narrowest aisle in metres, and asks for a look when it is tight", () => {
    const apart = said(facts(rounds(2, 6), 20), "aisles");
    expect(apart.attention).toBe(false);
    expect(apart.text).toMatch(/^Narrowest aisle \d+\.\d m$/u);

    const close = said(facts([...stamp("round", 0, 0), ...stamp("round", 2.3, 0)], 20), "aisles");
    expect(close.attention).toBe(true);
    expect(close.detail).toContain("The narrowest gap is");
  });

  it("never words the line as a verdict on safety", () => {
    const rooms = [
      facts([], null),
      facts(rounds(8), 120),
      facts(rounds(19), 190),
      facts([...stamp("round", 0, 0), ...stamp("round", 2.3, 0)], 20, "corporate"),
    ];
    for (const room of rooms) {
      const seats = seatLine(room.plane);
      const words = [`${seats.text} ${seats.detail ?? ""}`, ...roomStatus(room).map((entry) => `${entry.text} ${entry.detail}`)];
      for (const line of words) expect(line).not.toMatch(/\b(within|fits?|pass(es|ed)?|valid|compliant|safe)\b/iu);
    }
  });
});

describe("the journey", () => {
  it("marks the first step not yet done as the current one", () => {
    const states = (progress: Parameters<typeof journeySteps>[0]): string[] => journeySteps(progress).map((step) => step.state);
    expect(states({ eventKnown: false, seated: false, dressed: false, sent: false })).toEqual(["current", "ahead", "ahead", "ahead"]);
    expect(states({ eventKnown: true, seated: false, dressed: false, sent: false })).toEqual(["done", "current", "ahead", "ahead"]);
    expect(states({ eventKnown: true, seated: true, dressed: false, sent: false })).toEqual(["done", "done", "current", "ahead"]);
    expect(states({ eventKnown: true, seated: true, dressed: true, sent: false })).toEqual(["done", "done", "done", "current"]);
    expect(states({ eventKnown: true, seated: true, dressed: true, sent: true })).toEqual(["done", "done", "done", "done"]);
  });

  it("always names one next move, the most useful first, in the primary key's own words", () => {
    expect(nextMove(facts([], null), false)).toMatchObject({ id: "ask-guests", step: "event" });
    expect(nextMove(facts([], null), false).text).toBe("Say how many guests");
    expect(nextMove(facts([], 120), false)).toMatchObject({ id: "lay-out", text: "Lay out the room for 120 guests" });
    expect(nextMove(facts(rounds(8), 120), false)).toMatchObject({ id: "seat-more", text: "Seat 40 more guests" });
    expect(nextMove(facts(rounds(1), 11), false).text).toBe("Seat 1 more guest");
    expect(nextMove(facts(rounds(8), 80), false)).toMatchObject({ id: "send", step: "send", text: "Send to the events team" });
    expect(nextMove(facts(rounds(8), 80), true)).toMatchObject({ id: "sent", text: "Sent to the events team" });
    expect(nextMove(facts(rounds(19), 190), false)).toMatchObject({ id: "ask-venue", step: "send", text: "Ask the events team about more than 180" });
  });

  it("puts a blocked door ahead of seating, and a tight gap ahead of sending", () => {
    const door = GRAND_HALL_DOOR_CLEAR_SPACES[0];
    if (door === undefined) throw new Error("the Grand Hall has recorded doors");
    const blocking = stamp("round", (door.rect.minX + door.rect.maxX) / 2, (door.rect.minZ + door.rect.maxZ) / 2);
    expect(nextMove(facts(blocking, 60), false)).toMatchObject({ id: "clear-door", step: "layout" });
    expect(nextMove(facts(blocking, 60), false).text).toMatch(/^Move .+ clear of the door$/u);
    expect(nextMove(facts([...stamp("round", 0, 0), ...stamp("round", 2.3, 0)], 20), false)).toMatchObject({ id: "open-gap", text: "Open up the narrowest gap" });
  });

  // The planner's own Lay out keeps 0.6 m behind every chair, and the circulation scale calls anything under 0.9 m
  // tight. Read by the scale alone, every room the planner had just laid was sent straight back to be opened up.
  it("leaves a room at the planner's own spacing ready to send, and says every other tight gap as before", () => {
    expect(LAID_CLEARANCE_M).toBe(BANQUET_CHAIR_CLEARANCE_M);
    // Two rounds of ten side by side where one of Lay out's rows stands, clear of the room's gangways: the gap
    // between their chairs is their distance apart, less a round's reach.
    const ROW_Z = -2.25;
    const probe = facts([...stamp("round", -4, ROW_Z), ...stamp("round", 4, ROW_Z)], 20).aisles.tightestGapM;
    if (probe === null) throw new Error("two rounds have a gap between them");
    const reach = (8 - probe) / 2;
    const pair = (gapM: number): PlacedItem[] => [...stamp("round", -(reach + gapM / 2), ROW_Z), ...stamp("round", reach + gapM / 2, ROW_Z)];
    const apart = (gapM: number): ReturnType<typeof facts> => facts(pair(gapM), 20);

    // The planner's own spacing: said as a figure, and nothing asked.
    const laid = apart(LAID_CLEARANCE_M);
    expect(laid.aisles.tightestGapM).toBeCloseTo(LAID_CLEARANCE_M, 3);
    expect(laid.aisles.band).toBe("tight");
    expect(laid.aisles.asLaid).toBe(true);
    expect(gapToOpenUp(laid.aisles)).toBe(false);
    expect(nextMove(laid, false)).toMatchObject({ id: "send", text: "Send to the events team" });
    expect(said(laid, "aisles")).toMatchObject({ text: "Narrowest aisle 0.6 m", attention: false });

    // Wider than that is no more to ask about than the planner's own spacing is.
    for (const wider of [0.62, 0.7, 0.85]) {
      const room = apart(wider);
      expect(room.aisles.band, String(wider)).toBe("tight");
      expect(gapToOpenUp(room.aisles), String(wider)).toBe(false);
      expect(nextMove(room, false), String(wider)).toMatchObject({ id: "send" });
    }
    // Narrower is asked about, as it always was.
    for (const narrower of [0.5, 0.58]) {
      const room = apart(narrower);
      expect(room.aisles.band, String(narrower)).toBe("tight");
      expect(room.aisles.asLaid, String(narrower)).toBe(false);
      expect(gapToOpenUp(room.aisles), String(narrower)).toBe(true);
      expect(nextMove(room, false), String(narrower)).toMatchObject({ id: "open-gap" });
      expect(said(room, "aisles"), String(narrower)).toMatchObject({ attention: true });
    }
    const shut = apart(0.3);
    expect(shut.aisles.band).toBe("blocked");
    expect(nextMove(shut, false)).toMatchObject({ id: "open-gap" });
    expect(said(shut, "aisles")).toMatchObject({ attention: true });

    // Lay out keeps the same spacing from a piece already on the floor (it lays "round what is already placed"),
    // so a standing table that far from a round's chairs is the planner's spacing too.
    const standing = pieceCardId("poseur-table-white");
    const far = facts([...stamp("round", -3, ROW_Z), ...stamp(standing, 3, ROW_Z)], 10).aisles.tightestGapM;
    if (far === null) throw new Error("a round and a standing table have a gap between them");
    const beside = facts([...stamp("round", -3, ROW_Z), ...stamp(standing, 3 - (far - LAID_CLEARANCE_M), ROW_Z)], 10);
    expect(beside.aisles.tightestGapM).toBeCloseTo(LAID_CLEARANCE_M, 3);
    expect(gapToOpenUp(beside.aisles)).toBe(false);

    // A way to a door, or along a wall, narrowed under the planner's guidance excuses nothing. The same two rounds
    // at the planner's spacing, and a third standing where the planner's own review finds a gangway narrowed: the
    // pair's gap is said again, as it was before this rule.
    let narrowed: PlacedItem[] | null = null;
    for (let z = -3.6; z <= 3.6 && narrowed === null; z += 0.2) {
      const all = [...pair(LAID_CLEARANCE_M), ...stamp("round", 8, z)];
      if (layoutGangwayReview(all, GRAND_HALL_RENDER_DIMENSIONS, "grand-hall", null).items.length > 0) narrowed = all;
    }
    if (narrowed === null) throw new Error("nowhere across the hall narrows one of its gangways");
    const route = facts(narrowed, 30);
    expect(route.aisles.tightestGapM).toBeCloseTo(LAID_CLEARANCE_M, 3);
    expect(route.aisles.asLaid).toBe(false);
    expect(gapToOpenUp(route.aisles)).toBe(true);
    expect(said(route, "aisles")).toMatchObject({ attention: true });

    // Where the room's size is not known the review cannot be asked, and nothing is excused.
    const unsized = roomFacts({ items: pair(LAID_CLEARANCE_M), guests: 20, roomSlug: "grand-hall", doorSpaces: GRAND_HALL_DOOR_CLEAR_SPACES, kind: null, room: null });
    expect(unsized.aisles.asLaid).toBe(false);
    expect(gapToOpenUp(unsized.aisles)).toBe(true);

    // Blocked is asked about whatever else is said of it, and a gap that is not tight never was.
    expect(gapToOpenUp({ band: "blocked", tightestGapM: null, tightestPair: null, asLaid: true })).toBe(true);
    expect(gapToOpenUp(apart(1).aisles)).toBe(false);
    expect(gapToOpenUp(facts([], 20).aisles)).toBe(false);
  });
});
