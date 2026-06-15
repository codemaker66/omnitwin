import { type ReactNode, useState, useEffect } from "react";
import { useClerk } from "@clerk/react";
import { useAuthStore } from "../../stores/auth-store.js";
import { ToastContainer } from "../shared/ToastContainer.js";
import * as spacesApi from "../../api/spaces.js";

// ---------------------------------------------------------------------------
// DashboardLayout — sidebar nav + top bar + main content
// ---------------------------------------------------------------------------

type DashboardView = "enquiries" | "pipeline" | "reviews" | "analytics" | "proposals" | "search" | "loadouts" | "settings" | "admin";

const sidebarStyle: React.CSSProperties = {
  position: "fixed", left: 0, top: 0, bottom: 0, width: 220,
  background: "linear-gradient(180deg, #090807 0%, #17120d 100%)",
  color: "#fff7e8",
  display: "flex",
  flexDirection: "column",
  borderRight: "1px solid rgba(215,181,109,0.22)",
  boxShadow: "18px 0 60px rgba(0,0,0,0.22)",
  fontFamily: "'Inter', sans-serif",
  zIndex: 40,
};

const navItemStyle = (active: boolean): React.CSSProperties => ({
  display: "block", width: "100%", minHeight: 44, padding: "12px 20px", fontSize: 14,
  background: active ? "rgba(215,181,109,0.16)" : "none", border: "none",
  color: active ? "#fff7e8" : "rgba(246,241,232,0.68)", cursor: "pointer",
  textAlign: "left", borderLeft: active ? "3px solid #d7b56d" : "3px solid transparent",
  transition: "all 0.15s",
  fontWeight: active ? 800 : 650,
});

const mainStyle: React.CSSProperties = {
  marginLeft: 220,
  minHeight: "100vh",
  background:
    "linear-gradient(180deg, #f5efe3 0%, #ece2d3 100%)",
  fontFamily: "'Inter', sans-serif",
};

const topBarStyle: React.CSSProperties = {
  minHeight: 62,
  background: "rgba(255,250,240,0.92)",
  borderBottom: "1px solid rgba(99,74,35,0.16)",
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "0 24px",
  boxShadow: "0 12px 38px rgba(80,55,22,0.08)",
};

interface DashboardLayoutProps {
  readonly activeView: DashboardView;
  readonly onViewChange: (view: DashboardView) => void;
  readonly children: ReactNode;
}

const NAV_ITEMS: readonly { view: DashboardView; label: string; adminOnly?: boolean; staffOnly?: boolean }[] = [
  { view: "enquiries", label: "Enquiries" },
  { view: "pipeline", label: "Pipeline", staffOnly: true },
  { view: "reviews", label: "Pending Reviews" },
  { view: "analytics", label: "Executive Analytics" },
  // Proposals are a sales surface — the API grants create/mutate to staff
  // and admin only, so the nav mirrors that rather than offering a tab
  // that would only ever 403.
  { view: "proposals", label: "Proposals", staffOnly: true },
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
      <nav style={sidebarStyle} aria-label="Staff dashboard">
        <div style={{ padding: "20px 20px 24px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ color: "#fff2dc", fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 24, fontWeight: 650, letterSpacing: 0 }}>
            Venviewer
          </div>
          <div style={{ marginTop: 4, color: "rgba(246,241,232,0.56)", fontSize: 12, fontWeight: 800, letterSpacing: 0, textTransform: "uppercase" }}>
            Venue command
          </div>
        </div>
        {NAV_ITEMS.map((item) => {
          if (item.adminOnly === true && user?.role !== "admin") return null;
          if (item.staffOnly === true && user?.role !== "admin" && user?.role !== "staff") return null;
          return (
            <button
              key={item.view}
              type="button"
              style={navItemStyle(activeView === item.view)}
              aria-current={activeView === item.view ? "page" : undefined}
              onClick={() => { onViewChange(item.view); }}
            >
              {item.label}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <div style={{ padding: "16px 20px", fontSize: 12, color: "rgba(246,241,232,0.58)", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          {user?.email ?? ""}
          <button
            type="button"
            onClick={handleSignOut}
            style={{ display: "block", minHeight: 32, marginTop: 8, background: "none", border: "none", color: "#d7b56d", cursor: "pointer", fontSize: 12, fontWeight: 800, padding: 0 }}
          >
            Sign Out
          </button>
        </div>
      </nav>

      <div style={mainStyle}>
        <header style={topBarStyle}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1a140f", margin: 0, letterSpacing: 0 }}>
            {venueName}
          </h1>
          <span className="vv-status-chip" data-tone="review">{user?.name ?? "Signed in"}</span>
        </header>
        <main style={{ padding: 24 }} id="dashboard-main">
          {children}
        </main>
      </div>

      <ToastContainer />
    </>
  );
}

export type { DashboardView };
