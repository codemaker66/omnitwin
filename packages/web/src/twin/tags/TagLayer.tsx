import { useEffect, useMemo, useState, type ReactElement } from "react";
import { prefersReducedMotion } from "../reduced-motion.js";
import {
  TAG_CLOSE_LABEL,
  TAG_EXAMPLE_BADGE,
  TAG_EXAMPLE_DISCLOSURE,
  TAG_GO_TO_BEST_VIEW,
  TAG_GROUP_LABEL,
  tagCountAnnouncement,
  tagPinAria,
} from "./tag-copy.js";
import {
  TAG_KIND_LABELS,
  drawableTags,
  placeTags,
  tagCardClearBox,
  tagCardPosition,
  type TagCamera,
  type TagKind,
  type TagPlacement,
  type TagRect,
  type TagStage,
  type TwinTag,
} from "./tag-model.js";
import "./tags.css";

// -----------------------------------------------------------------------------
// TagLayer — the room notes, drawn over the walkthrough. Matterport's Mattertag,
// in the house's own language.
//
// WHAT THIS COMPONENT DOES NOT DO, AND WHY THE ABSENCES ARE THE DESIGN.
//
// It does no projection. Every position, scale, fade and rejection comes from
// tag-model.ts, which is pure and has no renderer in it. This component reads
// `visibility === "visible"` and draws. That split is why the maths is testable
// without a canvas, and why the one thing most likely to be silently wrong — the
// E57 axis convention — is pinned by a unit test rather than by a screenshot.
//
// It holds no camera and no raycast. The host owns both: only it can turn a
// frame into a `TagCamera`, and only it can sample the mesh for occlusion. This
// layer is handed the answers. That keeps the pick strategy free to change (no
// mesh today, a collider tomorrow) without touching a line of presentation.
//
// It is not a dialog and traps nothing. It floats over a live 3D view whose
// primary movement mechanic is clicking anywhere, so: the frame takes no pointer
// events and only the pins and the card take them back (enforced in tags.css,
// not merely intended here); focus is never stolen on arrival; and Escape closes
// the open card without the layer ever owning the key when nothing is open.
//
// WHAT HAPPENS TO A PIN THAT WOULD LAND UNDER THE HUD. It is not drawn. The
// model returns "under-hud" for it and this component filters it out with every
// other rejection. Nudging it aside was rejected outright: a pin moved off its
// anchor is a note pointing at the wrong part of a real building, which is the
// worst thing this product can do. The honest cost is recorded below rather
// than hidden.
//
// RESIDUAL, STATED PLAINLY. A dropped pin is also out of the tab order while it
// is dropped. For a pointer or touch user this is invisible — the smallest
// camera movement brings the anchor back out from under the chrome. For a
// keyboard-only user it means a note can be unreachable at one particular
// heading, and they must look around to recover it, exactly as they would to
// see the thing the note is about. Making every note reachable regardless of
// heading needs an index — a list of the notes in this room, opened from the
// quick-action rail — and that rail belongs to another module. This layer is
// built so that index is a small addition (it would call the same `placeTags`
// and open the same card through `openTagId`), not a rewrite.
// -----------------------------------------------------------------------------

/** 316px is the card's natural width; it narrows to the clear box on a landscape
 *  phone, where that box is only ~230px across. Kept here rather than in the
 *  stylesheet because `tagCardPosition` must clamp against the SAME number it is
 *  rendered at — a width set in CSS and a width used for clamping are two
 *  sources for one measurement, and they drift. */
const CARD_WIDTH_PX = 316;

/** The height the clamp assumes. The card's real height varies with its body and
 *  whether it carries media, and CSS caps it (`max-height`) with an internal
 *  scroll — so this is an upper bound the clamp can rely on, not a guess at the
 *  content. Clamping against a bound the element can never exceed is what keeps
 *  the card inside the proven-clear box without measuring the DOM. */
const CARD_HEIGHT_PX = 300;

/** The five glyphs. Stroke-only at 14px, matching the quick-action rail's icon
 *  treatment exactly — the same visual weight as the rest of the twin's chrome.
 *  Each one is the plainest reading of its category: a metaphor that needs
 *  explaining is decoration at this size. */
const KIND_GLYPHS: Readonly<Record<TagKind, ReactElement>> = {
  // A plug's two pins over a lead.
  power: (
    <svg
      className="vv-twin-tag-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden
    >
      <path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5" />
    </svg>
  ),
  // A speaker cone.
  av: (
    <svg
      className="vv-twin-tag-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden
    >
      <path d="M4 9h4l5-4v14l-5-4H4zM17 8a5 5 0 0 1 0 8" />
    </svg>
  ),
  // A doorway with its handle.
  access: (
    <svg
      className="vv-twin-tag-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden
    >
      <path d="M5 21V3h14v18M5 21h14M15 12h.01" />
    </svg>
  ),
  // A cloche — the service metaphor the venue's own trade uses.
  service: (
    <svg
      className="vv-twin-tag-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden
    >
      <path d="M3 18h18M4.5 18a7.5 7.5 0 0 1 15 0M12 7.5V6" />
    </svg>
  ),
  // A star: the thing in the room worth looking at.
  feature: (
    <svg
      className="vv-twin-tag-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden
    >
      <path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6.1L12 16.8 6.7 19.7l1.1-6.1L3.4 9.4l6-.8z" />
    </svg>
  ),
};

