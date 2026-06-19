import { useCallback, useEffect, useState } from "react";
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

type DetailLoadState = "loading" | "loaded" | "error";

const panelStyle: React.CSSProperties = {
  background:
    "linear-gradient(135deg, rgba(255,255,255,0.055), rgba(255,255,255,0.018)), rgba(9,14,16,0.94)",
  border: "1px solid rgba(215, 181, 109, 0.24)",
  borderRadius: 12,
  boxShadow: "0 22px 70px rgba(0,0,0,0.28)",
  color: "#fff7e8",
};

const alertStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 8,
  border: "1px solid rgba(255, 181, 82, 0.38)",
  background: "rgba(255, 181, 82, 0.09)",
  color: "#ffd89a",
  fontSize: 13,
  lineHeight: 1.45,
};

const primaryButtonStyle: React.CSSProperties = {
  minHeight: 40,
  padding: "8px 16px",
  borderRadius: 8,
  border: "1px solid rgba(255,224,154,0.52)",
  background: "linear-gradient(135deg, #d7b56d, #f0cf84)",
  color: "#0a0b0b",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 800,
  fontFamily: "inherit",
};

const linkButtonStyle: React.CSSProperties = {
  color: "#68d8d2",
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 0,
  fontFamily: "inherit",
};

export function LoadoutDetail({ venueId, spaceId, loadoutId, onBack, onDeleted }: LoadoutDetailProps): React.ReactElement {
  const [loadout, setLoadout] = useState<LoadoutDetailData | null>(null);
  const [loadState, setLoadState] = useState<DetailLoadState>("loading");
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [editingCaption, setEditingCaption] = useState<string | null>(null);
  const [captionValue, setCaptionValue] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [showDeletePhoto, setShowDeletePhoto] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  const refresh = useCallback((): void => {
    setLoadState("loading");
    setLoadErrorMessage(null);
    setActionError(null);
    void loadoutsApi.getLoadout(venueId, spaceId, loadoutId).then((data) => {
      setLoadout(data);
      setNameValue(data.name);
      setLoadState("loaded");
    }).catch((error: unknown) => {
      setLoadout(null);
      setLoadState("error");
      setLoadErrorMessage(error instanceof Error ? error.message : "Loadout unavailable.");
      addToast("Failed to load loadout", "error");
    });
  }, [venueId, spaceId, loadoutId, addToast]);

  useEffect(refresh, [refresh]);

  const saveName = async (): Promise<void> => {
    if (nameValue.trim() === "" || loadout === null || busyAction !== null) return;
    setBusyAction("name");
    setActionError(null);
    try {
      await loadoutsApi.updateLoadout(venueId, spaceId, loadoutId, { name: nameValue.trim() });
      setEditingName(false);
      refresh();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not update this loadout name.");
      addToast("Failed to update name", "error");
    } finally {
      setBusyAction(null);
    }
  };

  const handlePhotoUploaded = async (fileId: string, _filename: string): Promise<void> => {
    if (busyAction !== null) return;
    setBusyAction("photo-link");
    setActionError(null);
    try {
      await loadoutsApi.addPhoto(loadoutId, fileId);
      addToast("Photo added", "success");
      refresh();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Uploaded file could not be linked to this loadout.");
      addToast("Failed to link photo", "error");
    } finally {
      setBusyAction(null);
    }
  };

  const saveCaption = async (photoId: string): Promise<void> => {
    if (busyAction !== null) return;
    setBusyAction(`caption:${photoId}`);
    setActionError(null);
    try {
      await loadoutsApi.updatePhoto(loadoutId, photoId, { caption: captionValue });
      setEditingCaption(null);
      refresh();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not update this photo caption.");
      addToast("Failed to update caption", "error");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeletePhoto = async (photoId: string): Promise<void> => {
    if (busyAction !== null) return;
    setBusyAction(`delete-photo:${photoId}`);
    setActionError(null);
    try {
      await loadoutsApi.deletePhoto(loadoutId, photoId);
      addToast("Photo removed", "success");
      setShowDeletePhoto(null);
      refresh();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not remove this photo from the loadout.");
      addToast("Failed to delete photo", "error");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteLoadout = async (): Promise<void> => {
    if (busyAction !== null) return;
    setBusyAction("delete-loadout");
    setActionError(null);
    try {
      await loadoutsApi.deleteLoadout(venueId, spaceId, loadoutId);
      addToast("Loadout deleted", "success");
      onDeleted();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not delete this loadout.");
      addToast("Failed to delete loadout", "error");
    } finally {
      setBusyAction(null);
    }
  };

  // Punch list #26: native HTML5 drag-and-drop reorder. Dragging a photo card
  // onto another card swaps their positions and persists via reorderPhotos API.
  const handleDrop = (targetId: string): void => {
    if (loadout === null || dragId === null || dragId === targetId || busyAction !== null) {
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
    setBusyAction("reorder");
    setActionError(null);
    void loadoutsApi.reorderPhotos(loadoutId, orderedIds)
      .then(() => { refresh(); })
      .catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : "Could not save the new photo order.");
        addToast("Failed to reorder", "error");
      })
      .finally(() => { setBusyAction(null); });
    setDragId(null);
    setDragOverId(null);
  };

  // Punch list #37: move a photo up or down in the sort order, then call
  // the reorderPhotos API with the new ordered array of IDs.
  const handleMove = (photoId: string, direction: "up" | "down"): void => {
    if (loadout === null || busyAction !== null) return;
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
    setBusyAction("reorder");
    setActionError(null);
    void loadoutsApi.reorderPhotos(loadoutId, orderedIds)
      .then(() => { refresh(); })
      .catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : "Could not save the new photo order.");
        addToast("Failed to reorder", "error");
      })
      .finally(() => { setBusyAction(null); });
  };

  if (loadState === "error") {
    return (
      <div style={{ display: "grid", gap: 14, color: "#fff7e8" }}>
        <button type="button" onClick={onBack}
          style={{ ...linkButtonStyle, fontSize: 13, marginBottom: 4 }}>
          &larr; Back to loadouts
        </button>
        <section style={{ ...panelStyle, padding: 24 }} role="alert" data-testid="loadout-detail-error">
          <p style={{ color: "#d7b56d", fontSize: 12, fontWeight: 850, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>Reference loadout</p>
          <h2 style={{ margin: "8px 0", fontSize: 24, fontFamily: "Georgia, 'Times New Roman', serif", letterSpacing: 0 }}>Loadout unavailable</h2>
          <p style={{ color: "rgba(246,241,232,0.72)", lineHeight: 1.55 }}>
            {loadErrorMessage ?? "Failed to load this reference setup pack."}
          </p>
        </section>
        <button type="button" onClick={refresh}
          style={{ ...primaryButtonStyle, justifySelf: "start" }}>
          Retry
        </button>
      </div>
    );
  }
  if (loadState === "loading" || loadout === null) {
    return <div role="status" aria-live="polite" style={{ ...panelStyle, padding: 24 }}>Loading reference loadout...</div>;
  }

  return (
    <div style={{ display: "grid", gap: 18, color: "#fff7e8" }}>
      <button type="button" onClick={onBack}
        style={{ ...linkButtonStyle, fontSize: 13, justifySelf: "start" }}>
        &larr; Back to loadouts
      </button>

      {actionError !== null && (
        <div role="alert" data-testid="loadout-action-error" style={alertStyle}>
          {actionError}
        </div>
      )}

      {/* Name */}
      <div style={{ ...panelStyle, padding: 20 }}>
        {editingName ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              aria-label="Loadout name"
              value={nameValue}
              onChange={(e) => { setNameValue(e.target.value); }}
              style={{
                fontSize: 20,
                fontWeight: 700,
                border: "1px solid rgba(215,181,109,0.28)",
                borderRadius: 8,
                padding: "6px 10px",
                color: "#fff7e8",
                background: "rgba(255,247,232,0.08)",
              }}
              onKeyDown={(e) => { if (e.key === "Enter") void saveName(); if (e.key === "Escape") setEditingName(false); }}
            />
            <button type="button" onClick={() => { void saveName(); }}
              disabled={busyAction !== null || nameValue.trim() === ""}
              style={{ ...linkButtonStyle, fontSize: 12 }}>{busyAction === "name" ? "Saving..." : "Save"}</button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
              {loadout.name}
            </h2>
            <button
              type="button"
              onClick={() => { setEditingName(true); }}
              style={{
                fontSize: 12,
                color: "#68d8d2",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                fontFamily: "inherit",
              }}
            >
              Edit name
            </button>
          </div>
        )}
        {loadout.description !== null && (
          <p style={{ fontSize: 13, color: "rgba(246,241,232,0.66)", marginTop: 4 }}>{loadout.description}</p>
        )}
      </div>

      {/* Upload */}
      <div style={{ ...panelStyle, padding: 18 }}>
        <FileUploader context="loadout" contextId={loadoutId} onUploaded={(fileId, filename) => { void handlePhotoUploaded(fileId, filename); }} />
        {busyAction === "photo-link" && (
          <p role="status" style={{ margin: "10px 0 0", color: "rgba(246,241,232,0.66)", fontSize: 13 }}>
            Linking uploaded photo to this reference loadout...
          </p>
        )}
      </div>

      {/* Photos grid */}
      {loadout.photos.length === 0 && (
        <section style={{ ...panelStyle, padding: 20, color: "rgba(246,241,232,0.72)" }}>
          No photos have been attached yet. Add at least one setup reference before relying on this pack for hallkeeper preparation.
        </section>
      )}

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
                background: "rgba(255,247,232,0.05)", borderRadius: 8, overflow: "hidden", cursor: "grab",
                border: dragOverId === p.id && dragId !== p.id ? "2px solid #68d8d2" : "1px solid rgba(215,181,109,0.22)",
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
                    <input
                      type="text"
                      aria-label={`Caption for ${p.filename}`}
                      value={captionValue}
                      onChange={(e) => { setCaptionValue(e.target.value); }}
                      style={{ flex: 1, fontSize: 12, padding: 6, border: "1px solid rgba(215,181,109,0.28)", borderRadius: 6, color: "#fff7e8", background: "rgba(255,247,232,0.08)" }}
                      onKeyDown={(e) => { if (e.key === "Enter") void saveCaption(p.id); if (e.key === "Escape") setEditingCaption(null); }}
                    />
                    <button type="button" onClick={() => { void saveCaption(p.id); }}
                      disabled={busyAction !== null}
                      style={{ ...linkButtonStyle, fontSize: 11 }}>{busyAction === `caption:${p.id}` ? "Saving..." : "Save"}</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    style={{
                      fontSize: 12,
                      color: "rgba(246,241,232,0.66)",
                      cursor: "pointer",
                      background: "none",
                      border: "none",
                      padding: 0,
                      textAlign: "left",
                      fontFamily: "inherit",
                    }}
                    onClick={() => { setEditingCaption(p.id); setCaptionValue(p.caption ?? ""); }}
                  >
                    {p.caption ?? "Add caption..."}
                  </button>
                )}
                {/* Punch list #37: move up/down buttons for reordering */}
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button type="button" disabled={idx === 0 || busyAction !== null}
                    aria-label={`Move ${p.filename} up`}
                    onClick={() => { handleMove(p.id, "up"); }}
                    style={{ fontSize: 11, color: idx === 0 ? "rgba(246,241,232,0.34)" : "#68d8d2", background: "none", border: "none", cursor: idx === 0 || busyAction !== null ? "default" : "pointer", padding: 0 }}>
                    Move Up
                  </button>
                  <button type="button" disabled={idx === loadout.photos.length - 1 || busyAction !== null}
                    aria-label={`Move ${p.filename} down`}
                    onClick={() => { handleMove(p.id, "down"); }}
                    style={{ fontSize: 11, color: idx === loadout.photos.length - 1 ? "rgba(246,241,232,0.34)" : "#68d8d2", background: "none", border: "none", cursor: idx === loadout.photos.length - 1 || busyAction !== null ? "default" : "pointer", padding: 0 }}>
                    Move Down
                  </button>
                  <button type="button" aria-label={`Remove ${p.filename}`} onClick={() => { setShowDeletePhoto(p.id); }}
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
      <div style={{ ...panelStyle, padding: 18 }}>
        <button type="button" onClick={() => { setShowDelete(true); }}
          disabled={busyAction !== null}
          style={{ padding: "8px 16px", minHeight: 40, fontSize: 13, fontWeight: 800, background: "rgba(255,91,71,0.14)", color: "#ffd2bd", border: "1px solid rgba(255,125,91,0.42)", borderRadius: 8, cursor: "pointer" }}>
          Delete Loadout
        </button>
      </div>

      {showDelete && (
        <ConfirmModal
          title="Delete Loadout"
          message={`Are you sure you want to delete "${loadout.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          inFlight={busyAction === "delete-loadout"}
          errorMessage={actionError}
          onConfirm={() => { void handleDeleteLoadout(); }}
          onCancel={() => { setShowDelete(false); }}
        />
      )}

      {showDeletePhoto !== null && (
        <ConfirmModal
          title="Remove Photo"
          message="Remove this photo from the loadout? The file will not be deleted from storage."
          confirmLabel="Remove"
          inFlight={busyAction?.startsWith("delete-photo:") === true}
          errorMessage={actionError}
          onConfirm={() => { void handleDeletePhoto(showDeletePhoto); }}
          onCancel={() => { setShowDeletePhoto(null); }}
        />
      )}
    </div>
  );
}
