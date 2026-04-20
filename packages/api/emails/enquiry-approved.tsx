import {
  EnquiryApprovedEmail,
  type EnquiryApprovedData,
} from "../src/services/email-templates.js";

const sampleData: EnquiryApprovedData = {
  venueName: "Trades Hall Glasgow",
  spaceName: "Grand Hall",
  eventDate: "Saturday, 15 June 2026",
  configUrl: "http://localhost:5173/editor/abc-123",
};

export default function Preview() {
  return <EnquiryApprovedEmail {...sampleData} />;
}
