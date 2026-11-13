import { GUEST_ENQUIRY_LIMITS } from "@omnitwin/types/enquiry";

// -----------------------------------------------------------------------------
// A guest's message against the most the public enquiry route takes.
//
// The walkthrough's and the planner's message fields once set maxLength, and a
// browser cuts a longer paste at that length without a word: the events team
// got a brief that stopped mid-sentence and the guest never knew (review of
// #405, F5). The fields now keep everything pasted, and Send holds the enquiry
// with this sentence, announced and focused as the email's problem is.
//
// It counts what the API counts: the message the forms post (trimmed), in
// Unicode code points, which is how zod 4's .max reads a string's length
// ($ZodCheckMaxLength). An emoji outside the basic plane is one code point
// but two UTF-16 units, so String#length, or a maxlength attribute, would
// hold a message the API takes.
// -----------------------------------------------------------------------------

/** Why Send holds this message, or null when the API would take it. */
export function messageLengthProblem(message: string): string | null {
  const limit = GUEST_ENQUIRY_LIMITS.messageLength;
  const length = Array.from(message.trim()).length;
  if (length <= limit) return null;
  return `Messages can be up to ${limit.toLocaleString("en-GB")} characters. Yours is ${length.toLocaleString("en-GB")}.`;
}
