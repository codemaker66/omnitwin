import { useState, useEffect } from "react";
import * as spacesApi from "../../api/spaces.js";
import * as pricingApi from "../../api/pricing.js";
import type { Venue, VenueDetail, Space } from "../../api/spaces.js";
import type { PricingRule } from "../../api/pricing.js";
import { useToastStore } from "../../stores/toast-store.js";
import { ConfirmModal } from "../shared/ConfirmModal.js";

// ---------------------------------------------------------------------------
// AdminPanel — venue + space management for admin users
//
// Punch list #27: the backend CRUD for venues and spaces already existed
// but there were zero admin-facing screens. This component provides:
//   - List all venues with space counts
//   - Create a new venue
//   - View + manage spaces within a selected venue
//   - Create a new space within a venue
// ---------------------------------------------------------------------------

const cardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 8, padding: 16, border: "1px solid #e5e7eb",
  cursor: "pointer", transition: "box-shadow 0.15s",
};

const btnPrimary: React.CSSProperties = {
  padding: "8px 16px", fontSize: 13, fontWeight: 600, background: "#3b82f6",
  color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  padding: "8px 16px", fontSize: 13, fontWeight: 500, background: "none",
  color: "#3b82f6", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", fontSize: 14, border: "1px solid #d1d5db",
  borderRadius: 6, boxSizing: "border-box", fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4,
};

/** Generate a slug from a name string. */
function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Rectangular floor plan outline for a given width and length. */
function rectOutline(w: number, l: number): readonly { readonly x: number; readonly y: number }[] {
  const hw = w / 2;
  const hl = l / 2;
  return [{ x: -hw, y: -hl }, { x: hw, y: -hl }, { x: hw, y: hl }, { x: -hw, y: hl }];
}

