import { useState, useEffect } from "react";
import * as loadoutsApi from "../../api/loadouts.js";
import type { LoadoutDetail as LoadoutDetailData } from "../../api/loadouts.js";
import { FileUploader } from "../shared/FileUploader.js";
import { ConfirmModal } from "../shared/ConfirmModal.js";
import { useToastStore } from "../../stores/toast-store.js";

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
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [editingCaption, setEditingCaption] = useState<string | null>(null);
  const [captionValue, setCaptionValue] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [showDeletePhoto, setShowDeletePhoto] = useState<string | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  const refresh = (): void => {
    void loadoutsApi.getLoadout(venueId, spaceId, loadoutId).then((data) => {
      setLoadout(data);
      setNameValue(data.name);
    }).catch(() => { addToast("Failed to load loadout", "error"); });
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
          {loadout.photos.map((p) => (
            <div key={p.id} style={{ background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb", overflow: "hidden" }}>
              <div style={{ height: 150, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#999" }}>
                {p.filename}
              </div>
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
                <button type="button" onClick={() => { setShowDeletePhoto(p.id); }}
                  style={{ marginTop: 4, fontSize: 11, color: "#ef4444", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  Remove
                </button>
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
