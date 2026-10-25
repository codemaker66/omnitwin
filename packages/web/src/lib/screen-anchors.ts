// ---------------------------------------------------------------------------
// Points in the room that the chrome follows on screen (T-671 slice 11′; the
// approved spec §6.6 "Following"). The caption registers its piece's point
// and a writer; ScreenAnchors, inside the canvas, projects every registered
// point once a frame through the live camera and hands each writer its
// screen pixels. Writers set CSS variables on their own nodes, so following
// costs no React render, and the anchor has no spring of its own: the camera
// is already smoothed.
// ---------------------------------------------------------------------------

export type WorldPoint = readonly [number, number, number];

export interface ScreenPoint {
  /** Pixels from the canvas's left edge. */
  readonly x: number;
  /** Pixels from the canvas's top edge. */
  readonly y: number;
  /** In front of the camera and inside the view. */
  readonly visible: boolean;
}

interface Anchor {
  readonly world: () => WorldPoint | null;
  readonly write: (point: ScreenPoint) => void;
}

const HIDDEN: ScreenPoint = { x: 0, y: 0, visible: false };
const anchors = new Map<string, Anchor>();
/** The canvas draws on demand; this asks it for a frame (set by ScreenAnchors while it is mounted). */
let frame: (() => void) | null = null;

/** ScreenAnchors hands over the canvas's invalidate; the returned function takes it back. */
export function setScreenAnchorFrame(next: () => void): () => void {
  frame = next;
  return () => {
    if (frame === next) frame = null;
  };
}

/** One frame, so anchors (and anything the chrome just changed in the room) are drawn now. */
export function requestScreenAnchorFrame(): void {
  frame?.();
}

/**
 * Follows `world()` on screen until the returned function is called. A newer
 * registration under the same id replaces the older, and the older one
 * leaving does not remove it.
 */
export function registerScreenAnchor(id: string, world: () => WorldPoint | null, write: (point: ScreenPoint) => void): () => void {
  const anchor: Anchor = { world, write };
  anchors.set(id, anchor);
  // A still camera draws no frame of its own: ask for one so the anchor is placed at once.
  frame?.();
  return () => {
    if (anchors.get(id) === anchor) anchors.delete(id);
  };
}

export function screenAnchorCount(): number {
  return anchors.size;
}

/** Once a frame, from inside the canvas: each anchor's point through the camera to its writer. */
export function projectScreenAnchors(project: (world: WorldPoint) => ScreenPoint): void {
  for (const anchor of anchors.values()) {
    const world = anchor.world();
    anchor.write(world === null ? HIDDEN : project(world));
  }
}
