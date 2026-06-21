import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardLayout, type DashboardView } from "../components/dashboard/DashboardLayout.js";
import { EnquiriesView } from "../components/dashboard/EnquiriesView.js";
import { ReviewsView } from "../components/dashboard/ReviewsView.js";
import { ClientSearchView } from "../components/dashboard/ClientSearchView.js";
import { ClientProfile } from "../components/dashboard/ClientProfile.js";
import { LoadoutsView } from "../components/dashboard/LoadoutsView.js";
import { VenueSettings } from "../components/dashboard/VenueSettings.js";
import { AdminPanel } from "../components/dashboard/AdminPanel.js";
import { ExecutiveAnalyticsView } from "../components/dashboard/ExecutiveAnalyticsView.js";
import { ProposalsView } from "../components/dashboard/ProposalsView.js";
import { CommercialPipelineView } from "../components/dashboard/CommercialPipelineView.js";
import { OnboardingView } from "../components/dashboard/OnboardingView.js";
import { useAuthStore } from "../stores/auth-store.js";

// ---------------------------------------------------------------------------
// DashboardPage — hallkeeper management interface
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Punch list #34 — cross-view enquiry navigation with return context
//
// When the user clicks an enquiry inside ClientProfile, three things happen:
//   1. The enquiry id is captured (was previously discarded — the bug)
//   2. The current profile state is snapshotted into `enquiryReturnContext`
//      so "Back" can restore it
//   3. The view switches to "enquiries" with the captured id pre-selected
//
// The detail-view "Back" button reads the return context and restores the
// profile, so the user lands back exactly where they came from instead of
// being dumped at the top of the unfiltered enquiry list.
// ---------------------------------------------------------------------------

interface EnquiryReturnContext {
  readonly enquiryId: string;
  readonly returnUserId: string | null;
  readonly returnLeadId: string | null;
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
  "onboarding",
  "admin",
];

const STAFF_ONLY_VIEWS = new Set<DashboardView>(["pipeline", "proposals"]);
const ADMIN_ONLY_VIEWS = new Set<DashboardView>(["onboarding", "admin"]);

export function dashboardViewFromSearchValue(value: string | null): DashboardView | null {
  if (value === null) return null;
  return DASHBOARD_VIEW_VALUES.find((candidate) => candidate === value) ?? null;
}

export function canOpenDashboardView(view: DashboardView, role: string | null): boolean {
  if (role === "supplier") return false;
  if (role === "executive") return view === "analytics";
  if (ADMIN_ONLY_VIEWS.has(view)) return role === "admin";
  if (STAFF_ONLY_VIEWS.has(view)) return role === "admin" || role === "staff";
  return role !== null;
}

export function defaultDashboardViewForRole(role: string | null): DashboardView {
  return role === "executive" ? "analytics" : "enquiries";
}

export function initialDashboardViewForRole(requestedView: DashboardView | null, role: string | null): DashboardView {
  if (requestedView !== null && canOpenDashboardView(requestedView, role)) return requestedView;
  const defaultView = defaultDashboardViewForRole(role);
  return canOpenDashboardView(defaultView, role) ? defaultView : "enquiries";
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
  const requestedView = useMemo(
    () => dashboardViewFromSearchValue(searchParams.get("view")),
    [searchParams],
  );
  const [view, setView] = useState<DashboardView>(() => initialDashboardViewForRole(requestedView, userRole));
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [profileLeadId, setProfileLeadId] = useState<string | null>(null);
  const [enquiryReturnContext, setEnquiryReturnContext] = useState<EnquiryReturnContext | null>(null);

  useEffect(() => {
    if (requestedView !== null) {
      if (!canOpenDashboardView(requestedView, userRole)) return;
      setView(requestedView);
      setProfileUserId(null);
      setProfileLeadId(null);
      setEnquiryReturnContext(null);
      return;
    }

    const defaultView = defaultDashboardViewForRole(userRole);
    if (!canOpenDashboardView(defaultView, userRole)) return;
    setView(defaultView);
    setProfileUserId(null);
    setProfileLeadId(null);
    setEnquiryReturnContext(null);
  }, [requestedView, userRole]);

  const deniedRequestedView = requestedView !== null && userRole !== null && !canOpenDashboardView(requestedView, userRole)
    ? requestedView
    : null;

  const handleViewChange = (newView: DashboardView): void => {
    setView(newView);
    setProfileUserId(null);
    setProfileLeadId(null);
    // Switching views from the sidebar is a deliberate user action — drop
    // the cross-view return context so it doesn't bleed into the next view.
    setEnquiryReturnContext(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("view", newView);
    setSearchParams(nextParams);
  };

  const handleOpenDefaultView = (): void => {
    handleViewChange(defaultDashboardViewForRole(userRole));
  };

  // Triggered from ClientProfile. Snapshots the current profile so "Back"
  // from the enquiry detail can restore it, then jumps to the enquiries view.
  const handleViewEnquiryFromProfile = (enquiryId: string): void => {
    setEnquiryReturnContext({
      enquiryId,
      returnUserId: profileUserId,
      returnLeadId: profileLeadId,
    });
    setView("enquiries");
    setProfileUserId(null);
    setProfileLeadId(null);
  };

  // Called by EnquiriesView when its detail "Back" is clicked AND a return
  // context is in scope. Restores the profile the user came from.
  const handleEnquiryDetailClose = (): void => {
    if (enquiryReturnContext === null) return;
    setProfileUserId(enquiryReturnContext.returnUserId);
    setProfileLeadId(enquiryReturnContext.returnLeadId);
    setEnquiryReturnContext(null);
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

    // Client profile sub-view (shown from search)
    if (profileUserId !== null || profileLeadId !== null) {
      return (
        <ClientProfile
          userId={profileUserId ?? undefined}
          leadId={profileLeadId ?? undefined}
          onBack={() => { setProfileUserId(null); setProfileLeadId(null); }}
          onViewEnquiry={handleViewEnquiryFromProfile}
        />
      );
    }

    switch (view) {
      case "enquiries":
        return (
          <EnquiriesView
            initialSelectedId={enquiryReturnContext?.enquiryId ?? null}
            onDetailClose={enquiryReturnContext !== null ? handleEnquiryDetailClose : undefined}
          />
        );
      case "pipeline":
        return <CommercialPipelineView />;
      case "reviews":
        return <ReviewsView />;
      case "analytics":
        return <ExecutiveAnalyticsView />;
      case "proposals":
        return <ProposalsView />;
      case "search":
        return (
          <ClientSearchView
            onViewProfile={(id) => { setProfileUserId(id); }}
            onViewLeadProfile={(id) => { setProfileLeadId(id); }}
          />
        );
      case "loadouts":
        return <LoadoutsView />;
      case "settings":
        return <VenueSettings />;
      case "onboarding":
        return <OnboardingView />;
      case "admin":
        return <AdminPanel />;
    }
  };

  return (
    <DashboardLayout activeView={view} onViewChange={handleViewChange}>
      {renderContent()}
    </DashboardLayout>
  );
}
