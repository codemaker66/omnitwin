import { z } from "zod";
import { ConfigurationIdSchema } from "./configuration.js";
import { UserIdSchema } from "./user.js";

// ---------------------------------------------------------------------------
// NOTE: PhotoSchema below models an old `photo_references` table that is no
// longer the active runtime schema. The live system uses `reference_photos`
// (linked to a loadout, not a configuration), which is modelled by
// ReferencePhotoSchema at the bottom of this file. PhotoSchema is retained for
// backward compatibility with existing tests and any future consumer that needs
// the configuration-photo concept.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Photo ID — UUID v4
// ---------------------------------------------------------------------------

export const PhotoIdSchema = z.string().uuid();

export type PhotoId = z.infer<typeof PhotoIdSchema>;

// ---------------------------------------------------------------------------
// Allowed Content Types — restricted to common image formats
// ---------------------------------------------------------------------------

export const ALLOWED_PHOTO_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const PhotoContentTypeSchema = z.enum(ALLOWED_PHOTO_CONTENT_TYPES);

export type PhotoContentType = z.infer<typeof PhotoContentTypeSchema>;

// ---------------------------------------------------------------------------
// Photo — the full persisted entity (metadata stored in DB, file in S3)
// ---------------------------------------------------------------------------

const MAX_CAPTION_LENGTH = 1000;
const MAX_FILENAME_LENGTH = 255;

export const PhotoSchema = z.object({
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

export type Photo = z.infer<typeof PhotoSchema>;

// ---------------------------------------------------------------------------
// Photo Upload Request — client requests a presigned URL for direct S3 upload
// ---------------------------------------------------------------------------

export const PhotoUploadRequestSchema = z.object({
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

export type PhotoUploadRequest = z.infer<typeof PhotoUploadRequestSchema>;

// ---------------------------------------------------------------------------
// Photo Upload Response — presigned URL for browser-to-S3 direct upload
// ---------------------------------------------------------------------------

export const PhotoUploadResponseSchema = z.object({
  photoId: PhotoIdSchema,
  presignedUrl: z.string().url("Presigned URL must be a valid URL"),
  expiresAt: z.string().datetime({ message: "expiresAt must be an ISO 8601 datetime string" }),
});

export type PhotoUploadResponse = z.infer<typeof PhotoUploadResponseSchema>;

// ---------------------------------------------------------------------------
// ReferencePhotoSchema — matches the live `reference_photos` DB table
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
