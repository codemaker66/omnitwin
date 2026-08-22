import { type ReactElement } from "react";
import type { PublishedRoomSlug } from "../../lib/trades-hall-venue-truth.js";
import { ROOM_DISPLAY_NAMES } from "./twin-rooms.js";
import "./quick-actions.css";

// -----------------------------------------------------------------------------
// QuickActions — the chip rail that stands where the mockup's concierge stood.
//
// The design this comes from put an AI concierge at the bottom of the frame,
// offering four suggestions: ask it anything, and it would take you there. We
// are not shipping that, and not because it is hard. There is no concierge
// backend, no retrieval over the venue, no agent that can move the camera — so
// every one of those four chips would have been a promise the product cannot
// keep. A suggestion that cannot be carried out is worse than no suggestion: it
// teaches the visitor that the interface is decorative, and once they have
// learned that, the controls that DO work stop being trusted too. The mockup's
// shape survives here — a short rail of offered next moves, in the visitor's own
// language — and every chip behind it is wired to a capability that exists in
// the shipped viewer today:
//
//   See the plan    → the view-mode switch (useTwinMode)
//   Walk to <room>  → the Usher, i.e. shortestRoute() drained hop by hop
//   Share this view → the exact-view share URL (?node= + ?look=)
//   Enquire         → the in-twin enquiry modal, posting to a real endpoint
//
// The enforcement of that promise is structural, not editorial: each chip is
// gated on its own callback prop, and an absent callback renders no chip. There
// is no path through this file that can produce a control with nothing behind
// it. If the orchestrator cannot supply the capability — no mesh, so no plan
// view; no route, so no destination — the chip simply is not there, which is
// the honest state and also the calmer one.
//
// Room names arrive as `destinations` rather than being derived here. This file
// deliberately knows nothing about which viewpoint is which room: that answer
// lives in shell/twin-rooms.ts, which holds the human-validated bindings and
// returns null everywhere else. Splitting it that way means a chip rail can
// never be the thing that invents a sixth room.
// -----------------------------------------------------------------------------

/** Group name for the rail — screen readers announce the cluster first, so each
 *  chip's own label can stay short without losing its context. */
export const TWIN_QUICK_GROUP_LABEL = "Quick actions";

/** Switch the viewer out of the walk and into the overhead read of the hall. */
export const TWIN_QUICK_PLAN_LABEL = "See the plan";

/** Share the exact view. Worded distinctly from the utility rail's "Copy link
 *  to this walkthrough" so the two never read as one control to a screen reader
 *  working through the page by accessible name. */
export const TWIN_QUICK_SHARE_LABEL = "Share this view";

/** The way out into the venue's events team. Names the act, not the venue — the
 *  venue is already named by the HUD label above the rail. */
export const TWIN_QUICK_ENQUIRE_LABEL = "Enquire about hosting";

/**
 * A destination chip's visible text. The whole phrase is rendered, rather than a
 * bare room name behind an aria-label, so the accessible name and the visible
 * label are the same string — voice-control users say what they can see.
 */
export function twinQuickWalkLabel(destination: string): string {
  return `Walk to ${destination}`;
}

/** Every user-visible string this rail can render, for the copy-claim sweep
 *  (mirrors allTwinCopy() in twin-copy.ts; the orchestrator splices this in).
 *
 *  Every destination label is enumerated rather than sampled. Because a
 *  destination is a slug and the label is looked up, the set of renderable
 *  phrases is finite and known here — so the sweep covers the rail exactly,
 *  instead of covering one example and trusting the rest. */
export function allQuickActionCopy(): readonly string[] {
  return [
    TWIN_QUICK_GROUP_LABEL,
    TWIN_QUICK_PLAN_LABEL,
    TWIN_QUICK_SHARE_LABEL,
    TWIN_QUICK_ENQUIRE_LABEL,
    ...Object.values(ROOM_DISPLAY_NAMES).map(twinQuickWalkLabel),
  ];
}

/** A named place the walk can actually reach. Supplied by the orchestrator
 *  because only it holds the nav graph that proves reachability.
 *
 *  It carries a SLUG, not a display string, and the label is looked up here.
 *  A free-text label would let any caller name a room whatever it liked — copy
 *  that renders to a guest while bypassing the claim sweep, which can only
 *  check the strings it is handed. Constrained to PublishedRoomSlug, every
 *  label the rail can ever draw comes from ROOM_DISPLAY_NAMES, which one test
 *  already pins in full. */
export interface QuickActionDestination {
  /** Manifest node id, e.g. "scan_028". Passed straight back to `onWalkTo`. */
  readonly nodeId: string;
  /** Which published room this viewpoint stands in. Identity, not copy. */
  readonly slug: PublishedRoomSlug;
}

export interface QuickActionsProps {
  /** Switch to the overhead view. Omitted when there is no mesh to switch to. */
  readonly onSeeThePlan?: () => void;
  /** Route the walk to a node — the Usher, not a teleport. Without this, no
   *  destination chip renders, however many destinations are passed. */
  readonly onWalkTo?: (nodeId: string) => void;
  /** Places worth offering. Only rooms whose identity is verified belong here;
   *  see shell/twin-rooms.ts for why that list is as short as it is. */
  readonly destinations?: readonly QuickActionDestination[];
  /** Share the exact current view. */
  readonly onShareView?: () => void;
  /** Open the in-twin enquiry modal. */
  readonly onEnquire?: () => void;
}

