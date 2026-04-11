import { useState } from "react";
import { DashboardLayout, type DashboardView } from "../components/dashboard/DashboardLayout.js";
import { EnquiriesView } from "../components/dashboard/EnquiriesView.js";
import { ClientSearchView } from "../components/dashboard/ClientSearchView.js";
import { ClientProfile } from "../components/dashboard/ClientProfile.js";
import { LoadoutsView } from "../components/dashboard/LoadoutsView.js";

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

export function DashboardPage(): React.ReactElement {
  const [view, setView] = useState<DashboardView>("enquiries");
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [profileLeadId, setProfileLeadId] = useState<string | null>(null);
  const [enquiryReturnContext, setEnquiryReturnContext] = useState<EnquiryReturnContext | null>(null);

  const handleViewChange = (newView: DashboardView): void => {
    setView(newView);
    setProfileUserId(null);
    setProfileLeadId(null);
    // Switching views from the sidebar is a deliberate user action — drop
    // the cross-view return context so it doesn't bleed into the next view.
    setEnquiryReturnContext(null);
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
        return (
          <div style={{ textAlign: "center", padding: 40, color: "#999" }}>
            <h2 style={{ fontSize: 20, fontWeight: 600 }}>Venue Settings</h2>
            <p>Coming soon</p>
          </div>
        );
    }
  };

  return (
    <DashboardLayout activeView={view} onViewChange={handleViewChange}>
      {renderContent()}
    </DashboardLayout>
  );
}
