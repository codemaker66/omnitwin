import {
  ConfigSubmittedEmail,
  type ConfigSubmittedData,
} from "../src/services/email-templates.js";

const sampleData: ConfigSubmittedData = {
  eventName: "Anderson Wedding Reception",
  venueName: "Trades Hall Glasgow",
  spaceName: "Grand Hall",
  snapshotVersion: 1,
  submittedByName: "Sarah Anderson",
  reviewUrl: "http://localhost:5173/dashboard/reviews/cfg-001",
};

export default function Preview() {
  return <ConfigSubmittedEmail {...sampleData} />;
}
