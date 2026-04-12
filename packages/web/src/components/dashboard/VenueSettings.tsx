import { useState, useEffect } from "react";
import * as spacesApi from "../../api/spaces.js";
import type { VenueDetail } from "../../api/spaces.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useToastStore } from "../../stores/toast-store.js";

// ---------------------------------------------------------------------------
// VenueSettings — editable venue details for hallkeeper/admin
//
// Punch list #25: replaces the "Coming soon" placeholder. Loads the venue
// from the auth store's venueId, renders an editable form for name, address,
// brand colour, and logo URL, and saves via PATCH /venues/:id.
// ---------------------------------------------------------------------------

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 600, color: "#555",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", fontSize: 14, border: "1px solid #d1d5db",
  borderRadius: 6, boxSizing: "border-box", fontFamily: "inherit",
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 24px", fontSize: 14, fontWeight: 600, background: "#3b82f6",
  color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
};

export function VenueSettings(): React.ReactElement {
  const venueId = useAuthStore((s) => s.user?.venueId) ?? null;
  const addToast = useToastStore((s) => s.addToast);

  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [brandColour, setBrandColour] = useState("");
  const [logoUrl, setLogoUrl] = useState("");

  useEffect(() => {
    if (venueId === null) {
      setLoading(false);
      return;
    }
    void spacesApi.getVenue(venueId)
      .then((data) => {
        setVenue(data);
        setName(data.name);
        setAddress(data.address);
        setBrandColour(data.brandColour ?? "");
        setLogoUrl(data.logoUrl ?? "");
      })
      .catch(() => { addToast("Failed to load venue", "error"); })
      .finally(() => { setLoading(false); });
  }, [venueId, addToast]);

  const handleSave = async (): Promise<void> => {
    if (venueId === null || name.trim() === "") return;
    setSaving(true);
    try {
      const updated = await spacesApi.updateVenue(venueId, {
        name: name.trim(),
        address: address.trim(),
        brandColour: brandColour.trim() !== "" ? brandColour.trim() : null,
        logoUrl: logoUrl.trim() !== "" ? logoUrl.trim() : null,
      });
      setName(updated.name);
      setAddress(updated.address);
      setBrandColour(updated.brandColour ?? "");
      setLogoUrl(updated.logoUrl ?? "");
      addToast("Venue settings saved", "success");
    } catch {
      addToast("Failed to save settings", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p style={{ color: "#999", fontSize: 14 }}>Loading venue settings...</p>;
  }

  if (venueId === null) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "#999" }}>
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>Venue Settings</h2>
        <p>No venue assigned to your account.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Venue Settings</h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={labelStyle}>Venue Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); }}
            style={inputStyle}
            placeholder="e.g. Trades Hall Glasgow"
          />
        </div>

        <div>
          <label style={labelStyle}>Address</label>
          <input
            type="text"
            value={address}
            onChange={(e) => { setAddress(e.target.value); }}
            style={inputStyle}
            placeholder="e.g. 85 Glassford Street, Glasgow G1 1UH"
          />
        </div>

        <div>
          <label style={labelStyle}>Brand Colour</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="color"
              value={brandColour !== "" ? brandColour : "#1a1a2e"}
              onChange={(e) => { setBrandColour(e.target.value); }}
              style={{ width: 40, height: 36, border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", padding: 2 }}
            />
            <input
              type="text"
              value={brandColour}
              onChange={(e) => { setBrandColour(e.target.value); }}
              style={{ ...inputStyle, width: 120 }}
              placeholder="#1a1a2e"
              maxLength={7}
            />
          </div>
        </div>

        <div>
          <label style={labelStyle}>Logo URL</label>
          <input
            type="url"
            value={logoUrl}
            onChange={(e) => { setLogoUrl(e.target.value); }}
            style={inputStyle}
            placeholder="https://example.com/logo.png"
          />
          {logoUrl.trim() !== "" && (
            <div style={{ marginTop: 8, padding: 12, background: "#f9fafb", borderRadius: 6, textAlign: "center" }}>
              <img
                src={logoUrl}
                alt="Venue logo preview"
                style={{ maxHeight: 60, maxWidth: "100%" }}
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Venue info (read-only) */}
      {venue !== null && (
        <div style={{ marginTop: 24, padding: 12, background: "#f9fafb", borderRadius: 8, fontSize: 12, color: "#888" }}>
          <div>Slug: {venue.slug}</div>
          <div>Spaces: {venue.spaces.length}</div>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <button
          type="button"
          onClick={() => { void handleSave(); }}
          disabled={saving || name.trim() === ""}
          style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
