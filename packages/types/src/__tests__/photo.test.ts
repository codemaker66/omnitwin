import { describe, it, expect } from "vitest";
import {
  PhotoIdSchema,
  ALLOWED_PHOTO_CONTENT_TYPES,
  PhotoContentTypeSchema,
  PhotoSchema,
  PhotoUploadRequestSchema,
  PhotoUploadResponseSchema,
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
// PhotoSchema
// ---------------------------------------------------------------------------

describe("PhotoSchema", () => {
  it("accepts a fully valid photo", () => {
    const result = PhotoSchema.safeParse(validPhoto);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.caption).toBe("Grand Hall ceremony setup");
      expect(result.data.thumbnailUrl).toBe("https://cdn.omnitwin.com/photos/abc123-thumb.jpg");
    }
  });

  it("accepts null thumbnailUrl", () => {
    const result = PhotoSchema.safeParse({ ...validPhoto, thumbnailUrl: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.thumbnailUrl).toBeNull();
    }
  });

  it("accepts photo without caption (defaults to empty string)", () => {
    const { caption: _, ...noCaption } = validPhoto;
    const result = PhotoSchema.safeParse(noCaption);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.caption).toBe("");
    }
  });

  it("trims whitespace from caption", () => {
    const result = PhotoSchema.safeParse({ ...validPhoto, caption: "  Trimmed  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.caption).toBe("Trimmed");
    }
  });

  it("rejects caption exceeding 1000 characters", () => {
    expect(PhotoSchema.safeParse({ ...validPhoto, caption: "A".repeat(1001) }).success).toBe(false);
  });

  it("accepts caption of exactly 1000 characters", () => {
    expect(PhotoSchema.safeParse({ ...validPhoto, caption: "A".repeat(1000) }).success).toBe(true);
  });

  it("rejects missing id", () => {
    const { id: _, ...noId } = validPhoto;
    expect(PhotoSchema.safeParse(noId).success).toBe(false);
  });

  it("rejects invalid UUID for id", () => {
    expect(PhotoSchema.safeParse({ ...validPhoto, id: "bad" }).success).toBe(false);
  });

  it("rejects missing configurationId", () => {
    const { configurationId: _, ...noConfig } = validPhoto;
    expect(PhotoSchema.safeParse(noConfig).success).toBe(false);
  });

  it("rejects invalid UUID for configurationId", () => {
    expect(PhotoSchema.safeParse({ ...validPhoto, configurationId: "bad" }).success).toBe(false);
  });

  it("rejects missing uploadedBy", () => {
    const { uploadedBy: _, ...noUploader } = validPhoto;
    expect(PhotoSchema.safeParse(noUploader).success).toBe(false);
  });

  it("rejects invalid UUID for uploadedBy", () => {
    expect(PhotoSchema.safeParse({ ...validPhoto, uploadedBy: "bad" }).success).toBe(false);
  });

  it("rejects missing url", () => {
    const { url: _, ...noUrl } = validPhoto;
    expect(PhotoSchema.safeParse(noUrl).success).toBe(false);
  });

  it("rejects invalid url", () => {
    expect(PhotoSchema.safeParse({ ...validPhoto, url: "not-a-url" }).success).toBe(false);
  });

  it("rejects invalid thumbnailUrl (not a URL and not null)", () => {
    expect(PhotoSchema.safeParse({ ...validPhoto, thumbnailUrl: "not-a-url" }).success).toBe(false);
  });

  it("rejects missing createdAt", () => {
    const { createdAt: _, ...noCreated } = validPhoto;
    expect(PhotoSchema.safeParse(noCreated).success).toBe(false);
  });

  it("rejects invalid datetime for createdAt", () => {
    expect(PhotoSchema.safeParse({ ...validPhoto, createdAt: "bad" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PhotoUploadRequestSchema
// ---------------------------------------------------------------------------

describe("PhotoUploadRequestSchema", () => {
  it("accepts a valid upload request", () => {
    const result = PhotoUploadRequestSchema.safeParse(validUploadRequest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filename).toBe("ceremony-setup.jpg");
      expect(result.data.contentType).toBe("image/jpeg");
    }
  });

  it("accepts request without caption (defaults to empty string)", () => {
    const { caption: _, ...noCaption } = validUploadRequest;
    const result = PhotoUploadRequestSchema.safeParse(noCaption);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.caption).toBe("");
    }
  });

  it("trims whitespace from filename", () => {
    const result = PhotoUploadRequestSchema.safeParse({ ...validUploadRequest, filename: "  photo.jpg  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filename).toBe("photo.jpg");
    }
  });

  it("rejects empty filename", () => {
    expect(
      PhotoUploadRequestSchema.safeParse({ ...validUploadRequest, filename: "" }).success,
    ).toBe(false);
  });

  it("rejects whitespace-only filename", () => {
    expect(
      PhotoUploadRequestSchema.safeParse({ ...validUploadRequest, filename: "   " }).success,
    ).toBe(false);
  });

  it("rejects filename exceeding 255 characters", () => {
    expect(
      PhotoUploadRequestSchema.safeParse({ ...validUploadRequest, filename: "A".repeat(256) }).success,
    ).toBe(false);
  });

  it("accepts filename of exactly 255 characters", () => {
    expect(
      PhotoUploadRequestSchema.safeParse({ ...validUploadRequest, filename: "A".repeat(251) + ".jpg" }).success,
    ).toBe(true);
  });

  it("rejects missing configurationId", () => {
    const { configurationId: _, ...noConfig } = validUploadRequest;
    expect(PhotoUploadRequestSchema.safeParse(noConfig).success).toBe(false);
  });

  it("rejects invalid UUID for configurationId", () => {
    expect(
      PhotoUploadRequestSchema.safeParse({ ...validUploadRequest, configurationId: "bad" }).success,
    ).toBe(false);
  });

  it("rejects missing filename", () => {
    const { filename: _, ...noFile } = validUploadRequest;
    expect(PhotoUploadRequestSchema.safeParse(noFile).success).toBe(false);
  });

  it("rejects missing contentType", () => {
    const { contentType: _, ...noCt } = validUploadRequest;
    expect(PhotoUploadRequestSchema.safeParse(noCt).success).toBe(false);
  });

  it("rejects invalid contentType", () => {
    expect(
      PhotoUploadRequestSchema.safeParse({ ...validUploadRequest, contentType: "image/gif" }).success,
    ).toBe(false);
  });

  it.each([...ALLOWED_PHOTO_CONTENT_TYPES])("accepts contentType '%s'", (ct) => {
    expect(
      PhotoUploadRequestSchema.safeParse({ ...validUploadRequest, contentType: ct }).success,
    ).toBe(true);
  });

  it("rejects caption exceeding 1000 characters", () => {
    expect(
      PhotoUploadRequestSchema.safeParse({ ...validUploadRequest, caption: "A".repeat(1001) }).success,
    ).toBe(false);
  });

  it("trims whitespace from caption", () => {
    const result = PhotoUploadRequestSchema.safeParse({ ...validUploadRequest, caption: "  Nice  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.caption).toBe("Nice");
    }
  });
});

// ---------------------------------------------------------------------------
// PhotoUploadResponseSchema
// ---------------------------------------------------------------------------

describe("PhotoUploadResponseSchema", () => {
  it("accepts a valid upload response", () => {
    const result = PhotoUploadResponseSchema.safeParse(validUploadResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.photoId).toBe(VALID_UUID);
    }
  });

  it("rejects missing photoId", () => {
    const { photoId: _, ...noId } = validUploadResponse;
    expect(PhotoUploadResponseSchema.safeParse(noId).success).toBe(false);
  });

  it("rejects invalid UUID for photoId", () => {
    expect(
      PhotoUploadResponseSchema.safeParse({ ...validUploadResponse, photoId: "bad" }).success,
    ).toBe(false);
  });

  it("rejects missing presignedUrl", () => {
    const { presignedUrl: _, ...noUrl } = validUploadResponse;
    expect(PhotoUploadResponseSchema.safeParse(noUrl).success).toBe(false);
  });

  it("rejects invalid presignedUrl", () => {
    expect(
      PhotoUploadResponseSchema.safeParse({ ...validUploadResponse, presignedUrl: "not-a-url" }).success,
    ).toBe(false);
  });

  it("rejects empty presignedUrl", () => {
    expect(
      PhotoUploadResponseSchema.safeParse({ ...validUploadResponse, presignedUrl: "" }).success,
    ).toBe(false);
  });

  it("rejects missing expiresAt", () => {
    const { expiresAt: _, ...noExpiry } = validUploadResponse;
    expect(PhotoUploadResponseSchema.safeParse(noExpiry).success).toBe(false);
  });

  it("rejects invalid datetime for expiresAt", () => {
    expect(
      PhotoUploadResponseSchema.safeParse({ ...validUploadResponse, expiresAt: "not-a-date" }).success,
    ).toBe(false);
  });

  it("rejects null for expiresAt", () => {
    expect(
      PhotoUploadResponseSchema.safeParse({ ...validUploadResponse, expiresAt: null }).success,
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
