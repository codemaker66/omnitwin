import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import type { RecordFirstResponseResult, ReportedResponseChannel } from "@omnitwin/types";
import { recordFirstResponse, type Enquiry } from "../../../api/enquiries.js";
import { ApiError } from "../../../api/client.js";
import { ActivityIndicator } from "../../shared/Activity.js";
import { useToastStore } from "../../../stores/toast-store.js";
import { msToWallInput, wallInputToMs } from "../../../pages/diary/lib/board-time.js";
import { REPLY_CHANNEL_CHOICES, replyRecordLine, waitedFor } from "./reply-format.js";
import { enquiryName } from "./EnquiryLedger.js";

// ---------------------------------------------------------------------------
// First reply: when and how the venue first answered, and, for the venue's
// commercial team, a way to record a reply made outside Venviewer (a call,
// an email from the venue's own mailbox, a meeting). Approving, declining and
// sending a proposal record their own reply; this is for everything else.
//
// The enquiry keeps the earliest reply it knows of, so recording one later
// than the reply it holds changes nothing, and the panel says so plainly.
// Nothing is sent to the client.
// ---------------------------------------------------------------------------

/** The server's own words for a refusal the person can act on. */
const SAID_AS_IS = new Set([
  "FIRST_RESPONSE_IN_FUTURE", "FIRST_RESPONSE_TOO_OLD", "FIRST_RESPONSE_BEFORE_ENQUIRY", "ENQUIRY_NOT_SENT", "ENQUIRY_CHANGED",
]);

interface EnquiryReplyProps {
  readonly enquiry: Enquiry;
  /** Whether this person records replies for this enquiry's venue. */
  readonly canRecord: boolean;
  /** When the enquiry arrived, if the reply-time alarm flags it. */
  readonly overdueSinceMs: number | null;
  readonly thresholdHours: number | null;
  readonly viewerId: string | null;
  readonly nowMs: number;
  readonly onRecorded: (result: RecordFirstResponseResult) => void;
}

export function EnquiryReply({ enquiry, canRecord, overdueSinceMs, thresholdHours, viewerId, nowMs, onRecorded }: EnquiryReplyProps): ReactElement {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Where focus goes once the form has closed: back to the button that opened
  // it, or to the section, whose line now says what was recorded.
  const focusAfterRef = useRef<"opener" | "heading" | null>(null);
  useEffect(() => {
    if (recording || focusAfterRef.current === null) return;
    (focusAfterRef.current === "opener" ? openerRef.current : headingRef.current)?.focus();
    focusAfterRef.current = null;
  }, [recording]);
  const repliedAt = enquiry.firstResponseAt ?? null;
  const replied = repliedAt !== null;
  const line = repliedAt === null ? null
    : replyRecordLine({ at: repliedAt, channel: enquiry.firstResponseChannel, byUserId: enquiry.firstResponseBy, viewerId });
  const overdue = !replied && overdueSinceMs !== null;

  const finish = (result: RecordFirstResponseResult | null): void => {
    focusAfterRef.current = result === null ? "opener" : "heading";
    setRecording(false);
    if (result === null) return;
    setNote(result.changed ? "Reply recorded." : "An earlier reply is already recorded, so it stands.");
    onRecorded(result);
  };

  return (
    <section className="enq-section enq-reply" aria-labelledby={headingId} data-tone={overdue ? "alarm" : undefined}>
      <h3 id={headingId} ref={headingRef} tabIndex={-1}>First reply</h3>
      {line !== null ? (
        <p className="enq-reply__line">{line}</p>
      ) : overdue ? (
        <p className="enq-reply__line enq-reply__line--alarm">
          <span className="enq-reply__mark" aria-hidden="true" />
          No reply recorded after {waitedFor(overdueSinceMs, nowMs)}
          {thresholdHours === null ? "." : <>, past the <span className="enq-reply__nowrap">{String(thresholdHours)}-hour</span> mark.</>}
        </p>
      ) : (
        <p className="enq-reply__line enq-reply__line--quiet">No reply recorded yet.</p>
      )}
      <p className="vv-sr-only" role="status">{note}</p>
      {canRecord && !recording && (
        <div className="enq-actions">
          <button ref={openerRef} type="button" className="enq-quiet" data-testid="record-reply"
            onClick={() => { setNote(null); setRecording(true); }}>
            {replied ? "Record an earlier reply" : "Record a reply"}
          </button>
        </div>
      )}
      {canRecord && !recording && !replied && (
        <p className="enq-next__hint">For a reply made outside Venviewer: a call, an email from your own mailbox, a meeting.</p>
      )}
      {recording && <ReplyForm enquiry={enquiry} recordedAt={repliedAt} onDone={finish} />}
    </section>
  );
}

