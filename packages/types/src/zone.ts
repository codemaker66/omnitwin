import { z } from "zod";

// ---------------------------------------------------------------------------
// Zone — 7-zone classification of spatial regions within a room.
//
// 4 walls, plus entrance, perimeter, centre. Used by the hallkeeper sheet
// manifest (grouping rows by where in the room they belong) and by
// accessibility extraction (which zone a hearing loop should cover).
//
// Extracted from hallkeeper-v2.ts into its own module so event-requirements
// and hallkeeper-v2 can both import ZoneSchema without creating a
// circular import between hallkeeper-v2 and hallkeeper-instructions.
// ---------------------------------------------------------------------------

export const ZONES = [
  "North wall",
  "South wall",
  "East wall",
  "West wall",
  "Entrance",
  "Perimeter",
  "Centre",
] as const;

export const ZoneSchema = z.enum(ZONES);
export type Zone = z.infer<typeof ZoneSchema>;
