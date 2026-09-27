import { Fragment, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Mail, Phone } from "lucide-react";
import { PHASE_METADATA, type EventInstructions } from "@omnitwin/types";
import { ActivityStatus } from "../shared/Activity.js";
import type { HallkeeperContextResult } from "./useHallkeeperContext.js";
import { accessNeeds, allergyFacts, deadlineWhen, nextPhaseDeadline, telHref, venueDay } from "./sheet-facts.js";

export interface KeepInViewProps {
  readonly instructions: EventInstructions | null;
  readonly timeZone: string;
  /** The event's day on the venue's clock (YYYY-MM-DD), or null when the sheet has none. */
  readonly eventDay: string | null;
  /** The venue clock the next deadline is read against. */
  readonly nowMs: number;
  readonly context: HallkeeperContextResult;
}

/** Keep in view (roadmap N4): the facts that must not be missed, above the
 *  work on every stage. Access needs, allergies, who to call, the planner's
 *  next deadline and the event's open issues; the full brief stays in its
 *  panel. Each fact keeps its place, so a hallkeeper learns where to look. */
export function KeepInView({ instructions, timeZone, eventDay, nowMs, context }: KeepInViewProps): ReactElement {
  const access = accessNeeds(instructions?.accessibility ?? null);
  const allergies = allergyFacts(instructions?.dietary ?? null);
  const contact = instructions?.dayOfContact ?? null;
  const deadline = instructions === null ? null : nextPhaseDeadline(instructions.phaseDeadlines, nowMs);
  const phone = contact?.phone.trim() ?? "";
  const email = contact?.email.trim() ?? "";

  return <section className="hkf-keep" aria-labelledby="hkf-keep-title">
    <h2 id="hkf-keep-title" className="hkf-overline">Keep in view</h2>
    <dl className="hkf-keep-facts">
      {access.length > 0 && <div className="hkf-keep-fact is-need">
        <dt>Access needs</dt>
        <dd><ul>{access.map((need) => <li key={need}>{need}</li>)}</ul></dd>
      </div>}
      {allergies !== null && <div className="hkf-keep-fact is-need">
        <dt>Allergies</dt>
        <dd>{allergies.counts.length > 0 && <strong>{allergies.counts.map((count, index) => <Fragment key={count}>{index > 0 ? " and " : ""}<span className="hkf-keep-unbroken">{count}</span></Fragment>)} {allergies.noun}</strong>}
          {allergies.notes !== null && <span className="hkf-keep-note">{allergies.notes}</span>}</dd>
      </div>}
      {access.length === 0 && allergies === null && <div className="hkf-keep-fact">
        <dt>Access and allergies</dt>
        <dd className="hkf-keep-quiet">None recorded on this sheet</dd>
      </div>}
      <div className="hkf-keep-fact hkf-keep-call">
        <dt>Day-of contact</dt>
        {contact === null ? <dd className="hkf-keep-quiet">None on this sheet</dd> : <dd>
          <span className="hkf-keep-name">{contact.name}{contact.role.trim().length > 0 ? <small> · {contact.role.trim()}</small> : null}</span>
          {phone.length > 0
            ? <a href={telHref(phone)} aria-label={`Call ${contact.name} on ${phone}`}><Phone size={16} aria-hidden="true" />{phone}</a>
            : email.length > 0 ? <a href={`mailto:${email}`} aria-label={`Email ${contact.name} at ${email}`}><Mail size={16} aria-hidden="true" />{email}</a> : null}
        </dd>}
      </div>
      {deadline !== null && <div className="hkf-keep-fact">
        <dt>Next deadline</dt>
        <dd><strong>{PHASE_METADATA[deadline.phase].label} by {deadlineWhen(deadline.deadline, timeZone, eventDay ?? venueDay(nowMs, timeZone))}</strong>
          {deadline.reason.trim().length > 0 && <span className="hkf-keep-note">{deadline.reason.trim()}</span>}</dd>
      </div>}
      <div className="hkf-keep-fact">
        <dt>Event issues</dt>
        <dd><EventIssues result={context} /></dd>
      </div>
    </dl>
  </section>;
}

/** The event's open issues, from the operations board the sheet was opened
 *  with. The sheet stays usable whatever this optional context does. */
function EventIssues({ result }: { readonly result: HallkeeperContextResult }): ReactElement {
  if (result.status === "loading") return <ActivityStatus>Loading the event's issues…</ActivityStatus>;
  const context = result.context;
  const error = result.error ?? context?.opsError ?? null;
  if (error !== null) return <><span>{error}</span><button type="button" className="hkf-keep-action" onClick={result.retry}>Retry context</button></>;
  const graph = context?.graph ?? null;
  if (context === null || graph === null) return <span className="hkf-keep-quiet">Open it from its event to see issues.</span>;
  const open = context.board?.issues.filter((issue) => issue.status === "open" || issue.status === "in_progress") ?? [];
  if (open.length === 0) return <span>No open issues.</span>;
  return <>
    <strong>{open.length === 1 ? "1 open issue" : `${String(open.length)} open issues`}</strong>
    <span className="hkf-keep-note">{open[0]?.title}</span>
    <Link className="hkf-keep-action" to={`/ops/events/${graph.event.id}`}>Review issues <ArrowRight size={14} aria-hidden="true" /></Link>
  </>;
}
