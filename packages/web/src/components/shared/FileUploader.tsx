import { useState, useRef } from "react";
import { uploadFile, type UploadProgress } from "../../api/uploads.js";
import { useToastStore } from "../../stores/toast-store.js";

// ---------------------------------------------------------------------------
// FileUploader — presigned URL upload with progress
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Maximum file size in bytes (10 MB). */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface FileUploadStatus {
  readonly file: File;
  readonly progress: number;
  readonly status: "uploading" | "done" | "error";
  readonly fileId: string | null;
  readonly error: string | null;
}

interface FileUploaderProps {
  readonly context: string;
  readonly contextId: string;
  readonly onUploaded: (fileId: string, filename: string) => void;
}

const dropZoneStyle: React.CSSProperties = {
  border: "2px dashed rgba(215,181,109,0.28)", borderRadius: 12, padding: 24,
  textAlign: "center", cursor: "pointer", transition: "none",
  fontSize: 13, color: "rgba(246,241,232,0.68)", fontFamily: "'Inter', sans-serif",
  background: "rgba(255,247,232,0.04)",
};

export function FileUploader({ context, contextId, onUploaded }: FileUploaderProps): React.ReactElement {
  const [uploads, setUploads] = useState<FileUploadStatus[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addToast = useToastStore((s) => s.addToast);

  const handleFiles = (files: FileList | null): void => {
    if (files === null) return;
    const validFiles = Array.from(files).filter((f) => {
      if (!ACCEPTED_TYPES.includes(f.type)) return false;
      if (f.size > MAX_FILE_SIZE) {
        addToast(`${f.name} exceeds 10 MB limit`, "error");
        return false;
      }
      return true;
    });
    if (validFiles.length === 0) {
      addToast("Only JPEG, PNG, and WebP images under 10 MB are accepted", "error");
      return;
    }

    for (const file of validFiles) {
      const entry: FileUploadStatus = { file, progress: 0, status: "uploading", fileId: null, error: null };
      setUploads((prev) => [...prev, entry]);

      void uploadFile(file, context, contextId, (p: UploadProgress) => {
        setUploads((prev) => prev.map((u) =>
          u.file === file ? { ...u, progress: p.percent } : u,
        ));
      }).then(({ fileId }) => {
        setUploads((prev) => prev.map((u) =>
          u.file === file ? { ...u, status: "done" as const, fileId, progress: 100 } : u,
        ));
        onUploaded(fileId, file.name);
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Upload failed";
        setUploads((prev) => prev.map((u) =>
          u.file === file ? { ...u, status: "error" as const, error: message } : u,
        ));
        addToast(`Failed to upload ${file.name}`, "error");
      });
    }
  };

  const retryUpload = (upload: FileUploadStatus): void => {
    setUploads((prev) => prev.map((u) =>
      u.file === upload.file ? { ...u, status: "uploading" as const, progress: 0, error: null } : u,
    ));
    void uploadFile(upload.file, context, contextId, (p: UploadProgress) => {
      setUploads((prev) => prev.map((u) =>
        u.file === upload.file ? { ...u, progress: p.percent } : u,
      ));
    }).then(({ fileId }) => {
      setUploads((prev) => prev.map((u) =>
        u.file === upload.file ? { ...u, status: "done" as const, fileId, progress: 100 } : u,
      ));
      onUploaded(fileId, upload.file.name);
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "Upload failed";
      setUploads((prev) => prev.map((u) =>
        u.file === upload.file ? { ...u, status: "error" as const, error: message } : u,
      ));
    });
  };

  return (
    <div>
      <div
        style={{ ...dropZoneStyle, borderColor: dragOver ? "#68d8d2" : "rgba(215,181,109,0.28)" }}
        onClick={() => { inputRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => { setDragOver(false); }}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        role="button"
        tabIndex={0}
        aria-label="Upload photos"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <div style={{ fontSize: 24, marginBottom: 8 }}>&#128247;</div>
        <div>Click or drag photos here</div>
        <div style={{ fontSize: 11, color: "rgba(246,241,232,0.48)", marginTop: 4 }}>JPEG, PNG, WebP</div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        multiple
        style={{ display: "none" }}
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
      />

      {uploads.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {uploads.map((u) => (
            <div key={`${u.file.name}-${String(u.file.size)}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "rgba(246,241,232,0.72)" }}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {u.file.name}
              </span>
              {u.status === "uploading" && (
                <div style={{ width: 80, height: 6, background: "rgba(255,247,232,0.12)", borderRadius: 3 }}>
                  <div style={{ width: `${String(u.progress)}%`, height: "100%", background: "#68d8d2", borderRadius: 3, transition: "none" }} />
                </div>
              )}
              {u.status === "done" && <span style={{ color: "#22c55e" }}>Done</span>}
              {u.status === "error" && (
                <>
                  <span role="alert" style={{ color: "#ffd89a" }}>{u.error ?? "Upload failed"}</span>
                  <button
                    type="button"
                    onClick={() => { retryUpload(u); }}
                    style={{ background: "none", border: "none", color: "#68d8d2", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}
                  >
                    Retry
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
