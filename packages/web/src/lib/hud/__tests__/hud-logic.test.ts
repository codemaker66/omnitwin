import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GRAND_HALL_DOOR_CLEAR_SPACES } from "../../door-clear-spaces.js";
import type { PlacedItem } from "../../placement.js";
import { setPlannerFeaturesForTesting } from "../../planner-features.js";
import { cardParamsFor, pieceCardId, stampSetup, type CardId, type CardParamsRequest } from "../../setup-cards.js";
import { usePlannerEventStore } from "../../../stores/planner-event-store.js";
import { floorCounts, handCardIds, handCards } from "../hand-cards.js";
import { journeySteps, nextMove } from "../journey.js";
import { roomFacts, roomSeals, type RoomSeal, type SealId } from "../room-seals.js";

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
  return roomFacts({ items, guests, roomSlug: "grand-hall", doorSpaces: GRAND_HALL_DOOR_CLEAR_SPACES, kind });
}

function seal(seals: readonly RoomSeal[], id: SealId): RoomSeal {
  const found = seals.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no ${id} seal`);
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
});

describe("the seals", () => {
  it("waits quietly on an empty floor with no guest count", () => {
    const seals = roomSeals(facts([], null));
    expect(seals.map((entry) => entry.id)).toEqual(["seats", "doors", "aisles", "top-table", "dance-floor", "bar"]);
    expect(seal(seals, "seats").state).toBe("waiting");
    expect(seal(seals, "doors")).toMatchObject({ state: "lit", label: "Doors clear" });
    expect(seal(seals, "aisles").state).toBe("waiting");
    expect(seal(seals, "top-table")).toMatchObject({ state: "waiting", card: "top-table" });
  });

  it("fills the seats ring as guests are seated, and lights it when all are", () => {
    const short = seal(roomSeals(facts(rounds(8), 120)), "seats");
    expect(short).toMatchObject({ state: "progress", value: "80 / 120", detail: "40 guests still to seat." });
    expect(short.progress).toBeCloseTo(80 / 120, 5);

    const seated = seal(roomSeals(facts(rounds(8), 80)), "seats");
    expect(seated).toMatchObject({ state: "lit", value: "80 / 80", progress: 1 });
  });

  it("names the venue's published figure when more seats are placed than it", () => {
    const over = seal(roomSeals(facts(rounds(19), 190)), "seats");
    expect(over.state).toBe("attention");
    expect(over.detail).toContain("The venue publishes 180");
  });

  it("says which table stands in front of a door", () => {
    const door = GRAND_HALL_DOOR_CLEAR_SPACES[0];
    if (door === undefined) throw new Error("the Grand Hall has recorded doors");
    const blocking = stamp("round", (door.rect.minX + door.rect.maxX) / 2, (door.rect.minZ + door.rect.maxZ) / 2);
    const seals = roomSeals(facts(blocking, 10));
    expect(seal(seals, "doors")).toMatchObject({ state: "attention", value: "1 blocked" });
    expect(seal(seals, "doors").detail).toContain("is in front of");
  });

  it("says nothing about doors in a room with none recorded", () => {
    const seals = roomSeals(roomFacts({ items: rounds(2), guests: 20, roomSlug: "saloon", doorSpaces: null, kind: null }));
    expect(seals.some((entry) => entry.id === "doors")).toBe(false);
  });

  it("reads the narrowest gap in metres, and asks for a look when it is tight", () => {
    const apart = seal(roomSeals(facts(rounds(2, 6), 20)), "aisles");
    expect(apart.state).toBe("lit");
    expect(apart.value).toMatch(/^\d+\.\d m$/u);

    const close = seal(roomSeals(facts([...stamp("round", 0, 0), ...stamp("round", 2.3, 0)], 20)), "aisles");
    expect(close.state).toBe("attention");
    expect(close.detail).toContain("The narrowest gap is");
  });

  it("shows a conference its stage, lectern and screen", () => {
    const seals = roomSeals(facts(stamp(pieceCardId("lectern"), 0, 0), 80, "corporate"));
    expect(seals.map((entry) => entry.id).slice(-3)).toEqual(["stage", "lectern", "screen"]);
    expect(seal(seals, "lectern").state).toBe("lit");
    expect(seal(seals, "stage")).toMatchObject({ state: "waiting", card: pieceCardId("platform") });
  });

  it("never words a seal as a verdict on safety", () => {
    const every = [
      ...roomSeals(facts([], null)),
      ...roomSeals(facts(rounds(8), 120)),
      ...roomSeals(facts(rounds(19), 190)),
      ...roomSeals(facts([...stamp("round", 0, 0), ...stamp("round", 2.3, 0)], 20, "corporate")),
    ];
    for (const entry of every) {
      expect(`${entry.label} ${entry.value ?? ""} ${entry.detail}`).not.toMatch(/\b(within|fits?|pass(es|ed)?|valid|compliant|safe)\b/iu);
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

  it("always names one next move, the most useful first", () => {
    expect(nextMove(facts([], null), false)).toMatchObject({ id: "ask-guests", step: "event" });
    expect(nextMove(facts([], 120), false)).toMatchObject({ id: "lay-out", text: "lay out the room for 120 guests" });
    expect(nextMove(facts(rounds(8), 120), false)).toMatchObject({ id: "seat-more", text: "seat 40 more guests" });
    expect(nextMove(facts(rounds(1), 11), false).text).toBe("seat 1 more guest");
    expect(nextMove(facts(rounds(8), 80), false)).toMatchObject({ id: "send", step: "send" });
    expect(nextMove(facts(rounds(8), 80), true).id).toBe("sent");
  });

  it("puts a blocked door ahead of seating, and a tight gap ahead of sending", () => {
    const door = GRAND_HALL_DOOR_CLEAR_SPACES[0];
    if (door === undefined) throw new Error("the Grand Hall has recorded doors");
    const blocking = stamp("round", (door.rect.minX + door.rect.maxX) / 2, (door.rect.minZ + door.rect.maxZ) / 2);
    expect(nextMove(facts(blocking, 60), false).id).toBe("clear-door");
    expect(nextMove(facts([...stamp("round", 0, 0), ...stamp("round", 2.3, 0)], 20), false).id).toBe("open-gap");
  });
});
