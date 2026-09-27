import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ANALYTICS_ROLES, CLIENT_SEARCH_ROLES, COMMERCIAL_ROLES, CRM_PIPELINE_ROLES,
  DIARY_WRITE_ROLES, EVENT_SCOPED_ROLES, hasRole, INVENTORY_WRITE_ROLES, REVIEW_QUEUE_ROLES,
  ROTA_TAB_ROLES, WORKSPACE_ROLES,
} from "../lib/role-capabilities.js";
import { DashboardLayout, type DashboardView } from "../components/dashboard/DashboardLayout.js";
import { EnquiriesView } from "../components/dashboard/EnquiriesView.js";
import { ReviewsView } from "../components/dashboard/ReviewsView.js";
import { ClientsDesk } from "../components/dashboard/ClientsDesk.js";
import { clientRefFromSearchValue, clientRefToSearchValue, type ClientRef } from "../components/dashboard/clients/clients-desk-format.js";
import { LoadoutsView } from "../components/dashboard/LoadoutsView.js";
import { VenueSettings } from "../components/dashboard/VenueSettings.js";
import { AdminPanel } from "../components/dashboard/AdminPanel.js";
import { InventoryPanel } from "../components/dashboard/inventory/InventoryPanel.js";
import { ExecutiveAnalyticsView } from "../components/dashboard/ExecutiveAnalyticsView.js";
import { ProposalsView } from "../components/dashboard/ProposalsView.js";
import { CommercialPipelineView } from "../components/dashboard/CommercialPipelineView.js";
import { OnboardingView } from "../components/dashboard/OnboardingView.js";
import { RotaView } from "../components/dashboard/rota/RotaView.js";
import { useAuthStore } from "../stores/auth-store.js";

// ---------------------------------------------------------------------------
// DashboardPage — hallkeeper management interface
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Punch list #34 — cross-view enquiry navigation with return context
//
// When the user opens an enquiry from a client on the Clients desk, the
// enquiry id is kept and the view switches to "enquiries" with it selected.
// The address keeps the Clients desk's own state (?q= and ?client=), so the
// detail's "Back to profile" returns to the client exactly as it was left,
// rather than to the top of the unfiltered enquiry list.
// ---------------------------------------------------------------------------

interface EnquiryReturnContext {
  readonly enquiryId: string;
}

const DASHBOARD_VIEW_VALUES: readonly DashboardView[] = [
  "enquiries",
  "pipeline",
  "reviews",
  "analytics",
  "proposals",
  "search",
  "loadouts",
  "settings",
  "inventory",
  "rota",
  "onboarding",
  "admin",
];

// Pipeline is CommercialPipelineView, which reads api/crm.js (routes/crm.ts
// and routes/opportunities.ts); Proposals reads api/proposals.js. Both routes
// gate on canManageCommercial today, but each view keeps its own set so each
// tab names the gate it mirrors. See lib/role-capabilities.ts
// CRM_PIPELINE_ROLES and COMMERCIAL_ROLES.
const CRM_PIPELINE_VIEWS = new Set<DashboardView>(["pipeline"]);
const COMMERCIAL_VIEWS = new Set<DashboardView>(["proposals"]);
// Analytics, Client Search and the review queue each answer to their own API
// gate: the analytics tab mirrors GET /analytics/venue-dashboard
// (canManageCommercial), /clients gates on canManageVenue, and the
// pending-review queue takes the review state machine's own role set. See
// lib/role-capabilities.ts for each mirror.
const ANALYTICS_VIEWS = new Set<DashboardView>(["analytics"]);
const CLIENT_SEARCH_VIEWS = new Set<DashboardView>(["search"]);
const REVIEW_QUEUE_VIEWS = new Set<DashboardView>(["reviews"]);
// The Rota mirrors routes/rota.ts: the venue's whole team is answered (the
// week for the floor, their own shifts for everyone else in it). See
// lib/role-capabilities.ts ROTA_TAB_ROLES.
const ROTA_VIEWS = new Set<DashboardView>(["rota"]);
const ADMIN_ONLY_VIEWS = new Set<DashboardView>(["onboarding", "admin"]);
/** The views set as desks, full-bleed on the sage ground. */
const DESK_VIEWS = new Set<DashboardView>(["enquiries", "reviews", "search"]);
type PlatformRole = "none" | "operator" | "admin";

