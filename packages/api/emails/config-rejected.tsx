import {
  ConfigRejectedEmail,
  type ConfigRejectedData,
} from "../src/services/email-templates.js";

const sampleData: ConfigRejectedData = {
  eventName: "Anderson Wedding Reception",
  venueName: "Trades Hall Glasgow",
  spaceName: "Grand Hall",
  snapshotVersion: 1,
  rejectedByName: "Catherine Tait",
  editorUrl: "http://localhost:5173/plan/cfg-001",
  note:
    "The aisle in the Centre zone is under 1.2m. Please widen it to at least 1.5m for venue review and resubmit. Let us know if you need help adjusting the table positions.",
};

export default function Preview() {
  return <ConfigRejectedEmail {...sampleData} />;
}
