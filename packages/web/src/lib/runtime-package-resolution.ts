import {
  TRADES_HALL_RUNTIME_ROOMS as SHARED_TRADES_HALL_RUNTIME_ROOMS,
  type AssetEvidenceStatus,
  type RuntimePackage,
  type TradesHallRuntimeRoomSlug,
} from "@omnitwin/types";
import { parseRuntimeSplatUrl } from "./runtime-visual-asset.js";
import { deriveRoomCamera, roomSplatBundle, roomSplatTileUrls } from "../data/room-splat-bundles.js";

// ---------------------------------------------------------------------------
// Runtime asset decision for /dev/trades-hall-visual.
//
// The visual route uses the latest usable RuntimePackage for the selected
// venue/room. Every URL is revalidated in the browser before Spark sees it,
// even if it came from the API, so polluted registry rows fall back to the
// procedural scene.
// ---------------------------------------------------------------------------

export type { TradesHallRuntimeRoomSlug } from "@omnitwin/types";

export const TRADES_HALL_RUNTIME_ROOMS = SHARED_TRADES_HALL_RUNTIME_ROOMS.map((room) => ({
  slug: room.slug,
  label: room.displayName,
  sourceHint: room.primaryCaptureSource,
})) satisfies readonly {
  readonly slug: TradesHallRuntimeRoomSlug;
  readonly label: string;
  readonly sourceHint: string;
}[];
/**
 * Where a mounted captured layer came from.
 *
 * - `package`: a registered, immutable RuntimePackage. Authoritative.
 * - `staged`: tiles staged from a capture and described by the generated
 *   manifest, with no registry row yet. Real captured geometry, but it has not
 *   been through registration, so it must never present as reviewed.
 * - `none`: no captured layer; the procedural scene stands.
 */
export type RuntimeAssetSource = "package" | "staged" | "none";

export interface RuntimeRoomTarget {
  readonly venue: string;
  readonly room: TradesHallRuntimeRoomSlug;
  readonly roomLabel: string;
  readonly sourceHint: string;
  readonly error: string | null;
}

export interface RuntimeAssetDecision {
  readonly splatUrl: string | null;
  readonly splatUrls: readonly string[];
  readonly source: RuntimeAssetSource;
  readonly evidenceStatus: AssetEvidenceStatus | null;
  readonly evidenceLabel: string;
  readonly isProceduralFallback: boolean;
}

export interface RuntimeAssetViewTransform {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly scale: number;
  readonly note: string;
}

export interface RuntimeAssetCameraBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface RuntimeAssetCameraView {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly arrivalPosition: readonly [number, number, number] | null;
  readonly arrivalTarget: readonly [number, number, number] | null;
  readonly arrivalDurationMs: number;
  readonly fov: number;
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly panSpeed: number;
  readonly rotateSpeed: number;
  readonly zoomSpeed: number;
  readonly dampingFactor: number;
  readonly minPolarAngle: number;
  readonly maxPolarAngle: number;
  readonly targetBounds: RuntimeAssetCameraBounds | null;
  readonly cameraBounds: RuntimeAssetCameraBounds | null;
  readonly note: string;
}

const DEFAULT_VENUE = "trades-hall";
const DEFAULT_ROOM: TradesHallRuntimeRoomSlug = "grand-hall";
const IDENTITY_RUNTIME_ASSET_VIEW_TRANSFORM: RuntimeAssetViewTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
  note: "No room-specific runtime transform is registered.",
};

