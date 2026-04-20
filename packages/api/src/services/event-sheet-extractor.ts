import { createHash } from "node:crypto";
import {
  CANONICAL_ASSETS,
  EQUIPMENT_TAGS,
  buildAccessibilityCallouts,
  buildDoorScheduleSummary,
  hasCriticalAccessibility,
  hasDietaryContent,
  type AccessibilityCallout,
  type AccessibilityCalloutSeverity,
  type CanonicalAsset,
  type ConfigurationMetadata,
  type DietarySummary,
  type DoorScheduleSummary,
  type EquipmentTag,
  type Phase,
  type Zone,
} from "@omnitwin/types";
import {
  generateManifestV2,
  type AccessoryMap,
  type ManifestObjectV2,
} from "./manifest-generator-v2.js";
import { classifyZoneV2, type RoomDimensions } from "./spatial-classifier-v2.js";

// ---------------------------------------------------------------------------
// Event Sheet Extractor — the pure function at the heart of the approval
// workflow.
//
// Input:
//   - placements:   the flat array of ManifestObjectV2 for this config
//   - accessoryMap: DB-loaded asset_accessories lookup (same one the
//                   manifest generator uses)
//   - metadata:     the planner's ConfigurationMetadata blob
//                   (accessibility, dietary, doorSchedule, instructions)
//   - room:         spatial dimensions used to classify every placement
//                   into one of the 7 zones
//
// Output:
//   - manifest:              the phase/zone/row hierarchy (delegated to
//                            generateManifestV2 — this function does NOT
//                            reimplement geometry)
//   - implicitRequirements:  equipment tags that placed AV / stages /
//                            lecterns imply — rolled up by tag with a
//                            count and the list of contributing placements
//   - accessibilityCallouts: severity-ranked callouts the sheet renderer
//                            shows as a red/amber/info band
//   - dietary:               pass-through of DietarySummary when it has
//                            real content, otherwise null
//   - doorSchedule:          pass-through of the schedule with events
//                            per door sorted chronologically, otherwise
//                            null
//   - sourceHash:            sha256 hex digest of the canonicalised
//                            input — idempotency key for snapshot
//                            creation
//
// The function is PURE — no DB, no file I/O, no network, no Date.now.
// Re-running with identical inputs always produces identical outputs.
// That determinism is what lets the snapshot service short-circuit a
// re-submit when the hash matches the latest stored snapshot.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ExtractionInput {
  readonly placements: readonly ManifestObjectV2[];
  readonly accessoryMap: AccessoryMap;
  readonly metadata: ConfigurationMetadata | null;
  readonly room: RoomDimensions;
}

export interface ImplicitRequirementSource {
  readonly assetName: string;
  readonly zone: Zone;
}

export interface ImplicitRequirement {
  readonly tag: EquipmentTag;
  readonly count: number;
  readonly sources: readonly ImplicitRequirementSource[];
}

// AccessibilityCallout + DoorScheduleSummary types are re-exported from
// @omnitwin/types so consumers can pull either from here (for the full
// ExtractionOutput shape) or from the canonical source. See
// packages/types/src/event-sheet-rendering.ts for the pure builders.

export type { AccessibilityCallout, AccessibilityCalloutSeverity, DoorScheduleSummary };

export interface ExtractionOutput {
  readonly manifest: {
    readonly phases: readonly Phase[];
    readonly totals: {
      readonly entries: readonly {
        readonly name: string;
        readonly category: string;
        readonly qty: number;
      }[];
      readonly totalRows: number;
      readonly totalItems: number;
    };
  };
  readonly implicitRequirements: readonly ImplicitRequirement[];
  readonly accessibilityCallouts: readonly AccessibilityCallout[];
  readonly dietary: DietarySummary | null;
  readonly doorSchedule: DoorScheduleSummary | null;
  readonly sourceHash: string;
}

// ---------------------------------------------------------------------------
// Canonical-asset lookup — built once at module load. The catalogue is
// tiny (~18 entries) and never mutates at runtime; a Map beats
// Array.find for explicit "this lookup cannot miss a hot path".
// ---------------------------------------------------------------------------

const ASSETS_BY_NAME: ReadonlyMap<string, CanonicalAsset> = new Map(
  CANONICAL_ASSETS.map((a) => [a.name, a]),
);

// ---------------------------------------------------------------------------
// Source hash — the idempotency key. See plan §4.5 for rounding
// rationale.
//
//   - positions rounded to 3 decimal places (millimetre precision — the
//     editor only produces 3-decimal values; rounding to 3 is a no-op
//     for well-formed input but guards against float drift from future
//     transforms)
//   - rotations rounded to 5 decimals (0.00001 rad ≈ 0.0006° — finer
//     than any human perception; beyond this, rounding protects against
//     spurious version bumps when the editor saves a no-op rotation
//     tweak)
//   - placement notes are trimmed (surrounding whitespace edits must
//     NOT create a new snapshot)
//   - placements sorted by id so save order doesn't matter
//   - room dimensions are part of the input — a space rename / resize
//     invalidates the snapshot
//   - full metadata (instructions, accessibility, dietary, doorSchedule)
//     is part of the hash — any human-authored edit creates a new
//     version
// ---------------------------------------------------------------------------