export function AdminPanel(): React.ReactElement {
  const addToast = useToastStore((s) => s.addToast);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVenue, setSelectedVenue] = useState<VenueDetail | null>(null);
  const [showCreateVenue, setShowCreateVenue] = useState(false);
  const [showCreateSpace, setShowCreateSpace] = useState(false);

  // Create venue form
  const [venueName, setVenueName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");

  // Create space form
  const [spaceName, setSpaceName] = useState("");
  const [spaceWidth, setSpaceWidth] = useState("");
  const [spaceLength, setSpaceLength] = useState("");
  const [spaceHeight, setSpaceHeight] = useState("");

  // Venue delete
  const [showDeleteVenue, setShowDeleteVenue] = useState(false);

  // Space edit/delete
  const [editingSpace, setEditingSpace] = useState<Space | null>(null);
  const [editSpaceName, setEditSpaceName] = useState("");
  const [editSpaceWidth, setEditSpaceWidth] = useState("");
  const [editSpaceLength, setEditSpaceLength] = useState("");
  const [editSpaceHeight, setEditSpaceHeight] = useState("");
  const [deletingSpaceId, setDeletingSpaceId] = useState<string | null>(null);

  // Pricing rules
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [ruleType, setRuleType] = useState<PricingRule["type"]>("flat_rate");
  const [ruleAmount, setRuleAmount] = useState("");
  const [ruleSpaceId, setRuleSpaceId] = useState("");

  const loadVenues = (): void => {
    void spacesApi.listVenues()
      .then(setVenues)
      .catch(() => { addToast("Failed to load venues", "error"); })
      .finally(() => { setLoading(false); });
  };

  useEffect(loadVenues, [addToast]);

  const handleSelectVenue = (venueId: string): void => {
    // Clear stale pricing rules immediately so the previous venue's rules
    // are never shown under the newly selected venue (F22).
    setPricingRules([]);
    void spacesApi.getVenue(venueId)
      .then((v) => {
        setSelectedVenue(v);
        void pricingApi.listPricingRules(venueId)
          .then(setPricingRules)
          .catch(() => { /* non-critical */ });
      })
      .catch(() => { addToast("Failed to load venue", "error"); });
  };

  const handleCreateRule = async (): Promise<void> => {
    if (selectedVenue === null || ruleName.trim() === "") return;
    const amount = parseFloat(ruleAmount);
    if (Number.isNaN(amount) || amount < 0) {
      addToast("Amount must be a non-negative number", "error");
      return;
    }
    try {
      await pricingApi.createPricingRule(selectedVenue.id, {
        name: ruleName.trim(),
        type: ruleType,
        amount,
        spaceId: ruleSpaceId !== "" ? ruleSpaceId : null,
      });
      addToast("Pricing rule created", "success");
      setShowCreateRule(false);
      setRuleName("");
      setRuleAmount("");
      setRuleSpaceId("");
      void pricingApi.listPricingRules(selectedVenue.id).then(setPricingRules).catch(() => { /* ignore */ });
    } catch {
      addToast("Failed to create pricing rule", "error");
    }
  };

  const handleDeleteRule = async (ruleId: string): Promise<void> => {
    if (selectedVenue === null) return;
    try {
      await pricingApi.deletePricingRule(selectedVenue.id, ruleId);
      addToast("Pricing rule deleted", "success");
      void pricingApi.listPricingRules(selectedVenue.id).then(setPricingRules).catch(() => { /* ignore */ });
    } catch {
      addToast("Failed to delete pricing rule", "error");
    }
  };

  const handleCreateVenue = async (): Promise<void> => {
    if (venueName.trim() === "" || venueAddress.trim() === "") return;
    try {
      await spacesApi.createVenue({
        name: venueName.trim(),
        slug: slugify(venueName),
        address: venueAddress.trim(),
      });
      addToast("Venue created", "success");
      setShowCreateVenue(false);
      setVenueName("");
      setVenueAddress("");
      loadVenues();
    } catch {
      addToast("Failed to create venue", "error");
    }
  };

  const handleCreateSpace = async (): Promise<void> => {
    if (selectedVenue === null || spaceName.trim() === "") return;
    const w = parseFloat(spaceWidth);
    const l = parseFloat(spaceLength);
    const h = parseFloat(spaceHeight);
    if (Number.isNaN(w) || Number.isNaN(l) || Number.isNaN(h) || w <= 0 || l <= 0 || h <= 0) {
      addToast("Dimensions must be positive numbers", "error");
      return;
    }
    try {
      await spacesApi.createSpace(selectedVenue.id, {
        name: spaceName.trim(),
        slug: slugify(spaceName),
        widthM: w,
        lengthM: l,
        heightM: h,
        floorPlanOutline: rectOutline(w, l),
      });
      addToast("Space created", "success");
      setShowCreateSpace(false);
      setSpaceName("");
      setSpaceWidth("");
      setSpaceLength("");
      setSpaceHeight("");
      handleSelectVenue(selectedVenue.id);
    } catch {
      addToast("Failed to create space", "error");
    }
  };

  const handleDeleteVenue = async (): Promise<void> => {
    if (selectedVenue === null) return;
    try {
      await spacesApi.deleteVenue(selectedVenue.id);
      addToast("Venue deleted", "success");
      setSelectedVenue(null);
      setShowDeleteVenue(false);
      loadVenues();
    } catch {
      addToast("Failed to delete venue", "error");
    }
  };

  const openEditSpace = (space: Space): void => {
    setEditingSpace(space);
    setEditSpaceName(space.name);
    setEditSpaceWidth(space.widthM);
    setEditSpaceLength(space.lengthM);
    setEditSpaceHeight(space.heightM);
  };

  const handleEditSpace = async (): Promise<void> => {
    if (selectedVenue === null || editingSpace === null) return;
    const w = parseFloat(editSpaceWidth);
    const l = parseFloat(editSpaceLength);
    const h = parseFloat(editSpaceHeight);
    if (editSpaceName.trim() === "" || Number.isNaN(w) || Number.isNaN(l) || Number.isNaN(h) || w <= 0 || l <= 0 || h <= 0) {
      addToast("Name and positive dimensions required", "error");
      return;
    }
    try {
      await spacesApi.updateSpace(selectedVenue.id, editingSpace.id, {
        name: editSpaceName.trim(),
        widthM: w,
        lengthM: l,
        heightM: h,
      });
      addToast("Space updated", "success");
      setEditingSpace(null);
      handleSelectVenue(selectedVenue.id);
    } catch {
      addToast("Failed to update space", "error");
    }
  };

  const handleDeleteSpace = async (spaceId: string): Promise<void> => {
    if (selectedVenue === null) return;
    try {
      await spacesApi.deleteSpace(selectedVenue.id, spaceId);
      addToast("Space deleted", "success");
      setDeletingSpaceId(null);
      handleSelectVenue(selectedVenue.id);
    } catch {
      addToast("Failed to delete space", "error");
    }
  };

  // --- Venue detail view ---
  if (selectedVenue !== null) {
    return (
      <div>
        <button type="button" onClick={() => { setSelectedVenue(null); }}
          style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: 13, marginBottom: 16, padding: 0 }}>
          &larr; Back to venues
        </button>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{selectedVenue.name}</h2>
            <p style={{ fontSize: 13, color: "#666", marginBottom: 20 }}>{selectedVenue.address}</p>
          </div>
          <button type="button" onClick={() => { setShowDeleteVenue(true); }}
            style={{ fontSize: 12, color: "#dc2626", background: "#fee2e2", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>
            Delete Venue
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
            Spaces ({selectedVenue.spaces.length})
          </h3>
          <button type="button" style={btnPrimary} onClick={() => { setShowCreateSpace(true); }}>
            + New Space
          </button>
        </div>

        {selectedVenue.spaces.length === 0 && (
          <p style={{ color: "#999", fontSize: 14 }}>No spaces yet. Create one to get started.</p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {selectedVenue.spaces.map((space) => (
            <div key={space.id} style={{ ...cardStyle, cursor: "default" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{space.name}</div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
                    {space.widthM}m × {space.lengthM}m × {space.heightM}m · slug: {space.slug}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={() => { openEditSpace(space); }}
                    style={{ fontSize: 11, color: "#3b82f6", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    Edit
                  </button>
                  <button type="button" onClick={() => { setDeletingSpaceId(space.id); }}
                    style={{ fontSize: 11, color: "#ef4444", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Create space modal */}
        {showCreateSpace && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 100,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 400, boxShadow: "0 8px 32px rgba(0,0,0,0.15)" }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>New Space</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Space Name</label>
                  <input type="text" value={spaceName} onChange={(e) => { setSpaceName(e.target.value); }}
                    style={inputStyle} placeholder="e.g. Grand Hall" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div>
                    <label style={labelStyle}>Width (m)</label>
                    <input type="number" value={spaceWidth} onChange={(e) => { setSpaceWidth(e.target.value); }}
                      style={inputStyle} placeholder="21" step="0.1" min="0" />
                  </div>
                  <div>
                    <label style={labelStyle}>Length (m)</label>
                    <input type="number" value={spaceLength} onChange={(e) => { setSpaceLength(e.target.value); }}
                      style={inputStyle} placeholder="10" step="0.1" min="0" />
                  </div>
                  <div>
                    <label style={labelStyle}>Height (m)</label>
                    <input type="number" value={spaceHeight} onChange={(e) => { setSpaceHeight(e.target.value); }}
                      style={inputStyle} placeholder="7" step="0.1" min="0" />
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
                <button type="button" style={btnSecondary} onClick={() => { setShowCreateSpace(false); }}>Cancel</button>
                <button type="button" style={btnPrimary} onClick={() => { void handleCreateSpace(); }}
                  disabled={spaceName.trim() === ""}>Create Space</button>
              </div>
            </div>
          </div>
        )}

        {/* Pricing rules section */}
        <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid #e5e7eb" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
              Room Hire Pricing ({pricingRules.length} rules)
            </h3>
            <button type="button" style={btnPrimary} onClick={() => { setShowCreateRule(true); }}>
              + New Rule
            </button>
          </div>

          {pricingRules.length === 0 && (
            <p style={{ color: "#999", fontSize: 14 }}>No pricing rules configured.</p>
          )}

          {/* Pricing table — mirrors Trades Hall price sheet layout */}
          {pricingRules.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                    <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, color: "#333" }}>Rule</th>
                    <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600, color: "#333" }}>Amount</th>
                    <th style={{ textAlign: "center", padding: "8px 12px", fontWeight: 600, color: "#333" }}>Type</th>
                    <th style={{ textAlign: "center", padding: "8px 12px", fontWeight: 600, color: "#333" }}>Status</th>
                    <th style={{ textAlign: "center", padding: "8px 12px", fontWeight: 600, color: "#333" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pricingRules.map((rule) => (
                    <tr key={rule.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "8px 12px" }}>
                        <div style={{ fontWeight: 500 }}>{rule.name}</div>
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        £{parseFloat(rule.amount).toFixed(2)}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center", color: "#666" }}>
                        {rule.type.replace(/_/g, " ")}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>
                        <span style={{
                          fontSize: 11, padding: "2px 8px", borderRadius: 4,
                          background: rule.isActive ? "#dcfce7" : "#fee2e2",
                          color: rule.isActive ? "#16a34a" : "#dc2626",
                        }}>
                          {rule.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>
                        <button type="button" onClick={() => { void handleDeleteRule(rule.id); }}
                          style={{ fontSize: 11, color: "#ef4444", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {showCreateRule && (
            <div style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 100,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 400, boxShadow: "0 8px 32px rgba(0,0,0,0.15)" }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>New Pricing Rule</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Rule Name</label>
                    <input type="text" value={ruleName} onChange={(e) => { setRuleName(e.target.value); }}
                      style={inputStyle} placeholder="e.g. Grand Hall — Half Day" />
                  </div>
                  <div>
                    <label style={labelStyle}>Space (optional)</label>
                    <select value={ruleSpaceId} onChange={(e) => { setRuleSpaceId(e.target.value); }}
                      style={{ ...inputStyle, cursor: "pointer" }}>
                      <option value="">Venue-wide</option>
                      {selectedVenue.spaces.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Type</label>
                    <select value={ruleType} onChange={(e) => { setRuleType(e.target.value as PricingRule["type"]); }}
                      style={{ ...inputStyle, cursor: "pointer" }}>
                      <option value="flat_rate">Flat Rate</option>
                      <option value="per_hour">Per Hour</option>
                      <option value="per_head">Per Head</option>
                      <option value="tiered">Tiered</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Amount (GBP)</label>
                    <input type="number" value={ruleAmount} onChange={(e) => { setRuleAmount(e.target.value); }}
                      style={inputStyle} placeholder="500" step="0.01" min="0" />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
                  <button type="button" style={btnSecondary} onClick={() => { setShowCreateRule(false); }}>Cancel</button>
                  <button type="button" style={btnPrimary} onClick={() => { void handleCreateRule(); }}
                    disabled={ruleName.trim() === "" || ruleAmount === ""}>Create Rule</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Venue delete confirmation */}
        {showDeleteVenue && (
          <ConfirmModal
            title="Delete Venue"
            message={`Are you sure you want to delete "${selectedVenue.name}"? All spaces, pricing rules, and configurations will be permanently removed.`}
            confirmLabel="Delete"
            onConfirm={() => { void handleDeleteVenue(); }}
            onCancel={() => { setShowDeleteVenue(false); }}
          />
        )}

        {/* Space delete confirmation */}
        {deletingSpaceId !== null && (
          <ConfirmModal
            title="Delete Space"
            message="Are you sure you want to delete this space? All associated configurations and loadouts will be removed."
            confirmLabel="Delete"
            onConfirm={() => { void handleDeleteSpace(deletingSpaceId); }}
            onCancel={() => { setDeletingSpaceId(null); }}
          />
        )}

        {/* Space edit modal */}
        {editingSpace !== null && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 100,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 400, boxShadow: "0 8px 32px rgba(0,0,0,0.15)" }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Edit Space</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Space Name</label>
                  <input type="text" value={editSpaceName} onChange={(e) => { setEditSpaceName(e.target.value); }}
                    style={inputStyle} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div>
                    <label style={labelStyle}>Width (m)</label>
                    <input type="number" value={editSpaceWidth} onChange={(e) => { setEditSpaceWidth(e.target.value); }}
                      style={inputStyle} step="0.1" min="0" />
                  </div>
                  <div>
                    <label style={labelStyle}>Length (m)</label>
                    <input type="number" value={editSpaceLength} onChange={(e) => { setEditSpaceLength(e.target.value); }}
                      style={inputStyle} step="0.1" min="0" />
                  </div>
                  <div>
                    <label style={labelStyle}>Height (m)</label>
                    <input type="number" value={editSpaceHeight} onChange={(e) => { setEditSpaceHeight(e.target.value); }}
                      style={inputStyle} step="0.1" min="0" />
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
                <button type="button" style={btnSecondary} onClick={() => { setEditingSpace(null); }}>Cancel</button>
                <button type="button" style={btnPrimary} onClick={() => { void handleEditSpace(); }}
                  disabled={editSpaceName.trim() === ""}>Save Changes</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- Venue list view ---
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Admin — Venues</h2>
        <button type="button" style={btnPrimary} onClick={() => { setShowCreateVenue(true); }}>
          + New Venue
        </button>
      </div>

      {loading && <p style={{ color: "#999", fontSize: 14 }}>Loading...</p>}

      {!loading && venues.length === 0 && (
        <p style={{ color: "#999", fontSize: 14 }}>No venues found.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {venues.map((v) => (
          <div key={v.id} style={cardStyle} onClick={() => { handleSelectVenue(v.id); }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{v.name}</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
              {v.address} · slug: {v.slug}
            </div>
          </div>
        ))}
      </div>

      {/* Create venue modal */}
      {showCreateVenue && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 400, boxShadow: "0 8px 32px rgba(0,0,0,0.15)" }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>New Venue</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={labelStyle}>Venue Name</label>
                <input type="text" value={venueName} onChange={(e) => { setVenueName(e.target.value); }}
                  style={inputStyle} placeholder="e.g. Trades Hall Glasgow" />
              </div>
              <div>
                <label style={labelStyle}>Address</label>
                <input type="text" value={venueAddress} onChange={(e) => { setVenueAddress(e.target.value); }}
                  style={inputStyle} placeholder="e.g. 85 Glassford Street, Glasgow G1 1UH" />
              </div>
              <div style={{ fontSize: 12, color: "#999" }}>
                Slug: {slugify(venueName) !== "" ? slugify(venueName) : "(auto-generated from name)"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
              <button type="button" style={btnSecondary} onClick={() => { setShowCreateVenue(false); }}>Cancel</button>
              <button type="button" style={btnPrimary} onClick={() => { void handleCreateVenue(); }}
                disabled={venueName.trim() === "" || venueAddress.trim() === ""}>Create Venue</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
