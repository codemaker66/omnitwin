import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// AuthLayout — centered card for login/register
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 12,
  padding: 40,
  width: 400,
  maxWidth: "90vw",
  boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
};

const logoStyle: React.CSSProperties = {
  textAlign: "center",
  marginBottom: 32,
};

const titleStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  color: "#1a1a2e",
  letterSpacing: -0.5,
  margin: 0,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 14,
  color: "#666",
  marginTop: 4,
};

export function AuthLayout({ children }: { readonly children: ReactNode }): React.ReactElement {
  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={logoStyle}>
          <h1 style={titleStyle}>OMNITWIN</h1>
          <p style={subtitleStyle}>Venue Planning Platform</p>
        </div>
        {children}
      </div>
    </div>
  );
}