function ReplyForm({ enquiry, recordedAt, onDone }: {
  readonly enquiry: Enquiry;
  /** The reply already recorded, if any: only an earlier one can replace it,
   *  so "Just now" is not offered and the time starts from it. */
  readonly recordedAt: string | null;
  readonly onDone: (result: RecordFirstResponseResult | null) => void;
}): ReactElement {
  const legendId = useId();
  const whenId = useId();
  const firstChoiceRef = useRef<HTMLInputElement>(null);
  const addToast = useToastStore((state) => state.addToast);
  const recordedMs = recordedAt === null ? null : Date.parse(recordedAt);
  const [channel, setChannel] = useState<ReportedResponseChannel | null>(null);
  const [when, setWhen] = useState<"now" | "earlier">(recordedMs === null ? "now" : "earlier");
  const [earlier, setEarlier] = useState(() => msToWallInput(recordedMs ?? Date.now()));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // A save still on its way when the person moves on still says how it ended.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => { firstChoiceRef.current?.focus(); }, []);

  const save = async (): Promise<void> => {
    if (saving) return;
    if (channel === null) {
      setFailure("Choose how you replied.");
      return;
    }
    let respondedAt: string | undefined;
    if (when === "earlier") {
      const ms = wallInputToMs(earlier);
      if (ms === null) {
        setFailure("Enter the day and time of the reply.");
        return;
      }
      if (ms > Date.now()) {
        setFailure("A reply cannot be later than now.");
        return;
      }
      if (recordedMs !== null && ms >= recordedMs) {
        setFailure("Choose a time earlier than the reply already recorded.");
        return;
      }
      respondedAt = new Date(ms).toISOString();
    }
    setSaving(true);
    setFailure(null);
    try {
      const result = await recordFirstResponse(enquiry.id, respondedAt === undefined ? { channel } : { channel, respondedAt });
      onDone(result);
    } catch (error) {
      if (!mounted.current) {
        addToast(`The reply to ${enquiryName(enquiry)} could not be recorded`, "error");
        return;
      }
      setSaving(false);
      setFailure(error instanceof ApiError && SAID_AS_IS.has(error.code)
        ? error.message
        : "The reply could not be recorded. Nothing was changed; try again.");
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Escape closes this form, not the enquiry it sits in.
    if (event.key !== "Escape" || saving) return;
    event.preventDefault();
    onDone(null);
  };

  return (
    <div className="enq-confirm enq-reply__form" role="group" aria-labelledby={legendId} onKeyDown={onKeyDown}>
      <p className="enq-confirm__question" id={legendId}>{recordedMs === null ? "Record a reply" : "Record an earlier reply"}</p>
      <p className="enq-confirm__consequence">Only your team sees this. Nothing is sent to the client.</p>
      <fieldset className="enq-reply__choices" disabled={saving}>
        <legend>How did you reply?</legend>
        {REPLY_CHANNEL_CHOICES.map((choice, index) => (
          <label key={choice.channel} className="enq-reply__choice">
            <input ref={index === 0 ? firstChoiceRef : undefined} type="radio" name={`${legendId}-channel`} value={choice.channel}
              checked={channel === choice.channel} onChange={() => { setChannel(choice.channel); setFailure(null); }} />
            <span>{choice.label}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="enq-reply__choices" disabled={saving}>
        <legend>When?</legend>
        {recordedMs === null && (
          <>
            <label className="enq-reply__choice">
              <input type="radio" name={`${legendId}-when`} checked={when === "now"} onChange={() => { setWhen("now"); setFailure(null); }} />
              <span>Just now</span>
            </label>
            <label className="enq-reply__choice">
              <input type="radio" name={`${legendId}-when`} checked={when === "earlier"} onChange={() => { setWhen("earlier"); setFailure(null); }} />
              <span>Earlier</span>
            </label>
          </>
        )}
        {when === "earlier" && (
          <label className="enq-reply__time" htmlFor={whenId}>
            <span>Day and time (venue time)</span>
            <input id={whenId} type="datetime-local" value={earlier} max={msToWallInput(Date.now())}
              onChange={(event) => { setEarlier(event.target.value); setFailure(null); }} />
          </label>
        )}
      </fieldset>
      <div className="enq-actions">
        <button type="button" className="enq-cta" onClick={() => { void save(); }} disabled={saving} aria-busy={saving}>
          {saving && <ActivityIndicator size={18} />}
          {saving ? "Recording…" : "Record reply"}
        </button>
        <button type="button" className="enq-quiet" onClick={() => { onDone(null); }} disabled={saving}>Cancel</button>
      </div>
      {failure !== null && <p className="enq-confirm__error" role="alert">{failure}</p>}
    </div>
  );
}
