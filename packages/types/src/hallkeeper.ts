import { z } from "zod";
import { ConfigurationIdSchema } from "./configuration.js";
import { FurnitureCategorySchema } from "./furniture.js";

// ---------------------------------------------------------------------------
// Hallkeeper primitives
//
// The full sheet payload now lives in hallkeeper-v2.ts (HallkeeperSheetV2,
// phase/zone shape). This file keeps the small shared primitives that the
// enquiry-based hallkeeper route still uses plus the trigger request:
//
//   - HallkeeperSheetIdSchema — UUID for any entity that needs to address
//     a specific generated sheet instance (currently nothing persistent,
//     but kept for when the draft/revision concept lands)
//   - ManifestItemSchema — line-item shape used by the enquiry-based
//     generator (services/hallkeeper-sheet.ts)
//   - GenerateHallkeeperSheetRequest — the POST-trigger body shape
//
// The old HallkeeperSheetData + HallkeeperSheetDataSchema (flat manifest
// with setupGroup) were retired when the PDF and web view both moved to
// the v2 phase/zone layout.
// ---------------------------------------------------------------------------

export const HallkeeperSheetIdSchema = z.string().uuid();

export type HallkeeperSheetId = z.infer<typeof HallkeeperSheetIdSchema>;

const MAX_MANIFEST_QUANTITY = 10_000;
const MAX_NOTES_LENGTH = 500;

export const ManifestItemSchema = z.object({
  furnitureName: z.string().trim().min(1).max(200),
  category: FurnitureCategorySchema,
  quantity: z.number().int().min(1).max(MAX_MANIFEST_QUANTITY),
  notes: z.string().trim().max(MAX_NOTES_LENGTH).optional().default(""),
});

export type ManifestItem = z.infer<typeof ManifestItemSchema>;

export const GenerateHallkeeperSheetRequestSchema = z.object({
  configurationId: ConfigurationIdSchema,
});

export type GenerateHallkeeperSheetRequest = z.infer<typeof GenerateHallkeeperSheetRequestSchema>;
