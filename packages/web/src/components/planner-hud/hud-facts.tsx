import { createContext, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { roomFacts, type RoomFacts } from "../../lib/hud/room-seals.js";
import type { PlacedItem } from "../../lib/placement.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useDoorClearSpaceStore } from "../../stores/door-clear-space-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { usePlannerEventStore } from "../../stores/planner-event-store.js";

// ---------------------------------------------------------------------------
// The room's facts, read once for the whole screen (the steps, the shelf's
// status line and its edge, the cards' counts and the one primary key).
//
// A drag replaces the placed pieces on every frame. The HUD must not work the
// doors and the gaps out sixty times a second, so the pieces are taken at once
// when their number changes (something was set down or put back, and the line
// should answer now) and otherwise once the hand rests.
// ---------------------------------------------------------------------------

/** How long the pieces must rest before the stations read their new places. */
const REST_MS = 140;

function useRestedItems(): readonly PlacedItem[] {
  const [items, setItems] = useState(() => usePlacementStore.getState().placedItems);
  useEffect(() => {
    let timer: number | null = null;
    const take = (): void => {
      timer = null;
      setItems(usePlacementStore.getState().placedItems);
    };
    const unsubscribe = usePlacementStore.subscribe((state, previous) => {
      if (state.placedItems === previous.placedItems) return;
      if (timer !== null) window.clearTimeout(timer);
      if (state.placedItems.length !== previous.placedItems.length) take();
      else timer = window.setTimeout(take, REST_MS);
    });
    // Whatever was placed between the first render and this effect.
    take();
    return () => {
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);
  return items;
}

const HudFactsContext = createContext<RoomFacts | null>(null);

/**
 * Works the room's facts out once and hands them to every station.
 * `eventGuests` is the linked event's guest count, where there is one; a count
 * given in the planner itself (the Your event sheet, Lay out) comes first.
 */
export function HudFactsProvider({ eventGuests, children }: { readonly eventGuests: number | null; readonly children: ReactNode }): ReactElement {
  const items = useRestedItems();
  const planned = useCockpitStore((state) => state.plannedGuestCount);
  const roomSlug = useEditorStore((state) => state.space?.slug ?? null);
  const doorSpaces = useDoorClearSpaceStore((state) => state.spaces);
  const doorsRecorded = useDoorClearSpaceStore((state) => state.recorded);
  const kind = usePlannerEventStore((state) => state.eventKind);
  const facts = useMemo(
    () => roomFacts({ items, guests: planned ?? eventGuests, roomSlug, doorSpaces: doorsRecorded ? doorSpaces : null, kind }),
    [items, planned, eventGuests, roomSlug, doorSpaces, doorsRecorded, kind],
  );
  return <HudFactsContext.Provider value={facts}>{children}</HudFactsContext.Provider>;
}

/** The room's facts, inside the HUD. */
export function useHudFacts(): RoomFacts {
  const facts = useContext(HudFactsContext);
  if (facts === null) throw new Error("useHudFacts needs a HudFactsProvider above it");
  return facts;
}
