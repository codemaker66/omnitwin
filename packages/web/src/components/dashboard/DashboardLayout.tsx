import { type ReactNode, Suspense, useCallback, useMemo, useState, useEffect, useId, useLayoutEffect, useRef } from "react";
import { useClerk } from "@clerk/react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Bell, ChevronDown, Search } from "lucide-react";
import { useAuthStore } from "../../stores/auth-store.js";
import { ToastContainer } from "../shared/ToastContainer.js";
import * as spacesApi from "../../api/spaces.js";
import { NotificationCenter } from "./NotificationCenter.js";
import { getUnreadNotificationCount } from "../../api/notifications.js";
import { listensForFloorRequests, subscribeRequestsLive } from "../../lib/requests-live.js";
import { ActivityStatus } from "../shared/Activity.js";
import { InventoryExitBoundary, useInventoryExit } from "./inventory/InventoryNavigationGuard.js";
import { useSignOutWords } from "./proposals/sign-out-words.js";
import { SignOutAskContext, StaffShellContext, useInStaffShell, useShellFrame, type AskBeforeSignOut, type ShellFrame, type StaffShell } from "./staff-shell.js";
import { FindPalette } from "./find/FindPalette.js";
import type { FindPlace, FindSource, FindTarget } from "./find/find-model.js";
import { isE2EAuthBypassEnabled } from "../../lib/e2e-auth-bypass.js";
import { getDefaultRoute } from "../../lib/role-routing.js";
import {
  ANALYTICS_ROLES, awaitsVenue, CLIENT_SEARCH_ROLES, COMMERCIAL_ROLES, CRM_PIPELINE_ROLES,
  DIARY_ROLES, EVENT_SCOPED_ROLES, hasRole, INVENTORY_WRITE_ROLES, PLANNER_ROLES,
  REVIEW_QUEUE_ROLES, ROTA_TAB_ROLES, VENUE_DAY_ROLES, WORKSPACE_ROLES,
} from "../../lib/role-capabilities.js";
import "./DashboardLayout.css";

// ---------------------------------------------------------------------------
// DashboardLayout — shared venue navigation and a single workspace landmark
// ---------------------------------------------------------------------------

type DashboardView = "enquiries" | "pipeline" | "reviews" | "analytics" | "proposals" | "search" | "loadouts" | "settings" | "inventory" | "rota" | "onboarding" | "admin";

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
  /** A view that paints its own full-bleed workspace asks for it here: a
   *  desk (Enquiries, Pending reviews, Clients) on the sage ground, or the
   *  Rota; everything else keeps the padded forest ground. */
  readonly surface?: "desk" | "rota";
  /** What the page adds to Find while it shows (the Diary's board). It must
   *  keep its identity across the page's renders. */
  readonly findSource?: FindSource;
  readonly children: ReactNode;
}

// Every entry names the capability behind it, and each capability is the web
// mirror of a named API gate (lib/role-capabilities.ts). The rule: no entry
// ships that the API then refuses. A missing tab is a better R1 than a tab
// that answers 403.
type NavCapability =
  | "workspace" | "commercial" | "crmPipeline" | "analytics" | "clientSearch"
  | "reviewQueue" | "venueAdmin" | "rota" | "platformAdmin";

