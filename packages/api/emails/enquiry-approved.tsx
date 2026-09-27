import {
  EnquiryApprovedEmail,
  type EnquiryApprovedData,
} from "../src/services/email-templates.js";

const sampleData: EnquiryApprovedData = {
  venueName: "Trades Hall Glasgow",
  roomName: "Grand Hall",
  eventDate: "Saturday, 15 June 2026",
  configUrl: "http://localhost:5173/plan/abc-123",
};

export default function Preview() {
  return <EnquiryApprovedEmail {...sampleData} />;
}
