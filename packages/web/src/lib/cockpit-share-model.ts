import type { ProposalVersionPayload } from "@omnitwin/types";
import { PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION } from "@omnitwin/types";
import { getCatalogueItem } from "./catalogue.js";
import type { PlacedItem } from "./placement.js";
import { seatingCountsFromPlacedItems } from "./seating-counts.js";
import { costQuantitiesFromLayout, coversSourceLabel, type CoversSource } from "./cockpit-cost-model.js";
import {
  plannerLayoutStyle,
  publishedCapacityNote,
  publishedFormatForStyle,
  type PublishedCapacityAnswer,
} from "./planner-truth.js";
import { BAR_CATALOGUE_SLUG } from "./guest-flow-layout-input.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";
import { countLabel } from "./count-label.js";

// ---------------------------------------------------------------------------
// cockpit-share-model — turn the LIVE layout into a client-safe proposal draft
// (Epic 0 Share lens). The Share lens hands a layout off to a client as a
// shareable proposal; this is the pure content model behind that.
//
// Everything here is derived from the placed layout (covers/tables/features)
// and the room's real-metre dimensions — no invented venue facts. The capacity
// note states the venue's PUBLISHED figure for the layout with who stated it
// and when (planner-truth.ts), never floor area ÷ generic spacing: a client
// once read 339 standing for a Grand Hall the venue publishes at 250 (redteam
// fix-first 1). Money is never asserted here: a cost scenario is the Costs
// lens's editable estimate, not a client quote, so the share draft carries no
// quote (`quote: null`). The panel's footer keeps the SAFE wording visible.
//
// The layout summary states what is placed ("8 round tables · 64 chairs"),
// never the guest count as if it were seating: it once read "Seating for 220
// across 8 round tables" with 64 chairs on the floor (integration check, 17
// Oct 2026). When the chairs fall short of the guest count, the summary says
// by how many, and the draft carries the planner's way forward.
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

/** Chairs placed against the planner's own guest count, when they fall short. */
export interface ShareSeatingShortfall {
  readonly guests: number;
  readonly chairs: number;
  readonly short: number;
  /** The way forward, for the planner before sharing. */
  readonly next: string;
}

/** A client-safe proposal draft built from the live layout. */
export interface ShareProposalDraft {
  readonly title: string;
  readonly roomSummary: string;
  readonly layoutSummary: string;
  readonly capacityNote: string;
  readonly summary: ShareLayoutSummary;
  /** Null unless a seated layout has fewer chairs than the guest count. */
  readonly seatingShortfall: ShareSeatingShortfall | null;
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
  /** Optional room name for the capacity note; defaults to "this room". */
  readonly roomName?: string | null;
  /** The venue's published figures for the room. Without them the note names
   *  who confirms the capacity; it never states a computed count. */
  readonly published?: PublishedCapacityAnswer;
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
    if (!isSceneFurniturePlacement(placed)) continue;
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

/** Chairs short of the planner's guest count, for a layout with seating on
 *  the floor. A standing reception (poseur tables, no chairs) is not short of
 *  seats, and an empty floor has nothing to measure yet. */
function seatingShortfallFor(
  plannedGuestCount: number | null,
  roundTables: number,
  banquetTables: number,
  chairs: number,
  standing: boolean,
): ShareSeatingShortfall | null {
  if (plannedGuestCount === null || !Number.isFinite(plannedGuestCount) || plannedGuestCount <= 0) return null;
  const guests = Math.floor(plannedGuestCount);
  if (chairs >= guests) return null;
  if (chairs === 0 && (standing || roundTables + banquetTables === 0)) return null;
  const short = guests - chairs;
  return {
    guests,
    chairs,
    short,
    next: `Place ${countLabel(short, "more chair", "more chairs")} or lower the guest count before you share this plan. The events team can advise on the layout.`,
  };
}

/** What is placed, in the venue's words: "8 round tables · 64 chairs · a
 *  stage". The guest count is never stated as seating. */
function buildLayoutSummary(
  roundTables: number,
  banquetTables: number,
  chairs: number,
  features: readonly string[],
  shortfall: ShareSeatingShortfall | null,
): string {
  const featurePhrases = features.map((label) => `a ${label.toLowerCase()}`);
  const parts: string[] = [];
  if (roundTables > 0) parts.push(countLabel(roundTables, "round table"));
  if (banquetTables > 0) parts.push(countLabel(banquetTables, "long table"));
  if (chairs > 0) parts.push(countLabel(chairs, "chair"));
  if (parts.length === 0) {
    return featurePhrases.length > 0
      ? `An open-plan layout with ${joinAnd(featurePhrases)}.`
      : "An open-plan layout, ready to dress.";
  }
  if (featurePhrases.length > 0) parts.push(joinAnd(featurePhrases));
  if (shortfall !== null) {
    parts.push(`${countLabel(shortfall.short, "seat")} short of ${countLabel(shortfall.guests, "guest")}`);
  }
  return parts.join(" · ");
}

function buildRoomSummary(roomWidthM: number, roomLengthM: number): string {
  const area = Math.round(roomWidthM * roomLengthM);
  return `${roomWidthM.toFixed(1)} m × ${roomLengthM.toFixed(1)} m floor · ${String(area)} m²`;
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
    : null;
  const capacityNote = publishedCapacityNote({
    published: input.published ?? { kind: "not-published" },
    format: publishedFormatForStyle(plannerLayoutStyle(input.placedItems)),
    roomName,
    guests: quantities.covers > 0 ? quantities.covers : null,
  });

  const seatingShortfall = seatingShortfallFor(
    input.plannedGuestCount,
    seating.roundTables,
    seating.banquetTables,
    seating.chairs,
    plannerLayoutStyle(input.placedItems) === "cocktail",
  );

  const trimmedTitle = input.titleOverride?.trim() ?? "";
  const title = trimmedTitle.length > 0
    ? trimmedTitle
    : quantities.covers > 0
      ? `Event plan for ${countLabel(quantities.covers, "guest")}`
      : "Event plan";

  return {
    title,
    roomSummary: buildRoomSummary(input.roomWidthM, input.roomLengthM),
    layoutSummary: buildLayoutSummary(
      seating.roundTables,
      seating.banquetTables,
      seating.chairs,
      features,
      seatingShortfall,
    ),
    capacityNote,
    summary: {
      covers: quantities.covers,
      coversSource: quantities.coversSource,
      roundTables: seating.roundTables,
      banquetTables: seating.banquetTables,
      chairs: seating.chairs,
      avItems: quantities.avItems,
      features,
    },
    seatingShortfall,
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
