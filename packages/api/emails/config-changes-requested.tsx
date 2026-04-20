import {
  ConfigChangesRequestedEmail,
  type ConfigChangesRequestedData,
} from "../src/services/email-templates.js";

const sampleData: ConfigChangesRequestedData = {
  eventName: "Anderson Wedding Reception",
  venueName: "Trades Hall Glasgow",
  spaceName: "Grand Hall",
  snapshotVersion: 2,
  requestedByName: "Catherine Tait",
  editorUrl: "http://localhost:5173/editor/cfg-001",
  note:
    "Layout looks great overall. Two small revisions:\n• Please add a wheelchair space near the main entrance (we have two guests arriving in wheelchairs).\n• Move the DJ booth 1m further from the speaker stack — feedback risk.\nRe-submit when done and I'll approve.",
};

export default function Preview() {
  return <ConfigChangesRequestedEmail {...sampleData} />;
}
