import { describe, it, expect } from "vitest";
import {
  PhotoIdSchema,
  ALLOWED_PHOTO_CONTENT_TYPES,
  PhotoContentTypeSchema,
  LegacyPhotoSchema,
  LegacyPhotoUploadRequestSchema,
  LegacyPhotoUploadResponseSchema,
  ReferencePhotoSchema,
} from "../photo.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const VALID_CONFIG_UUID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const VALID_USER_UUID = "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f";
const VALID_DATETIME = "2025-01-15T10:30:00.000Z";

const validPhoto = {
  id: VALID_UUID,
  configurationId: VALID_CONFIG_UUID,
  uploadedBy: VALID_USER_UUID,
  url: "https://cdn.omnitwin.com/photos/abc123.jpg",
  thumbnailUrl: "https://cdn.omnitwin.com/photos/abc123-thumb.jpg",
  caption: "Grand Hall ceremony setup",
  createdAt: VALID_DATETIME,
};

const validUploadRequest = {
  configurationId: VALID_CONFIG_UUID,
  filename: "ceremony-setup.jpg",
  contentType: "image/jpeg" as const,
  caption: "Grand Hall ceremony setup",
};

const validUploadResponse = {
  photoId: VALID_UUID,
  presignedUrl: "https://s3.amazonaws.com/bucket/key?X-Amz-Signature=abc123",
  expiresAt: VALID_DATETIME,
};

// ---------------------------------------------------------------------------
// PhotoIdSchema
// ---------------------------------------------------------------------------