const NAV_ITEMS: readonly { view: DashboardView; label: string; capability: NavCapability }[] = [
  { view: "enquiries", label: "Enquiries", capability: "workspace" },
  // Pipeline is PipelineDesk, reading api/crm.js — mirrors
  // routes/crm.ts and routes/opportunities.ts, which gate on
  // canManageCommercial: admin, manager, staff and sales.
  { view: "pipeline", label: "Pipeline", capability: "crmPipeline" },
  { view: "reviews", label: "Pending reviews", capability: "reviewQueue" },
  { view: "analytics", label: "Executive analytics", capability: "analytics" },
  // Proposals is ProposalsDesk, which reads api/proposals.js — already on
  // canManageCommercial, so the whole commercial set can open it.
  { view: "proposals", label: "Proposals", capability: "commercial" },
  // Clients is the Clients desk, reading api/clients.js — its search and
  // lists gate on canManageVenue, so sales and planner are refused.
  { view: "search", label: "Clients", capability: "clientSearch" },
  { view: "loadouts", label: "Reference loadouts", capability: "workspace" },
  { view: "settings", label: "Venue settings", capability: "workspace" },
  { view: "inventory", label: "Inventory", capability: "venueAdmin" },
  // The Rota is RotaView, reading api/rota.js — routes/rota.ts answers the
  // venue's whole team: the week for the floor, their own shifts for sales.
  { view: "rota", label: "Rota", capability: "rota" },
  { view: "onboarding", label: "Clients & access", capability: "platformAdmin" },
  { view: "admin", label: "Admin", capability: "platformAdmin" },
];

/** Venue names already read, by venue. Every page wears its own copy of the
 *  shell, so without this each move between Enquiries, the Diary and the
 *  Hallkeeper read the name again and the header showed "Your venue" and
 *  "Opening venue…" each time. Read once, then shown at once; each page
 *  still re-reads it quietly in case it was renamed. */
const knownVenueNames = new Map<string, string>();

/** Test seam: forget the names read so far. */
export function forgetKnownVenueNames(): void {
  knownVenueNames.clear();
}

/** The count is exact; past this the chip reads "99+" so it keeps its size. */
const UNREAD_CHIP_DISPLAY_LIMIT = 99;

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
  if (item.capability === "analytics") return hasRole(ANALYTICS_ROLES, role);
  if (item.capability === "clientSearch") return hasRole(CLIENT_SEARCH_ROLES, role);
  if (item.capability === "reviewQueue") return hasRole(REVIEW_QUEUE_ROLES, role);
  if (item.capability === "rota") return hasRole(ROTA_TAB_ROLES, role);
  return hasRole(WORKSPACE_ROLES, role);
}

export { NAV_ITEMS };

interface SignOutButtonProps {
  readonly onLocalSignOut: () => void;
  readonly askFirst: AskBeforeSignOut;
}

function ClerkSignOutButton(props: SignOutButtonProps): React.ReactElement {
  const { signOut } = useClerk();
  const handleSignOut = (): void => {
    props.askFirst(() => { props.onLocalSignOut(); void signOut(); });
  };

  return (
    <button type="button" onClick={handleSignOut} className="dashboard-layout-signout">
      Sign Out
    </button>
  );
}

function LocalSignOutButton(props: SignOutButtonProps): React.ReactElement {
  return (
    <button type="button" onClick={() => { props.askFirst(props.onLocalSignOut); }} className="dashboard-layout-signout">
      Sign Out
    </button>
  );
}

/** "⌘K" on a Mac, iPhone or iPad (whose browser also says "Macintosh");
 *  "Ctrl K" elsewhere. Both keys work everywhere; this only names one. */
function findShortcut(): string {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return /Macintosh|Mac OS X|iPhone|iPad/u.test(agent) ? "⌘K" : "Ctrl K";
}

/** Whether a modal dialog other than Find is open: Find never opens over one. */
function anotherDialogOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

