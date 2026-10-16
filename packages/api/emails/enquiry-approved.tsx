import {
  EnquiryApprovedEmail,
  type EnquiryApprovedData,
} from "../src/services/email-templates.js";

const sampleData: EnquiryApprovedData = {
  venueName: "Trades Hall Glasgow",
  roomName: "Grand Hall",
  // The stored calendar date, as the route passes it; the email words it.
  eventDate: "2026-06-15",
  configUrl: "http://localhost:5173/plan/abc-123",
};

export default function Preview() {
  return <EnquiryApprovedEmail {...sampleData} />;
}
