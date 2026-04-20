import {
  ConfigApprovedEmail,
  type ConfigApprovedData,
} from "../src/services/email-templates.js";

const sampleData: ConfigApprovedData = {
  eventName: "Anderson Wedding Reception",
  venueName: "Trades Hall Glasgow",
  spaceName: "Grand Hall",
  snapshotVersion: 3,
  approvedByName: "Catherine Tait",
  approvedAt: "17 Apr 2026, 14:30",
  hallkeeperUrl: "http://localhost:5173/hallkeeper/cfg-001",
  editorUrl: "http://localhost:5173/editor/cfg-001",
  note:
    "Great work on the table layout. Note: hearing loop required in the Centre zone — please coordinate with the AV team. Everything else looks ready to go.",
};

export default function Preview() {
  return <ConfigApprovedEmail {...sampleData} />;
}
