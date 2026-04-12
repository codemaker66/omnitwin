import { useState, useEffect } from "react";
import * as spacesApi from "../../api/spaces.js";
import * as loadoutsApi from "../../api/loadouts.js";
import type { Space } from "../../api/spaces.js";
import type { Loadout } from "../../api/loadouts.js";
import { LoadoutDetail } from "./LoadoutDetail.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useToastStore } from "../../stores/toast-store.js";

// ---------------------------------------------------------------------------
// LoadoutsView — space selector + loadout grid + create
// ---------------------------------------------------------------------------

const cardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 8, padding: 16, border: "1px solid #e5e7eb",
  cursor: "pointer", transition: "box-shadow 0.15s",
};

const btnStyle: React.CSSProperties = {
  padding: "8px 16px", fontSize: 13, fontWeight: 600, background: "#3b82f6",
  color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
};

export function LoadoutsView(): React.ReactElement {
  const venueId = useAuthStore((s) => s.user?.venueId) ?? "";
  const addToast = useToastStore((s) => s.addToast);

  const [spaces, setSpaces] = useState<Space[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [loadouts, setLoadouts] = useState<Loadout[]>([]);
  const [selectedLoadoutId, setSelectedLoadoutId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [loading, setLoading] = useState(true);

  // Load spaces. Punch list #36: the early return for empty venueId must
  // also clear the loading flag — otherwise users without a venue
  // (new accounts, client role) see an infinite spinner.
  useEffect(() => {
    if (venueId === "") {
      setLoading(false);
      return;
    }
    void spacesApi.listSpaces(venueId).then(setSpaces).catch(() => { addToast("Failed to load spaces", "error"); })
      .finally(() => { setLoading(false); });
  }, [venueId, addToast]);

  // Auto-select first space
  useEffect(() => {
    if (spaces.length > 0 && selectedSpaceId === null && spaces[0] !== undefined) {
      setSelectedSpaceId(spaces[0].id);
    }
  }, [spaces, selectedSpaceId]);

  // Load loadouts for selected space
  useEffect(() => {
    if (selectedSpaceId === null || venueId === "") return;
    void loadoutsApi.listLoadouts(venueId, selectedSpaceId).then(setLoadouts).catch(() => { /* ignore */ });
  }, [selectedSpaceId, venueId]);

  const handleCreate = async (): Promise<void> => {
    if (selectedSpaceId === null || createName.trim() === "") return;
    try {
      await loadoutsApi.createLoadout(venueId, selectedSpaceId, createName.trim(), createDesc.trim() !== "" ? createDesc.trim() : undefined);
      addToast("Loadout created", "success");
      setShowCreate(false);
      setCreateName("");
      setCreateDesc("");
      // Refresh
      const updated = await loadoutsApi.listLoadouts(venueId, selectedSpaceId);
      setLoadouts(updated);
    } catch { addToast("Failed to create loadout", "error"); }
  };

  if (selectedLoadoutId !== null && selectedSpaceId !== null) {
    return (
      <LoadoutDetail
        venueId={venueId}
        spaceId={selectedSpaceId}
        loadoutId={selectedLoadoutId}
        onBack={() => { setSelectedLoadoutId(null); }}
        onDeleted={() => {
          setSelectedLoadoutId(null);
          // selectedSpaceId is already non-null in this branch (see outer guard).
          void loadoutsApi.listLoadouts(venueId, selectedSpaceId).then(setLoadouts).catch(() => { /* ignore */ });
        }}
      />
    );
  }

  return (
    <div>
      {/* Space selector */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {spaces.map((s) => (
          <button key={s.id} type="button"
            style={{
              padding: "8px 16px", fontSize: 13, borderRadius: 6, border: "1px solid #e5e7eb",
              background: s.id === selectedSpaceId ? "#1a1a2e" : "#fff",
              color: s.id === selectedSpaceId ? "#fff" : "#333",
              cursor: "pointer",
            }}
            onClick={() => { setSelectedSpaceId(s.id); }}>
            {s.name}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Reference Loadouts</h3>
        <button type="button" style={btnStyle} onClick={() => { setShowCreate(true); }}>New Loadout</button>
      </div>

      {loading && <p style={{ color: "#999" }}>Loading...</p>}

      {!loading && loadouts.length === 0 && (
        <p style={{ color: "#999", fontSize: 14 }}>No reference loadouts yet. Create one to start documenting room setups with photos.</p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {loadouts.map((l) => (
          <div key={l.id} style={cardStyle} onClick={() => { setSelectedLoadoutId(l.id); }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{l.name}</div>
            <div style={{ fontSize: 12, color: "#999" }}>
              {String(l.photoCount)} photo{l.photoCount === 1 ? "" : "s"}
            </div>
          </div>
        ))}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }}
          onClick={() => { setShowCreate(false); }} onKeyDown={(e) => { if (e.key === "Escape") setShowCreate(false); }} role="dialog" tabIndex={-1}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 400, maxWidth: "90vw" }} onClick={(e) => { e.stopPropagation(); }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>New Reference Loadout</h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Name *</label>
              <input type="text" value={createName} onChange={(e) => { setCreateName(e.target.value); }}
                style={{ width: "100%", padding: 8, fontSize: 14, border: "1px solid #ddd", borderRadius: 6, boxSizing: "border-box" }}
                placeholder="e.g. Masonic Lodge Setup" />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Description</label>
              <textarea value={createDesc} onChange={(e) => { setCreateDesc(e.target.value); }}
                style={{ width: "100%", padding: 8, fontSize: 14, border: "1px solid #ddd", borderRadius: 6, boxSizing: "border-box", minHeight: 60 }}
                placeholder="Full ceremonial layout with altar table..." />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => { setShowCreate(false); }}
                style={{ padding: "8px 16px", fontSize: 13, background: "#f3f4f6", border: "none", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
              <button type="button" onClick={() => { void handleCreate(); }}
                style={{ ...btnStyle, opacity: createName.trim() === "" ? 0.5 : 1 }} disabled={createName.trim() === ""}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
