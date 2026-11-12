// ---------------------------------------------------------------------------
// The window wall's cut, for the front outside it
//
// The front stands outside the window wall, so wherever the cutaway lowers
// that wall the front is cut at the same height: one section through the
// building, never a facade standing whole in front of a cut room. The cut is
// GrandHallModel's own, eased with the walls' (its cutState for the window
// wall, HALL_WALLS[0]), copied here every frame so the front's material reads
// the very value the wall's body does. 100 is "nothing cut", as HALL_CUTS.none.
// ---------------------------------------------------------------------------

import { uniform } from "three/tsl";

/** The window wall's cut, planner y: written by GrandHallModel, read by the front's material. */
export const hallFrontCut = uniform(100);
