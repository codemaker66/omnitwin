// CARD A2 (G1b) — "the room resolves" (01 §13, 02 §6 signature move 1).
// Pure model for the planner's load choreography: blueprint ink paints first,
// the captured splat develops over it coarse-to-fine, and a quiet caption
// reports honest chunk progress. No spinner anywhere; the scene itself is
// the state. Kept pure so the phase machine and copy are unit-testable.

export type RoomResolvePhase = "ink" | "developing" | "resolved" | "fallback" | "degraded" | "unavailable";

export type CaptureAvailability = "pending" | "available" | "degraded" | "unavailable";

/** Only explicitly identified environment sources are excluded. Registered
 * packages without role metadata keep every source as possible room content. */
export function captureAvailability(input: {
  readonly urls: readonly string[];
  readonly environmentUrls: readonly string[];
  readonly loadedUrls: ReadonlySet<string>;
  readonly failedUrls: ReadonlySet<string>;
}): CaptureAvailability {
  const environment = new Set(input.environmentUrls);
  const content = [...new Set(input.urls)].filter((url) => !environment.has(url));
  if (content.length === 0) return "unavailable";
  const loaded = content.filter((url) => input.loadedUrls.has(url)).length;
  const failed = content.filter((url) => !input.loadedUrls.has(url) && input.failedUrls.has(url)).length;
  if (failed === content.length) return "unavailable";
  if (loaded + failed < content.length) return "pending";
  return failed > 0 ? "degraded" : "available";
}

export interface RoomResolveInput {
  /** Registry resolution status from useRoomRuntimeSplat. "idle" is a
   *  declared-but-never-set member of that union today; it maps to the
   *  settled no-asset state, same as "none". */
  readonly splatStatus: "idle" | "none" | "loading" | "loaded";
  /** Whether a usable captured layer (≥1 valid chunk URL) is mounted. */
  readonly hasAsset: boolean;
  readonly totalChunks: number;
  readonly loadedChunks: number;
  /** Permanently failed chunks count toward settling the pending phase.
   * Global ink opacity does not describe which physical regions are absent. */
  readonly failedChunks?: number;
  readonly captureAvailability?: CaptureAvailability;
}

export function roomResolvePhase(input: RoomResolveInput): RoomResolvePhase {
  if (input.captureAvailability === "unavailable" && input.totalChunks > 0) return "unavailable";
  if (input.splatStatus === "loading") return "ink";
  if (input.hasAsset && input.totalChunks > 0) {
    const settledChunks = input.loadedChunks + (input.failedChunks ?? 0);
    if (settledChunks < input.totalChunks) return "developing";
    return input.captureAvailability === "degraded" ? "degraded" : "resolved";
  }
  return "fallback";
}

/**
 * Pending captions report real chunk arrivals. Terminal failure captions
 * persist without working motion. No per-chunk byte sizes are available.
 */
export function roomResolveCaption(
  phase: RoomResolvePhase,
  roomName: string | null,
  loadedChunks: number,
  totalChunks: number,
): string | null {
  if (phase === "unavailable") return "Room capture could not load. You can continue planning in Model view.";
  if (phase === "degraded") return "Part of the room capture could not load. Model view remains available for planning.";
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
