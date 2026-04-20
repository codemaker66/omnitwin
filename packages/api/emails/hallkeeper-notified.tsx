import {
  HallkeeperNotifiedEmail,
  type HallkeeperNotifiedData,
} from "../src/services/email-templates.js";

const sampleData: HallkeeperNotifiedData = {
  eventName: "Anderson Wedding Reception",
  venueName: "Trades Hall Glasgow",
  spaceName: "Grand Hall",
  snapshotVersion: 3,
  eventDate: "Saturday, 15 June 2026 · 18:00",
  hallkeeperUrl: "http://localhost:5173/hallkeeper/cfg-001",
};

export default function Preview() {
  return <HallkeeperNotifiedEmail {...sampleData} />;
}