export interface TagLayerProps {
  /** Every note that exists. Filtering to this viewpoint is the model's job, so
   *  the host may pass the whole set without pre-selecting — and cannot
   *  accidentally pass a note the author did not place here. */
  readonly tags: readonly TwinTag[];
  /** The viewpoint the walk is standing at. Notes appear only where their author
   *  listed them; this is the key that lookup runs on. */
  readonly nodeId: string;
  /** The camera, as the model's six numbers. The host converts three's DEGREE
   *  fov to radians at this boundary. */
  readonly camera: TagCamera;
  /** The stage's size in CSS pixels — what the keep-out and clamp arithmetic
   *  needs. The host already measures this for its own layout. */
  readonly stage: TagStage;
  /** Which note is open, or null. CONTROLLED: the host owns it so the card can
   *  be opened from elsewhere (a future note index, or a deep link) and so
   *  arriving at a new viewpoint can close it. */
  readonly openTagId: string | null;
  /** Open a note, or close the open one with null. */
  readonly onOpenChange: (tagId: string | null) => void;
  /** Walk to a note's best viewpoint. Absent → no such button, ever; a control
   *  that cannot do what it says is worse than a missing one. */
  readonly onWalkTo?: (nodeId: string) => void;
  /** Distance to the first solid surface along the ray to each note, by tag id.
   *  Absent → no occlusion testing, which is the honest state with no mesh. */
  readonly occlusionDepthsM?: ReadonlyMap<string, number | null>;
  /** Live-measured HUD rects, when the host has them. Defaults to the table
   *  measured off the running route. */
  readonly hudRects?: readonly TagRect[];
}

