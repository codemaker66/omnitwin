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
  furnitureName: z
    .string()
    .trim()
    .min(1, "Furniture name must not be empty")
    .max(200, "Furniture name must be at most 200 characters"),
  category: FurnitureCategorySchema,
  quantity: z
    .number()
    .int("Quantity must be an integer")
    .min(1, "Quantity must be at least 1")
    .max(MAX_MANIFEST_QUANTITY, `Quantity must be at most ${String(MAX_MANIFEST_QUANTITY)}`),
  notes: z
    .string()
    .trim()
    .max(MAX_NOTES_LENGTH, `Notes must be at most ${String(MAX_NOTES_LENGTH)} characters`)
    .optional()
    .default(""),
});

export type ManifestItem = z.infer<typeof ManifestItemSchema>;

// ---------------------------------------------------------------------------
// Hallkeeper Sheet — the full persisted entity (generated server-side)
// ---------------------------------------------------------------------------

const MAX_QR_CODE_DATA_LENGTH = 2000;

export const HallkeeperSheetSchema = z.object({
  id: HallkeeperSheetIdSchema,
  configurationId: ConfigurationIdSchema,
  generatedAt: z.string().datetime({ message: "generatedAt must be an ISO 8601 datetime string" }),
  pdfUrl: z.string().url("PDF URL must be a valid URL"),
  manifest: z.array(ManifestItemSchema).min(1, "Manifest must contain at least one item"),
  qrCodeData: z
    .string()
    .min(1, "QR code data must not be empty")
    .max(MAX_QR_CODE_DATA_LENGTH, `QR code data must be at most ${String(MAX_QR_CODE_DATA_LENGTH)} characters`),
  topDownDiagramUrl: z.string().url("Top-down diagram URL must be a valid URL"),
  createdAt: z.string().datetime({ message: "createdAt must be an ISO 8601 datetime string" }),
  updatedAt: z.string().datetime({ message: "updatedAt must be an ISO 8601 datetime string" }),
});

export type HallkeeperSheet = z.infer<typeof HallkeeperSheetSchema>;

// ---------------------------------------------------------------------------
// Generate Hallkeeper Sheet Request — triggers PDF generation for a config
// ---------------------------------------------------------------------------

export const GenerateHallkeeperSheetRequestSchema = z.object({
  configurationId: ConfigurationIdSchema,
});

export type GenerateHallkeeperSheetRequest = z.infer<typeof GenerateHallkeeperSheetRequestSchema>;
