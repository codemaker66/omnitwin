// ---------------------------------------------------------------------------
// LegalPage — placeholder pages for /privacy and /terms routes
//
// These routes are linked from SpacePicker footer. Real legal copy will be
// provided by Trades Hall's legal team before production launch.
// ---------------------------------------------------------------------------

interface LegalPageProps {
  readonly type: "privacy" | "terms";
}

const TITLES: Record<string, string> = {
  privacy: "Privacy Policy",
  terms: "Terms of Service",
};

const BODIES: Record<string, string> = {
  privacy: "This privacy policy will be updated with full details before launch. VenViewer collects only the data necessary to provide the venue planning service.",
  terms: "These terms of service will be updated with full details before launch. By using VenViewer you agree to use the platform for legitimate venue planning purposes.",
};

export function LegalPage({ type }: LegalPageProps): React.ReactElement {
  const title = TITLES[type] ?? "Legal";
  const body = BODIES[type] ?? "";

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', system-ui, sans-serif", background: "#f5f5f0", padding: 40,
    }}>
      <div style={{ maxWidth: 640, width: "100%" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "#1a1a2e", marginBottom: 16 }}>
          {title}
        </h1>
        <p style={{ fontSize: 15, color: "#555", lineHeight: 1.7, marginBottom: 24 }}>
          {body}
        </p>
        <a
          href="/plan"
          style={{ color: "#c9a84c", textDecoration: "none", fontWeight: 600, fontSize: 14 }}
        >
          Back to the planner
        </a>
      </div>
    </div>
  );
}
