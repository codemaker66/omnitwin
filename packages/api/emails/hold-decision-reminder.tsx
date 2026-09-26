import {
  HoldDecisionReminderEmail,
  type HoldDecisionReminderData,
} from "../src/services/email-templates.js";

const sampleData: HoldDecisionReminderData = {
  holdTitle: "The Hartley wedding",
  spaceName: "Grand Hall",
  ownerName: "Fiona",
  holdDate: "Saturday 14 November 2026",
  decisionDate: "Friday 2 October 2026",
  daysUntilDecision: 7,
  rank: 1,
  jointFlag: false,
  diaryUrl: "http://localhost:5173/diary?view=week&date=2026-11-14",
};

export default function Preview() {
  return <HoldDecisionReminderEmail {...sampleData} />;
}
