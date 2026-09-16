import { type ReactNode, useState, useEffect, useId, useRef } from "react";
import { useClerk } from "@clerk/react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useAuthStore } from "../../stores/auth-store.js";
import { ToastContainer } from "../shared/ToastContainer.js";
import * as spacesApi from "../../api/spaces.js";
import { NotificationCenter } from "./NotificationCenter.js";
import { ActivityStatus } from "../shared/Activity.js";
import { InventoryExitBoundary, useInventoryExit } from "./inventory/InventoryNavigationGuard.js";
import { isE2EAuthBypassEnabled } from "../../lib/e2e-auth-bypass.js";
import {
  COMMERCIAL_ROLES, CRM_PIPELINE_ROLES, DIARY_ROLES, EVENT_SCOPED_ROLES,
  hasRole, INVENTORY_WRITE_ROLES, PLANNER_ROLES, VENUE_DAY_ROLES, WORKSPACE_ROLES,
} from "../../lib/role-capabilities.js";
import "./DashboardLayout.css";

// ---------------------------------------------------------------------------
// DashboardLayout — shared venue navigation and a single workspace landmark
// ---------------------------------------------------------------------------

type DashboardView = "enquiries" | "pipeline" | "reviews" | "analytics" | "proposals" | "search" | "loadouts" | "settings" | "inventory" | "onboarding" | "admin";

interface DashboardLayoutProps {
  /** Present only on /dashboard, which owns the view switch itself. Every
   *  other surface wears the shell WITHOUT these — the nav then routes to
   *  /dashboard?view=… instead of calling back. Optional rather than a
   *  second component so the ten dashboard views, their ?view= URLs and
   *  every existing selector stay exactly as they are. */
  readonly activeView?: DashboardView;
  readonly onViewChange?: (view: DashboardView) => void;
  /** The accessible name for this page's <main> landmark. The shell owns the
   *  only <main> on the page, so a wrapped surface hands its name up rather
   *  than keeping a second landmark of its own. */
  readonly mainLabel?: string;
  readonly children: ReactNode;
}

// Every entry names the capability behind it, and each capability is the web
// mirror of a named API gate (lib/role-capabilities.ts). The rule: no entry
// ships that the API then refuses. A missing tab is a better R1 than a tab
// that answers 403.
type NavCapability = "workspace" | "commercial" | "crmPipeline" | "venueAdmin" | "platformAdmin";

const NAV_ITEMS: readonly { view: DashboardView; label: string; capability: NavCapability }[] = [
  { view: "enquiries", label: "Enquiries", capability: "workspace" },
  // Pipeline is CommercialPipelineView, reading api/crm.js — mirrors
  // routes/crm.ts:31 and routes/opportunities.ts:38, which are staff-only on
  // release/r1 until Lane 7 (PR #24) widens them to canManageCommercial.
  { view: "pipeline", label: "Pipeline", capability: "crmPipeline" },
  { view: "reviews", label: "Pending Reviews", capability: "workspace" },
  { view: "analytics", label: "Executive Analytics", capability: "commercial" },
  // Proposals is ProposalsView, which reads api/proposals.js — already on
  // canManageCommercial, so the whole commercial set can open it.
  { view: "proposals", label: "Proposals", capability: "commercial" },
  { view: "search", label: "Client Search", capability: "workspace" },
  { view: "loadouts", label: "Reference Loadouts", capability: "workspace" },
  { view: "settings", label: "Venue Settings", capability: "workspace" },
  { view: "inventory", label: "Inventory", capability: "venueAdmin" },
  { view: "onboarding", label: "Clients & access", capability: "platformAdmin" },
  { view: "admin", label: "Admin", capability: "platformAdmin" },
];

// What the account menu calls the signed-in person. A role with no entry is a
// workspace member, which is also what an unknown future role reads as.
const ROLE_LABELS: Readonly<Record<string, string>> = {
  admin: "Venue admin",
  manager: "Venue manager",
  staff: "Venue team",
  sales: "Sales",
  hallkeeper: "Hallkeeper",
  planner: "Planner",
  caterer: "Caterer",
};

/** Exported so role-capabilities.test.ts can prove every offer is reachable. */
export function canShowNavItem(
  item: (typeof NAV_ITEMS)[number],
  role: string | null | undefined,
  platformRole: "none" | "operator" | "admin",
): boolean {
  if (role === null || role === undefined) return false;
  // Caterers are event-scoped and reach the venue through a share, never the
  // venue dashboard.
  if (hasRole(EVENT_SCOPED_ROLES, role)) return false;
  if (item.capability === "platformAdmin") return platformRole === "admin";
  // Venue stock before the platform-admin shortcut: a platform admin is not a
  // member of this venue and holds no stock authority over it.
  if (item.capability === "venueAdmin") return hasRole(INVENTORY_WRITE_ROLES, role);
  if (platformRole === "admin") return true;
  if (item.capability === "commercial") return hasRole(COMMERCIAL_ROLES, role);
  if (item.capability === "crmPipeline") return hasRole(CRM_PIPELINE_ROLES, role);
  return hasRole(WORKSPACE_ROLES, role);
}

