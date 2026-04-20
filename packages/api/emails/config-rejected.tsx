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
  editorUrl: "http://localhost:5173/editor/cfg-001",
  note:
    "The aisle in the Centre zone is under 1.2m — this won't pass the fire-exit clearance check. Please widen to at least 1.5m and re-submit. Let us know if you need help adjusting the table positions.",
};

export default function Preview() {
  return <ConfigRejectedEmail {...sampleData} />;
}
