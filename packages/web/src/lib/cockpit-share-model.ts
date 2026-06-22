import type { LayoutStyle, ProposalVersionPayload } from "@omnitwin/types";
import { PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION } from "@omnitwin/types";
import { getCatalogueItem } from "./catalogue.js";
import type { PlacedItem } from "./placement.js";
import { seatingCountsFromPlacedItems } from "./seating-counts.js";
import { costQuantitiesFromLayout, coversSourceLabel, type CoversSource } from "./cockpit-cost-model.js";
import { buildProposalCapacityGuidance, buildProposalCapacityNote } from "./proposal-capacity-note.js";
import { BAR_CATALOGUE_SLUG } from "./guest-flow-layout-input.js";

// ---------------------------------------------------------------------------
// cockpit-share-model — turn the LIVE layout into a client-safe proposal draft
// (Epic 0 Share lens). The Share lens hands a layout off to a client as a
// shareable proposal; this is the pure content model behind that.
//
// Everything here is derived from the placed layout (covers/tables/features)
// and the room's real-metre dimensions — no invented venue facts. The capacity
// note reuses the planner's planning-grade engine, so it ALWAYS ends with the
// human-review disclosure and passes the types-level proposal claim guard by
// construction. Money is never asserted here: a cost scenario is the Costs
// lens's editable estimate, not a client quote, so the share draft carries no
// quote (`quote: null`). The panel's footer keeps the SAFE wording visible.
// ---------------------------------------------------------------------------

export { coversSourceLabel };

/** Structured layout facts behind the proposal preview rows. */
export interface ShareLayoutSummary {
  readonly covers: number;
  readonly coversSource: CoversSource;
  readonly roundTables: number;
  readonly banquetTables: number;
  readonly chairs: number;
  readonly avItems: number;
  /** Title-case feature labels present in the layout, e.g. ["Stage", "Bar"]. */
  readonly features: readonly string[];
}

/** A client-safe proposal draft built from the live layout. */
export interface ShareProposalDraft {
  readonly title: string;
  readonly roomSummary: string;
  readonly layoutSummary: string;
  readonly capacityNote: string;
  readonly summary: ShareLayoutSummary;
}

export interface ShareDraftInput {
  readonly placedItems: readonly PlacedItem[];
  /** Real room width in metres (NOT render-space). */
  readonly roomWidthM: number;
  /** Real room length in metres (NOT render-space). */
  readonly roomLengthM: number;
  /** Planner-set guest count; covers fall back to placed chairs when null. */
  readonly plannedGuestCount: number | null;
  /** Planner-entered event title; falls back to a layout-derived default when blank. */
  readonly titleOverride: string | null;
  /** Optional room name for the capacity note; defaults to "This room". */
  readonly roomName?: string | null;
}

function plural(n: number, singular: string): string {
  return n === 1 ? singular : `${singular}s`;
}

/** Join phrases as a natural English list ("a, b and c"). */
function joinAnd(parts: readonly string[]): string {
  if (parts.length === 0) return "";
  const last = parts[parts.length - 1] ?? "";
  if (parts.length === 1) return last;
  return `${parts.slice(0, -1).join(", ")} and ${last}`;
}

/** Title-case feature labels present in the layout (stage, bar, lectern). */
function featureLabelsFromLayout(placedItems: readonly PlacedItem[]): string[] {
  let stage = 0;
  let bar = 0;
  let lectern = 0;
  for (const placed of placedItems) {
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item === undefined) continue;
    if (item.category === "stage") stage += 1;
    else if (item.category === "lectern") lectern += 1;
    else if (item.slug === BAR_CATALOGUE_SLUG) bar += 1;
  }
  const labels: string[] = [];
  if (stage > 0) labels.push("Stage");
  if (bar > 0) labels.push("Bar");
  if (lectern > 0) labels.push("Lectern");
  return labels;
}

/** Infer the seating style that best frames the capacity comfort estimate. */
function inferLayoutStyle(roundTables: number, banquetTables: number, chairs: number): LayoutStyle {
  if (banquetTables > roundTables && banquetTables > 0) return "dinner-banquet";
  if (roundTables > 0) return "dinner-rounds";
  if (chairs > 0) return "theatre";
  return "cocktail";
}

function buildTableClause(roundTables: number, banquetTables: number): string {
  const parts: string[] = [];
  if (roundTables > 0) parts.push(`${String(roundTables)} round ${plural(roundTables, "table")}`);
  if (banquetTables > 0) parts.push(`${String(banquetTables)} long ${plural(banquetTables, "table")}`);
  return joinAnd(parts);
}

