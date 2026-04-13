import { z } from "zod";
import { ConfigurationIdSchema } from "./configuration.js";
import { FurnitureCategorySchema } from "./furniture.js";

// ---------------------------------------------------------------------------
// Hallkeeper Sheet ID — UUID v4
// ---------------------------------------------------------------------------

export const HallkeeperSheetIdSchema = z.string().uuid();

export type HallkeeperSheetId = z.infer<typeof HallkeeperSheetIdSchema>;

// ---------------------------------------------------------------------------
// Manifest Item — one line in the furniture manifest (name + count + notes)
// ---------------------------------------------------------------------------

const MAX_MANIFEST_QUANTITY = 10_000;
const MAX_NOTES_LENGTH = 500;

export const ManifestItemSchema = z.object({
  furnitureName: z.string().trim().min(1).max(200),
  category: FurnitureCategorySchema,
  quantity: z.number().int().min(1).max(MAX_MANIFEST_QUANTITY),
  notes: z.string().trim().max(MAX_NOTES_LENGTH).optional().default(""),
});

export type ManifestItem = z.infer<typeof ManifestItemSchema>;

// ---------------------------------------------------------------------------
// Hallkeeper Sheet Data — the generated-on-the-fly response from the API
//
// The live system does NOT persist hallkeeper sheets as a DB entity.
// Instead, GET /hallkeeper/:configId/data assembles the data from the
// configuration, venue, space, and placed objects, then returns this shape.
// GET /hallkeeper/:configId/sheet generates a PDF binary on-the-fly.
//
// Fields match hallkeeper-sheet-v2.ts assembleSheetData() return shape.
// ---------------------------------------------------------------------------

export const HallkeeperSheetDataSchema = z.object({
  config: z.object({
    id: ConfigurationIdSchema,
    name: z.string(),
    guestCount: z.number().int().nonnegative(),
    layoutStyle: z.string(),
  }),
  venue: z.object({
    name: z.string(),
    address: z.string(),
  }),
  space: z.object({
    name: z.string(),
    widthM: z.string(),
    lengthM: z.string(),
    heightM: z.string(),
  }),
  manifest: z.object({
    rows: z.array(z.object({
      code: z.string(),
      item: z.string(),
      qty: z.number().int().nonnegative(),
      position: z.string(),
      notes: z.string(),
      setupGroup: z.string(),
    })),
    summary: z.object({
      totalItems: z.number().int().nonnegative(),
      categories: z.record(z.number().int().nonnegative()),
    }),
  }),
  diagramUrl: z.string().nullable(),
  webViewUrl: z.string(),
});

export type HallkeeperSheetData = z.infer<typeof HallkeeperSheetDataSchema>;

// ---------------------------------------------------------------------------
// Generate request — triggers PDF generation
// ---------------------------------------------------------------------------

export const GenerateHallkeeperSheetRequestSchema = z.object({
  configurationId: ConfigurationIdSchema,
});

export type GenerateHallkeeperSheetRequest = z.infer<typeof GenerateHallkeeperSheetRequestSchema>;

// ---------------------------------------------------------------------------
// Legacy persistent sheet schema — DEPRECATED
//
// The original design assumed hallkeeper sheets would be persisted as DB
// entities with pdfUrl, qrCodeData, topDownDiagramUrl. The running system
// generates them on-the-fly instead. This schema is kept for backward
// compatibility with existing tests only.
// ---------------------------------------------------------------------------

/** @deprecated Use HallkeeperSheetDataSchema. Sheets are generated, not persisted. */
export const HallkeeperSheetSchema = z.object({
  id: HallkeeperSheetIdSchema,
  configurationId: ConfigurationIdSchema,
  generatedAt: z.string().datetime(),
  pdfUrl: z.string().url(),
  manifest: z.array(ManifestItemSchema).min(1),
  qrCodeData: z.string().min(1).max(2000),
  topDownDiagramUrl: z.string().url(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** @deprecated */
// eslint-disable-next-line @typescript-eslint/no-deprecated
export type HallkeeperSheet = z.infer<typeof HallkeeperSheetSchema>;
