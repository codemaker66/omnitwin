import { api, ApiError } from "./client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PresignedUrlResponse {
  readonly uploadUrl: string;
  readonly fileKey: string;
  readonly publicUrl: string | null;
  readonly readUrl: string | null;
  readonly fileId: string;
  readonly visibility: "private" | "public";
}

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
  return api.post<PresignedUrlResponse>("/uploads/presigned", {
    filename, contentType, contentLengthBytes, context, contextId,
  });
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
