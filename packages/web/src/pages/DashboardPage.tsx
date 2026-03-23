import { UserMenu } from "../components/auth/UserMenu.js";

// ---------------------------------------------------------------------------
// DashboardPage — placeholder for hallkeeper dashboard (Prompt 9)
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexDirection: "column",
  fontFamily: "'Inter', sans-serif",
  background: "#f5f5f0",
  color: "#333",
};

export function DashboardPage(): React.ReactElement {
  return (
    <>
      <UserMenu />
      <div style={containerStyle}>
        <h1 style={{ fontSize: 32, fontWeight: 700, margin: 0 }}>Hallkeeper Dashboard</h1>
        <p style={{ fontSize: 16, color: "#666", marginTop: 8 }}>Coming in Prompt 9</p>
      </div>
    </>
  );
}