export { NAV_ITEMS };

function ClerkSignOutButton(props: { readonly onLocalSignOut: () => void }): React.ReactElement {
  const { signOut } = useClerk();
  const requestExit = useInventoryExit();
  const handleSignOut = (): void => {
    requestExit(() => { props.onLocalSignOut(); void signOut(); });
  };

  return (
    <button type="button" onClick={handleSignOut} className="dashboard-layout-signout">
      Sign Out
    </button>
  );
}

function LocalSignOutButton(props: { readonly onLocalSignOut: () => void }): React.ReactElement {
  const requestExit = useInventoryExit();
  return (
    <button type="button" onClick={() => { requestExit(props.onLocalSignOut); }} className="dashboard-layout-signout">
      Sign Out
    </button>
  );
}

function DashboardLayoutShell({ activeView, onViewChange, mainLabel, children }: DashboardLayoutProps): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const logoutLocal = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [openMenu, setOpenMenu] = useState<"more" | "account" | null>(null);
  const menuId = useId();
  const moreRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setOpenMenu(null); }, [location.key, activeView, user?.id, user?.venueId]);
  useEffect(() => {
    if (openMenu === null) return;
    const currentRef = openMenu === "more" ? moreRef : accountRef;
    const dismissOutside = (event: Event): void => {
      if (event.target instanceof Node && currentRef.current?.contains(event.target) !== true) setOpenMenu(null);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpenMenu(null);
      (openMenu === "more" ? moreButtonRef : accountButtonRef).current?.focus();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [openMenu]);

  // Worn by a page that is not /dashboard: the view buttons cannot call back,
  // so they route instead. Same element, same label, same selector.
  const selectView = (view: DashboardView): void => {
    setOpenMenu(null);
    if (onViewChange !== undefined) {
      onViewChange(view);
      return;
    }
    void navigate(`/dashboard?view=${view}`);
  };

  /** A cross-route nav link is "current" when its route is the one showing.
   *  These four links have never had an active state — so on the Diary,
   *  nothing in the rail told you where you were. */
  const isRouteActive = (to: string): boolean =>
    location.pathname === to || location.pathname.startsWith(`${to}/`);

  const routeLinkClass = (to: string): string =>
    `dashboard-layout-nav-item dashboard-layout-nav-link${
      isRouteActive(to) ? " dashboard-layout-nav-item--active" : ""
    }`;

  // Fetch venue name dynamically so the header reflects the actual venue,
  // not the hardcoded placeholder (F28). Admin users without a venueId see
  // "Admin Dashboard" instead.
  const [venueName, setVenueName] = useState("Dashboard");
  const [venueLoading, setVenueLoading] = useState(false);
  useEffect(() => {
    if (user?.venueId === undefined || user.venueId === null) {
      setVenueName(user?.platformRole === "admin" ? "Venviewer Platform" : "Dashboard");
      setVenueLoading(false);
      return;
    }
    const request = { current: true };
    setVenueName("Your venue");
    setVenueLoading(true);
    void spacesApi.getVenue(user.venueId)
      .then((v) => { if (request.current) setVenueName(v.name); })
      .catch(() => { /* non-critical — keep default */ })
      .finally(() => { if (request.current) setVenueLoading(false); });
    return () => { request.current = false; };
  }, [user?.platformRole, user?.venueId]);

  const handleLocalSignOut = (): void => {
    setOpenMenu(null);
    logoutLocal();
  };

  const platformRole = user?.platformRole ?? "none";
  // One flag per ROUTE, not one flag per neighbourhood: /diary and
  // /hallkeeper have different gates, and a single canSchedule offered the
  // Hallkeeper link to sales, which /hallkeeper/today then refused.
  const canPlan = platformRole === "admin" || hasRole(PLANNER_ROLES, user?.role);
  const canOpenDiary = platformRole === "admin" || hasRole(DIARY_ROLES, user?.role);
  const canOpenHallkeeperDay = platformRole === "admin" || hasRole(VENUE_DAY_ROLES, user?.role);
  // Venue stock is written by venue administration only, and the platform
  // admin's own tools never grant it (pinned by DashboardLayout.test.tsx).
  const canManageStock = hasRole(INVENTORY_WRITE_ROLES, user?.role);
  const moreItems = NAV_ITEMS.filter((item) => item.view !== "inventory" && canShowNavItem(item, user?.role, platformRole));
  // /event-architect still marks the menu active for anyone who reaches it by
  // URL, even though R1 offers no link to it.
  const moreActive = moreItems.some((item) => item.view === activeView) ||
    isRouteActive("/event-architect") || isRouteActive("/dev/capture-intake");
  const nameInitials = user?.name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("") ?? "";
  const initials = (nameInitials.length > 0 ? nameInitials : "V").toLocaleUpperCase("en-GB");
  const roleLabel = platformRole === "admin" ? "Platform admin" : ROLE_LABELS[user?.role ?? ""] ?? "Workspace member";

  return (
    <>
      <a className="dashboard-layout-skip" href="#dashboard-main">Skip to workspace</a>
      <header className="dashboard-layout-header">
        <div className="dashboard-layout-identity">
          <Link className="dashboard-layout-brand-name" to="/dashboard">Venviewer</Link>
          <div className="dashboard-layout-venue">
            <p className="dashboard-layout-title" title={venueName}>{venueName}</p>
            {venueLoading && <ActivityStatus>Opening venue…</ActivityStatus>}
          </div>
        </div>
        <nav className="dashboard-layout-navigation" aria-label="Staff dashboard">
          {canPlan && <Link className={routeLinkClass("/plan")} to="/plan"
            aria-current={isRouteActive("/plan") ? "page" : undefined}>Plan</Link>}
          {canOpenDiary && <Link className={routeLinkClass("/diary")} to="/diary"
            aria-current={isRouteActive("/diary") ? "page" : undefined}>Diary</Link>}
          {canOpenHallkeeperDay && <Link className={routeLinkClass("/hallkeeper")} to="/hallkeeper"
            aria-current={isRouteActive("/hallkeeper") ? "page" : undefined}>Hallkeeper</Link>}
          {canManageStock && <button type="button"
            className={`dashboard-layout-nav-item${activeView === "inventory" ? " dashboard-layout-nav-item--active" : ""}`}
            aria-current={activeView === "inventory" ? "page" : undefined}
            onClick={() => { selectView("inventory"); }}>Inventory</button>}
          <div className="dashboard-layout-disclosure" ref={moreRef}>
            <button type="button" ref={moreButtonRef} className={`dashboard-layout-nav-item${moreActive ? " dashboard-layout-nav-item--active" : ""}`}
              aria-expanded={openMenu === "more"} aria-controls={`${menuId}-more`}
              onClick={() => { setOpenMenu((current) => current === "more" ? null : "more"); }}>
              More <ChevronDown aria-hidden="true" size={16} />
            </button>
            <div className="dashboard-layout-popover" id={`${menuId}-more`} hidden={openMenu !== "more"}>
              <div className="dashboard-layout-more-links">
                {moreItems.map((item) => <button key={item.view} type="button"
                  className={`dashboard-layout-menu-link${activeView === item.view ? " dashboard-layout-menu-link--active" : ""}`}
                  aria-current={activeView === item.view ? "page" : undefined}
                  onClick={() => { selectView(item.view); }}>{item.label}</button>)}
                {/* Event Architect is hidden for R1 (goal 18 §6 decision 8).
                    The route and the page stay; only the way in is closed, so
                    restoring it is this one link back. */}
                {platformRole === "admin" && <Link className="dashboard-layout-menu-link" to="/dev/capture-intake"
                  aria-current={isRouteActive("/dev/capture-intake") ? "page" : undefined}>Capture Factory</Link>}
              </div>
              <div className="dashboard-layout-notifications"><p className="dashboard-layout-menu-label">Notifications</p><NotificationCenter /></div>
            </div>
          </div>
        </nav>
        <div className="dashboard-layout-disclosure dashboard-layout-account" ref={accountRef}>
          <button className="dashboard-layout-account-button" type="button" ref={accountButtonRef}
            aria-label={`Account: ${user?.name ?? "Signed in"}`} aria-expanded={openMenu === "account"} aria-controls={`${menuId}-account`}
            onClick={() => { setOpenMenu((current) => current === "account" ? null : "account"); }}>
            <span className="dashboard-layout-avatar" aria-hidden="true">{initials}</span>
            <span className="dashboard-layout-account-name"><strong>{user?.name ?? "Signed in"}</strong><span>{roleLabel}</span></span>
            <ChevronDown aria-hidden="true" size={18} />
          </button>
          <div className="dashboard-layout-popover dashboard-layout-account-panel" id={`${menuId}-account`} hidden={openMenu !== "account"}>
            <p className="dashboard-layout-account-email">{user?.email ?? ""}</p>
            {isE2EAuthBypassEnabled()
              ? <LocalSignOutButton onLocalSignOut={handleLocalSignOut} />
              : <ClerkSignOutButton onLocalSignOut={handleLocalSignOut} />}
          </div>
        </div>
      </header>
      <div className={`dashboard-layout-main${activeView === "inventory" ? " dashboard-layout-main--inventory" : ""}${isRouteActive("/diary") ? " dashboard-layout-main--diary" : ""}`}>
        <main className="dashboard-layout-content" id="dashboard-main" tabIndex={-1} aria-label={mainLabel ?? "Dashboard workspace"}>
          {children}
        </main>
      </div>

      <ToastContainer />
    </>
  );
}

export function DashboardLayout(props: DashboardLayoutProps): React.ReactElement {
  return <InventoryExitBoundary><DashboardLayoutShell {...props} /></InventoryExitBoundary>;
}

export type { DashboardView };
