import { z } from "zod";
import { api, ApiError } from "./client.js";

// ---------------------------------------------------------------------------
// Response schemas — Zod validation at the API boundary.
//
// The presign response is parsed from server JSON, so it is validated. A
// drifted shape (e.g. a missing fileId or a non-URL field) now fails loudly
// at the network boundary instead of producing a broken upload deep in the
// flow. UploadProgress is a client-local XHR construct, not server JSON, so
// it stays a plain interface.
// ---------------------------------------------------------------------------

const PresignedUrlResponseSchema = z.object({
  uploadUrl: z.string(),
  fileKey: z.string(),
  publicUrl: z.string().nullable(),
  readUrl: z.string().nullable(),
  fileId: z.string(),
  visibility: z.enum(["private", "public"]),
});

export type PresignedUrlResponse = z.infer<typeof PresignedUrlResponseSchema>;

export interface UploadProgress {
  readonly loaded: number;
  readonly total: number;
  readonly percent: number;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function getPresignedUrl(
  filename: string,
  contentType: string,
  contentLengthBytes: number,
  context: string,
  contextId: string,
): Promise<PresignedUrlResponse> {
  return api.post("/uploads/presigned", {
    filename, contentType, contentLengthBytes, context, contextId,
  }, undefined, PresignedUrlResponseSchema);
}

/**
 * Upload a file directly to R2 via presigned URL.
 * Returns when complete. Progress callback is optional.
 */
export async function uploadToR2(
  presignedUrl: string,
  file: File,
  onProgress?: (progress: UploadProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", presignedUrl);
    xhr.setRequestHeader("Content-Type", file.type);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress !== undefined) {
        onProgress({
          loaded: e.loaded,
          total: e.total,
          percent: Math.round((e.loaded / e.total) * 100),
        });
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new ApiError(xhr.status, "Upload failed", "UPLOAD_ERROR"));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new ApiError(0, "Upload failed — check your connection", "NETWORK_ERROR"));
    });

    xhr.send(file);
  });
}

/**
 * Full upload flow: get presigned URL -> upload to R2 -> return fileId.
 */
export async function uploadFile(
  file: File,
  context: string,
  contextId: string,
  onProgress?: (progress: UploadProgress) => void,
): Promise<{ fileId: string; publicUrl: string | null }> {
  const presigned = await getPresignedUrl(file.name, file.type, file.size, context, contextId);
  await uploadToR2(presigned.uploadUrl, file, onProgress);
  return { fileId: presigned.fileId, publicUrl: presigned.publicUrl };
}