function DashboardLayoutShell({ activeView, onViewChange, mainLabel, surface, findSource, children }: DashboardLayoutProps): React.ReactElement {
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

  // Find (T-635): Ctrl/⌘K from anywhere under the shell, a field included, as
  // in the mail and calendar tools a booker already uses. Pressed again it
  // closes; it never opens over another dialog. Moving elsewhere (Back, a
  // link, another person signing in) puts it away.
  const [findOpen, setFindOpen] = useState(false);
  const [shortcut] = useState(findShortcut);
  useEffect(() => { setFindOpen(false); }, [location.key, user?.id, user?.venueId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.repeat || event.isComposing) return;
      if (event.key.toLowerCase() !== "k" && event.code !== "KeyK") return;
      if (findOpen) {
        event.preventDefault();
        setFindOpen(false);
        return;
      }
      if (event.defaultPrevented || anotherDialogOpen()) return;
      event.preventDefault();
      setOpenMenu(null);
      setFindOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [findOpen]);
  // A finding opens where it lives: the page's own (the board's booking is
  // brought into view and focused), a layout in the planner in a new tab, and
  // anything else by its address, through the same guard as the header's links.
  const openFound = useCallback((target: FindTarget): void => {
    setFindOpen(false);
    if (target.kind === "local") {
      findSource?.pick(target.id);
      return;
    }
    if (target.newTab) {
      window.open(target.href, "_blank", "noopener,noreferrer");
      return;
    }
    void navigate(target.href);
  }, [findSource, navigate]);
  const closeFind = useCallback(() => { setFindOpen(false); }, []);
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
  // not the hardcoded placeholder (F28). With no venue it says why: a
  // platform admin's is the platform's, and a venue's own account not
  // connected to one yet is told so on every page.
  const cachedVenueName = user?.venueId === undefined || user.venueId === null
    ? undefined
    : knownVenueNames.get(user.venueId);
  const noVenueTitle = user?.platformRole === "admin" ? "Venviewer Platform"
    : awaitsVenue(user ?? null) ? "No venue yet" : "Dashboard";
  const [venueName, setVenueName] = useState(cachedVenueName ?? noVenueTitle);
  // The name is known (read by this page or an earlier one), so the header
  // can say it; until then it says what it is waiting for.
  const [venueKnown, setVenueKnown] = useState(cachedVenueName !== undefined);
  const [venueLoading, setVenueLoading] = useState(false);
  useEffect(() => {
    if (user?.venueId === undefined || user.venueId === null) {
      setVenueName(noVenueTitle);
      setVenueKnown(false);
      setVenueLoading(false);
      return;
    }
    const venueId = user.venueId;
    const request = { current: true };
    const known = knownVenueNames.get(venueId);
    if (known === undefined) {
      setVenueName("Your venue");
      setVenueKnown(false);
      setVenueLoading(true);
    } else {
      setVenueName(known);
      setVenueKnown(true);
    }
    void spacesApi.getVenue(venueId)
      .then((v) => {
        knownVenueNames.set(venueId, v.name);
        if (!request.current) return;
        setVenueName(v.name);
        setVenueKnown(true);
      })
      .catch(() => {
        // A name already shown stays; one never read is said to be missing,
        // rather than a placeholder that reads like a name.
        if (request.current && known === undefined) setVenueName("Venue name unavailable");
      })
      .finally(() => { if (request.current) setVenueLoading(false); });
    return () => { request.current = false; };
  }, [noVenueTitle, user?.platformRole, user?.venueId]);

  // Signing out asks first about an unfinished stock correction, then about
  // proposal words not yet saved; the workspace's own ways to sign out (a
  // refusal's "Use another account") ask the same. Staying, focus goes back
  // to the control signed out from, or to the account button when that is in
  // its closed menu.
  const requestExit = useInventoryExit();
  const signOutWords = useSignOutWords(user?.id ?? null, () => { accountButtonRef.current?.focus(); });
  const askWords = signOutWords.askFirst;
  const askBeforeSignOut = useCallback<AskBeforeSignOut>((signOut) => { requestExit(() => { askWords(signOut); }); }, [requestExit, askWords]);
  const handleLocalSignOut = (): void => {
    setOpenMenu(null);
    // Whoever signs in next on this browser reads their own venue afresh.
    forgetKnownVenueNames();
    logoutLocal();
  };

  // What this page is called: its own name when it gives one, else the
  // dashboard view's label, so <main> and the tab both say where you are.
  const viewLabel = activeView === undefined ? undefined : NAV_ITEMS.find((item) => item.view === activeView)?.label;
  const workspaceName = mainLabel ?? viewLabel ?? "Dashboard workspace";
  useEffect(() => {
    const previous = document.title;
    document.title = venueKnown
      ? `${workspaceName} · ${venueName} — Venviewer`
      : `${workspaceName} — Venviewer`;
    return () => { document.title = previous; };
  }, [venueKnown, venueName, workspaceName]);

  // Choosing another view, or another page under the persistent shell, moves
  // focus to the workspace, which is named after it, so a keyboard or
  // screen-reader user starts in the new place ("Proposals, main") rather
  // than on a menu that has closed or a link in the header. Not the view's
  // first heading: several views open with a card's ("New proposal"). Not
  // over a page that placed focus itself, and not on first arrival, which
  // keeps the browser's own start.
  const mainRef = useRef<HTMLElement>(null);
  const place = `${location.pathname}|${activeView ?? ""}`;
  const previousPlace = useRef(place);
  useEffect(() => {
    if (previousPlace.current === place) return;
    previousPlace.current = place;
    const main = mainRef.current;
    if (main === null || main.contains(document.activeElement)) return;
    main.focus({ preventScroll: true });
  }, [place]);

  // -------------------------------------------------------------------------
  // Unread notifications on the VISIBLE nav row
  //
  // The NotificationCenter lives inside the More popover, so anything it shows
  // is only readable once the popover is open — which means "unread count on
  // the nav" was not actually met: a hallkeeper never learns a change landed
  // until they go looking. The count is therefore lifted onto the
  // always-visible row as a chip.
  //
  // ONE number from ONE source: GET /notifications/unread-count, which counts
  // rather than measuring a capped page, so a busy day reads "23". The chip
  // shows it and the popover's NotificationCenter says the same number in
  // words; neither asks for its own. Unknown (a failed read) is null: no chip,
  // and no count stated anywhere.
  //
  // The count is re-read when the More popover closes and when a notification
  // is read inside it, and on a live inbox frame for the people the requests
  // channel can reach (lib/requests-live.ts).
  // -------------------------------------------------------------------------
  const [unreadNotifications, setUnreadNotifications] = useState<number | null>(null);
  // The bell opens More with the list already showing; More opens on its
  // links. Either way the list folds away when the popover closes.
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const morePopoverRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const notificationsShown = openMenu === "more" && notificationsOpen;
  // The list sits below More's links. When it opens, bring it to the top of
  // the menu, so the bell shows notifications on a phone without a scroll.
  // Before paint, so the menu never shows its links and then jumps.
  useLayoutEffect(() => {
    if (!notificationsShown) return;
    const popover = morePopoverRef.current;
    const block = notificationsRef.current;
    if (popover === null || block === null) return;
    popover.scrollTop = Math.max(0, block.offsetTop - parseFloat(getComputedStyle(popover).paddingTop));
  }, [notificationsShown]);
  const [unreadReadAt, setUnreadReadAt] = useState(0);
  const rereadUnread = useCallback(() => { setUnreadReadAt((tick) => tick + 1); }, []);
  useEffect(() => {
    if (openMenu !== "more") return;
    return rereadUnread;
  }, [openMenu, rereadUnread]);
  const identityId = user?.id ?? null;
  useEffect(() => {
    if (identityId === null) {
      setUnreadNotifications(null);
      return;
    }
    const request = { current: true };
    void getUnreadNotificationCount()
      .then((unread) => { if (request.current) setUnreadNotifications(unread); })
      .catch(() => { if (request.current) setUnreadNotifications(null); });
    return () => { request.current = false; };
  }, [identityId, unreadReadAt]);
  const listensForInbox = listensForFloorRequests(user);
  useEffect(() => {
    if (!listensForInbox) return;
    return subscribeRequestsLive((event) => {
      if (event.kind === "notification" || event.kind === "reconnected") rereadUnread();
    });
  }, [listensForInbox, rereadUnread]);
  const unreadShown = unreadNotifications ?? 0;
  const unreadLabel = `Notifications: ${String(unreadShown)} unread`;

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
  const rotaItem = NAV_ITEMS.find((item) => item.view === "rota");
  const canOpenRota = rotaItem !== undefined && canShowNavItem(rotaItem, user?.role, platformRole);
  // Inventory and the Rota sit on the visible row; the rest wait behind More.
  const role = user?.role;
  const moreItems = useMemo(
    () => NAV_ITEMS.filter((item) => item.view !== "inventory" && item.view !== "rota" && canShowNavItem(item, role, platformRole)),
    [platformRole, role],
  );
  // Find offers exactly the places this header offers, in its order, so it
  // never opens a page the person would be refused.
  const findPlaces = useMemo<readonly FindPlace[]>(() => {
    const places: FindPlace[] = [];
    if (canPlan) places.push({ id: "plan", label: "Plan", href: "/plan" });
    if (canOpenDiary) places.push({ id: "diary", label: "Diary", href: "/diary" });
    if (canOpenHallkeeperDay) places.push({ id: "hallkeeper", label: "Hallkeeper", href: "/hallkeeper" });
    if (canOpenRota) places.push({ id: "rota", label: "Rota", href: "/dashboard?view=rota" });
    if (canManageStock) places.push({ id: "inventory", label: "Inventory", href: "/dashboard?view=inventory" });
    for (const item of moreItems) places.push({ id: item.view, label: item.label, href: `/dashboard?view=${item.view}` });
    if (platformRole === "admin") places.push({ id: "capture", label: "Capture Factory", href: "/dev/capture-intake" });
    return places;
  }, [canManageStock, canOpenDiary, canOpenHallkeeperDay, canOpenRota, canPlan, moreItems, platformRole]);
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
      <header className="dashboard-layout-header" data-register="ivory">
        <div className="dashboard-layout-identity">
          {/* Home is the role's own first page: a hallkeeper's day, a platform
              admin's clients, everyone else's dashboard. */}
          <Link className="dashboard-layout-brand-name" to={user === null ? "/dashboard" : getDefaultRoute(user.role, user.platformRole)}>Venviewer</Link>
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
          {canOpenRota && <button type="button"
            className={`dashboard-layout-nav-item${activeView === "rota" ? " dashboard-layout-nav-item--active" : ""}`}
            aria-current={activeView === "rota" ? "page" : undefined}
            onClick={() => { selectView("rota"); }}>Rota</button>}
          {canManageStock && <button type="button"
            className={`dashboard-layout-nav-item${activeView === "inventory" ? " dashboard-layout-nav-item--active" : ""}`}
            aria-current={activeView === "inventory" ? "page" : undefined}
            onClick={() => { selectView("inventory"); }}>Inventory</button>}
          <div className="dashboard-layout-disclosure dashboard-layout-more" ref={moreRef}>
            {unreadShown > 0 && <button type="button"
              className="dashboard-layout-nav-item dashboard-layout-unread"
              data-testid="nav-unread-notifications"
              aria-label={unreadLabel} aria-expanded={openMenu === "more"} aria-controls={`${menuId}-more`}
              onClick={() => {
                if (openMenu === "more") { setOpenMenu(null); return; }
                setNotificationsOpen(true);
                setOpenMenu("more");
              }}>
              <Bell aria-hidden="true" size={16} />
              <span aria-hidden="true" className="dashboard-layout-unread-count">
                {unreadShown > UNREAD_CHIP_DISPLAY_LIMIT ? `${String(UNREAD_CHIP_DISPLAY_LIMIT)}+` : unreadShown}
              </span>
            </button>}
            <button type="button" ref={moreButtonRef} className={`dashboard-layout-nav-item${moreActive ? " dashboard-layout-nav-item--active" : ""}`}
              aria-expanded={openMenu === "more"} aria-controls={`${menuId}-more`}
              onClick={() => {
                if (openMenu === "more") { setOpenMenu(null); return; }
                setNotificationsOpen(false);
                setOpenMenu("more");
              }}>
              More <ChevronDown aria-hidden="true" size={16} />
            </button>
            <div className="dashboard-layout-popover" id={`${menuId}-more`} hidden={openMenu !== "more"} ref={morePopoverRef}>
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
              <div className="dashboard-layout-notifications" ref={notificationsRef}>
                <h2 className="dashboard-layout-menu-label">Notifications</h2>
                <NotificationCenter unreadCount={unreadNotifications} onUnreadChanged={rereadUnread}
                  expanded={notificationsShown} onExpandedChange={setNotificationsOpen} />
              </div>
            </div>
          </div>
        </nav>
        <div className="dashboard-layout-tools">
          <button type="button" className="dashboard-layout-find"
            aria-label="Find" aria-keyshortcuts="Control+K Meta+K" aria-haspopup="dialog" aria-expanded={findOpen}
            onClick={() => { setOpenMenu(null); setFindOpen(true); }}>
            <Search aria-hidden="true" size={18} />
            <span className="dashboard-layout-find-label" aria-hidden="true">Find</span>
            <kbd className="dashboard-layout-find-key" aria-hidden="true">{shortcut}</kbd>
          </button>
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
                ? <LocalSignOutButton onLocalSignOut={handleLocalSignOut} askFirst={askBeforeSignOut} />
                : <ClerkSignOutButton onLocalSignOut={handleLocalSignOut} askFirst={askBeforeSignOut} />}
            </div>
          </div>
        </div>
      </header>
      {findOpen && <FindPalette places={findPlaces} source={findSource ?? null} onOpen={openFound} onClose={closeFind} />}
      <div className={`dashboard-layout-main${activeView === "inventory" ? " dashboard-layout-main--inventory" : ""}${isRouteActive("/diary") ? " dashboard-layout-main--diary" : ""}${surface === "desk" ? " dashboard-layout-main--desk" : ""}${surface === "rota" ? " dashboard-layout-main--rota" : ""}`}>
        <main ref={mainRef} className="dashboard-layout-content" id="dashboard-main" tabIndex={-1} aria-label={workspaceName}>
          <SignOutAskContext.Provider value={askBeforeSignOut}>{children}</SignOutAskContext.Provider>
        </main>
      </div>

      <ToastContainer />
      {signOutWords.question}
    </>
  );
}

