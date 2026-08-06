import {
  TRADES_HALL_RUNTIME_ROOMS as SHARED_TRADES_HALL_RUNTIME_ROOMS,
  type AssetEvidenceStatus,
  type RuntimePackage,
  type TradesHallRuntimeRoomSlug,
} from "@omnitwin/types";
import { parseRuntimeSplatUrl } from "./runtime-visual-asset.js";

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
export type RuntimeAssetSource = "package" | "none";

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

// Temporary view transform for the Reception Room XGRIDS/SOG room chunks.
// Reception Room.lcc2 root bounds:
// min [-16.8106313, -19.0330453, -6.1218724]
// max [11.5081897, 32.2435517, 3.4532032].
// This rotates Z-up into Three's Y-up scene, scales the manifest room chunks
// into the planner camera frame, and lifts the lowest source Z to the stage
// floor. It is not a signed room-local alignment.
// Move this into RuntimePackage manifest metadata once room transforms are
// reviewed and signed.
const RECEPTION_ROOM_XGRIDS_VIEW_TRANSFORM: RuntimeAssetViewTransform = {
  position: [1.11, 2.57, 2.77],
  rotation: [-Math.PI / 2, 0, 0],
  scale: 0.63,
  note: "Approximate XGRIDS SOG view transform; visual QA and signed room-local alignment still required.",
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
const RECEPTION_ROOM_XGRIDS_CAMERA_VIEW: RuntimeAssetCameraView = {
  position: [0.2, 6.2, 13.4],
  target: [0, 0.9, -4.15],
  arrivalPosition: [0.25, 7.15, 14.1],
  arrivalTarget: [0, 1.2, -4],
  arrivalDurationMs: 1400,
  fov: 48,
  minDistance: 1.2,
  maxDistance: 13.5,
  panSpeed: 0.16,
  rotateSpeed: 0.36,
  zoomSpeed: 0.32,
  dampingFactor: 0.14,
  minPolarAngle: Math.PI * 0.14,
  maxPolarAngle: Math.PI * 0.48,
  targetBounds: {
    min: [-5.8, 0.7, -9.2],
    max: [5.8, 2.35, 4.8],
  },
  cameraBounds: {
    min: [-6.8, 1.4, -11.8],
    max: [6.8, 7.4, 14.2],
  },
  note: "Reception Room uses a restrained interior cinematic inspection camera; approximate until signed alignment lands.",
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
 * Planner top-bar chip copy, derived from the runtime asset decision: the
 * evidence-state label while a captured layer is mounted, the atelier
 * fallback copy otherwise. The chip stays sourced from claim/evidence data —
 * never component-local strings.
 */
export function plannerRuntimeChipLabel(decision: RuntimeAssetDecision): string {
  return decision.isProceduralFallback ? CAPTURED_LAYER_FALLBACK_STATUS : decision.evidenceLabel;
}

export function runtimeAssetViewTransformForRoom(room: TradesHallRuntimeRoomSlug): RuntimeAssetViewTransform {
  if (room === "reception-room") return RECEPTION_ROOM_XGRIDS_VIEW_TRANSFORM;
  return IDENTITY_RUNTIME_ASSET_VIEW_TRANSFORM;
}

export function runtimeAssetCameraViewForRoom(room: TradesHallRuntimeRoomSlug): RuntimeAssetCameraView {
  if (room === "reception-room") return RECEPTION_ROOM_XGRIDS_CAMERA_VIEW;
  return DEFAULT_RUNTIME_ASSET_CAMERA_VIEW;
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

interface Lcc2ChunkAddress {
  readonly depth: number;
  readonly format: "sog" | "spz";
  readonly identity: string;
  readonly url: string;
}

type Lcc2ChunkAddressResult =
  | { readonly kind: "chunk"; readonly chunk: Lcc2ChunkAddress }
  | { readonly kind: "malformed" }
  | { readonly kind: "not_lcc2" };

// RuntimeHierarchyNodeRangeV1 uses a root node named `0`. Requiring that root
// here avoids treating ordinary numeric tile names such as 12_34.sog as LCC2.
const LCC2_CHUNK_FILE_NAME = /^(0(?:_(?:0|[1-9]\d*))+?)\.(sog|spz)$/iu;

function lcc2ChunkAddress(url: string): Lcc2ChunkAddressResult {
  let parsed: URL;
  try {
    parsed = new URL(url, "https://venviewer.local");
  } catch {
    return { kind: "malformed" };
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return { kind: "malformed" };
  }

  const separator = pathname.lastIndexOf("/");
  const fileName = pathname.slice(separator + 1);
  const lowerFileName = fileName.toLowerCase();
  const isSogOrSpz = lowerFileName.endsWith(".sog") || lowerFileName.endsWith(".spz");
  const match = LCC2_CHUNK_FILE_NAME.exec(fileName);
  if (match === null) {
    // A file beginning with the canonical LCC2 root prefix is intended to be
    // a hierarchy chunk. Fail closed if it is malformed. Other names,
    // including ordinary numeric tiles, are not reinterpreted as LCC2.
    return isSogOrSpz && /^0_/u.test(fileName)
      ? { kind: "malformed" }
      : { kind: "not_lcc2" };
  }

  const nodePath = match[1];
  const format = match[2]?.toLowerCase();
  if (nodePath === undefined || (format !== "sog" && format !== "spz")) {
    return { kind: "malformed" };
  }

  return {
    kind: "chunk",
    chunk: {
      depth: nodePath.split("_").length - 1,
      format,
      // The production API deliberately gives each asset its own
      // /runtime-assets/{assetVersionId}/ directory. Logical chunk identity is
      // therefore the format plus node path, not its delivery URL directory
      // or query string.
      identity: `${format}|${nodePath}`,
      url,
    },
  };
}

/**
 * Validate one already-declared LCC2 SOG/SPZ frontier.
 *
 * LCC2 node paths encode hierarchy depth in underscore-separated numeric
 * segments (for example 0_0, 0_1_0, and 0_1_0_5). Chunks from different
 * depths are replacement levels, not additive layers. A URL filename cannot
 * prove that every chunk needed for a deeper level is present, so this
 * function never tries to repair a mixed-level package by keeping only its
 * deepest filenames. Mixed levels fail closed. A reviewed package must
 * declare only the complete, non-overlapping frontier it intends to mount.
 * The declared order is preserved for deterministic loading.
 *
 * An empty result means the URL set looked like an LCC2 family but was
 * ambiguous or malformed. A wholly non-LCC2 multi-file scene is unchanged.
 */
export function selectNonOverlappingLcc2UrlFrontier(
  urls: readonly string[],
): readonly string[] {
  const parsed = urls.map(lcc2ChunkAddress);
  const chunks = parsed.flatMap((result) => result.kind === "chunk" ? [result.chunk] : []);
  if (chunks.length === 0) {
    return parsed.some((result) => result.kind === "malformed") ? [] : [...urls];
  }

  // A numeric LCC2 family mixed with an ordinary/malformed member, another
  // format, another hierarchy level, or the same logical chunk behind two
  // delivery URLs is not a proven frontier. The viewer falls back instead of
  // rendering a partial or overlapping room. Delivery directories may differ
  // because the API serves each asset under its own immutable version id.
  if (chunks.length !== parsed.length) return [];
  const format = chunks[0]?.format;
  if (format === undefined || chunks.some((chunk) => chunk.format !== format)) return [];
  if (new Set(chunks.map((chunk) => chunk.identity)).size !== chunks.length) return [];
  if (new Set(chunks.map((chunk) => chunk.depth)).size !== 1) return [];
  return chunks.map((chunk) => chunk.url);
}

function usablePackageUrls(published: RuntimePackage, primaryUrl: string): readonly string[] {
  const declaredUrls = Array.isArray(published.visualAssetUrls) ? published.visualAssetUrls : [];
  const declaredIds = published.manifestJson.assets.visualAssetVersionIds;

  // A declared multi-file visual is one atomic scene. Rendering a surviving
  // subset can create holes or, for replacement LoD trees, overlap the wrong
  // levels. Require one valid, unique URL for every exact manifest member and
  // require the primary URL to be part of that same set.
  if (declaredIds !== undefined) {
    if (declaredUrls.length !== declaredIds.length) return [];

    const urls: string[] = [];
    const seen = new Set<string>();
    for (const url of declaredUrls) {
      const parsed = parseRuntimeSplatUrl(url);
      if (!parsed.ok || parsed.url === null || seen.has(parsed.url)) return [];
      seen.add(parsed.url);
      urls.push(parsed.url);
    }
    if (!seen.has(primaryUrl)) return [];
    return selectNonOverlappingLcc2UrlFrontier(urls);
  }

  // Legacy manifests name only one primary asset. Do not let an undeclared
  // URL list silently broaden that package's membership in the browser.
  if (declaredUrls.length === 0) return [primaryUrl];
  if (declaredUrls.length !== 1) return [];
  const parsed = parseRuntimeSplatUrl(declaredUrls[0]);
  return parsed.ok && parsed.url === primaryUrl ? [primaryUrl] : [];
}

export function decideRuntimeAsset(
  _manualUrl: string | null,
  published: RuntimePackage | null,
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
        splatUrl: packageUrls[0] ?? packageUrl,
        splatUrls: packageUrls,
        source: "package",
        evidenceStatus: published.evidenceStatus,
        evidenceLabel: evidenceStatusLabel(published.evidenceStatus),
        isProceduralFallback: false,
      };
    }
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
