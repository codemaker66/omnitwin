import { useState, useEffect } from "react";
import type { Venue, Space } from "../../api/spaces.js";
import * as spacesApi from "../../api/spaces.js";

// ---------------------------------------------------------------------------
// SpacePicker — venue/space selection screen
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  minHeight: "100vh", display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center", padding: 40,
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  background: "linear-gradient(135deg, #f5f5f0 0%, #e8e4df 100%)",
};

const titleStyle: React.CSSProperties = {
  fontSize: 32, fontWeight: 700, color: "#1a1a2e", marginBottom: 8,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 16, color: "#666", marginBottom: 40,
};

const gridStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280, 1fr))",
  gap: 20, maxWidth: 900, width: "100%",
};

const cardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 12, padding: 24,
  border: "1px solid #e5e5e5", cursor: "pointer",
  transition: "transform 0.2s, box-shadow 0.2s",
  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
};

const cardNameStyle: React.CSSProperties = {
  fontSize: 18, fontWeight: 600, color: "#1a1a2e", marginBottom: 8,
};

const cardDimStyle: React.CSSProperties = {
  fontSize: 13, color: "#888", marginBottom: 4,
};

interface SpacePickerProps {
  readonly onSelectSpace: (spaceId: string, venueId: string) => void;
}

export function SpacePicker({ onSelectSpace }: SpacePickerProps): React.ReactElement {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const venueList = await spacesApi.listVenues();
        if (cancelled) return;
        setVenues(venueList);

        // V1: auto-select first venue
        if (venueList.length > 0 && venueList[0] !== undefined) {
          const spaceList = await spacesApi.listSpaces(venueList[0].id);
          if (!cancelled) setSpaces(spaceList);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load venues");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div style={containerStyle}><p style={{ color: "#999" }}>Loading spaces...</p></div>;
  }

  if (error !== null) {
    return <div style={containerStyle}><p style={{ color: "#dc2626" }}>{error}</p></div>;
  }

  const venue = venues[0];

  return (
    <div style={containerStyle}>
      <h1 style={titleStyle}>Choose a Space</h1>
      <p style={subtitleStyle}>
        {venue !== undefined ? venue.name : "Select a venue space to start designing"}
      </p>
      <div style={gridStyle}>
        {spaces.map((space) => (
          <div
            key={space.id}
            style={cardStyle}
            onClick={() => { if (venue !== undefined) onSelectSpace(space.id, venue.id); }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)"; }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" && venue !== undefined) onSelectSpace(space.id, venue.id); }}
          >
            <div style={cardNameStyle}>{space.name}</div>
            <div style={cardDimStyle}>{space.widthM}m × {space.lengthM}m × {space.heightM}m</div>
            {space.loadoutCount !== undefined && space.loadoutCount > 0 && (
              <div style={{ fontSize: 12, color: "#6366f1", marginTop: 4 }}>
                {String(space.loadoutCount)} reference loadout{space.loadoutCount === 1 ? "" : "s"}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