/** Inside the persistent shell a page hands its frame up to the header and
 *  draws only its workspace. */
function FramedWorkspace({ children, ...frame }: DashboardLayoutProps): React.ReactElement {
  useShellFrame(frame);
  return <>{children}</>;
}

export function DashboardLayout(props: DashboardLayoutProps): React.ReactElement {
  const inShell = useInStaffShell();
  if (inShell) return <FramedWorkspace {...props} />;
  return <InventoryExitBoundary><DashboardLayoutShell {...props} /></InventoryExitBoundary>;
}

/**
 * The persistent staff shell (roadmap N2), the parent of every staff page for
 * the venue's workspace members and platform admins. The header is drawn once
 * and stays while the pages beneath it change, so its unread count, its menus
 * and any toast survive a move from the Enquiries desk to the Diary.
 */
export function PersistentStaffShell(): React.ReactElement {
  const [held, setHeld] = useState<{ readonly owner: symbol; readonly frame: ShellFrame } | null>(null);
  const shell = useMemo<StaffShell>(() => ({
    hold: (owner, frame) => { setHeld({ owner, frame }); },
    release: (owner) => { setHeld((current) => (current?.owner === owner ? null : current)); },
  }), []);
  return (
    <InventoryExitBoundary>
      <StaffShellContext.Provider value={shell}>
        <DashboardLayoutShell {...held?.frame}>
          {/* A page whose code is still on its way opens here, under the header. */}
          <Suspense fallback={<ActivityStatus variant="panel">Opening…</ActivityStatus>}>
            <Outlet />
          </Suspense>
        </DashboardLayoutShell>
      </StaffShellContext.Provider>
    </InventoryExitBoundary>
  );
}


export type { DashboardView };
