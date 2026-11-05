import type { ReportedResponseChannel } from "@omnitwin/types";
import { VENUE_TIME_ZONE } from "../../../pages/diary/lib/board-time.js";
import { countPhrase, venueMoment, type SummaryPart } from "./enquiry-desk-format.js";

// ---------------------------------------------------------------------------
// Words for an enquiry's first reply and the reply-time alarm (migration 0100,
// run-first item 3). Pure functions: the desk renders what these return, and
// the tests pin them. Times are venue-local, as everywhere on the desk.
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;

/** How a reply was made, as the record line says it. */
const CHANNEL_WORDS: Readonly<Record<string, string>> = {
  email: "By email",
  phone: "By phone",
  in_person: "In person",
  video_call: "On a video call",
  text_message: "By text message",
  proposal: "With a proposal",
  decision: "With the decision email",
};

/** The choices offered when someone records a reply, in the order offered. */
export const REPLY_CHANNEL_CHOICES: readonly { readonly channel: ReportedResponseChannel; readonly label: string }[] = [
  { channel: "phone", label: "Phone call" },
  { channel: "email", label: "Email" },
  { channel: "in_person", label: "In person" },
  { channel: "video_call", label: "Video call" },
  { channel: "text_message", label: "Text message" },
];

/** "By phone · Tue 27 Oct, 14:02 · by you", the time as the timeline below
 *  writes it. Null when the time cannot be read. */
export function replyRecordLine(input: {
  readonly at: string;
  readonly channel: string | null | undefined;
  readonly byUserId: string | null | undefined;
  readonly viewerId: string | null;
  readonly zone?: string;
}): string | null {
  const when = venueMoment(input.at, input.zone ?? VENUE_TIME_ZONE);
  if (when === null) return null;
  const how = (input.channel === null || input.channel === undefined ? undefined : CHANNEL_WORDS[input.channel]) ?? "Replied";
  const who = input.viewerId !== null && input.byUserId === input.viewerId ? " · by you" : "";
  return `${how} · ${when}${who}`;
}

/** "26 hours", "3 days": how long an enquiry has waited, at the scale a
 *  booker counts it in. Whole hours under two days, whole days after. */
export function waitedFor(arrivedAtMs: number, nowMs: number): string {
  const hours = Math.max(0, Math.floor((nowMs - arrivedAtMs) / HOUR_MS));
  if (hours < 48) return `${String(hours)} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.floor(hours / 24);
  return `${String(days)} days`;
}

/** The alarm's sentence under the desk's summary, or null when nothing is
 *  past the threshold: "2 enquiries have waited more than 24 hours for a
 *  first reply; the longest, 3 days." */
export function replyAlarmSummary(input: {
  readonly overdue: number;
  readonly thresholdHours: number;
  readonly longestArrivedAtMs: number | null;
  readonly nowMs: number;
}): readonly SummaryPart[] | null {
  const { overdue, thresholdHours, longestArrivedAtMs, nowMs } = input;
  if (overdue <= 0) return null;
  const noun = countPhrase(overdue, "all");
  const longest = longestArrivedAtMs === null || overdue === 1 ? [] : ["; the longest, ", { strong: waitedFor(longestArrivedAtMs, nowMs) }];
  return [
    { strong: noun, tone: "alarm" },
    ` ${overdue === 1 ? "has" : "have"} waited more than ${String(thresholdHours)} hours for a first reply`,
    ...longest,
    ".",
  ];
}