function buildLayoutSummary(
  covers: number,
  roundTables: number,
  banquetTables: number,
  chairs: number,
  features: readonly string[],
): string {
  const tables = roundTables + banquetTables;
  const featurePhrases = features.map((label) => `a ${label.toLowerCase()}`);
  const featureClause = featurePhrases.length > 0 ? `, with ${joinAnd(featurePhrases)}` : "";
  if (covers > 0 && tables > 0) {
    return `Seating for ${String(covers)} across ${buildTableClause(roundTables, banquetTables)}${featureClause}.`;
  }
  if (covers > 0) {
    return `Seating for ${String(covers)}${featureClause}.`;
  }
  if (chairs > 0) {
    return `${String(chairs)} ${plural(chairs, "chair")} arranged in the room${featureClause}.`;
  }
  if (featurePhrases.length > 0) {
    return `An open-plan layout with ${joinAnd(featurePhrases)}.`;
  }
  return "An open-plan layout, ready to dress.";
}

function buildRoomSummary(roomWidthM: number, roomLengthM: number): string {
  const area = Math.round(roomWidthM * roomLengthM);
  return `${roomWidthM.toFixed(1)} m × ${roomLengthM.toFixed(1)} m floor · ${String(area)} m²`;
}

function buildCapacityNote(
  roomWidthM: number,
  roomLengthM: number,
  covers: number,
  style: LayoutStyle,
  roomName: string,
): string {
  const floorAreaM2 = roomWidthM * roomLengthM;
  if (!Number.isFinite(floorAreaM2) || floorAreaM2 <= 0) {
    return "Capacity guidance appears once the room is set. Planning estimate only — human review required; final capacity confirmed by the venue team.";
  }
  const intel = buildProposalCapacityGuidance(floorAreaM2, covers, style);
  return buildProposalCapacityNote(roomName, intel);
}

/**
 * Build the client-safe proposal draft from the live layout. Pure: no React,
 * no API, no money assertions. Reuses the same seating/cover derivations as the
 * Flow and Costs lenses so every lens reads the layout the same way.
 */
export function buildShareProposalDraft(input: ShareDraftInput): ShareProposalDraft {
  const seating = seatingCountsFromPlacedItems(input.placedItems);
  const quantities = costQuantitiesFromLayout(input.placedItems, input.plannedGuestCount);
  const features = featureLabelsFromLayout(input.placedItems);
  const roomName = input.roomName !== undefined && input.roomName !== null && input.roomName.trim().length > 0
    ? input.roomName.trim()
    : "This room";

  const style = inferLayoutStyle(seating.roundTables, seating.banquetTables, seating.chairs);
  const trimmedTitle = input.titleOverride?.trim() ?? "";
  const title = trimmedTitle.length > 0
    ? trimmedTitle
    : quantities.covers > 0
      ? `Event plan for ${String(quantities.covers)} guests`
      : "Event plan";

  return {
    title,
    roomSummary: buildRoomSummary(input.roomWidthM, input.roomLengthM),
    layoutSummary: buildLayoutSummary(
      quantities.covers,
      seating.roundTables,
      seating.banquetTables,
      seating.chairs,
      features,
    ),
    capacityNote: buildCapacityNote(input.roomWidthM, input.roomLengthM, quantities.covers, style, roomName),
    summary: {
      covers: quantities.covers,
      coversSource: quantities.coversSource,
      roundTables: seating.roundTables,
      banquetTables: seating.banquetTables,
      chairs: seating.chairs,
      avItems: quantities.avItems,
      features,
    },
  };
}

/**
 * Build the immutable proposal-version payload candidate for the share draft.
 * Returns a plain object the caller validates with `ProposalVersionPayloadSchema`
 * (client-side claim guard) before posting — exactly the dashboard's pattern.
 * The configuration id lets the server capture the layout SVG snapshot.
 */
export function buildShareVersionPayloadCandidate(
  draft: ShareProposalDraft,
  configurationId: string | null,
  clientMessage: string | null,
): ProposalVersionPayload {
  const message = clientMessage !== null && clientMessage.trim().length > 0 ? clientMessage.trim() : null;
  return {
    schemaVersion: PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION,
    title: draft.title,
    clientMessage: message,
    configurationId,
    layoutRevision: null,
    capacityNote: draft.capacityNote,
    quote: null,
    roomSummary: draft.roomSummary,
    layoutSummary: draft.layoutSummary,
  };
}