interface CanonicalPlacement {
  readonly id: string;
  readonly assetName: string;
  readonly assetCategory: string;
  readonly x: number;
  readonly z: number;
  readonly rotY: number;
  readonly groupId: string | null;
  readonly notes: string;
}

function canonicalisePlacements(
  placements: readonly ManifestObjectV2[],
): readonly CanonicalPlacement[] {
  return [...placements]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p): CanonicalPlacement => ({
      id: p.id,
      assetName: p.assetName,
      assetCategory: p.assetCategory,
      x: Number(p.positionX.toFixed(3)),
      z: Number(p.positionZ.toFixed(3)),
      rotY: Number(p.rotationY.toFixed(5)),
      groupId: p.groupId,
      notes: (p.notes ?? "").trim(),
    }));
}

function canonicalise(input: ExtractionInput): string {
  const canonical = {
    placements: canonicalisePlacements(input.placements),
    metadata: input.metadata ?? null,
    room: {
      widthM: Number(input.room.widthM.toFixed(3)),
      lengthM: Number(input.room.lengthM.toFixed(3)),
    },
  };
  return JSON.stringify(canonical);
}

function computeSourceHash(input: ExtractionInput): string {
  return createHash("sha256").update(canonicalise(input)).digest("hex");
}

// ---------------------------------------------------------------------------
// Implicit-requirement extraction
//
// Walks every placement, looks up its canonical asset by name, and
// accumulates a count + source list per equipment tag. Output order
// follows EQUIPMENT_TAGS (the canonical ordering in @omnitwin/types)
// so the sheet renderer can rely on a stable sequence.
//
// Placements whose asset isn't in the canonical catalogue (e.g. a
// legacy row from before the seed standardisation) are silently
// skipped — they can't contribute tags they don't know about. They
// still appear in the manifest via generateManifestV2 which doesn't
// rely on CANONICAL_ASSETS.
// ---------------------------------------------------------------------------

interface TagAccumulator {
  count: number;
  readonly sources: ImplicitRequirementSource[];
}

function extractImplicitRequirements(
  placements: readonly ManifestObjectV2[],
  room: RoomDimensions,
): readonly ImplicitRequirement[] {
  const bucket = new Map<EquipmentTag, TagAccumulator>();

  for (const p of placements) {
    const asset = ASSETS_BY_NAME.get(p.assetName);
    if (asset === undefined) continue;
    if (asset.equipmentTags.length === 0) continue;
    const zone = classifyZoneV2(p.positionX, p.positionZ, room);
    for (const tag of asset.equipmentTags) {
      const existing = bucket.get(tag);
      if (existing === undefined) {
        bucket.set(tag, {
          count: 1,
          sources: [{ assetName: p.assetName, zone }],
        });
      } else {
        existing.count += 1;
        existing.sources.push({ assetName: p.assetName, zone });
      }
    }
  }

  const result: ImplicitRequirement[] = [];
  for (const tag of EQUIPMENT_TAGS) {
    const entry = bucket.get(tag);
    if (entry === undefined) continue;
    const sortedSources = [...entry.sources].sort((a, b) => {
      const byName = a.assetName.localeCompare(b.assetName);
      if (byName !== 0) return byName;
      return a.zone.localeCompare(b.zone);
    });
    result.push({
      tag,
      count: entry.count,
      sources: sortedSources,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Accessibility callouts + Door schedule
//
// Severity ranking, detail-string construction, and chronological sort
// live in @omnitwin/types/event-sheet-rendering so every renderer (this
// extractor's snapshot payload, the HallkeeperPage tablet view, the PDF,
// the email templates) produces identical output. See the shared module
// for the rules.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Dietary — pass-through with a "is it content-bearing" gate. Empty
// DietarySummary (all zeros, no notes) returns null so the renderer
// can skip the entire dietary row cleanly.
// ---------------------------------------------------------------------------

function extractDietary(
  dietary: DietarySummary | null,
): DietarySummary | null {
  if (dietary === null) return null;
  if (!hasDietaryContent(dietary)) return null;
  return dietary;
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

export function extractEventSheet(input: ExtractionInput): ExtractionOutput {
  const manifest = generateManifestV2(
    input.placements,
    input.room,
    input.accessoryMap,
  );

  const implicitRequirements = extractImplicitRequirements(
    input.placements,
    input.room,
  );

  const instructions = input.metadata?.instructions ?? null;
  const accessibilityCallouts = buildAccessibilityCallouts(
    instructions?.accessibility ?? null,
  );
  const dietary = extractDietary(instructions?.dietary ?? null);
  const doorSchedule = buildDoorScheduleSummary(instructions?.doorSchedule ?? null);

  const sourceHash = computeSourceHash(input);

  return {
    manifest,
    implicitRequirements,
    accessibilityCallouts,
    dietary,
    doorSchedule,
    sourceHash,
  };
}

// ---------------------------------------------------------------------------
// Re-exports — so route code doesn't need two imports to use this.
// ---------------------------------------------------------------------------

export { hasCriticalAccessibility };
