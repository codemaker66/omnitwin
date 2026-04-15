import { z } from "zod";
import { ConfigurationIdSchema, LayoutStyleSchema } from "./configuration.js";
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
// Hallkeeper Sheet Data — LEGACY flat-manifest response shape.
//
// Status: superseded by HallkeeperSheetV2 (see hallkeeper-v2.ts). The web
// view migrated to /v2 during the phase-zone redesign. This shape stays
// alive because the PDF renderer still consumes it; new consumers should
// target HallkeeperSheetV2.
//
// GET /hallkeeper/:configId/data returns this shape.
// GET /hallkeeper/:configId/sheet generates a PDF from the same shape.
// GET /hallkeeper/:configId/v2 returns HallkeeperSheetV2 (new).
// ---------------------------------------------------------------------------

export const HallkeeperSheetDataSchema = z.object({
  config: z.object({
    id: ConfigurationIdSchema,
    name: z.string(),
    guestCount: z.number().int().nonnegative(),
    layoutStyle: LayoutStyleSchema,
  }),
  venue: z.object({
    name: z.string(),
    address: z.string(),
    logoUrl: z.string().nullable().optional(),
  }),
  space: z.object({
    name: z.string(),
    widthM: z.number(),
    lengthM: z.number(),
    heightM: z.number(),
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
    totals: z.object({
      entries: z.array(z.object({ item: z.string(), qty: z.number().int().nonnegative() })),
      totalChairs: z.number().int().nonnegative(),
    }),
  }),
  diagramUrl: z.string().nullable(),
  webViewUrl: z.string(),
  generatedAt: z.string().datetime(),
});

export type HallkeeperSheetData = z.infer<typeof HallkeeperSheetDataSchema>;

// ---------------------------------------------------------------------------
// Generate request — triggers PDF generation
// ---------------------------------------------------------------------------

export const GenerateHallkeeperSheetRequestSchema = z.object({
  configurationId: ConfigurationIdSchema,
});

export type GenerateHallkeeperSheetRequest = z.infer<typeof GenerateHallkeeperSheetRequestSchema>;

