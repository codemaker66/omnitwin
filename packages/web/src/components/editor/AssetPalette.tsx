import { usePlacementStore } from "../../stores/placement-store.js";

// ---------------------------------------------------------------------------
// Asset palette — click to place assets in the scene
// ---------------------------------------------------------------------------

// Placeholder asset definitions for V1 (matches seed data categories)
const ASSET_CATEGORIES: Record<string, { label: string; color: string }> = {
  table: { label: "Tables", color: "#8b5cf6" },
  chair: { label: "Chairs", color: "#3b82f6" },
  staging: { label: "Staging", color: "#ef4444" },
  danceFloor: { label: "Dance Floor", color: "#f59e0b" },
  bar: { label: "Bar", color: "#10b981" },
  av: { label: "AV Equipment", color: "#6366f1" },
  decor: { label: "Decoration", color: "#ec4899" },
  misc: { label: "Misc", color: "#6b7280" },
};

// Hardcoded asset list matching seed data
const ASSETS: readonly { id: string; name: string; category: string }[] = [
  { id: "round-table-5ft", name: "Round Table 5ft", category: "table" },
  { id: "round-table-6ft", name: "Round Table 6ft", category: "table" },
  { id: "rect-table-6ft", name: "Rectangular Table 6ft", category: "table" },
  { id: "standard-chair", name: "Standard Chair", category: "chair" },
  { id: "highboy-cocktail", name: "Highboy Cocktail Table", category: "table" },
  { id: "stage-platform", name: "Stage Platform", category: "staging" },
  { id: "dance-floor-panel", name: "Dance Floor Panel", category: "danceFloor" },
  { id: "lectern", name: "Lectern", category: "misc" },
];

const panelStyle: React.CSSProperties = {
  position: "fixed", left: 0, top: 48, bottom: 0, width: 220,
  background: "rgba(255,255,255,0.95)", borderRight: "1px solid #e5e5e5",
  overflowY: "auto", padding: "12px 0", zIndex: 40,
  fontFamily: "'Inter', sans-serif", backdropFilter: "blur(8px)",
};

const sectionStyle: React.CSSProperties = {
  padding: "8px 16px",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, textTransform: "uppercase" as const,
  letterSpacing: 0.5, color: "#999", marginBottom: 8,
};

const assetBtnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, width: "100%",
  padding: "8px 12px", background: "none", border: "none",
  borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#333",
  textAlign: "left",
};

export function AssetPalette(): React.ReactElement {
  const placeItem = usePlacementStore((s) => s.placeItem);

  // Group assets by category
  const grouped = new Map<string, typeof ASSETS[number][]>();
  for (const asset of ASSETS) {
    const list = grouped.get(asset.category) ?? [];
    list.push(asset);
    grouped.set(asset.category, list);
  }

  return (
    <div style={panelStyle} data-testid="asset-palette">
      {Array.from(grouped.entries()).map(([category, assets]) => {
        const catInfo = ASSET_CATEGORIES[category] ?? { label: category, color: "#999" };
        return (
          <div key={category} style={sectionStyle}>
            <div style={sectionTitleStyle}>{catInfo.label}</div>
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                style={assetBtnStyle}
                onClick={() => { placeItem(asset.id, 0, 0); }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f5f5f5"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: 2, background: catInfo.color,
                  flexShrink: 0,
                }} />
                {asset.name}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
