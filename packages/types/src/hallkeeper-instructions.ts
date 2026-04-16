import { z } from "zod";
import { SETUP_PHASES, SetupPhaseSchema } from "./hallkeeper-accessories.js";

// ---------------------------------------------------------------------------
// Hallkeeper Instructions — the human layer
//
// Everything in hallkeeper-v2 describes GEOMETRY. What a planner actually
// wants to communicate to a hallkeeper is human: "fire exit must stay
// clear", "table 5 is reserved for the board", "my contact day-of is
// Sarah +44...", "furniture must be done by 3pm because the boss is
// arriving early". This module captures that human layer.
//
// Two scopes:
//
//   Event-level (EventInstructions) — one blob attached to the
//   configuration. Carries special instructions, day-of contact, and
//   optional per-phase deadlines. Stored on configurations.metadata
//   under the "instructions" key.
//
//   Object-level (PlacedObjectNote) — a single freeform note attached
//   to a placed object. Stored on placed_objects.metadata under the
//   "notes" key. When a row in the manifest aggregates several
//   placements, the row carries the union of their notes.
//
// Both fields are strictly optional — existing configs without
// metadata continue to render the sheet exactly as before.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DayOfContact — who the hallkeeper rings if something goes wrong
// ---------------------------------------------------------------------------

export const DayOfContactSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.string().max(120).default(""),
  phone: z.string().max(40).default(""),
  email: z.string().email().max(255).or(z.literal("")).default(""),
});
export type DayOfContact = z.infer<typeof DayOfContactSchema>;

// ---------------------------------------------------------------------------
// PhaseDeadline — override the global setupBy with a per-phase milestone
//
// If the planner wants "structure done by 1pm, furniture by 2:30pm,
// dress by 4pm" we store that here. The sheet renderer then draws a
// timing chart. An empty array = no per-phase milestones, only the
// global setupBy applies.
// ---------------------------------------------------------------------------

export const PhaseDeadlineSchema = z.object({
  phase: SetupPhaseSchema,
  /** ISO-8601 datetime this phase must be complete by. */
  deadline: z.string().datetime(),
  /** Optional short justification ("boss arrives early", "AV check"). */
  reason: z.string().max(200).default(""),
});
export type PhaseDeadline = z.infer<typeof PhaseDeadlineSchema>;

// ---------------------------------------------------------------------------
// EventInstructions — everything the planner can communicate to the
// hallkeeper that isn't captured by the geometry of placed objects.
// ---------------------------------------------------------------------------

export const EventInstructionsSchema = z.object({
  /**
   * Freeform notes for the hallkeeper. Rendered prominently at the top
   * of the sheet and on page 1 of the PDF. Markdown is NOT parsed —
   * line breaks are preserved, nothing else.
   */
  specialInstructions: z.string().max(4000).default(""),
  /** Day-of contact block — who the hallkeeper rings on the day. */
  dayOfContact: DayOfContactSchema.nullable().default(null),
  /**
   * Per-phase deadlines — optional override of the global setupBy time.
   * Capped at one deadline per phase; SETUP_PHASES has 5 entries today,
   * the cap moves with it.
   */
  phaseDeadlines: z.array(PhaseDeadlineSchema).max(SETUP_PHASES.length).default([]),
  /**
   * Access / load-in notes — "service entrance at south door, parking
   * in the cobbled yard, no vehicles after 15:00". Rendered in a
   * separate callout so it stands apart from event instructions.
   */
  accessNotes: z.string().max(1500).default(""),
});
export type EventInstructions = z.infer<typeof EventInstructionsSchema>;

// ---------------------------------------------------------------------------
// ConfigurationMetadataSchema — the shape of configurations.metadata JSONB
//
// Currently only "instructions" is defined. Future additions (e.g.
// seating-chart, dietary flags) go alongside it without breaking
// existing records since the schema uses .passthrough() to tolerate
// unknown keys.
// ---------------------------------------------------------------------------

export const ConfigurationMetadataSchema = z.object({
  instructions: EventInstructionsSchema.optional(),
}).passthrough();
export type ConfigurationMetadata = z.infer<typeof ConfigurationMetadataSchema>;

// ---------------------------------------------------------------------------
// PlacedObjectMetadataSchema — the shape of placed_objects.metadata JSONB
//
// `groupId` was already in use for chair↔table grouping; we formalise
// it here so the type system owns it. `notes` is new — a single string
// per placement ("VIP table", "needs HDMI cable", "keep chair at
// 45° exact"). When the manifest generator aggregates N placements
// into one row it concatenates distinct notes.
// ---------------------------------------------------------------------------

export const PlacedObjectMetadataSchema = z.object({
  groupId: z.string().nullable().optional(),
  notes: z.string().max(500).optional(),
}).passthrough();
export type PlacedObjectMetadata = z.infer<typeof PlacedObjectMetadataSchema>;

// ---------------------------------------------------------------------------
// Empty-instructions builder — used by tests and by the route handler
// when a config has no metadata yet. Guarantees the shape is never
// "partially defaulted" — every field has a deterministic empty value.
// ---------------------------------------------------------------------------

export function emptyEventInstructions(): EventInstructions {
  return {
    specialInstructions: "",
    dayOfContact: null,
    phaseDeadlines: [],
    accessNotes: "",
  };
}

/**
 * True if the instructions block contains no actual content. Used by
 * renderers to skip the "no instructions" empty state cleanly.
 */
export function hasInstructionContent(i: EventInstructions): boolean {
  if (i.specialInstructions.trim().length > 0) return true;
  if (i.accessNotes.trim().length > 0) return true;
  if (i.phaseDeadlines.length > 0) return true;
  if (i.dayOfContact !== null) return true;
  return false;
}
