import { useState } from "react";
import { DashboardLayout, type DashboardView } from "../components/dashboard/DashboardLayout.js";
import { EnquiriesView } from "../components/dashboard/EnquiriesView.js";
import { ClientSearchView } from "../components/dashboard/ClientSearchView.js";
import { ClientProfile } from "../components/dashboard/ClientProfile.js";
import { LoadoutsView } from "../components/dashboard/LoadoutsView.js";

// ---------------------------------------------------------------------------
// DashboardPage — hallkeeper management interface
// ---------------------------------------------------------------------------

export function DashboardPage(): React.ReactElement {
  const [view, setView] = useState<DashboardView>("enquiries");
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [profileLeadId, setProfileLeadId] = useState<string | null>(null);

  const handleViewChange = (newView: DashboardView): void => {
    setView(newView);
    setProfileUserId(null);
    setProfileLeadId(null);
  };

  const renderContent = (): React.ReactElement => {
    // Client profile sub-view (shown from search)
    if (profileUserId !== null || profileLeadId !== null) {
      return (
        <ClientProfile
          userId={profileUserId ?? undefined}
          leadId={profileLeadId ?? undefined}
          onBack={() => { setProfileUserId(null); setProfileLeadId(null); }}
          onViewEnquiry={() => { setView("enquiries"); setProfileUserId(null); setProfileLeadId(null); }}
        />
      );
    }

    switch (view) {
      case "enquiries":
        return <EnquiriesView />;
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
