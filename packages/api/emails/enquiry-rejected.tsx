import {
  EnquiryRejectedEmail,
  type EnquiryRejectedData,
} from "../src/services/email-templates.js";

const sampleData: EnquiryRejectedData = {
  venueName: "Trades Hall Glasgow",
  roomName: "Grand Hall",
  eventDate: "2026-06-15",
  note:
    "Unfortunately we're already committed to a civic event on this date. We'd love to help you find an alternative Saturday in late July — please reach out and we can share our calendar.",
};

export default function Preview() {
  return <EnquiryRejectedEmail {...sampleData} />;
}
