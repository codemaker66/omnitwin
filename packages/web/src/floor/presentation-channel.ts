// ---------------------------------------------------------------------------
// Furniture presentation channel: how placed furniture is drawn while a
// reveal plays (the Grand Assembly).
//
// The placement store is the truth and nothing here writes it. A reveal
// publishes, each frame, how each piece is drawn relative to its placed
// transform; everything that draws furniture follows the same frame: the
// instanced models, the `furniture-<id>` groups (cloths, settings, name
// plates), the contact shadows and the candles. Publishing null releases the
// furniture and every follower redraws store truth exactly, so no frame of a
// reveal can ever be saved as a position.
//
// Followers keep their own record of what they drew presented, restore those
// slots when a piece leaves the frame, and apply the current frame whenever
// they rebuild (a pool that grows, a template that resolves late).
// ---------------------------------------------------------------------------

import { Matrix4 } from "three";

/** One piece as a reveal draws it this frame. */
export interface PresentedPiece {
  /** Whether it is drawn at all this frame. */
  visible: boolean;
  /** Drawn = delta · placed, in world space (the identity draws it as placed). */
  readonly delta: Matrix4;
  /** Its contact shadow: where on the floor and turned how... */
  shadowX: number;
  shadowZ: number;
  shadowYaw: number;
  /** ...how dark, 0 to 1 of its placed darkness, and how far it spreads (1 as placed). */
  shadow: number;
  shadowSpread: number;
  /** The candles on a table: wax height, flame and their light, each 0 (none yet) to 1 (as placed). */
  wax: number;
  flame: number;
  glow: number;
}

export interface PresentationFrame {
  readonly pieces: ReadonlyMap<string, PresentedPiece>;
  /**
   * How pieces missing from `pieces` are drawn: as placed, or not at all
   * (the empty room a reveal starts from, held while the room loads).
   */
  readonly others: "placed" | "hidden";
}

export type PresentationListener = (frame: PresentationFrame | null) => void;

const listeners = new Set<PresentationListener>();
let current: PresentationFrame | null = null;

/** Draw this frame, or release the furniture to store truth with null. */
export function publishFurniturePresentation(frame: PresentationFrame | null): void {
  if (frame === null && current === null) return;
  current = frame;
  for (const listener of listeners) listener(frame);
}

/** The frame in force, for a follower that has just (re)built its buffers. */
export function currentFurniturePresentation(): PresentationFrame | null {
  return current;
}

export function subscribeFurniturePresentation(listener: PresentationListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A matrix that draws nothing: every vertex at one point far below the floor. */
export const HIDDEN_MATRIX: Readonly<Matrix4> = new Matrix4().makeScale(0, 0, 0).setPosition(0, -60, 0);

/**
 * How a frame draws the piece `id`: the presented piece, "hidden", or null
 * for as placed.
 */
export function presentedPiece(frame: PresentationFrame, id: string): PresentedPiece | "hidden" | null {
  const piece = frame.pieces.get(id);
  if (piece !== undefined) return piece.visible ? piece : "hidden";
  return frame.others === "hidden" ? "hidden" : null;
}

/** A presented piece drawn exactly as placed, for tests and holds. */
export function placedPresentation(): PresentedPiece {
  return {
    visible: true, delta: new Matrix4(), shadowX: 0, shadowZ: 0, shadowYaw: 0, shadow: 1, shadowSpread: 1,
    wax: 1, flame: 1, glow: 1,
  };
}
