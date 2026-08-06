import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import {
  RECONSTRUCTION_RELEASE_STATES,
  type ReconstructionReleaseDetail,
  type ReconstructionReviewEvidenceArtifact,
  type ReconstructionReviewEvidenceArtifactKind,
} from "@omnitwin/types";
import {
  listReconstructionReviewEvidenceArtifacts,
  getReconstructionRelease,
  getReconstructionReleaseSigningPayload,
  listReconstructionReleases,
  parseReconstructionReleaseChannelConflict,
  promoteReconstructionRelease,
  publishReconstructionRelease,
  registerReconstructionReviewEvidenceArtifact,
  reviewReconstructionRelease,
  rollbackReconstructionRelease,
  verifyReconstructionCandidate,
  verifyReconstructionReleaseAttestation,
  type PromoteInput,
  type PublicationInput,
  type ReleaseList,
  type ReviewInput,
  type RollbackInput,
} from "../../api/reconstruction-foundry.js";
import { ApiError } from "../../api/client.js";
import { FoundryActionDialog, type FoundryAction } from "./foundry/FoundryActionDialog.js";
import {
  FoundryReleaseDetail,
  buildSelectedVisualEvidence,
  getLatestFoundryReview,
  getMatchingFoundryAttestation,
  type FoundryReviewEvidenceDraft,
  type FoundryTab,
} from "./foundry/FoundryReleaseDetail.js";
import { FoundryReleaseLedger } from "./foundry/FoundryReleaseLedger.js";
import { FoundryEvidenceRegistry } from "./foundry/FoundryEvidenceRegistry.js";
import "./RuntimeFoundryView.css";

type OverviewState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | {
    readonly kind: "ready";
    readonly venueSlug: string;
    readonly data: ReleaseList;
    readonly evidenceArtifacts: readonly ReconstructionReviewEvidenceArtifact[];
  };

type DetailState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly detail: ReconstructionReleaseDetail };

const EMPTY_REVIEW_DRAFT: FoundryReviewEvidenceDraft = {
  selectedEvidencePaths: [],
  transformArtifactId: "",
  transformArtifactDigest: "",
  sceneAuthorityMapId: "",
  sceneAuthorityMapDigest: "",
};

function tabFromSearch(value: string | null): FoundryTab {
  return value === "qa" || value === "history" ? value : "summary";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

function mutationMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "The Foundry action was not accepted.";
}

function parsedJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function downloadSigningPayload(fileName: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function reviewInput(
  detail: ReconstructionReleaseDetail,
  draft: FoundryReviewEvidenceDraft,
  action: "approve" | "reject",
  note: string,
  idempotencyKey: string,
): ReviewInput {
  const approved = action === "approve";
  return {
    releaseId: detail.registration.id,
    releaseDigest: detail.registration.manifest.releaseDigest,
    qaReportDigest: detail.registration.qaReport.reportDigest,
    decision: approved ? "approved" : "rejected",
    targetExposure: "public",
    visualEvidence: [...buildSelectedVisualEvidence(detail, draft.selectedEvidencePaths)],
    transformArtifactRef: approved ? {
      artifactId: draft.transformArtifactId.trim(),
      artifactDigest: draft.transformArtifactDigest.trim(),
    } : null,
    sceneAuthorityMapRef: approved ? {
      artifactId: draft.sceneAuthorityMapId.trim(),
      artifactDigest: draft.sceneAuthorityMapDigest.trim(),
    } : null,
    note,
    idempotencyKey,
  };
}

function publicationInput(
  detail: ReconstructionReleaseDetail,
  note: string,
  idempotencyKey: string,
): PublicationInput {
  const review = getLatestFoundryReview(detail);
  const attestation = getMatchingFoundryAttestation(detail);
  if (review === null || attestation === null) throw new Error("Public approval and verified attestation are required before publication.");
  return {
    releaseId: detail.registration.id,
    releaseDigest: detail.registration.manifest.releaseDigest,
    qaReportDigest: detail.registration.qaReport.reportDigest,
    reviewId: review.id,
    reviewDigest: review.reviewDigest,
    attestationId: attestation.id,
    attestationEnvelopeSha256: attestation.envelopeSha256,
    idempotencyKey,
    note,
  };
}

function transitionInput(
  detail: ReconstructionReleaseDetail,
  note: string,
  idempotencyKey: string,
): PromoteInput {
  if (detail.publication === null) throw new Error("Immutable publication is required before a production pointer change.");
  return {
    targetReleaseId: detail.registration.id,
    targetReleaseDigest: detail.registration.manifest.releaseDigest,
    targetPublicationId: detail.publication.id,
    expectedRevision: detail.productionChannel?.revision ?? 0,
    expectedActiveReleaseId: detail.productionChannel?.activeReleaseId ?? null,
    idempotencyKey,
    reason: note,
  };
}

function rollbackInput(
  detail: ReconstructionReleaseDetail,
  note: string,
  idempotencyKey: string,
): RollbackInput {
  const input = transitionInput(detail, note, idempotencyKey);
  if (input.expectedActiveReleaseId === null) throw new Error("A current production release is required before rollback.");
  return { ...input, expectedActiveReleaseId: input.expectedActiveReleaseId };
}

function CurrentPointer(props: { readonly data: ReleaseList }): ReactElement {
  const channel = props.data.productionChannel;
  return (
    <dl className="runtime-foundry__current" aria-label="Production release pointer">
      <div className="runtime-foundry__metric"><dt>Production channel</dt><dd>{channel === null || channel.activeReleaseId === null ? "No current release" : "Current release recorded"}</dd></div>
      <div className="runtime-foundry__metric"><dt>Current digest</dt><dd className="runtime-foundry__mono">{channel?.activeReleaseDigest ?? "not set"}</dd></div>
      <div className="runtime-foundry__metric"><dt>Pointer revision</dt><dd className="runtime-foundry__mono">{String(channel?.revision ?? 0)}</dd></div>
      <div className="runtime-foundry__metric"><dt>Last changed</dt><dd>{channel === null ? "not recorded" : formatDate(channel.updatedAt)}</dd></div>
    </dl>
  );
}

export function RuntimeFoundryView(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedVenueSlug = searchParams.get("venue")?.trim() ?? null;
  const venueSlug = requestedVenueSlug === null || requestedVenueSlug === "" ? "trades-hall" : requestedVenueSlug;
  const selectedReleaseId = searchParams.get("release");
  const tab = tabFromSearch(searchParams.get("foundryTab"));
  const [venueDraft, setVenueDraft] = useState(venueSlug);
  const [stateFilter, setStateFilter] = useState("all");
  const [candidatePrefix, setCandidatePrefix] = useState("");
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [overview, setOverview] = useState<OverviewState>({ kind: "loading" });
  const [detailState, setDetailState] = useState<DetailState>({ kind: "idle" });
  const [reviewDraft, setReviewDraft] = useState<FoundryReviewEvidenceDraft>(EMPTY_REVIEW_DRAFT);
  const [dialog, setDialog] = useState<FoundryAction | null>(null);
  const [busyAction, setBusyAction] = useState<FoundryAction | "candidate" | "evidence" | "signing-payload" | "attest" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [signingError, setSigningError] = useState<string | null>(null);
  const [signingEnvelopeJson, setSigningEnvelopeJson] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const operationKeys = useRef(new Map<string, string>());

  const reload = useCallback(() => { setReloadToken((current) => current + 1); }, []);
  const setQuery = useCallback((patch: Readonly<Record<string, string | null>>): void => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      return next;
    });
  }, [setSearchParams]);

  useEffect(() => {
    const previous = document.title;
    document.title = "Runtime Foundry — Venviewer";
    return () => { document.title = previous; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setOverview({ kind: "loading" });
    void Promise.all([
      listReconstructionReleases(venueSlug, controller.signal),
      listReconstructionReviewEvidenceArtifacts(venueSlug, controller.signal),
    ])
      .then(([data, evidence]) => {
        if (controller.signal.aborted) return;
        setOverview({ kind: "ready", venueSlug, data, evidenceArtifacts: evidence.artifacts });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setOverview({ kind: "error", message: mutationMessage(error) });
    });
    return () => { controller.abort(); };
  }, [reloadToken, venueSlug]);

  useEffect(() => {
    if (
      selectedReleaseId !== null ||
      overview.kind !== "ready" ||
      overview.venueSlug !== venueSlug
    ) return;
    const first = overview.data.releases.find((release) => release.active) ?? overview.data.releases[0];
    if (first !== undefined) setQuery({ release: first.id });
  }, [overview, selectedReleaseId, setQuery, venueSlug]);

  useEffect(() => {
    if (selectedReleaseId === null) {
      setDetailState({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setDetailState({ kind: "loading" });
    setReviewDraft(EMPTY_REVIEW_DRAFT);
    setSigningEnvelopeJson("");
    setSigningError(null);
    void getReconstructionRelease(selectedReleaseId, controller.signal)
      .then((detail) => { if (!controller.signal.aborted) setDetailState({ kind: "ready", detail }); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDetailState({ kind: "error", message: mutationMessage(error) });
      });
    return () => { controller.abort(); };
  }, [reloadToken, selectedReleaseId]);

  const filteredReleases = useMemo(() => {
    if (overview.kind !== "ready") return [];
    return stateFilter === "all" ? overview.data.releases : overview.data.releases.filter((release) => release.state === stateFilter);
  }, [overview, stateFilter]);

  const operationKey = (fingerprint: string): string => {
    const existing = operationKeys.current.get(fingerprint);
    if (existing !== undefined) return existing;
    const created = `foundry:${crypto.randomUUID()}`;
    operationKeys.current.set(fingerprint, created);
    return created;
  };

  const closeDialog = (): void => {
    if (busyAction !== null) return;
    setDialog(null);
    setActionError(null);
  };

  const submitCandidate = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (busyAction !== null) return;
    const prefix = candidatePrefix.trim();
    const key = operationKey(`candidate:${prefix}`);
    setBusyAction("candidate");
    setCandidateError(null);
    void verifyReconstructionCandidate({ candidateR2Prefix: prefix, idempotencyKey: key })
      .then((registration) => {
        operationKeys.current.delete(`candidate:${prefix}`);
        setNotice("Candidate bytes, manifest and deterministic QA were verified and registered.");
        setCandidatePrefix("");
        setQuery({ release: registration.id, foundryTab: "qa" });
        reload();
      })
      .catch((error: unknown) => { setCandidateError(mutationMessage(error)); })
      .finally(() => { setBusyAction(null); });
  };

  const registerEvidence = (
    artifactKind: ReconstructionReviewEvidenceArtifactKind,
    file: File,
  ): void => {
    if (busyAction !== null) return;
    if (file.size <= 0 || file.size > 4 * 1024 * 1024) {
      setEvidenceError("Evidence JSON must be a non-empty file no larger than 4 MiB.");
      return;
    }
    const fingerprint = `evidence:${venueSlug}:${artifactKind}:${file.name}:${String(file.size)}:${String(file.lastModified)}`;
    const key = operationKey(fingerprint);
    setBusyAction("evidence");
    setEvidenceError(null);
    void file.text()
      .then((text) => parsedJson(text))
      .then((artifact) => registerReconstructionReviewEvidenceArtifact({
        venueSlug,
        artifactKind,
        artifact,
        idempotencyKey: key,
      }))
      .then((registered) => {
        operationKeys.current.delete(fingerprint);
        setNotice(`${registered.artifactId} was schema-validated, stored immutably and read back.`);
        reload();
      })
      .catch((error: unknown) => { setEvidenceError(mutationMessage(error)); })
      .finally(() => { setBusyAction(null); });
  };

  const applyAction = async (action: FoundryAction, note: string): Promise<void> => {
    if (detailState.kind !== "ready") return;
    const detail = detailState.detail;
    const fingerprint = JSON.stringify({
      action,
      releaseId: detail.registration.id,
      note,
      reviewDraft,
      publicationId: detail.publication?.id ?? null,
      expectedChannelRevision: detail.productionChannel?.revision ?? 0,
      expectedActiveReleaseId: detail.productionChannel?.activeReleaseId ?? null,
    });
    const key = operationKey(fingerprint);
    if (action === "approve" || action === "reject") await reviewReconstructionRelease(detail.registration.id, reviewInput(detail, reviewDraft, action, note, key));
    else if (action === "publish") await publishReconstructionRelease(detail.registration.id, publicationInput(detail, note, key));
    else if (action === "promote") await promoteReconstructionRelease(transitionInput(detail, note, key));
    else await rollbackReconstructionRelease(rollbackInput(detail, note, key));
    operationKeys.current.delete(fingerprint);
  };

  const confirmAction = (note: string): void => {
    if (dialog === null || busyAction !== null) return;
    const action = dialog;
    setBusyAction(action);
    setActionError(null);
    void applyAction(action, note).then(() => {
      setDialog(null);
      setNotice(action === "approve" || action === "reject" ? "Append-only human review recorded." : action === "publish" ? "Immutable public release verified and recorded." : "Production pointer changed and the audit event was recorded.");
      reload();
    }).catch((error: unknown) => {
      const conflict = parseReconstructionReleaseChannelConflict(error);
      if (conflict !== null) {
        setActionError(`Production changed on another device. Current revision is ${String(conflict.currentRevision)}; the Foundry has reloaded.`);
        reload();
      } else setActionError(mutationMessage(error));
    }).finally(() => { setBusyAction(null); });
  };

  const downloadPayload = (): void => {
    if (detailState.kind !== "ready" || busyAction !== null) return;
    const review = getLatestFoundryReview(detailState.detail);
    if (review === null || review.decision !== "approved" || review.targetExposure !== "public") return;
    setBusyAction("signing-payload");
    setSigningError(null);
    void getReconstructionReleaseSigningPayload(detailState.detail.registration.id, review.id)
      .then((payload) => {
        downloadSigningPayload(`venviewer-${payload.releaseDigest.slice(0, 12)}-signing-payload.json`, payload);
        setNotice("Exact signing payload downloaded. Sign it with the controlled Ed25519 key, then return the DSSE envelope here.");
      })
      .catch((error: unknown) => { setSigningError(mutationMessage(error)); })
      .finally(() => { setBusyAction(null); });
  };

  const verifyAttestation = (): void => {
    if (detailState.kind !== "ready" || busyAction !== null) return;
    const review = getLatestFoundryReview(detailState.detail);
    if (review === null || review.decision !== "approved" || review.targetExposure !== "public") return;
    let envelope: unknown;
    try {
      envelope = parsedJson(signingEnvelopeJson);
    } catch {
      setSigningError("The DSSE envelope is not valid JSON.");
      return;
    }
    const fingerprint = `attestation:${detailState.detail.registration.id}:${review.id}:${signingEnvelopeJson}`;
    const key = operationKey(fingerprint);
    setBusyAction("attest");
    setSigningError(null);
    void verifyReconstructionReleaseAttestation(detailState.detail.registration.id, {
      reviewId: review.id,
      envelope,
      idempotencyKey: key,
    })
      .then(() => { operationKeys.current.delete(fingerprint); setNotice("Detached Ed25519 attestation verified against the exact release and review digests."); setSigningEnvelopeJson(""); reload(); })
      .catch((error: unknown) => { setNotice(null); setSigningError(mutationMessage(error)); })
      .finally(() => { setBusyAction(null); });
  };

  const submitVenue = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextVenue = venueDraft.trim().toLowerCase();
    if (nextVenue.length === 0) return;
    setQuery({ venue: nextVenue, release: null });
  };

  return (
    <section className="runtime-foundry" aria-labelledby="runtime-foundry-title">
      <header className="runtime-foundry__header"><div><h2 id="runtime-foundry-title">Runtime Foundry</h2><p>Inspect immutable reconstruction releases, bind human decisions to exact evidence, publish digest-addressed objects, and change production through an audited pointer.</p></div><div className="runtime-foundry__header-actions"><Link className="runtime-foundry__button" to="/dev/assets/rooms">Open legacy room registry</Link><button type="button" className="runtime-foundry__button" onClick={reload} disabled={overview.kind === "loading" || busyAction !== null}><RefreshCw aria-hidden="true" /> Refresh Foundry</button></div></header>
      <form className="runtime-foundry__filters" onSubmit={submitVenue}>
        <label className="runtime-foundry__field"><span>Venue</span><input value={venueDraft} onChange={(event) => { setVenueDraft(event.target.value); }} aria-label="Foundry venue" /></label>
        <label className="runtime-foundry__field"><span>Release state</span><select value={stateFilter} onChange={(event) => { setStateFilter(event.target.value); }}><option value="all">All states</option>{RECONSTRUCTION_RELEASE_STATES.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        <button type="submit" className="runtime-foundry__button"><ShieldCheck aria-hidden="true" /> Open venue releases</button>
      </form>
      <form className="runtime-foundry__candidate" onSubmit={submitCandidate}>
        <label className="runtime-foundry__field"><span>Private candidate prefix</span><input className="runtime-foundry__mono" value={candidatePrefix} spellCheck={false} onChange={(event) => { setCandidatePrefix(event.target.value); }} aria-label="Private candidate R2 prefix" /></label>
        <button type="submit" className="runtime-foundry__button runtime-foundry__button--primary" disabled={busyAction !== null || candidatePrefix.trim() === ""}><ShieldCheck aria-hidden="true" /> {busyAction === "candidate" ? "Verifying candidate…" : "Verify candidate"}</button>
        {candidateError !== null ? <p className="runtime-foundry__notice" data-kind="error" role="alert">{candidateError}</p> : null}
      </form>
      {overview.kind === "ready" ? <FoundryEvidenceRegistry artifacts={overview.evidenceArtifacts} busy={busyAction === "evidence"} error={evidenceError} onRegister={registerEvidence} /> : null}
      {notice !== null ? <p className="runtime-foundry__notice" role="status" aria-live="polite">{notice}</p> : null}
      {actionError !== null && dialog === null ? <p className="runtime-foundry__notice" data-kind="error" role="alert">{actionError}</p> : null}
      {overview.kind === "loading" ? <div className="runtime-foundry__state" role="status" aria-live="polite">Reading immutable release records…</div> : null}
      {overview.kind === "error" ? <div className="runtime-foundry__state" data-kind="error" role="alert"><span>{overview.message}</span><button type="button" className="runtime-foundry__button" onClick={reload}>Retry Foundry</button></div> : null}
      {overview.kind === "ready" ? <><CurrentPointer data={overview.data} /><div className="runtime-foundry__workspace"><FoundryReleaseLedger releases={filteredReleases} selectedReleaseId={selectedReleaseId} onSelect={(releaseId) => { setQuery({ release: releaseId }); }} />{detailState.kind === "idle" ? <div className="runtime-foundry__state">Select a release to inspect its evidence.</div> : null}{detailState.kind === "loading" ? <div className="runtime-foundry__state" role="status" aria-live="polite">Loading the exact release evidence…</div> : null}{detailState.kind === "error" ? <div className="runtime-foundry__state" data-kind="error" role="alert"><span>{detailState.message}</span><button type="button" className="runtime-foundry__button" onClick={reload}>Retry release</button></div> : null}{detailState.kind === "ready" ? <FoundryReleaseDetail detail={detailState.detail} evidenceArtifacts={overview.evidenceArtifacts} tab={tab} draft={reviewDraft} busy={busyAction !== null} envelopeJson={signingEnvelopeJson} signingError={signingError} onTabChange={(nextTab) => { setQuery({ foundryTab: nextTab }); }} onDraftChange={(patch) => { setReviewDraft((current) => ({ ...current, ...patch })); }} onToggleEvidence={(path) => { setReviewDraft((current) => ({ ...current, selectedEvidencePaths: current.selectedEvidencePaths.includes(path) ? current.selectedEvidencePaths.filter((item) => item !== path) : [...current.selectedEvidencePaths, path] })); }} onSelectEvidence={(paths) => { setReviewDraft((current) => ({ ...current, selectedEvidencePaths: [...paths] })); }} onAction={(action) => { setActionError(null); setDialog(action); }} onEnvelopeChange={setSigningEnvelopeJson} onDownloadSigningPayload={downloadPayload} onVerifyAttestation={verifyAttestation} /> : null}</div></> : null}
      {dialog !== null && detailState.kind === "ready" ? <FoundryActionDialog action={dialog} releaseDigest={detailState.detail.registration.manifest.releaseDigest} currentDigest={detailState.detail.productionChannel?.activeReleaseDigest ?? null} inFlight={busyAction !== null} error={actionError} onCancel={closeDialog} onConfirm={confirmAction} /> : null}
    </section>
  );
}
