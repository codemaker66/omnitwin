import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { Check, CircleAlert, FileCheck2, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import type {
  EventArchitectCandidate,
  EventArchitectOpsEvidenceKind,
  EventArchitectOpsReviewDecision,
  EventArchitectOpsReviewGate,
} from "@omnitwin/types";
import {
  createEventArchitectOpsReview,
  getEventArchitectOpsReview,
} from "../../api/event-architect.js";

interface WitnessDraft {
  readonly sourceLabel: string;
  readonly sourceReference: string;
  readonly contentDigest: string;
  readonly observedAt: string;
}

interface ReviewDraft {
  readonly decision: EventArchitectOpsReviewDecision;
  readonly note: string;
  readonly validUntil: string;
  readonly witnesses: Readonly<Record<EventArchitectOpsEvidenceKind, WitnessDraft>>;
}

const WITNESS_LABELS: Readonly<Record<EventArchitectOpsEvidenceKind, string>> = {
  surveyed_door_positions: "Surveyed door positions",
  reviewed_route_model: "Reviewed route model",
  venue_operations_signoff: "Venue operations sign-off",
};

const WITNESS_KINDS = [
  "surveyed_door_positions",
  "reviewed_route_model",
  "venue_operations_signoff",
] as const satisfies readonly EventArchitectOpsEvidenceKind[];

function localDateTime(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function initialDraft(): ReviewDraft {
  const now = new Date();
  const observedAt = localDateTime(now);
  const validUntil = localDateTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
  const emptyWitness = (): WitnessDraft => ({
    sourceLabel: "",
    sourceReference: "",
    contentDigest: "",
    observedAt,
  });
  return {
    decision: "approved",
    note: "",
    validUntil,
    witnesses: {
      surveyed_door_positions: emptyWitness(),
      reviewed_route_model: emptyWitness(),
      venue_operations_signoff: emptyWitness(),
    },
  };
}

function statusCopy(gate: EventArchitectOpsReviewGate | null): string {
  if (gate === null || gate.status === "open") return "Awaiting reviewed evidence";
  if (gate.status === "approved") return "Current approval recorded";
  if (gate.status === "rejected") return "Latest review rejected Ops admission";
  return "Latest review has expired";
}

export function EventArchitectOpsReviewPanel(props: {
  readonly candidate: EventArchitectCandidate;
  readonly requestDigest: string;
  readonly canReview: boolean;
}): ReactElement {
  const [gate, setGate] = useState<EventArchitectOpsReviewGate | null>(null);
  const [draft, setDraft] = useState<ReviewDraft>(initialDraft);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyRef = useRef<{ readonly fingerprint: string; readonly key: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void getEventArchitectOpsReview(props.candidate.candidateId, controller.signal)
      .then(setGate)
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError("The persisted Ops review gate could not be loaded.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
  }, [props.candidate.candidateId]);

  const updateWitness = (
    kind: EventArchitectOpsEvidenceKind,
    patch: Partial<WitnessDraft>,
  ): void => {
    setDraft((current) => ({
      ...current,
      witnesses: {
        ...current.witnesses,
        [kind]: { ...current.witnesses[kind], ...patch },
      },
    }));
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const witnesses = WITNESS_KINDS.map((kind) => ({
      kind,
      sourceLabel: draft.witnesses[kind].sourceLabel.trim(),
      sourceReference: draft.witnesses[kind].sourceReference.trim(),
      contentDigest: draft.witnesses[kind].contentDigest.trim().toLowerCase(),
      observedAt: new Date(draft.witnesses[kind].observedAt).toISOString(),
    }));
    const envelope = {
      expectedRequestDigest: props.requestDigest,
      expectedSnapshotDigest: props.candidate.snapshotDigest,
      expectedProofDigest: props.candidate.validation.proofDigest,
      expectedGuestFlowArtifactHash: props.candidate.guestFlowEvidence.artifactHash,
      decision: draft.decision,
      note: draft.note.trim(),
      validUntil: new Date(draft.validUntil).toISOString(),
      witnesses,
    };
    const fingerprint = JSON.stringify(envelope);
    const existing = idempotencyRef.current;
    const key = existing?.fingerprint === fingerprint
      ? existing.key
      : `event-architect:ops-review:${crypto.randomUUID()}`;
    idempotencyRef.current = { fingerprint, key };
    setSubmitting(true);
    setError(null);
    void createEventArchitectOpsReview(props.candidate.candidateId, {
      idempotencyKey: key,
      ...envelope,
    }).then(setGate).catch(() => {
      setError("The review artifact was not recorded. Verify every SHA-256 digest, authority, and validity date, then retry.");
    }).finally(() => { setSubmitting(false); });
  };

  const latest = gate?.history[0] ?? null;
  const digestLabel = latest?.artifactDigest.slice(0, 12) ?? "none";

  return (
    <section className="event-architect-ops-review" aria-labelledby="event-architect-ops-review-title">
      <header>
        <div>
          <p>03 / Authority</p>
          <h2 id="event-architect-ops-review-title">Ops review evidence</h2>
        </div>
        <span className={`event-architect-ops-status event-architect-ops-status--${gate?.status ?? "open"}`}>
          {gate?.status === "approved" ? <Check aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
          {statusCopy(gate)}
        </span>
      </header>

      <div className="event-architect-ops-summary">
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>{gate?.blockingForOpsCompilation === false ? "Ops evidence gate resolved" : "Ops compilation remains blocked"}</strong>
          <p>Approval must bind surveyed doors, a reviewed route model, and venue operations sign-off to this candidate’s exact request, snapshot, validator proof, and simulated-flow hashes.</p>
        </div>
        <code>artifact {digestLabel}</code>
      </div>

      {loading ? <p className="event-architect-ops-loading"><LoaderCircle aria-hidden="true" /> Loading review history…</p> : null}
      {error === null ? null : <p className="event-architect-ops-error" role="alert"><CircleAlert aria-hidden="true" /> {error}</p>}

      {latest === null ? null : (
        <dl className="event-architect-ops-latest">
          <div><dt>Latest decision</dt><dd>{latest.decision}</dd></div>
          <div><dt>Reviewer authority</dt><dd>{latest.reviewerAuthority.replaceAll("_", " ")}</dd></div>
          <div><dt>Reviewed</dt><dd>{new Date(latest.reviewedAt).toLocaleString("en-GB")}</dd></div>
          <div><dt>Valid until</dt><dd>{new Date(latest.validUntil).toLocaleString("en-GB")}</dd></div>
        </dl>
      )}

      {props.canReview ? (
        <form className="event-architect-ops-form" onSubmit={submit}>
          <div className="event-architect-ops-decision-row">
            <label><span>Decision</span><select value={draft.decision} onChange={(event) => { setDraft((current) => ({ ...current, decision: event.target.value === "rejected" ? "rejected" : "approved" })); }}><option value="approved">Approve for Ops admission</option><option value="rejected">Reject for Ops admission</option></select></label>
            <label><span>Valid until</span><input type="datetime-local" value={draft.validUntil} onChange={(event) => { setDraft((current) => ({ ...current, validUntil: event.target.value })); }} required /></label>
          </div>

          <div className="event-architect-ops-witnesses">
            {WITNESS_KINDS.map((kind) => (
              <fieldset key={kind}>
                <legend><FileCheck2 aria-hidden="true" /> {WITNESS_LABELS[kind]}</legend>
                <label><span>Source label</span><input value={draft.witnesses[kind].sourceLabel} onChange={(event) => { updateWitness(kind, { sourceLabel: event.target.value }); }} minLength={3} maxLength={200} required /></label>
                <label><span>Source reference</span><input value={draft.witnesses[kind].sourceReference} onChange={(event) => { updateWitness(kind, { sourceReference: event.target.value }); }} minLength={3} maxLength={500} placeholder="Document URL, registry ID, or controlled path" required /></label>
                <label><span>SHA-256 content digest</span><input value={draft.witnesses[kind].contentDigest} onChange={(event) => { updateWitness(kind, { contentDigest: event.target.value }); }} pattern="[a-fA-F0-9]{64}" maxLength={64} spellCheck={false} required /></label>
                <label><span>Observed at</span><input type="datetime-local" value={draft.witnesses[kind].observedAt} onChange={(event) => { updateWitness(kind, { observedAt: event.target.value }); }} required /></label>
              </fieldset>
            ))}
          </div>

          <label className="event-architect-ops-note"><span>Review note</span><textarea value={draft.note} onChange={(event) => { setDraft((current) => ({ ...current, note: event.target.value })); }} minLength={10} maxLength={2000} rows={3} required /></label>
          <button type="submit" disabled={submitting}>{submitting ? <LoaderCircle aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}{submitting ? "Recording immutable review" : "Record append-only review"}</button>
          <p className="event-architect-ops-immutability"><LockKeyhole aria-hidden="true" /> Review rows cannot be edited or deleted. A later decision creates a new artifact; expiry closes the gate automatically.</p>
        </form>
      ) : (
        <p className="event-architect-ops-readonly"><LockKeyhole aria-hidden="true" /> Venue staff, hallkeepers, or administrators must record this review. Planner access is read-only.</p>
      )}
    </section>
  );
}
