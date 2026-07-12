// CARD A2 (G1b) — "the room resolves" (01 §13, 02 §6 signature move 1).
// Pure model for the planner's load choreography: blueprint ink paints first,
// the captured splat develops over it coarse-to-fine, and a quiet caption
// reports honest chunk progress. No spinner anywhere; the scene itself is
// the state. Kept pure so the phase machine and copy are unit-testable.

export type RoomResolvePhase = "ink" | "developing" | "resolved" | "fallback";

export interface RoomResolveInput {
  /** Registry resolution status from useRoomRuntimeSplat. "idle" is a
   *  declared-but-never-set member of that union today; it maps to the
   *  settled no-asset state, same as "none". */
  readonly splatStatus: "idle" | "none" | "loading" | "loaded";
  /** Whether a usable captured layer (≥1 valid chunk URL) is mounted. */
  readonly hasAsset: boolean;
  readonly totalChunks: number;
  readonly loadedChunks: number;
  /** Chunks whose decode failed permanently. They count toward settling the
   *  phase (a dead chunk must never wedge the caption open) while the ink
   *  layer honestly persists over the region they would have covered. */
  readonly failedChunks?: number;
}

export function roomResolvePhase(input: RoomResolveInput): RoomResolvePhase {
  if (input.splatStatus === "loading") return "ink";
  if (input.hasAsset && input.totalChunks > 0) {
    const settledChunks = input.loadedChunks + (input.failedChunks ?? 0);
    return settledChunks >= input.totalChunks ? "resolved" : "developing";
  }
  return "fallback";
}

/**
 * Quiet caption for the developing phase only. Progress is real chunk
 * arrivals — the runtime-package schema carries no per-chunk byte sizes, so
 * any MB total would be fabricated and is deliberately absent.
 */
export function roomResolveCaption(
  phase: RoomResolvePhase,
  roomName: string | null,
  loadedChunks: number,
  totalChunks: number,
): string | null {
  if (phase !== "developing") return null;
  const progress = `${String(loadedChunks)} of ${String(totalChunks)} chunks`;
  return roomName !== null && roomName.length > 0
    ? `Loading captured room · ${roomName} · ${progress}`
    : `Loading captured room · ${progress}`;
}

export interface InkTargetInput {
  /** Whether the captured splat layer is mounted and allowed by layer mode. */
  readonly splatActive: boolean;
  readonly loadedChunks: number;
  readonly totalChunks: number;
}

/**
 * Where the blueprint ink should settle: full ink whenever no captured layer
 * is developing (atelier fallback, mesh-only mode, registry still resolving),
 * receding proportionally as chunks arrive so the linework hands the room
 * over to the capture coarse-to-fine.
 */
export function inkTargetOpacity(input: InkTargetInput): number {
  if (!input.splatActive || input.totalChunks <= 0) return 1;
  const coverage = Math.min(Math.max(input.loadedChunks / input.totalChunks, 0), 1);
  return 1 - coverage;
}

// Motion constants (02 §6): caption sits in the Deliberate tier; exits are
// snappier than entries; reduced motion collapses to the mandated 120 ms fade.
export const ROOM_RESOLVE_CAPTION_ENTER_MS = 240;
export const ROOM_RESOLVE_CAPTION_EXIT_MS = 160;
export const ROOM_RESOLVE_REDUCED_MOTION_MS = 120;