/** Stable empty list, so the default path allocates nothing per render. */
const NO_DESTINATIONS: readonly QuickActionDestination[] = [];

/** 14px sits level with the 0.72rem uppercase label — the pairing the Enquire
 *  pill in the utility rail already uses. */
const ICON_SIZE = 14;

/** The overhead read: a room outline with one dividing wall. */
const ICON_PLAN: ReactElement = (
  <svg
    className="vv-twin-quick-icon"
    viewBox="0 0 24 24"
    width={ICON_SIZE}
    height={ICON_SIZE}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden
  >
    <path d="M3 3h18v18H3z" />
    <path d="M3 10h11M14 10v11" />
  </svg>
);

/** Going somewhere: a plain arrow. Every metaphor tried (footprints, a doorway)
 *  read as decoration at 14px; an arrow reads as direction. */
const ICON_WALK: ReactElement = (
  <svg
    className="vv-twin-quick-icon"
    viewBox="0 0 24 24"
    width={ICON_SIZE}
    height={ICON_SIZE}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden
  >
    <path d="M4 12h13M12 6l6 6-6 6" />
  </svg>
);

/** The share node — deliberately NOT the chain link, which the utility rail
 *  already owns for copy-link. Two controls, two glyphs. */
const ICON_SHARE: ReactElement = (
  <svg
    className="vv-twin-quick-icon"
    viewBox="0 0 24 24"
    width={ICON_SIZE}
    height={ICON_SIZE}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden
  >
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
  </svg>
);

/** The paper plane, matching the utility rail's Enquire pill exactly — the same
 *  act should not wear two faces on one screen. */
const ICON_ENQUIRE: ReactElement = (
  <svg
    className="vv-twin-quick-icon"
    viewBox="0 0 24 24"
    width={ICON_SIZE}
    height={ICON_SIZE}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden
  >
    <path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z" />
  </svg>
);

interface QuickChipProps {
  readonly label: string;
  readonly icon: ReactElement;
  /** "gold" is the single filled chip — at most one may ever carry it. */
  readonly tone?: "quiet" | "gold";
  readonly onClick: () => void;
  readonly testId: string;
}

function QuickChip({ label, icon, tone, onClick, testId }: QuickChipProps): ReactElement {
  return (
    <button
      type="button"
      className={
        tone === "gold"
          ? "vv-twin-quick-chip vv-twin-quick-chip--gold"
          : "vv-twin-quick-chip"
      }
      onClick={onClick}
      data-testid={testId}
    >
      {icon}
      <span className="vv-twin-quick-label">{label}</span>
    </button>
  );
}

export function QuickActions({
  onSeeThePlan,
  onWalkTo,
  destinations,
  onShareView,
  onEnquire,
}: QuickActionsProps): ReactElement | null {
  // Destinations without a handler are not "destinations pending a handler",
  // they are nothing: rendering them would put beautiful dead buttons on the
  // glass. The gate sits here rather than at each chip so the emptiness
  // propagates into the count below and the whole rail can disappear.
  const walkTargets =
    onWalkTo === undefined ? NO_DESTINATIONS : destinations ?? NO_DESTINATIONS;

  const chipCount =
    (onSeeThePlan === undefined ? 0 : 1) +
    walkTargets.length +
    (onShareView === undefined ? 0 : 1) +
    (onEnquire === undefined ? 0 : 1);

  // An empty group is still a group: a screen reader would announce "Quick
  // actions" and then find nothing inside it. Render no rail at all.
  if (chipCount === 0) {
    return null;
  }

  return (
    <div
      className="vv-twin-quick"
      role="group"
      aria-label={TWIN_QUICK_GROUP_LABEL}
      data-testid="twin-quick-actions"
    >
      {/* DOM order is the only order — nothing here reverses, reorders or floats
        * on any breakpoint, so tab order and reading order ARE the visual order
        * by construction, rather than by a second declaration free to drift. */}
      {onSeeThePlan !== undefined && (
        <QuickChip
          label={TWIN_QUICK_PLAN_LABEL}
          icon={ICON_PLAN}
          onClick={onSeeThePlan}
          testId="twin-quick-plan"
        />
      )}

      {walkTargets.map((destination) => (
        <QuickChip
          key={destination.nodeId}
          label={twinQuickWalkLabel(ROOM_DISPLAY_NAMES[destination.slug])}
          icon={ICON_WALK}
          onClick={() => {
            // Narrowed by construction — walkTargets is empty unless onWalkTo
            // exists — and the optional call keeps that true at runtime too.
            onWalkTo?.(destination.nodeId);
          }}
          testId={`twin-quick-walk-${destination.nodeId}`}
        />
      ))}

      {onShareView !== undefined && (
        <QuickChip
          label={TWIN_QUICK_SHARE_LABEL}
          icon={ICON_SHARE}
          onClick={onShareView}
          testId="twin-quick-share"
        />
      )}

      {onEnquire !== undefined && (
        <QuickChip
          label={TWIN_QUICK_ENQUIRE_LABEL}
          icon={ICON_ENQUIRE}
          tone="gold"
          onClick={onEnquire}
          testId="twin-quick-enquire"
        />
      )}
    </div>
  );
}