const DEFAULT_RUNTIME_ASSET_CAMERA_VIEW: RuntimeAssetCameraView = {
  position: [0, 20, 22],
  target: [0, 1.8, 0],
  arrivalPosition: null,
  arrivalTarget: null,
  arrivalDurationMs: 0,
  fov: 42,
  minDistance: 1.5,
  maxDistance: 34,
  panSpeed: 0.8,
  rotateSpeed: 1,
  zoomSpeed: 1,
  dampingFactor: 0.14,
  minPolarAngle: 0,
  maxPolarAngle: Math.PI * 0.49,
  targetBounds: null,
  cameraBounds: null,
  note: "Generic runtime asset overview camera.",
};
function slugIsSafe(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function roomForSlug(slug: string): (typeof TRADES_HALL_RUNTIME_ROOMS)[number] | null {
  return TRADES_HALL_RUNTIME_ROOMS.find((room) => room.slug === slug) ?? null;
}

export function runtimeRoomTargetFromSearchParams(searchParams: URLSearchParams): RuntimeRoomTarget {
  const rawVenue = searchParams.get("venue")?.trim() ?? DEFAULT_VENUE;
  const rawRoom = searchParams.get("room")?.trim() ?? DEFAULT_ROOM;

  const room = roomForSlug(rawRoom);
  if (!slugIsSafe(rawVenue)) {
    const fallbackRoom = roomForSlug(DEFAULT_ROOM);
    return {
      venue: DEFAULT_VENUE,
      room: DEFAULT_ROOM,
      roomLabel: fallbackRoom?.label ?? "Grand Hall",
      sourceHint: fallbackRoom?.sourceHint ?? "runpod",
      error: "Unsupported venue query; showing procedural planning context.",
    };
  }
  if (room === null) {
    const fallbackRoom = roomForSlug(DEFAULT_ROOM);
    return {
      venue: rawVenue,
      room: DEFAULT_ROOM,
      roomLabel: fallbackRoom?.label ?? "Grand Hall",
      sourceHint: fallbackRoom?.sourceHint ?? "runpod",
      error: "Unsupported room query; showing procedural planning context.",
    };
  }

  return {
    venue: rawVenue,
    room: room.slug,
    roomLabel: room.label,
    sourceHint: room.sourceHint,
    error: null,
  };
}

export function evidenceStatusLabel(status: AssetEvidenceStatus): string {
  switch (status) {
    case "unverified":
      return "Runtime asset loaded, not yet verified/signed.";
    case "machine_checked":
      return "Runtime asset loaded, machine checked; human review required.";
    case "human_reviewed":
      return "Runtime asset loaded, human reviewed.";
    case "rejected":
      return "Runtime asset rejected in review — not loaded";
  }
}

// The planner's honest no-splat state (01 §13): the atelier fallback is a
// designed state, not an apology. One canonical string, shared by the cockpit
// store default and the chip label derivation below.
export const CAPTURED_LAYER_FALLBACK_STATUS =
  "Captured visual layer not yet available — planning on reviewed geometry";

/**
 * Copy for a staged-but-unregistered capture.
 *
 * Says exactly what it is. These are real captured tiles, but no registry row
 * vouches for them and no human has signed the alignment, so the chip must not
 * borrow the language of a reviewed asset.
 */
export const STAGED_CAPTURE_STATUS =
  "Captured layer staged from source — not yet registered or alignment-reviewed";

/**
 * Planner top-bar chip copy, derived from the runtime asset decision: the
 * evidence-state label while a captured layer is mounted, the atelier
 * fallback copy otherwise. The chip stays sourced from claim/evidence data —
 * never component-local strings.
 */
export function plannerRuntimeChipLabel(decision: RuntimeAssetDecision): string {
  return decision.isProceduralFallback ? CAPTURED_LAYER_FALLBACK_STATUS : decision.evidenceLabel;
}

/**
 * The room-local transform for the captured layer that is actually mounted.
 *
 * `source` is required, and that is the point: a transform belongs to the ASSET,
 * not to the room. The staged transform is derived from one particular XGRIDS
 * walk and is meaningless for any other asset — applying it to a registered
 * package would place a reviewed asset using an unrelated capture's origin.
 * Only `staged` gets the derived transform; a registered package carries its own
 * alignment, and anything else keeps identity.
 */
export function runtimeAssetViewTransformForRoom(
  room: TradesHallRuntimeRoomSlug,
  source: RuntimeAssetSource,
): RuntimeAssetViewTransform {
  if (source !== "staged") return IDENTITY_RUNTIME_ASSET_VIEW_TRANSFORM;
  const bundle = roomSplatBundle(room);
  if (bundle === null) return IDENTITY_RUNTIME_ASSET_VIEW_TRANSFORM;
  return {
    position: bundle.transform.position,
    rotation: bundle.transform.rotation,
    scale: bundle.transform.scale,
    note: bundle.alignmentNote,
  };
}

/**
 * The inspection camera for the captured layer that is actually mounted.
 *
 * Framed from the staged capture's measured extent, which is only meaningful
 * when that capture is what is on screen — hence the required `source`. The
 * staged transform centres the room on the origin with its floor at y = 0, so
 * the framing follows from size alone. Any other source keeps the generic
 * overview camera.
 */
export function runtimeAssetCameraViewForRoom(
  room: TradesHallRuntimeRoomSlug,
  source: RuntimeAssetSource,
): RuntimeAssetCameraView {
  if (source !== "staged") return DEFAULT_RUNTIME_ASSET_CAMERA_VIEW;
  const bundle = roomSplatBundle(room);
  if (bundle === null) return DEFAULT_RUNTIME_ASSET_CAMERA_VIEW;

  const camera = deriveRoomCamera(bundle.extentM);
  const height = bundle.extentM[1];
  return {
    position: camera.position,
    target: camera.target,
    arrivalPosition: [camera.position[0], camera.position[1], camera.position[2] * 1.08],
    arrivalTarget: camera.target,
    arrivalDurationMs: 1400,
    fov: camera.fov,
    minDistance: camera.minDistance,
    maxDistance: camera.maxDistance,
    panSpeed: 0.16,
    rotateSpeed: 0.36,
    zoomSpeed: 0.32,
    dampingFactor: 0.14,
    minPolarAngle: Math.PI * 0.14,
    maxPolarAngle: Math.PI * 0.48,
    targetBounds: camera.targetBounds,
    cameraBounds: {
      min: [camera.targetBounds.min[0] * 1.2, 0.6, -camera.maxDistance],
      max: [camera.targetBounds.max[0] * 1.2, Math.max(1.2, height * 0.95), camera.maxDistance],
    },
    note: bundle.alignmentNote,
  };
}

function usablePackageUrl(published: RuntimePackage): string | null {
  if (published.runtimeStatus !== "internal_ready" && published.runtimeStatus !== "published") return null;
  const asset = published.primaryVisualAssetVersion;
  if (asset === null) return null;
  if (asset.assetKind !== "splat" || asset.runtimeStatus !== "usable") return null;
  if (published.primaryVisualAssetUrl === null) return null;

  const parsed = parseRuntimeSplatUrl(published.primaryVisualAssetUrl);
  return parsed.ok ? parsed.url : null;
}

function usablePackageUrls(published: RuntimePackage, primaryUrl: string): readonly string[] {
  const declaredUrls = Array.isArray(published.visualAssetUrls) ? published.visualAssetUrls : [];
  const urls = declaredUrls.length > 0 ? declaredUrls : [primaryUrl];
  const usable = urls
    .map((url) => parseRuntimeSplatUrl(url))
    .flatMap((parsed) => parsed.ok && parsed.url !== null ? [parsed.url] : []);
  return Array.from(new Set(usable));
}

export interface RuntimeAssetOptions {
  /** The room, so staged tiles can be found when allowed. */
  readonly room?: TradesHallRuntimeRoomSlug | null;
  /**
   * Whether staged-but-unregistered tiles may mount.
   *
   * Off by default. A surface that opts in takes on one obligation: the
   * decision's evidenceLabel (STAGED_CAPTURE_STATUS) must reach the person
   * looking at the room, unedited — staged tiles are real measured capture,
   * but nothing has reviewed them, and the label is what carries that truth.
   *
   * Who opts in: internal review surfaces (seeing the capture is their point),
   * the public walkthrough, and — since the Stage programme's S1 — the
   * planner, which plans inside the captured room under the staged chip.
   * Surfaces that render without a visible label keep the default.
   */
  readonly allowStagedCapture?: boolean;
}

/**
 * Chooses the captured layer for a room.
 *
 * A registered package always wins: it is immutable and carries a reviewed
 * evidence state. Failing that, tiles staged from the capture are used so the
 * room can actually be seen and worked on before registration — but they are
 * reported as `staged` and labelled as unregistered, never as reviewed.
 */
export function decideRuntimeAsset(
  _manualUrl: string | null,
  published: RuntimePackage | null,
  options: RuntimeAssetOptions = {},
): RuntimeAssetDecision {
  void _manualUrl;
  if (published !== null) {
    const packageUrl = usablePackageUrl(published);
    if (packageUrl !== null) {
      const packageUrls = usablePackageUrls(published, packageUrl);
      if (packageUrls.length === 0) {
        return {
          splatUrl: null,
          splatUrls: [],
          source: "none",
          evidenceStatus: null,
          evidenceLabel: "No real asset loaded yet",
          isProceduralFallback: true,
        };
      }
      return {
        splatUrl: packageUrl,
        splatUrls: packageUrls,
        source: "package",
        evidenceStatus: published.evidenceStatus,
        evidenceLabel: evidenceStatusLabel(published.evidenceStatus),
        isProceduralFallback: false,
      };
    }
  }

  const room = options.room ?? null;
  const stagedUrls = room === null || options.allowStagedCapture !== true
    ? []
    : roomSplatTileUrls(room, import.meta.env.VITE_SPLAT_BASE_URL);
  if (stagedUrls.length > 0) {
    const firstUrl = stagedUrls[0] ?? null;
    return {
      splatUrl: firstUrl,
      splatUrls: stagedUrls,
      source: "staged",
      evidenceStatus: null,
      evidenceLabel: STAGED_CAPTURE_STATUS,
      isProceduralFallback: false,
    };
  }

  return {
    splatUrl: null,
    splatUrls: [],
    source: "none",
    evidenceStatus: null,
    evidenceLabel: "No real asset loaded yet",
    isProceduralFallback: true,
  };
}
