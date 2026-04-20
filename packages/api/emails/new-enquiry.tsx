import { NewEnquiryEmail, type NewEnquiryData } from "../src/services/email-templates.js";

// ---------------------------------------------------------------------------
// React-email preview — `NewEnquiry` notification
//
// This file exists to feed the `email dev` visual preview server. It is
// NOT shipped to production; the production build excludes `emails/` via
// the api package's `tsconfig.json` (include: ["src/**"]).
//
// Each preview file supplies sample props and default-exports the
// rendered JSX. React-email auto-discovers files in this directory and
// renders them in the local inbox at http://localhost:3000.
// ---------------------------------------------------------------------------

const sampleData: NewEnquiryData = {
  spaceName: "Grand Hall",
  eventType: "Wedding Reception",
  contactName: "Sarah Anderson",
  contactEmail: "sarah@example.com",
  contactPhone: "+44 7700 900123",
  eventDate: "Saturday, 15 June 2026",
  guestCount: 120,
  message:
    "Looking for a late-summer evening reception with dinner for 120. We'd love gold accents and a dance floor. Is the dome lit in the evening? Happy to visit next week.",
  dashboardUrl: "http://localhost:5173/dashboard",
};

export default function Preview() {
  return <NewEnquiryEmail {...sampleData} />;
}
