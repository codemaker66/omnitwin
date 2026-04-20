import {
  EnquiryRejectedEmail,
  type EnquiryRejectedData,
} from "../src/services/email-templates.js";

const sampleData: EnquiryRejectedData = {
  venueName: "Trades Hall Glasgow",
  spaceName: "Grand Hall",
  eventDate: "Saturday, 15 June 2026",
  note:
    "Unfortunately we're already committed to a civic event on this date. We'd love to help you find an alternative Saturday in late July — please reach out and we can share our calendar.",
};

export default function Preview() {
  return <EnquiryRejectedEmail {...sampleData} />;
}
