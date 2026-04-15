import { z } from "zod";
import { ConfigurationIdSchema } from "./configuration.js";
import { UserIdSchema } from "./user.js";

// ---------------------------------------------------------------------------
// Photo schemas — two coexisting shapes, named to make the difference obvious:
//
//   - LegacyPhotoSchema / LegacyPhoto / LegacyPhotoUpload* model the OLD
//     `photo_references` table (configuration-scoped, direct URL stored in
//     the row). Retained because removing them would break older tests and
//     any future consumer that wants the configuration-photo concept back.
//
//   - ReferencePhotoSchema / ReferencePhoto model the LIVE `reference_photos`
//     table (loadout-scoped, references a `files` row instead of storing a
//     URL directly). This is what the production API actually serves; new
//     consumers should target this shape.
//
// Shared infrastructure (PhotoIdSchema, PhotoContentTypeSchema,
// ALLOWED_PHOTO_CONTENT_TYPES) is intentionally NOT prefixed — it's reused
// across both shapes and renaming it would force unrelated churn.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Photo ID — UUID v4 (shared)
// ---------------------------------------------------------------------------

export const PhotoIdSchema = z.string().uuid();

export type PhotoId = z.infer<typeof PhotoIdSchema>;

// ---------------------------------------------------------------------------
// Allowed Content Types — restricted to common image formats (shared)
// ---------------------------------------------------------------------------

export const ALLOWED_PHOTO_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const PhotoContentTypeSchema = z.enum(ALLOWED_PHOTO_CONTENT_TYPES);

export type PhotoContentType = z.infer<typeof PhotoContentTypeSchema>;

// ---------------------------------------------------------------------------
// LegacyPhoto — old configuration-scoped persisted entity
// ---------------------------------------------------------------------------

const MAX_CAPTION_LENGTH = 1000;
const MAX_FILENAME_LENGTH = 255;

export const LegacyPhotoSchema = z.object({
  id: PhotoIdSchema,
  configurationId: ConfigurationIdSchema,
  uploadedBy: UserIdSchema,
  url: z.string().url("URL must be a valid URL"),
  thumbnailUrl: z.string().url("Thumbnail URL must be a valid URL").nullable(),
  caption: z
    .string()
    .trim()
    .max(MAX_CAPTION_LENGTH, `Caption must be at most ${String(MAX_CAPTION_LENGTH)} characters`)
    .optional()
    .default(""),
  createdAt: z.string().datetime({ message: "createdAt must be an ISO 8601 datetime string" }),
});

export type LegacyPhoto = z.infer<typeof LegacyPhotoSchema>;

// ---------------------------------------------------------------------------
// LegacyPhotoUploadRequest — old presigned-URL request shape
// ---------------------------------------------------------------------------

export const LegacyPhotoUploadRequestSchema = z.object({
  configurationId: ConfigurationIdSchema,
  filename: z
    .string()
    .trim()
    .min(1, "Filename must not be empty")
    .max(MAX_FILENAME_LENGTH, `Filename must be at most ${String(MAX_FILENAME_LENGTH)} characters`),
  contentType: PhotoContentTypeSchema,
  caption: z
    .string()
    .trim()
    .max(MAX_CAPTION_LENGTH, `Caption must be at most ${String(MAX_CAPTION_LENGTH)} characters`)
    .optional()
    .default(""),
});

export type LegacyPhotoUploadRequest = z.infer<typeof LegacyPhotoUploadRequestSchema>;

// ---------------------------------------------------------------------------
// LegacyPhotoUploadResponse — old presigned-URL response shape
// ---------------------------------------------------------------------------

export const LegacyPhotoUploadResponseSchema = z.object({
  photoId: PhotoIdSchema,
  presignedUrl: z.string().url("Presigned URL must be a valid URL"),
  expiresAt: z.string().datetime({ message: "expiresAt must be an ISO 8601 datetime string" }),
});

export type LegacyPhotoUploadResponse = z.infer<typeof LegacyPhotoUploadResponseSchema>;

// ---------------------------------------------------------------------------
// ReferencePhotoSchema — matches the LIVE `reference_photos` DB table
//
// Photos are linked to a reference loadout (not a configuration), and
// reference a `files` row rather than storing a direct URL.
// ---------------------------------------------------------------------------

export const ReferencePhotoSchema = z.object({
  id: z.string().uuid(),
  loadoutId: z.string().uuid(),
  fileId: z.string().uuid(),
  caption: z.string().nullable(),
  sortOrder: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ message: "createdAt must be an ISO 8601 datetime string" }),
});

export type ReferencePhoto = z.infer<typeof ReferencePhotoSchema>;
