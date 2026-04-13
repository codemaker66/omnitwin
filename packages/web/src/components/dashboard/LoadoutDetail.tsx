import { useState, useEffect } from "react";
import * as loadoutsApi from "../../api/loadouts.js";
import type { LoadoutDetail as LoadoutDetailData } from "../../api/loadouts.js";
import { FileUploader } from "../shared/FileUploader.js";
import { ConfirmModal } from "../shared/ConfirmModal.js";
import { useToastStore } from "../../stores/toast-store.js";
import { R2_PUBLIC_URL } from "../../config/env.js";

// ---------------------------------------------------------------------------
// LoadoutDetail — photos, upload, reorder, captions
// ---------------------------------------------------------------------------

interface LoadoutDetailProps {
  readonly venueId: string;
  readonly spaceId: string;
  readonly loadoutId: string;
  readonly onBack: () => void;
  readonly onDeleted: () => void;
}

export function LoadoutDetail({ venueId, spaceId, loadoutId, onBack, onDeleted }: LoadoutDetailProps): React.ReactElement {
  const [loadout, setLoadout] = useState<LoadoutDetailData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [editingCaption, setEditingCaption] = useState<string | null>(null);
  const [captionValue, setCaptionValue] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [showDeletePhoto, setShowDeletePhoto] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  const refresh = (): void => {
    setLoadError(false);
    void loadoutsApi.getLoadout(venueId, spaceId, loadoutId).then((data) => {
      setLoadout(data);
      setNameValue(data.name);
    }).catch(() => { setLoadError(true); addToast("Failed to load loadout", "error"); });
  };

  useEffect(refresh, [venueId, spaceId, loadoutId, addToast]);

  const saveName = async (): Promise<void> => {
    if (nameValue.trim() === "" || loadout === null) return;
    try {
      await loadoutsApi.updateLoadout(venueId, spaceId, loadoutId, { name: nameValue.trim() });
      setEditingName(false);
      refresh();
    } catch { addToast("Failed to update name", "error"); }
  };

  const handlePhotoUploaded = async (fileId: string, _filename: string): Promise<void> => {
    try {
      await loadoutsApi.addPhoto(loadoutId, fileId);
      addToast("Photo added", "success");
      refresh();
    } catch { addToast("Failed to link photo", "error"); }
  };

  const saveCaption = async (photoId: string): Promise<void> => {
    try {
      await loadoutsApi.updatePhoto(loadoutId, photoId, { caption: captionValue });
      setEditingCaption(null);
      refresh();
    } catch { addToast("Failed to update caption", "error"); }
  };

  const handleDeletePhoto = async (photoId: string): Promise<void> => {
    try {
      await loadoutsApi.deletePhoto(loadoutId, photoId);
      addToast("Photo removed", "success");
      setShowDeletePhoto(null);
      refresh();
    } catch { addToast("Failed to delete photo", "error"); }
  };

  const handleDeleteLoadout = async (): Promise<void> => {
    try {
      await loadoutsApi.deleteLoadout(venueId, spaceId, loadoutId);
      addToast("Loadout deleted", "success");
      onDeleted();
    } catch { addToast("Failed to delete loadout", "error"); }
  };

  // Punch list #26: native HTML5 drag-and-drop reorder. Dragging a photo card
  // onto another card swaps their positions and persists via reorderPhotos API.
  const handleDrop = (targetId: string): void => {
    if (loadout === null || dragId === null || dragId === targetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const photos = [...loadout.photos];
    const fromIdx = photos.findIndex((p) => p.id === dragId);
    const toIdx = photos.findIndex((p) => p.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = photos.splice(fromIdx, 1);
    if (moved === undefined) return;
    photos.splice(toIdx, 0, moved);
    const orderedIds = photos.map((p) => p.id);
    void loadoutsApi.reorderPhotos(loadoutId, orderedIds)
      .then(() => { refresh(); })
      .catch(() => { addToast("Failed to reorder", "error"); });
    setDragId(null);
    setDragOverId(null);
  };

  // Punch list #37: move a photo up or down in the sort order, then call
  // the reorderPhotos API with the new ordered array of IDs.
  const handleMove = (photoId: string, direction: "up" | "down"): void => {
    if (loadout === null) return;
    const photos = [...loadout.photos];
    const idx = photos.findIndex((p) => p.id === photoId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= photos.length) return;
    const swapTarget = photos[swapIdx];
    const current = photos[idx];
    if (swapTarget === undefined || current === undefined) return;
    photos[swapIdx] = current;
    photos[idx] = swapTarget;
    const orderedIds = photos.map((p) => p.id);
    void loadoutsApi.reorderPhotos(loadoutId, orderedIds)
      .then(() => { refresh(); })
      .catch(() => { addToast("Failed to reorder", "error"); });
  };

  if (loadError) {
    return (
      <div>
        <button type="button" onClick={onBack}
          style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: 13, marginBottom: 16, padding: 0 }}>
          &larr; Back to loadouts
        </button>
        <p style={{ color: "#ef4444" }}>Failed to load loadout.</p>
        <button type="button" onClick={refresh}
          style={{ padding: "6px 12px", fontSize: 13, border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", cursor: "pointer" }}>
          Retry
        </button>
      </div>
    );
  }
  if (loadout === null) return <p style={{ color: "#999" }}>Loading...</p>;

  return (
    <div>
      <button type="button" onClick={onBack}
        style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: 13, marginBottom: 16, padding: 0 }}>
        &larr; Back to loadouts
      </button>

      {/* Name */}
      <div style={{ marginBottom: 20 }}>
        {editingName ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="text" value={nameValue} onChange={(e) => { setNameValue(e.target.value); }}
              style={{ fontSize: 20, fontWeight: 700, border: "1px solid #ddd", borderRadius: 6, padding: "4px 8px" }}
              onKeyDown={(e) => { if (e.key === "Enter") void saveName(); if (e.key === "Escape") setEditingName(false); }} />
            <button type="button" onClick={() => { void saveName(); }}
              style={{ fontSize: 12, color: "#3b82f6", background: "none", border: "none", cursor: "pointer" }}>Save</button>
          </div>
        ) : (
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, cursor: "pointer" }}
            onClick={() => { setEditingName(true); }}>
            {loadout.name} <span style={{ fontSize: 12, color: "#999" }}>click to edit</span>
          </h2>
        )}
        {loadout.description !== null && (
          <p style={{ fontSize: 13, color: "#666", marginTop: 4 }}>{loadout.description}</p>
        )}
      </div>

      {/* Upload */}
      <div style={{ marginBottom: 20 }}>
        <FileUploader context="loadout" contextId={loadoutId} onUploaded={(fileId, filename) => { void handlePhotoUploaded(fileId, filename); }} />
      </div>

      {/* Photos grid */}
      {loadout.photos.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {loadout.photos.map((p, idx) => (
            <div key={p.id}
              draggable
              onDragStart={() => { setDragId(p.id); }}
              onDragEnd={() => { setDragId(null); setDragOverId(null); }}
              onDragOver={(e) => { e.preventDefault(); setDragOverId(p.id); }}
              onDragLeave={() => { setDragOverId(null); }}
              onDrop={(e) => { e.preventDefault(); handleDrop(p.id); }}
              style={{
                background: "#fff", borderRadius: 8, overflow: "hidden", cursor: "grab",
                border: dragOverId === p.id && dragId !== p.id ? "2px solid #3b82f6" : "1px solid #e5e7eb",
                opacity: dragId === p.id ? 0.5 : 1,
                transition: "border-color 0.15s, opacity 0.15s",
              }}>
              {/* Punch list #38: render image preview when R2 URL is configured,
                  fall back to filename text when it isn't. */}
              {R2_PUBLIC_URL !== null ? (
                <img
                  src={`${R2_PUBLIC_URL}/${p.fileKey}`}
                  alt={p.caption ?? p.filename}
                  loading="lazy"
                  style={{ width: "100%", height: 150, objectFit: "cover", display: "block" }}
                  onError={(e) => {
                    // If the image fails to load, show the filename as fallback
                    e.currentTarget.style.display = "none";
                    const parent = e.currentTarget.parentElement;
                    if (parent !== null) {
                      const fallback = document.createElement("div");
                      fallback.style.cssText = "height:150px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:12px;color:#999";
                      fallback.textContent = p.filename;
                      parent.prepend(fallback);
                    }
                  }}
                />
              ) : (
                <div style={{ height: 150, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#999" }}>
                  {p.filename}
                </div>
              )}
              <div style={{ padding: 8 }}>
                {editingCaption === p.id ? (
                  <div style={{ display: "flex", gap: 4 }}>
                    <input type="text" value={captionValue} onChange={(e) => { setCaptionValue(e.target.value); }}
                      style={{ flex: 1, fontSize: 12, padding: 4, border: "1px solid #ddd", borderRadius: 4 }}
                      onKeyDown={(e) => { if (e.key === "Enter") void saveCaption(p.id); if (e.key === "Escape") setEditingCaption(null); }} />
                    <button type="button" onClick={() => { void saveCaption(p.id); }}
                      style={{ fontSize: 11, color: "#3b82f6", background: "none", border: "none", cursor: "pointer" }}>Save</button>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "#666", cursor: "pointer" }}
                    onClick={() => { setEditingCaption(p.id); setCaptionValue(p.caption ?? ""); }}>
                    {p.caption ?? "Add caption..."}
                  </div>
                )}
                {/* Punch list #37: move up/down buttons for reordering */}
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button type="button" disabled={idx === 0}
                    onClick={() => { handleMove(p.id, "up"); }}
                    style={{ fontSize: 11, color: idx === 0 ? "#ccc" : "#3b82f6", background: "none", border: "none", cursor: idx === 0 ? "default" : "pointer", padding: 0 }}>
                    Move Up
                  </button>
                  <button type="button" disabled={idx === loadout.photos.length - 1}
                    onClick={() => { handleMove(p.id, "down"); }}
                    style={{ fontSize: 11, color: idx === loadout.photos.length - 1 ? "#ccc" : "#3b82f6", background: "none", border: "none", cursor: idx === loadout.photos.length - 1 ? "default" : "pointer", padding: 0 }}>
                    Move Down
                  </button>
                  <button type="button" onClick={() => { setShowDeletePhoto(p.id); }}
                    style={{ fontSize: 11, color: "#ef4444", background: "none", border: "none", cursor: "pointer", padding: 0, marginLeft: "auto" }}>
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete loadout */}
      <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid #e5e7eb" }}>
        <button type="button" onClick={() => { setShowDelete(true); }}
          style={{ padding: "8px 16px", fontSize: 13, background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 6, cursor: "pointer" }}>
          Delete Loadout
        </button>
      </div>

      {showDelete && (
        <ConfirmModal
          title="Delete Loadout"
          message={`Are you sure you want to delete "${loadout.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => { void handleDeleteLoadout(); }}
          onCancel={() => { setShowDelete(false); }}
        />
      )}

      {showDeletePhoto !== null && (
        <ConfirmModal
          title="Remove Photo"
          message="Remove this photo from the loadout? The file will not be deleted from storage."
          confirmLabel="Remove"
          onConfirm={() => { void handleDeletePhoto(showDeletePhoto); }}
          onCancel={() => { setShowDeletePhoto(null); }}
        />
      )}
    </div>
  );
}