export function TagLayer({
  tags,
  nodeId,
  camera,
  stage,
  openTagId,
  onOpenChange,
  onWalkTo,
  occlusionDepthsM,
  hudRects,
}: TagLayerProps): ReactElement | null {
  const placements = useMemo(
    () => placeTags(tags, nodeId, camera, stage, { occlusionDepthsM, hudRects }),
    [tags, nodeId, camera, stage, occlusionDepthsM, hudRects],
  );
  const drawable = useMemo(() => drawableTags(placements), [placements]);

  // The open note is looked up among ALL placements, not just the drawable ones.
  // A card must not vanish because the guest turned slightly and its pin slipped
  // under the minimap: the pin going is a placement decision, the card going
  // would be the interface forgetting what was asked of it.
  const openPlacement: TagPlacement | null =
    openTagId === null
      ? null
      : (placements.find((placement) => placement.tag.id === openTagId) ?? null);

  useEffect(() => {
    // The key listener exists only while a card is open. A window listener that
    // outlived its card would quietly swallow Escape for the fullscreen control
    // and the enquiry modal.
    if (openPlacement === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onOpenChange(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openPlacement, onOpenChange]);

  // Announced one tick after the region mounts, on purpose: a live region that
  // appears already carrying its text is silent in most screen readers, which
  // announce mutations to a region they were already watching.
  const countText = tagCountAnnouncement(drawable.length);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (countText === "") {
      setAnnouncement("");
      return;
    }
    const timer = window.setTimeout(() => {
      setAnnouncement(countText);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [countText]);

  // Nothing to draw and nothing open: render no group at all. An empty labelled
  // group is still a group — a screen reader would announce "Room notes" and
  // then find nothing inside it.
  if (drawable.length === 0 && openPlacement === null) {
    return null;
  }

  const box = tagCardClearBox(stage);
  const cardWidth = Math.min(CARD_WIDTH_PX, box.widthPx);
  const cardHeight = Math.min(CARD_HEIGHT_PX, box.heightPx);

  return (
    <div
      className="vv-twin-tags"
      role="group"
      aria-label={TAG_GROUP_LABEL}
      data-testid="twin-tags"
    >
      <p className="vv-sr-only" aria-live="polite" data-testid="twin-tags-live">
        {announcement}
      </p>

      {/* DOM order is paint order, and the model has already sorted these far
          first — so a near pin overlaps a far one rather than hiding behind it.
          The order is the model's guarantee, not this component's. */}
      {drawable.map((placement) => {
        const { tag } = placement;
        const isOpen = tag.id === openTagId;
        return (
          <button
            type="button"
            key={tag.id}
            className={isOpen ? "vv-twin-tag-pin vv-twin-tag-pin--open" : "vv-twin-tag-pin"}
            data-testid={`twin-tag-pin-${tag.id}`}
            aria-label={tagPinAria(TAG_KIND_LABELS[tag.kind], tag.title)}
            aria-expanded={isOpen}
            style={{
              left: `${String(placement.stageX * 100)}%`,
              top: `${String(placement.stageY * 100)}%`,
              // Read by tags.css. The scale rides the disc inside, never this
              // button, so the 44px hit target is the same at every distance.
              ["--vv-tag-scale" as string]: String(placement.scale),
              ["--vv-tag-opacity" as string]: String(placement.opacity),
            }}
            onClick={() => {
              // Pressing the open note's pin closes it — the same control, in
              // the same place, reversing itself.
              onOpenChange(isOpen ? null : tag.id);
            }}
          >
            <span className="vv-twin-tag-disc">
              <span className="vv-twin-tag-halo" aria-hidden />
              {KIND_GLYPHS[tag.kind]}
            </span>
          </button>
        );
      })}

      {openPlacement !== null && (
        <TagCard
          placement={openPlacement}
          stage={stage}
          widthPx={cardWidth}
          heightPx={cardHeight}
          nodeId={nodeId}
          onClose={() => {
            onOpenChange(null);
          }}
          onWalkTo={onWalkTo}
        />
      )}
    </div>
  );
}

interface TagCardProps {
  readonly placement: TagPlacement;
  readonly stage: TagStage;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly nodeId: string;
  readonly onClose: () => void;
  readonly onWalkTo?: (nodeId: string) => void;
}

function TagCard({
  placement,
  stage,
  widthPx,
  heightPx,
  nodeId,
  onClose,
  onWalkTo,
}: TagCardProps): ReactElement {
  const { tag } = placement;

  // Clamped into the box proven disjoint from every HUD rect. Both the position
  // and the width come from the model, so the rectangle the test asserts about
  // is the rectangle that renders.
  const position = tagCardPosition(placement.stageX, placement.stageY, widthPx, heightPx, stage);

  // Read at render, never cached: the visitor may toggle the OS setting
  // mid-session. Under the preference the card is rendered with its animation
  // removed, so it arrives already in its final state rather than being animated
  // quickly — the stylesheet cancels the keyframes too, and both halves are
  // needed (script alone would still leave the CSS animation to run).
  const reduced = prefersReducedMotion();

  const isExample = tag.provenance === "example";
  // The walk offer is real or absent — never a dead control. It needs a handler,
  // and it needs somewhere to go that is not where we already are.
  const canWalk = onWalkTo !== undefined && tag.bestViewedFrom !== nodeId;

  return (
    <div
      className="vv-twin-tag-card"
      data-testid="twin-tag-card"
      style={{
        left: `${String(position.xPx)}px`,
        top: `${String(position.yPx)}px`,
        width: `${String(widthPx)}px`,
        ...(reduced ? { animation: "none" } : {}),
      }}
    >
      <div className="vv-twin-tag-card-head">
        <p className="vv-twin-tag-eyebrow">
          {TAG_KIND_LABELS[tag.kind]}
          {/* The example badge sits in the header, beside the category, because
              it IS a statement about what kind of thing this is. Gated on
              provenance — there is no route through this component that renders
              an example body without both this badge and the disclosure below. */}
          {isExample && <span className="vv-twin-tag-badge">{TAG_EXAMPLE_BADGE}</span>}
        </p>
        <button
          type="button"
          className="vv-twin-tag-close"
          onClick={onClose}
          aria-label={TAG_CLOSE_LABEL}
          data-testid="twin-tag-close"
        >
          {/* A drawn cross, not the "×" character: the multiplication sign is
              read aloud as "times" by several screen readers, and the button's
              real name is on the aria-label above. */}
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="M5 5l14 14M19 5L5 19" />
          </svg>
        </button>
      </div>

      <h2 className="vv-twin-tag-title" data-testid="twin-tag-title">
        {tag.title}
      </h2>
      <p className="vv-twin-tag-body">{tag.body}</p>

      {tag.media !== undefined && tag.media.kind === "image" && (
        <img
          className="vv-twin-tag-media"
          src={tag.media.src}
          alt={tag.media.alt}
          loading="lazy"
          data-testid="twin-tag-image"
        />
      )}

      {tag.media !== undefined && tag.media.kind === "link" && (
        <a
          className="vv-twin-tag-link"
          href={tag.media.href}
          target="_blank"
          // noreferrer alongside noopener: the first is the security control,
          // the second stops the venue's own analytics being polluted by a
          // referrer from a walkthrough embedded on someone else's page.
          rel="noopener noreferrer"
          data-testid="twin-tag-link"
        >
          {tag.media.label}
        </a>
      )}

      {isExample && (
        <p className="vv-twin-tag-disclosure" data-testid="twin-tag-disclosure">
          {TAG_EXAMPLE_DISCLOSURE}
        </p>
      )}

      {canWalk && (
        <div className="vv-twin-tag-actions">
          <button
            type="button"
            className="vv-twin-tag-button"
            data-testid="twin-tag-walk"
            onClick={() => {
              // Narrowed by the `canWalk` alias above, the same way MeasureLayer
              // narrows through `canClear` — no optional call, which would only
              // hide a future refactor that broke the narrowing.
              onWalkTo(tag.bestViewedFrom);
            }}
          >
            {TAG_GO_TO_BEST_VIEW}
          </button>
        </div>
      )}
    </div>
  );
}
