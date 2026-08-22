import { findUnsupportedProposalClaim } from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import { allQuickActionCopy } from "../QuickActions.js";
import { allRoomDossierCopy } from "../RoomDossier.js";
import { ROOM_DISPLAY_NAMES } from "../twin-rooms.js";

// -----------------------------------------------------------------------------
// The claim guard, applied to the shell panels.
//
// TwinPage's own suite sweeps allTwinCopy() through findUnsupportedProposalClaim
// — that sweep is the repo's only enforcement of the banned certainty phrases.
// The shell panels are NOT in allTwinCopy(), and they are deliberately not being
// spliced in: twin-copy.ts is a pure data module, and importing these components
// into it would invert the dependency and drag React and a stylesheet into the
// copy graph. The guarantee is worth more than the location, so the same guard
// runs here instead, over the lists the panels publish about themselves.
//
// The failure this catches is not hypothetical. Both panels talk about capacity,
// which is exactly the subject the guard exists to police: a venue tool that
// says a room "fits 250" has made a promise, where "250 standing, a planning
// guide" has given information. One word's drift is the whole difference.
// -----------------------------------------------------------------------------

describe("shell copy passes the claim guard", () => {
  it("finds no unsupported certainty claim in the quick-action rail", () => {
    for (const line of allQuickActionCopy()) {
      expect(findUnsupportedProposalClaim(line)).toBeNull();
    }
  });

  it("finds no unsupported certainty claim in the room dossier", () => {
    for (const line of allRoomDossierCopy()) {
      expect(findUnsupportedProposalClaim(line)).toBeNull();
    }
  });

  // A sweep list that drifts from what the component renders is worse than no
  // sweep: it reports green over copy nobody checked. This pins the list to the
  // only thing that can vary — the room names — so a sixth room added to
  // twin-rooms cannot silently ship an unswept label.
  it("sweeps a walk label for every room the rail can name", () => {
    const swept = allQuickActionCopy();
    for (const name of Object.values(ROOM_DISPLAY_NAMES)) {
      expect(swept.some((line) => line.includes(name))).toBe(true);
    }
  });

  it("publishes a non-empty list from both panels", () => {
    // Guards the degenerate pass: an empty list satisfies every assertion above
    // while checking nothing at all.
    expect(allQuickActionCopy().length).toBeGreaterThan(0);
    expect(allRoomDossierCopy().length).toBeGreaterThan(0);
  });
});