export function dashboardViewFromSearchValue(value: string | null): DashboardView | null {
  if (value === null) return null;
  return DASHBOARD_VIEW_VALUES.find((candidate) => candidate === value) ?? null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** The `config` deep-link parameter, validated. A view that pre-selects a
 *  record from a URL must not accept arbitrary text: an id the list cannot
 *  match is simply no selection, not an error state for the reviewer. */
export function configIdFromSearchValue(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

/** The deal the pipeline opens from the address (?opportunity=): a uuid, or none. */
export function opportunityIdFromSearchValue(value: string | null): string | null {
  return configIdFromSearchValue(value);
}

export function canOpenDashboardView(view: DashboardView, role: string | null, platformRole: PlatformRole = "none"): boolean {
  if (role === null) return false;
  // Caterers are event-scoped: they reach an event through a share, never the
  // venue dashboard (goal 18 §6 decision 6a).
  if (hasRole(EVENT_SCOPED_ROLES, role)) return false;
  if (ADMIN_ONLY_VIEWS.has(view)) return platformRole === "admin";
  // Venue stock is checked BEFORE the platform-admin shortcut: a Venviewer
  // platform admin is not a member of this venue and holds no stock
  // authority over it. Putting the shortcut first silently granted it.
  if (view === "inventory") return hasRole(INVENTORY_WRITE_ROLES, role);
  if (platformRole === "admin") return true;
  if (CRM_PIPELINE_VIEWS.has(view)) return hasRole(CRM_PIPELINE_ROLES, role);
  if (COMMERCIAL_VIEWS.has(view)) return hasRole(COMMERCIAL_ROLES, role);
  if (ANALYTICS_VIEWS.has(view)) return hasRole(ANALYTICS_ROLES, role);
  if (CLIENT_SEARCH_VIEWS.has(view)) return hasRole(CLIENT_SEARCH_ROLES, role);
  if (REVIEW_QUEUE_VIEWS.has(view)) return hasRole(REVIEW_QUEUE_ROLES, role);
  if (ROTA_VIEWS.has(view)) return hasRole(ROTA_TAB_ROLES, role);
  return hasRole(WORKSPACE_ROLES, role);
}

export function defaultDashboardViewForRole(_role: string | null): DashboardView {
  return "enquiries";
}

export function initialDashboardViewForRole(
  requestedView: DashboardView | null,
  role: string | null,
  platformRole: PlatformRole = "none",
): DashboardView {
  if (requestedView !== null && canOpenDashboardView(requestedView, role, platformRole)) return requestedView;
  const defaultView = defaultDashboardViewForRole(role);
  return canOpenDashboardView(defaultView, role, platformRole) ? defaultView : "enquiries";
}

function DashboardAccessDenied({
  requestedView,
  onOpenDefault,
  defaultView,
}: {
  readonly requestedView: DashboardView;
  readonly onOpenDefault: () => void;
  readonly defaultView: DashboardView;
}): React.ReactElement {
  const defaultLabel = defaultView === "analytics" ? "Open analytics" : "Open enquiries";
  return (
    <section className="vv-state-panel" role="alert">
      <p className="vv-state-kicker">Role restricted</p>
      <h1>That dashboard surface is not available for this role</h1>
      <p>
        The requested view "{requestedView}" is held back because it can change commercial, deployment, or admin records.
        Open a permitted dashboard view or ask an admin to update your workspace role.
      </p>
      <button type="button" className="vv-button primary" onClick={onOpenDefault}>
        {defaultLabel}
      </button>
    </section>
  );
}

export function DashboardPage(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const userRole = useAuthStore((state) => state.user?.role ?? null);
  const userPlatformRole = useAuthStore((state) => state.user?.platformRole ?? "none");
  const requestedView = useMemo(
    () => dashboardViewFromSearchValue(searchParams.get("view")),
    [searchParams],
  );
  // The review open on the reviews desk is in the address as ?review=:id, so
  // a reload or a shared link returns to it. The reviewer email's "Open
  // Review" button still links here as ?config=:id. Anything that is not a
  // uuid is ignored rather than handed to the desk as a selection.
  const requestedReviewId = useMemo(
    () => configIdFromSearchValue(searchParams.get("review")) ?? configIdFromSearchValue(searchParams.get("config")),
    [searchParams],
  );
  // Create opportunity on the Enquiries desk lands on its deal as
  // /dashboard?view=pipeline&opportunity=:id, and the address then follows
  // the deal that is open.
  const requestedOpportunityId = useMemo(
    () => opportunityIdFromSearchValue(searchParams.get("opportunity")),
    [searchParams],
  );
  // A proposal opened from the Clients desk: /dashboard?view=proposals&proposal=:id.
  const requestedProposalId = useMemo(
    () => opportunityIdFromSearchValue(searchParams.get("proposal")),
    [searchParams],
  );
  const requestedClientQuery = (searchParams.get("q") ?? "").trim();
  const requestedClient = useMemo(
    () => clientRefFromSearchValue(searchParams.get("client")),
    [searchParams],
  );
  const [view, setView] = useState<DashboardView>(() => initialDashboardViewForRole(requestedView, userRole, userPlatformRole));
  const [enquiryReturnContext, setEnquiryReturnContext] = useState<EnquiryReturnContext | null>(null);

  useEffect(() => {
    if (requestedView !== null) {
      if (!canOpenDashboardView(requestedView, userRole, userPlatformRole)) return;
      setView(requestedView);
      setEnquiryReturnContext(null);
      return;
    }

    const defaultView = defaultDashboardViewForRole(userRole);
    if (!canOpenDashboardView(defaultView, userRole, userPlatformRole)) return;
    setView(defaultView);
    setEnquiryReturnContext(null);
  }, [requestedView, userPlatformRole, userRole]);

  const deniedRequestedView = requestedView !== null && userRole !== null && !canOpenDashboardView(requestedView, userRole, userPlatformRole)
    ? requestedView
    : null;

  const handleViewChange = (newView: DashboardView): void => {
    // Inventory may hold this router transition while a correction is dirty.
    // Its accepted URL effect must own unmounting the editor. Other subviews
    // retain their existing local profile/return-context navigation behaviour.
    if (view !== "inventory" || newView === "inventory") {
      setView(newView);
      setEnquiryReturnContext(null);
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("view", newView);
    if (newView !== "pipeline") nextParams.delete("opportunity");
    if (newView !== "reviews") { nextParams.delete("review"); nextParams.delete("config"); }
    if (newView !== "proposals") nextParams.delete("proposal");
    if (newView !== "search") { nextParams.delete("q"); nextParams.delete("client"); }
    setSearchParams(nextParams);
  };

  /** Opens another view on one record, as a step the browser's Back undoes. */
  const openRecord = (target: DashboardView, param: "opportunity" | "proposal", id: string): void => {
    setView(target);
    setEnquiryReturnContext(null);
    const nextParams = new URLSearchParams(searchParams);
    for (const stale of ["opportunity", "proposal", "q", "client"]) nextParams.delete(stale);
    nextParams.set("view", target);
    nextParams.set(param, id);
    setSearchParams(nextParams);
  };

  const handleOpenOpportunity = (opportunityId: string): void => { openRecord("pipeline", "opportunity", opportunityId); };
  const handleOpenProposal = (proposalId: string): void => { openRecord("proposals", "proposal", proposalId); };

  const handleProposalShown = useCallback((proposalId: string | null): void => {
    setSearchParams((previous) => {
      if ((previous.get("proposal") ?? null) === proposalId) return previous;
      const nextParams = new URLSearchParams(previous);
      if (proposalId === null) nextParams.delete("proposal");
      else nextParams.set("proposal", proposalId);
      return nextParams;
    }, { replace: true });
  }, [setSearchParams]);

  // The Clients desk keeps what was typed (?q=, replaced as it is typed) and
  // the client open (?client=, a step of its own), so a reload returns to
  // both and the browser's Back closes the client onto the results.
  const handleClientQueryChange = useCallback((query: string): void => {
    setSearchParams((previous) => {
      const trimmed = query.trim();
      if ((previous.get("q") ?? "") === trimmed) return previous;
      const nextParams = new URLSearchParams(previous);
      if (trimmed === "") nextParams.delete("q");
      else nextParams.set("q", trimmed);
      return nextParams;
    }, { replace: true });
  }, [setSearchParams]);

  const handleClientChange = useCallback((client: ClientRef | null): void => {
    setSearchParams((previous) => {
      const value = client === null ? null : clientRefToSearchValue(client);
      if ((previous.get("client") ?? null) === value) return previous;
      const nextParams = new URLSearchParams(previous);
      if (value === null) nextParams.delete("client");
      else nextParams.set("client", value);
      return nextParams;
    });
  }, [setSearchParams]);

  const handleOpportunityShown = useCallback((opportunityId: string | null): void => {
    setSearchParams((previous) => {
      if ((previous.get("opportunity") ?? null) === opportunityId) return previous;
      const nextParams = new URLSearchParams(previous);
      if (opportunityId === null) nextParams.delete("opportunity");
      else nextParams.set("opportunity", opportunityId);
      return nextParams;
    }, { replace: true });
  }, [setSearchParams]);

  const handleReviewShown = useCallback((reviewId: string | null): void => {
    setSearchParams((previous) => {
      if ((previous.get("review") ?? null) === reviewId && !previous.has("config")) return previous;
      const nextParams = new URLSearchParams(previous);
      nextParams.delete("config");
      if (reviewId === null) nextParams.delete("review");
      else nextParams.set("review", reviewId);
      return nextParams;
    }, { replace: true });
  }, [setSearchParams]);

  const handleOpenDefaultView = (): void => {
    handleViewChange(defaultDashboardViewForRole(userRole));
  };

  // From a client on the Clients desk: the enquiry opens on the Enquiries
  // desk. The address still names the client, so closing the enquiry (or a
  // reload) returns to it.
  const handleViewEnquiryFromClient = (enquiryId: string): void => {
    setEnquiryReturnContext({ enquiryId });
    setView("enquiries");
  };

  // Called by EnquiriesView when its detail "Back" is clicked AND a return
  // context is in scope: back to the client it was opened from.
  const handleEnquiryDetailClose = (): void => {
    if (enquiryReturnContext === null) return;
    setEnquiryReturnContext(null);
    setView("search");
  };

  const renderContent = (): React.ReactElement => {
    if (deniedRequestedView !== null) {
      return (
        <DashboardAccessDenied
          requestedView={deniedRequestedView}
          defaultView={defaultDashboardViewForRole(userRole)}
          onOpenDefault={handleOpenDefaultView}
        />
      );
    }

    switch (view) {
      case "enquiries":
        return (
          <EnquiriesView
            initialSelectedId={enquiryReturnContext?.enquiryId ?? null}
            onDetailClose={enquiryReturnContext !== null ? handleEnquiryDetailClose : undefined}
            // The commercial API refuses anyone outside the venue's commercial
            // team, and "pipeline" is the view that capability already gates,
            // so the button and the tab agree by construction.
            canCreateOpportunity={canOpenDashboardView("pipeline", userRole, userPlatformRole)}
            onOpenOpportunity={handleOpenOpportunity}
            // The Diary's own write rule, so the link and the drawer agree.
            canHoldDate={hasRole(DIARY_WRITE_ROLES, userRole)}
          />
        );
      case "pipeline":
        return <CommercialPipelineView opportunityId={requestedOpportunityId} onOpportunityShown={handleOpportunityShown} />;
      case "reviews":
        return <ReviewsView reviewId={requestedReviewId} onReviewShown={handleReviewShown} />;
      case "analytics":
        return <ExecutiveAnalyticsView />;
      case "proposals":
        return <ProposalsView proposalId={requestedProposalId} onProposalShown={handleProposalShown} />;
      case "search":
        return (
          <ClientsDesk
            query={requestedClientQuery}
            client={requestedClient}
            onQueryChange={handleClientQueryChange}
            onClientChange={handleClientChange}
            // The contact, organisation, deal and proposal results are the
            // commercial record; the pipeline is the view that gates it.
            canSeeCommercial={canOpenDashboardView("pipeline", userRole, userPlatformRole)}
            onOpenDeal={handleOpenOpportunity}
            onOpenProposal={handleOpenProposal}
            onViewEnquiry={handleViewEnquiryFromClient}
          />
        );
      case "loadouts":
        return <LoadoutsView />;
      case "settings":
        return <VenueSettings />;
      case "inventory":
        return <InventoryPanel />;
      case "rota":
        return <RotaView />;
      case "onboarding":
        return <OnboardingView />;
      case "admin":
        return <AdminPanel />;
    }
  };

  const surface = deniedRequestedView !== null ? undefined
    : DESK_VIEWS.has(view) ? "desk" as const : view === "rota" ? "rota" as const : undefined;

  return (
    <DashboardLayout activeView={view} onViewChange={handleViewChange} surface={surface}>
      {renderContent()}
    </DashboardLayout>
  );
}
