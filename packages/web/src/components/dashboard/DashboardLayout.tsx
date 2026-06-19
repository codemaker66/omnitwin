import { type ReactNode, useState, useEffect } from "react";
import { useClerk } from "@clerk/react";
import { useAuthStore } from "../../stores/auth-store.js";
import { ToastContainer } from "../shared/ToastContainer.js";
import * as spacesApi from "../../api/spaces.js";
import { NotificationCenter } from "./NotificationCenter.js";
import "./DashboardLayout.css";

// ---------------------------------------------------------------------------
// DashboardLayout — sidebar nav + top bar + main content
// ---------------------------------------------------------------------------

type DashboardView = "enquiries" | "pipeline" | "reviews" | "analytics" | "proposals" | "search" | "loadouts" | "settings" | "onboarding" | "admin";

interface E2EWindow extends Window {
  readonly __OMNITWIN_E2E__?: boolean;
}

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
  { view: "onboarding", label: "Onboarding", adminOnly: true },
  { view: "admin", label: "Admin", adminOnly: true },
];

function canShowNavItem(
  item: (typeof NAV_ITEMS)[number],
  role: string | null | undefined,
): boolean {
  if (role === "supplier") return false;
  if (role === "executive") return item.view === "analytics";
  if (item.adminOnly === true) return role === "admin";
  if (item.staffOnly === true) return role === "admin" || role === "staff";
  return role !== null && role !== undefined;
}

function isE2EAuthBypass(): boolean {
  return import.meta.env.DEV && (window as E2EWindow).__OMNITWIN_E2E__ === true;
}

function ClerkSignOutButton(props: { readonly onLocalSignOut: () => void }): React.ReactElement {
  const { signOut } = useClerk();
  const handleSignOut = (): void => {
    props.onLocalSignOut();
    void signOut();
  };

  return (
    <button type="button" onClick={handleSignOut} className="dashboard-layout-signout">
      Sign Out
    </button>
  );
}

function LocalSignOutButton(props: { readonly onLocalSignOut: () => void }): React.ReactElement {
  return (
    <button type="button" onClick={props.onLocalSignOut} className="dashboard-layout-signout">
      Sign Out
    </button>
  );
}

export function DashboardLayout({ activeView, onViewChange, children }: DashboardLayoutProps): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const logoutLocal = useAuthStore((s) => s.logout);

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

  const handleLocalSignOut = (): void => {
    logoutLocal();
  };

  return (
    <>
      <nav className="dashboard-layout-sidebar" aria-label="Staff dashboard">
        <div className="dashboard-layout-brand">
          <div className="dashboard-layout-brand-name">
            Venviewer
          </div>
          <div className="dashboard-layout-brand-kicker">
            Venue command
          </div>
        </div>
        {NAV_ITEMS.map((item) => {
          if (!canShowNavItem(item, user?.role)) return null;
          return (
            <button
              key={item.view}
              type="button"
              className={`dashboard-layout-nav-item${activeView === item.view ? " dashboard-layout-nav-item--active" : ""}`}
              aria-current={activeView === item.view ? "page" : undefined}
              onClick={() => { onViewChange(item.view); }}
            >
              {item.label}
            </button>
          );
        })}
        <div className="dashboard-layout-spacer" />
        <div className="dashboard-layout-account">
          {user?.email ?? ""}
          {isE2EAuthBypass()
            ? <LocalSignOutButton onLocalSignOut={handleLocalSignOut} />
            : <ClerkSignOutButton onLocalSignOut={handleLocalSignOut} />}
        </div>
      </nav>

      <div className="dashboard-layout-main">
        <header className="dashboard-layout-topbar">
          <h1 className="dashboard-layout-title">
            {venueName}
          </h1>
          <div className="dashboard-layout-topbar-actions">
            <NotificationCenter />
            <span className="vv-status-chip" data-tone="review">{user?.name ?? "Signed in"}</span>
          </div>
        </header>
        <main className="dashboard-layout-content" id="dashboard-main">
          {children}
        </main>
      </div>

      <ToastContainer />
    </>
  );
}

export type { DashboardView };