describe("PhotoIdSchema", () => {
  it("accepts a valid UUID", () => {
    expect(PhotoIdSchema.safeParse(VALID_UUID).success).toBe(true);
  });

  it("rejects a non-UUID string", () => {
    expect(PhotoIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(PhotoIdSchema.safeParse("").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PhotoContentTypeSchema
// ---------------------------------------------------------------------------

describe("PhotoContentTypeSchema", () => {
  it("has exactly 3 content types", () => {
    expect(ALLOWED_PHOTO_CONTENT_TYPES).toHaveLength(3);
  });

  it("contains the expected content types", () => {
    expect(ALLOWED_PHOTO_CONTENT_TYPES).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });

  it.each([...ALLOWED_PHOTO_CONTENT_TYPES])("accepts '%s'", (ct) => {
    expect(PhotoContentTypeSchema.safeParse(ct).success).toBe(true);
  });

  it("rejects 'image/gif'", () => {
    expect(PhotoContentTypeSchema.safeParse("image/gif").success).toBe(false);
  });

  it("rejects 'image/bmp'", () => {
    expect(PhotoContentTypeSchema.safeParse("image/bmp").success).toBe(false);
  });

  it("rejects 'application/pdf'", () => {
    expect(PhotoContentTypeSchema.safeParse("application/pdf").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(PhotoContentTypeSchema.safeParse("").success).toBe(false);
  });

  it("rejects 'IMAGE/JPEG' (case sensitive)", () => {
    expect(PhotoContentTypeSchema.safeParse("IMAGE/JPEG").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LegacyPhotoSchema
// ---------------------------------------------------------------------------

describe("LegacyPhotoSchema", () => {
  it("accepts a fully valid photo", () => {
    const result = LegacyPhotoSchema.safeParse(validPhoto);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.caption).toBe("Grand Hall ceremony setup");
      expect(result.data.thumbnailUrl).toBe("https://cdn.omnitwin.com/photos/abc123-thumb.jpg");
    }
  });

  it("accepts null thumbnailUrl", () => {
    const result = LegacyPhotoSchema.safeParse({ ...validPhoto, thumbnailUrl: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.thumbnailUrl).toBeNull();
    }
  });

  it("accepts photo without caption (defaults to empty string)", () => {
    const { caption: _, ...noCaption } = validPhoto;
    const result = LegacyPhotoSchema.safeParse(noCaption);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.caption).toBe("");
    }
  });

  it("trims whitespace from caption", () => {
    const result = LegacyPhotoSchema.safeParse({ ...validPhoto, caption: "  Trimmed  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.caption).toBe("Trimmed");
    }
  });

  it("rejects caption exceeding 1000 characters", () => {
    expect(LegacyPhotoSchema.safeParse({ ...validPhoto, caption: "A".repeat(1001) }).success).toBe(false);
  });

  it("accepts caption of exactly 1000 characters", () => {
    expect(LegacyPhotoSchema.safeParse({ ...validPhoto, caption: "A".repeat(1000) }).success).toBe(true);
  });

  it("rejects missing id", () => {
    const { id: _, ...noId } = validPhoto;
    expect(LegacyPhotoSchema.safeParse(noId).success).toBe(false);
  });

  it("rejects invalid UUID for id", () => {
    expect(LegacyPhotoSchema.safeParse({ ...validPhoto, id: "bad" }).success).toBe(false);
  });

  it("rejects missing configurationId", () => {
    const { configurationId: _, ...noConfig } = validPhoto;
    expect(LegacyPhotoSchema.safeParse(noConfig).success).toBe(false);
  });

  it("rejects invalid UUID for configurationId", () => {
    expect(LegacyPhotoSchema.safeParse({ ...validPhoto, configurationId: "bad" }).success).toBe(false);
  });

  it("rejects missing uploadedBy", () => {
    const { uploadedBy: _, ...noUploader } = validPhoto;
    expect(LegacyPhotoSchema.safeParse(noUploader).success).toBe(false);
  });

  it("rejects invalid UUID for uploadedBy", () => {
    expect(LegacyPhotoSchema.safeParse({ ...validPhoto, uploadedBy: "bad" }).success).toBe(false);
  });

  it("rejects missing url", () => {
    const { url: _, ...noUrl } = validPhoto;
    expect(LegacyPhotoSchema.safeParse(noUrl).success).toBe(false);
  });

  it("rejects invalid url", () => {
    expect(LegacyPhotoSchema.safeParse({ ...validPhoto, url: "not-a-url" }).success).toBe(false);
  });

  it("rejects invalid thumbnailUrl (not a URL and not null)", () => {
    expect(LegacyPhotoSchema.safeParse({ ...validPhoto, thumbnailUrl: "not-a-url" }).success).toBe(false);
  });

  it("rejects missing createdAt", () => {
    const { createdAt: _, ...noCreated } = validPhoto;
    expect(LegacyPhotoSchema.safeParse(noCreated).success).toBe(false);
  });

  it("rejects invalid datetime for createdAt", () => {
    expect(LegacyPhotoSchema.safeParse({ ...validPhoto, createdAt: "bad" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LegacyPhotoUploadRequestSchema
// ---------------------------------------------------------------------------

describe("LegacyPhotoUploadRequestSchema", () => {
  it("accepts a valid upload request", () => {
    const result = LegacyPhotoUploadRequestSchema.safeParse(validUploadRequest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filename).toBe("ceremony-setup.jpg");
      expect(result.data.contentType).toBe("image/jpeg");
    }
  });

  it("accepts request without caption (defaults to empty string)", () => {
    const { caption: _, ...noCaption } = validUploadRequest;
    const result = LegacyPhotoUploadRequestSchema.safeParse(noCaption);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.caption).toBe("");
    }
  });

  it("trims whitespace from filename", () => {
    const result = LegacyPhotoUploadRequestSchema.safeParse({ ...validUploadRequest, filename: "  photo.jpg  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filename).toBe("photo.jpg");
    }
  });

  it("rejects empty filename", () => {
    expect(
      LegacyPhotoUploadRequestSchema.safeParse({ ...validUploadRequest, filename: "" }).success,
    ).toBe(false);
  });

  it("rejects whitespace-only filename", () => {
    expect(
      LegacyPhotoUploadRequestSchema.safeParse({ ...validUploadRequest, filename: "   " }).success,
    ).toBe(false);
  });

  it("rejects filename exceeding 255 characters", () => {
    expect(
      LegacyPhotoUploadRequestSchema.safeParse({ ...validUploadRequest, filename: "A".repeat(256) }).success,
    ).toBe(false);
  });

  it("accepts filename of exactly 255 characters", () => {
    expect(
      LegacyPhotoUploadRequestSchema.safeParse({ ...validUploadRequest, filename: "A".repeat(251) + ".jpg" }).success,
    ).toBe(true);
  });

  it("rejects missing configurationId", () => {
    const { configurationId: _, ...noConfig } = validUploadRequest;
    expect(LegacyPhotoUploadRequestSchema.safeParse(noConfig).success).toBe(false);
  });

  it("rejects invalid UUID for configurationId", () => {
    expect(
      LegacyPhotoUploadRequestSchema.safeParse({ ...validUploadRequest, configurationId: "bad" }).success,
    ).toBe(false);
  });

  it("rejects missing filename", () => {
    const { filename: _, ...noFile } = validUploadRequest;
    expect(LegacyPhotoUploadRequestSchema.safeParse(noFile).success).toBe(false);
  });

  it("rejects missing contentType", () => {
    const { contentType: _, ...noCt } = validUploadRequest;
    expect(LegacyPhotoUploadRequestSchema.safeParse(noCt).success).toBe(false);
  });

  it("rejects invalid contentType", () => {
    expect(
      LegacyPhotoUploadRequestSchema.safeParse({ ...validUploadRequest, contentType: "image/gif" }).success,
    ).toBe(false);
  });

  it.each([...ALLOWED_PHOTO_CONTENT_TYPES])("accepts contentType '%s'", (ct) => {
    expect(
      LegacyPhotoUploadRequestSchema.safeParse({ ...validUploadRequest, contentType: ct }).success,
    ).toBe(true);
  });

  it("rejects caption exceeding 1000 characters", () => {
    expect(
      LegacyPhotoUploadRequestSchema.safeParse({ ...validUploadRequest, caption: "A".repeat(1001) }).success,
    ).toBe(false);
  });

  it("trims whitespace from caption", () => {
    const result = LegacyPhotoUploadRequestSchema.safeParse({ ...validUploadRequest, caption: "  Nice  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.caption).toBe("Nice");
    }
  });
});

// ---------------------------------------------------------------------------
// LegacyPhotoUploadResponseSchema
// ---------------------------------------------------------------------------

describe("LegacyPhotoUploadResponseSchema", () => {
  it("accepts a valid upload response", () => {
    const result = LegacyPhotoUploadResponseSchema.safeParse(validUploadResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.photoId).toBe(VALID_UUID);
    }
  });

  it("rejects missing photoId", () => {
    const { photoId: _, ...noId } = validUploadResponse;
    expect(LegacyPhotoUploadResponseSchema.safeParse(noId).success).toBe(false);
  });

  it("rejects invalid UUID for photoId", () => {
    expect(
      LegacyPhotoUploadResponseSchema.safeParse({ ...validUploadResponse, photoId: "bad" }).success,
    ).toBe(false);
  });

  it("rejects missing presignedUrl", () => {
    const { presignedUrl: _, ...noUrl } = validUploadResponse;
    expect(LegacyPhotoUploadResponseSchema.safeParse(noUrl).success).toBe(false);
  });

  it("rejects invalid presignedUrl", () => {
    expect(
      LegacyPhotoUploadResponseSchema.safeParse({ ...validUploadResponse, presignedUrl: "not-a-url" }).success,
    ).toBe(false);
  });

  it("rejects empty presignedUrl", () => {
    expect(
      LegacyPhotoUploadResponseSchema.safeParse({ ...validUploadResponse, presignedUrl: "" }).success,
    ).toBe(false);
  });

  it("rejects missing expiresAt", () => {
    const { expiresAt: _, ...noExpiry } = validUploadResponse;
    expect(LegacyPhotoUploadResponseSchema.safeParse(noExpiry).success).toBe(false);
  });

  it("rejects invalid datetime for expiresAt", () => {
    expect(
      LegacyPhotoUploadResponseSchema.safeParse({ ...validUploadResponse, expiresAt: "not-a-date" }).success,
    ).toBe(false);
  });

  it("rejects null for expiresAt", () => {
    expect(
      LegacyPhotoUploadResponseSchema.safeParse({ ...validUploadResponse, expiresAt: null }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ReferencePhotoSchema — live runtime schema (F30)
//
// Matches the reference_photos DB table: linked to a loadout (not a
// configuration), references a files row (fileId, not a direct URL).
// ---------------------------------------------------------------------------

describe("ReferencePhotoSchema", () => {
  const VALID_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
  const VALID_LOADOUT_UUID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
  const VALID_FILE_UUID = "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f";
  const VALID_DATETIME = "2026-01-15T10:30:00.000Z";

  const validReferencePhoto = {
    id: VALID_UUID,
    loadoutId: VALID_LOADOUT_UUID,
    fileId: VALID_FILE_UUID,
    caption: "Grand Hall — ceremony layout",
    sortOrder: 0,
    createdAt: VALID_DATETIME,
  };

  it("accepts a fully valid reference photo", () => {
    expect(ReferencePhotoSchema.safeParse(validReferencePhoto).success).toBe(true);
  });

  it("accepts null caption", () => {
    expect(ReferencePhotoSchema.safeParse({ ...validReferencePhoto, caption: null }).success).toBe(true);
  });

  it("rejects missing loadoutId", () => {
    const { loadoutId: _, ...noLoadout } = validReferencePhoto;
    expect(ReferencePhotoSchema.safeParse(noLoadout).success).toBe(false);
  });

  it("rejects missing fileId", () => {
    const { fileId: _, ...noFile } = validReferencePhoto;
    expect(ReferencePhotoSchema.safeParse(noFile).success).toBe(false);
  });

  it("rejects non-UUID loadoutId", () => {
    expect(ReferencePhotoSchema.safeParse({ ...validReferencePhoto, loadoutId: "not-uuid" }).success).toBe(false);
  });

  it("rejects negative sortOrder", () => {
    expect(ReferencePhotoSchema.safeParse({ ...validReferencePhoto, sortOrder: -1 }).success).toBe(false);
  });

  it("accepts sortOrder of 0", () => {
    expect(ReferencePhotoSchema.safeParse({ ...validReferencePhoto, sortOrder: 0 }).success).toBe(true);
  });

  it("rejects invalid createdAt format", () => {
    expect(ReferencePhotoSchema.safeParse({ ...validReferencePhoto, createdAt: "not-a-date" }).success).toBe(false);
  });
});
