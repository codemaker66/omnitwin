import { useCallback, useEffect, useState } from "react";
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

type LoadoutsState = "idle" | "loading" | "loaded" | "error";

const shellStyle: React.CSSProperties = {
  display: "grid",
  gap: 18,
  color: "#fff7e8",
};

const panelStyle: React.CSSProperties = {
  background:
    "linear-gradient(135deg, rgba(255,255,255,0.055), rgba(255,255,255,0.018)), rgba(9,14,16,0.94)",
  border: "1px solid rgba(215, 181, 109, 0.24)",
  borderRadius: 12,
  boxShadow: "0 22px 70px rgba(0,0,0,0.28)",
};

const cardStyle: React.CSSProperties = {
  ...panelStyle,
  padding: 16,
  cursor: "pointer",
  transition: "border-color 0.15s, background 0.15s",
  textAlign: "left",
  width: "100%",
  fontFamily: "inherit",
  color: "#fff7e8",
};

const btnStyle: React.CSSProperties = {
  minHeight: 40,
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 800,
  background: "linear-gradient(135deg, #d7b56d, #f0cf84)",
  color: "#0a0b0b",
  border: "1px solid rgba(255,224,154,0.52)",
  borderRadius: 8,
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: "rgba(255,247,232,0.07)",
  color: "#fff7e8",
  border: "1px solid rgba(215,181,109,0.25)",
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  fontSize: 14,
  border: "1px solid rgba(215,181,109,0.28)",
  borderRadius: 8,
  boxSizing: "border-box",
  background: "rgba(255,247,232,0.08)",
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
  const [spacesError, setSpacesError] = useState<string | null>(null);
  const [loadoutsState, setLoadoutsState] = useState<LoadoutsState>("idle");
  const [loadoutsError, setLoadoutsError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Load spaces. Punch list #36: the early return for empty venueId must
  // also clear the loading flag — otherwise users without a venue
  // (new accounts, client role) see an infinite spinner.
  const loadSpaces = useCallback((): void => {
    if (venueId === "") {
      setSpaces([]);
      setSelectedSpaceId(null);
      setLoading(false);
      setSpacesError(null);
      return;
    }
    setLoading(true);
    setSpacesError(null);
    void spacesApi.listSpaces(venueId)
      .then((list) => {
        setSpaces([...list]);
        setSelectedSpaceId((current) => {
          if (current !== null && list.some((space) => space.id === current)) return current;
          return list[0]?.id ?? null;
        });
      })
      .catch((error: unknown) => {
        setSpaces([]);
        setSelectedSpaceId(null);
        setSpacesError(error instanceof Error ? error.message : "Spaces are unavailable.");
        addToast("Failed to load spaces", "error");
      })
      .finally(() => { setLoading(false); });
  }, [venueId, addToast]);

  useEffect(() => { loadSpaces(); }, [loadSpaces]);

  // Load loadouts for selected space
  const loadSelectedLoadouts = useCallback((): void => {
    if (selectedSpaceId === null || venueId === "") {
      setLoadouts([]);
      setLoadoutsState("idle");
      setLoadoutsError(null);
      return;
    }
    setLoadoutsState("loading");
    setLoadoutsError(null);
    setLoadouts([]);
    void loadoutsApi.listLoadouts(venueId, selectedSpaceId)
      .then((items) => {
        setLoadouts([...items]);
        setLoadoutsState("loaded");
      })
      .catch((error: unknown) => {
        setLoadouts([]);
        setLoadoutsState("error");
        setLoadoutsError(error instanceof Error ? error.message : "Loadouts are unavailable.");
        addToast("Failed to load loadouts", "error");
      });
  }, [selectedSpaceId, venueId, addToast]);

  useEffect(() => { loadSelectedLoadouts(); }, [loadSelectedLoadouts]);

  const handleCreate = async (): Promise<void> => {
    if (selectedSpaceId === null || createName.trim() === "" || createBusy) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      await loadoutsApi.createLoadout(venueId, selectedSpaceId, createName.trim(), createDesc.trim() !== "" ? createDesc.trim() : undefined);
      addToast("Loadout created", "success");
      setShowCreate(false);
      setCreateName("");
      setCreateDesc("");
      // Refresh
      const updated = await loadoutsApi.listLoadouts(venueId, selectedSpaceId);
      setLoadouts(updated);
      setLoadoutsState("loaded");
    } catch (error: unknown) {
      setCreateError(error instanceof Error ? error.message : "Could not create this loadout.");
      addToast("Failed to create loadout", "error");
    } finally {
      setCreateBusy(false);
    }
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
          loadSelectedLoadouts();
        }}
      />
    );
  }

  if (venueId === "") {
    return (
      <section style={{ ...panelStyle, padding: 24 }} role="status">
        <p style={{ color: "#d7b56d", fontSize: 12, fontWeight: 850, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>Reference loadouts</p>
        <h2 style={{ margin: "8px 0", fontSize: 24, fontFamily: "Georgia, 'Times New Roman', serif", letterSpacing: 0 }}>No venue assigned</h2>
        <p style={{ margin: 0, color: "rgba(246,241,232,0.72)", lineHeight: 1.55 }}>
          Reference setup packs are venue-scoped. Ask an admin to attach your user to a venue before creating room setup evidence.
        </p>
      </section>
    );
  }

  return (
    <div style={shellStyle}>
      {/* Space selector */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {spaces.map((s) => (
          <button key={s.id} type="button"
            style={{
              padding: "8px 16px", fontSize: 13, borderRadius: 8, border: "1px solid rgba(215,181,109,0.25)",
              background: s.id === selectedSpaceId ? "rgba(215,181,109,0.2)" : "rgba(255,247,232,0.07)",
              color: s.id === selectedSpaceId ? "#fff7e8" : "rgba(246,241,232,0.72)",
              cursor: "pointer",
            }}
            onClick={() => { setSelectedSpaceId(s.id); }}>
            {s.name}
          </button>
        ))}
      </div>

      <div style={{ ...panelStyle, padding: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p style={{ color: "#68d8d2", fontSize: 12, fontWeight: 850, letterSpacing: "0.08em", margin: 0, textTransform: "uppercase" }}>Operations evidence</p>
          <h3 style={{ fontSize: 22, fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 650, margin: "4px 0 0", letterSpacing: 0 }}>Reference Loadouts</h3>
        </div>
        <button type="button" style={{ ...btnStyle, opacity: selectedSpaceId === null ? 0.5 : 1 }}
          disabled={selectedSpaceId === null}
          onClick={() => { setCreateError(null); setShowCreate(true); }}>New Loadout</button>
      </div>

      {loading && <div role="status" aria-live="polite" style={{ ...panelStyle, padding: 24, color: "rgba(246,241,232,0.72)" }}>Loading room list...</div>}

      {spacesError !== null && (
        <div role="alert" data-testid="loadout-spaces-error" style={alertStyle}>
          <div style={{ marginBottom: 10 }}>Could not load rooms: {spacesError}</div>
          <button type="button" style={secondaryBtnStyle} onClick={loadSpaces}>
            Retry rooms
          </button>
        </div>
      )}

      {!loading && spacesError === null && spaces.length === 0 && (
        <div style={{ ...panelStyle, padding: 24, color: "rgba(246,241,232,0.72)" }}>
          No rooms exist for this venue yet. Add rooms in Admin before documenting reference setup packs.
        </div>
      )}

      {loadoutsState === "loading" && <div role="status" aria-live="polite" style={{ ...panelStyle, padding: 18, color: "rgba(246,241,232,0.72)" }}>Loading setup packs...</div>}

      {loadoutsState === "error" && (
        <div role="alert" data-testid="loadouts-list-error" style={alertStyle}>
          <div style={{ marginBottom: 10 }}>Could not load reference loadouts: {loadoutsError}</div>
          <button type="button" style={secondaryBtnStyle} onClick={loadSelectedLoadouts}>
            Retry loadouts
          </button>
        </div>
      )}

      {!loading && loadoutsState === "loaded" && loadouts.length === 0 && (
        <div style={{ ...panelStyle, padding: 24, color: "rgba(246,241,232,0.72)" }}>No reference loadouts yet. Create one to start documenting room setups with photos.</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {loadouts.map((l) => (
          <button
            key={l.id}
            type="button"
            style={cardStyle}
            onClick={() => { setSelectedLoadoutId(l.id); }}
            aria-label={`Open reference loadout ${l.name}`}
          >
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{l.name}</div>
            <div style={{ fontSize: 12, color: "rgba(246,241,232,0.62)" }}>
              {String(l.photoCount)} photo{l.photoCount === 1 ? "" : "s"}
            </div>
          </button>
        ))}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.68)", backdropFilter: "blur(14px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }}
          onClick={() => { if (!createBusy) setShowCreate(false); }}
          onKeyDown={(e) => { if (e.key === "Escape" && !createBusy) setShowCreate(false); }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="loadout-create-title"
          tabIndex={-1}
        >
          <div style={{ ...panelStyle, padding: 24, width: 420, maxWidth: "90vw" }} onClick={(e) => { e.stopPropagation(); }}>
            <h3 id="loadout-create-title" style={{ fontSize: 20, fontWeight: 700, margin: "0 0 16px", color: "#fff7e8" }}>New Reference Loadout</h3>
            {createError !== null && (
              <div role="alert" data-testid="loadout-create-error" style={{ ...alertStyle, marginBottom: 12 }}>
                {createError}
              </div>
            )}
            <div style={{ marginBottom: 12 }}>
              <label htmlFor="loadout-create-name" style={{ fontSize: 12, fontWeight: 800, color: "#f1c978", display: "block", marginBottom: 4 }}>Name *</label>
              <input id="loadout-create-name" type="text" value={createName} onChange={(e) => { setCreateName(e.target.value); }}
                style={fieldStyle}
                placeholder="e.g. Masonic Lodge Setup" />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="loadout-create-description" style={{ fontSize: 12, fontWeight: 800, color: "#f1c978", display: "block", marginBottom: 4 }}>Description</label>
              <textarea id="loadout-create-description" value={createDesc} onChange={(e) => { setCreateDesc(e.target.value); }}
                style={{ ...fieldStyle, minHeight: 70, resize: "vertical" }}
                placeholder="Full ceremonial layout with altar table..." />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => { setShowCreate(false); }}
                disabled={createBusy}
                style={secondaryBtnStyle}>Cancel</button>
              <button type="button" onClick={() => { void handleCreate(); }}
                style={{ ...btnStyle, opacity: createName.trim() === "" || createBusy ? 0.5 : 1 }}
                disabled={createName.trim() === "" || createBusy}>{createBusy ? "Creating..." : "Create"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
