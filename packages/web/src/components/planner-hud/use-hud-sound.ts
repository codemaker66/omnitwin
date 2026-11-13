import { useEffect } from "react";
import { placementSound } from "../../lib/hud/placement-sound.js";
import { playPlannerSound, setPlannerSoundPageDefault, usePlannerSoundArming } from "../../lib/sound-registry.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { subscribeFurniturePlaced, usePlacementStore } from "../../stores/placement-store.js";

// ---------------------------------------------------------------------------
// The HUD's sound (design spec, "Motion and sound"). Quiet by default, its
// setting only in the view's More tools (Blake's D1): Quiet is this page's
// default until someone chooses, and nothing is kept until they do.
//
// The engine already sounds a refusal (lib/place-in-hand.ts). The HUD adds
// the two touches it owns: a card taken in hand lifts (Full only), and each
// act of setting down lands once, however many pieces it brought, a Lay out
// as one brush (lib/hud/placement-sound.ts). Choosing a table or opening a
// sheet is silent. Sound is never the only signal: the ghost, the seat line
// and the seals carry every one of these.
// ---------------------------------------------------------------------------

/** While the HUD is mounted: the first gesture arms the sound, and the hand and the floor are heard. */
export function useHudSound(): void {
  usePlannerSoundArming();

  useEffect(() => { setPlannerSoundPageDefault("quiet"); }, []);

  useEffect(() => subscribeFurniturePlaced((ids) => {
    const sound = placementSound(ids, usePlacementStore.getState().placedItems);
    if (sound !== null) playPlannerSound(sound);
  }), []);

  // A card taken in hand: by a click, a digit, a drag or the catalogue, from the hand's one store.
  useEffect(() => useCatalogueStore.subscribe((state, previous) => {
    if (state.armedCardId !== null && state.armedCardId !== previous.armedCardId) playPlannerSound("planner-lift");
  }), []);
}
