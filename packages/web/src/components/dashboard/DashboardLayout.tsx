import { type ReactNode, useState, useEffect } from "react";
import { useClerk } from "@clerk/react";
import { useAuthStore } from "../../stores/auth-store.js";
import { ToastContainer } from "../shared/ToastContainer.js";
import * as spacesApi from "../../api/spaces.js";

// ---------------------------------------------------------------------------
// DashboardLayout — sidebar nav + top bar + main content
// ---------------------------------------------------------------------------

type DashboardView = "enquiries" | "reviews" | "search" | "loadouts" | "settings" | "admin";

const sidebarStyle: React.CSSProperties = {
  position: "fixed", left: 0, top: 0, bottom: 0, width: 220,
  background: "#1a1a2e", color: "#fff", display: "flex", flexDirection: "column",
  fontFamily: "'Inter', sans-serif", zIndex: 40,
};

const navItemStyle = (active: boolean): React.CSSProperties => ({
  display: "block", width: "100%", padding: "12px 20px", fontSize: 14,
  background: active ? "rgba(255,255,255,0.1)" : "none", border: "none",
  color: active ? "#fff" : "rgba(255,255,255,0.6)", cursor: "pointer",
  textAlign: "left", borderLeft: active ? "3px solid #3b82f6" : "3px solid transparent",
  transition: "all 0.15s",
});

const mainStyle: React.CSSProperties = {
  marginLeft: 220, minHeight: "100vh", background: "#f8f9fa",
  fontFamily: "'Inter', sans-serif",
};

const topBarStyle: React.CSSProperties = {
  height: 56, background: "#fff", borderBottom: "1px solid #e5e7eb",
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "0 24px",
};

interface DashboardLayoutProps {
  readonly activeView: DashboardView;
  readonly onViewChange: (view: DashboardView) => void;
  readonly children: ReactNode;
}

const NAV_ITEMS: readonly { view: DashboardView; label: string; adminOnly?: boolean }[] = [
  { view: "enquiries", label: "Enquiries" },
  { view: "reviews", label: "Pending Reviews" },
  { view: "search", label: "Client Search" },
  { view: "loadouts", label: "Reference Loadouts" },
  { view: "settings", label: "Venue Settings" },
  { view: "admin", label: "Admin", adminOnly: true },
];

export function DashboardLayout({ activeView, onViewChange, children }: DashboardLayoutProps): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const logoutLocal = useAuthStore((s) => s.logout);
  const { signOut } = useClerk();

  // Fetch venue name dynamically so the header reflects the actual venue,
  // not the hardcoded placeholder (F28). Admin users without a venueId see
  // "Admin Dashboard" instead.
  const [venueName, setVenueName] = useState("Dashboard");
  useEffect(() => {
    if (user?.venueId === undefined || user.venueId === null) {
      setVenueName(user?.role === "admin" ? "Admin Dashboard" : "Dashboard");
      return;
    }
    void spacesApi.getVenue(user.venueId)
      .then((v) => { setVenueName(v.name); })
      .catch(() => { /* non-critical — keep default */ });
  }, [user?.venueId, user?.role]);

  // Punch list #11: previously called only the local Zustand `logout()`,
  // which cleared the in-memory user but left the Clerk session intact.
  // A page refresh would re-populate the store from Clerk and the user
  // would be "logged in" again. Now invokes Clerk's signOut() and clears
  // local state for immediate UI feedback. Clerk handles the redirect
  // (default: stays on the current page; ProtectedRoute then redirects).
  const handleSignOut = (): void => {
    logoutLocal();
    void signOut();
  };

  return (
    <>
      <nav style={sidebarStyle}>
        <div style={{ padding: "20px 20px 24px", fontSize: 18, fontWeight: 700, letterSpacing: -0.5 }}>
          VenViewer
        </div>
        {NAV_ITEMS.map((item) => {
          if (item.adminOnly === true && user?.role !== "admin") return null;
          return (
            <button
              key={item.view}
              type="button"
              style={navItemStyle(activeView === item.view)}
              onClick={() => { onViewChange(item.view); }}
            >
              {item.label}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <div style={{ padding: "16px 20px", fontSize: 12, color: "rgba(255,255,255,0.4)", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          {user?.email ?? ""}
          <button
            type="button"
            onClick={handleSignOut}
            style={{ display: "block", marginTop: 8, background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 12, padding: 0 }}
          >
            Sign Out
          </button>
        </div>
      </nav>

      <div style={mainStyle}>
        <header style={topBarStyle}>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: "#1a1a2e", margin: 0 }}>
            {venueName}
          </h1>
          <span style={{ fontSize: 13, color: "#999" }}>{user?.name ?? ""}</span>
        </header>
        <main style={{ padding: 24 }}>
          {children}
        </main>
      </div>

      <ToastContainer />
    </>
  );
}

export type { DashboardView };
