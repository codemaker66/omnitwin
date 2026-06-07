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
// Manual URL is an explicit internal override. Otherwise the page uses the
// latest usable RuntimePackage for the selected venue/room. Every URL is
// revalidated in the browser before Spark sees it, even if it came from the
// API, so polluted registry rows fall back to the procedural scene.
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
export type RuntimeAssetSource = "manual" | "package" | "none";

export interface RuntimeRoomTarget {
  readonly venue: string;
  readonly room: TradesHallRuntimeRoomSlug;
  readonly roomLabel: string;
  readonly sourceHint: string;
  readonly error: string | null;
}

export interface RuntimeAssetDecision {
  readonly splatUrl: string | null;
  readonly source: RuntimeAssetSource;
  readonly evidenceStatus: AssetEvidenceStatus | null;
  readonly evidenceLabel: string;
  readonly isProceduralFallback: boolean;
}

const DEFAULT_VENUE = "trades-hall";
const DEFAULT_ROOM: TradesHallRuntimeRoomSlug = "grand-hall";

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
      return "Runtime asset loaded, not yet verified/signed";
    case "machine_checked":
      return "Runtime asset loaded, machine checked; human review required";
    case "human_reviewed":
      return "Runtime asset loaded, human reviewed";
    case "rejected":
      return "Runtime asset rejected in review — not loaded";
  }
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

export function decideRuntimeAsset(
  manualUrl: string | null,
  published: RuntimePackage | null,
): RuntimeAssetDecision {
  if (manualUrl !== null && manualUrl.length > 0) {
    return {
      splatUrl: manualUrl,
      source: "manual",
      evidenceStatus: null,
      evidenceLabel: "Runtime asset URL mounted manually; human review required",
      isProceduralFallback: false,
    };
  }

  if (published !== null) {
    const packageUrl = usablePackageUrl(published);
    if (packageUrl !== null) {
      return {
        splatUrl: packageUrl,
        source: "package",
        evidenceStatus: published.evidenceStatus,
        evidenceLabel: evidenceStatusLabel(published.evidenceStatus),
        isProceduralFallback: false,
      };
    }
  }

  return {
    splatUrl: null,
    source: "none",
    evidenceStatus: null,
    evidenceLabel: "No real asset loaded yet",
    isProceduralFallback: true,
  };
}
