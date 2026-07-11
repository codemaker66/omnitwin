import {
  Check,
  CircleAlert,
  Clock3,
  FileCheck2,
  History,
  LockKeyhole,
  RotateCcw,
  Send,
  ShieldCheck,
  Upload,
} from "lucide-react";
import type {
  ReconstructionReleaseDetail,
  ReconstructionReleaseFile,
  ReconstructionReleaseReview,
  ReconstructionReviewEvidenceArtifact,
} from "@omnitwin/types";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { fetchReconstructionVisualEvidence } from "../../../api/reconstruction-foundry.js";
import type { FoundryAction } from "./FoundryActionDialog.js";
import { FoundrySigningControls } from "./FoundrySigningControls.js";

export type FoundryTab = "summary" | "qa" | "history";

export interface FoundryReviewEvidenceDraft {
  readonly selectedEvidencePaths: readonly string[];
  readonly transformArtifactId: string;
  readonly transformArtifactDigest: string;
  readonly sceneAuthorityMapId: string;
  readonly sceneAuthorityMapDigest: string;
}

const QA_LABELS: Readonly<Record<string, string>> = {
  manifest_schema: "Manifest schema",
  exact_file_set: "Exact file set",
  content_hashes: "Content hashes",
  image_dimensions: "Image dimensions",
  mesh_structure: "Mesh structure",
  mesh_budget: "Mesh budget",
  navigation_graph: "Navigation graph",
  coordinate_frame: "Coordinate frame",
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const;
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index] ?? "B"}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

function humanize(value: string): string {
  return value.replaceAll(/[._-]/gu, " ");
}

function latestReview(reviews: readonly ReconstructionReleaseReview[]): ReconstructionReleaseReview | null {
  return reviews[0] ?? null;
}

function matchingAttestation(detail: ReconstructionReleaseDetail): ReconstructionReleaseDetail["attestations"][number] | null {
  const review = latestReview(detail.reviews);
  if (review === null || review.decision !== "approved" || review.targetExposure !== "public") return null;
  return detail.attestations.find((item) => item.reviewId === review.id && item.reviewDigest === review.reviewDigest) ?? null;
}

function reviewableEvidence(detail: ReconstructionReleaseDetail): readonly ReconstructionReleaseFile[] {
  return detail.registration.manifest.files.filter((file) =>
    file.role === "imagery" &&
    file.mimeType === "image/webp" &&
    file.sizeBytes <= 8 * 1024 * 1024 &&
    (/\/equirect_512\.webp$/u.test(file.path) || /_256\.webp$/u.test(file.path))
  );
}

function hasCompleteArtifactRefs(draft: FoundryReviewEvidenceDraft): boolean {
  return draft.transformArtifactId.trim().length > 0 &&
    SHA256_PATTERN.test(draft.transformArtifactDigest.trim()) &&
    draft.sceneAuthorityMapId.trim().length > 0 &&
    SHA256_PATTERN.test(draft.sceneAuthorityMapDigest.trim());
}

function actionBlockers(
  detail: ReconstructionReleaseDetail,
  draft: FoundryReviewEvidenceDraft,
): Readonly<Record<FoundryAction, readonly string[]>> {
  const review = latestReview(detail.reviews);
  const attestation = matchingAttestation(detail);
  const visualEvidenceFiles = reviewableEvidence(detail);
  const visualEvidenceChosen = visualEvidenceFiles.length > 0 &&
    visualEvidenceFiles.every((file) => draft.selectedEvidencePaths.includes(file.path));
  const publicApproval = review?.decision === "approved" && review.targetExposure === "public";
  const channel = detail.productionChannel;
  const publication = detail.publication;
  const wasPreviouslyActive = detail.channelEvents.some((event) => event.toReleaseId === detail.registration.id);
  const commonReview = detail.registration.qaReport.outcome === "passed" ? [] : ["Machine QA must pass before human review."];
  return {
    approve: [
      ...commonReview,
      ...(visualEvidenceChosen ? [] : ["Load and bind the complete low-resolution visual review board."]),
      ...(hasCompleteArtifactRefs(draft) ? [] : ["Bind exact TransformArtifact and Scene Authority Map IDs and SHA-256 digests."]),
    ],
    reject: [
      ...commonReview,
      ...(visualEvidenceChosen ? [] : ["Load and bind the complete low-resolution visual review board."]),
    ],
    publish: [
      ...(publicApproval ? [] : ["A current public approval is required."]),
      ...(attestation === null ? ["A verified detached attestation is required."] : []),
      ...(publication === null ? [] : ["This immutable release is already published."]),
    ],
    promote: [
      ...(publicApproval ? [] : ["A current public approval is required."]),
      ...(publication === null ? ["Publish and verify the release before promotion."] : []),
      ...(channel?.activeReleaseId === detail.registration.id ? ["This release is already current in production."] : []),
    ],
    rollback: [
      ...(publicApproval ? [] : ["A current public approval is required."]),
      ...(publication === null ? ["Only an immutable published release can be restored."] : []),
      ...(channel?.activeReleaseId === null || channel === null ? ["There is no current production release to roll back from."] : []),
      ...(channel?.activeReleaseId === detail.registration.id ? ["This release is already current in production."] : []),
      ...(wasPreviouslyActive ? [] : ["This release has no prior production-pointer event; use promotion instead."]),
    ],
  };
}

function StatusChip(props: { readonly detail: ReconstructionReleaseDetail }): ReactElement {
  const state = props.detail.state;
  const tone = state === "active" || state === "published" || state === "ready_to_publish"
    ? "passed"
    : state === "rejected" || state === "machine_qa_failed"
      ? "failed"
      : "review";
  const Icon = tone === "passed" ? Check : tone === "failed" ? CircleAlert : Clock3;
  return (
    <span className="runtime-foundry__chip" data-tone={tone}>
      <Icon aria-hidden="true" /> {state === "active" ? "Current" : humanize(state)}
    </span>
  );
}

function ArtifactBinding(props: {
  readonly label: string;
  readonly reference: ReconstructionReleaseReview["transformArtifactRef"];
}): ReactElement {
  return (
    <div>
      <dt>{props.label}</dt>
      <dd>
        {props.reference === null ? (
          "Not bound for this decision"
        ) : (
          <>
            <span>{props.reference.artifactId}</span>
            <code className="runtime-foundry__mono">{props.reference.artifactDigest}</code>
          </>
        )}
      </dd>
    </div>
  );
}

function RecordedReview(props: { readonly review: ReconstructionReleaseReview }): ReactElement {
  const review = props.review;
  return (
    <section className="runtime-foundry__recorded-review" aria-labelledby="foundry-recorded-review-title">
      <header className="runtime-foundry__recorded-review-heading">
        <div>
          <p className="runtime-foundry__micro-label">Append-only decision record</p>
          <h4 id="foundry-recorded-review-title">Current human review binding</h4>
        </div>
        <span className="runtime-foundry__chip" data-tone={review.decision}>
          {review.decision} · {humanize(review.targetExposure)}
        </span>
      </header>
      <dl className="runtime-foundry__review-metadata">
        <div>
          <dt>Reviewer</dt>
          <dd>
            <span>{humanize(review.reviewerAuthority)}</span>
            <code className="runtime-foundry__mono">{review.reviewerUserId}</code>
          </dd>
        </div>
        <div>
          <dt>Recorded</dt>
          <dd><time dateTime={review.reviewedAt}>{formatDate(review.reviewedAt)}</time></dd>
        </div>
        <div>
          <dt>Review digest</dt>
          <dd><code className="runtime-foundry__mono">{review.reviewDigest}</code></dd>
        </div>
        <ArtifactBinding label="TransformArtifact" reference={review.transformArtifactRef} />
        <ArtifactBinding label="Scene Authority Map" reference={review.sceneAuthorityMapRef} />
      </dl>
      <div className="runtime-foundry__review-note">
        <h5>Operator note</h5>
        <p>{review.note}</p>
      </div>
      <div className="runtime-foundry__review-evidence">
        <h5>Visual evidence reviewed</h5>
        <ul aria-label="Visual evidence bound to current review">
          {review.visualEvidence.map((evidence) => (
            <li key={`${evidence.objectKey}:${evidence.sha256}`}>
              <strong>{evidence.label}</strong>
              <span className="runtime-foundry__mono">{evidence.objectKey}</span>
              <code className="runtime-foundry__mono">{evidence.sha256}</code>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SummaryPanel(props: { readonly detail: ReconstructionReleaseDetail }): ReactElement {
  const { registration, publication, attestations } = props.detail;
  const review = latestReview(props.detail.reviews);
  return (
    <div className="runtime-foundry__tab-panel" role="tabpanel" id="foundry-summary-panel" aria-labelledby="foundry-summary-tab">
      <dl className="runtime-foundry__manifest">
        <div><dt>Release digest</dt><dd className="runtime-foundry__mono">{registration.manifest.releaseDigest}</dd></div>
        <div><dt>Source manifest</dt><dd className="runtime-foundry__mono">{registration.manifest.sourceManifestSha256}</dd></div>
        <div><dt>Candidate bundle</dt><dd className="runtime-foundry__mono">{registration.candidateR2Prefix}</dd></div>
        <div><dt>Bundle size</dt><dd>{registration.manifest.fileCount} files · {formatBytes(registration.manifest.totalBytes)}</dd></div>
        <div><dt>Machine QA</dt><dd>{registration.qaReport.outcome} · <span className="runtime-foundry__mono">{registration.qaReport.reportDigest}</span></dd></div>
        <div><dt>Latest human review</dt><dd>{review === null ? "No human decision recorded" : `${review.decision} for ${humanize(review.targetExposure)}`}</dd></div>
        <div><dt>Detached attestation</dt><dd>{attestations.length === 0 ? "Not verified" : `${String(attestations.length)} verified record${attestations.length === 1 ? "" : "s"}`}</dd></div>
        <div><dt>Immutable publication</dt><dd>{publication === null ? "Not published" : publication.publicManifestR2Key}</dd></div>
      </dl>
      {publication !== null ? (
        <a className="runtime-foundry__button" href={publication.publicManifestUrl} target="_blank" rel="noreferrer">
          Open public manifest
        </a>
      ) : null}
      {props.detail.productionChannel?.activeReleaseId === registration.id ? (
        <Link className="runtime-foundry__button" to={`/venues/${encodeURIComponent(registration.manifest.venueSlug)}/twin`}>
          Open live Twin
        </Link>
      ) : null}
      {review !== null ? <RecordedReview review={review} /> : null}
    </div>
  );
}

function EvidenceReferenceFields(props: {
  readonly draft: FoundryReviewEvidenceDraft;
  readonly evidenceArtifacts: readonly ReconstructionReviewEvidenceArtifact[];
  readonly onChange: (patch: Partial<FoundryReviewEvidenceDraft>) => void;
}): ReactElement {
  const transforms = props.evidenceArtifacts.filter((artifact) => artifact.artifactKind === "transform_artifact_v0");
  const sceneMaps = props.evidenceArtifacts.filter((artifact) => artifact.artifactKind === "scene_authority_map_v0");
  const choose = (
    digest: string,
    artifacts: readonly ReconstructionReviewEvidenceArtifact[],
    kind: "transform" | "scene",
  ): void => {
    const artifact = artifacts.find((candidate) => candidate.artifactDigest === digest);
    if (kind === "transform") {
      props.onChange({
        transformArtifactId: artifact?.artifactId ?? "",
        transformArtifactDigest: artifact?.artifactDigest ?? "",
      });
    } else {
      props.onChange({
        sceneAuthorityMapId: artifact?.artifactId ?? "",
        sceneAuthorityMapDigest: artifact?.artifactDigest ?? "",
      });
    }
  };
  return (
    <div className="runtime-foundry__evidence-binding-grid">
      <label className="runtime-foundry__field">
        <span>Verified TransformArtifact</span>
        <select value={props.draft.transformArtifactDigest} onChange={(event) => { choose(event.target.value, transforms, "transform"); }}>
          <option value="">Choose a registered transform…</option>
          {transforms.map((artifact) => <option key={artifact.id} value={artifact.artifactDigest}>{artifact.artifactId} · {artifact.artifactDigest.slice(0, 12)}</option>)}
        </select>
      </label>
      <label className="runtime-foundry__field">
        <span>Transform receipt</span>
        <code className="runtime-foundry__mono">{props.draft.transformArtifactDigest || "not selected"}</code>
      </label>
      <label className="runtime-foundry__field">
        <span>Verified Scene Authority Map</span>
        <select value={props.draft.sceneAuthorityMapDigest} onChange={(event) => { choose(event.target.value, sceneMaps, "scene"); }}>
          <option value="">Choose a registered authority map…</option>
          {sceneMaps.map((artifact) => <option key={artifact.id} value={artifact.artifactDigest}>{artifact.artifactId} · {artifact.artifactDigest.slice(0, 12)}</option>)}
        </select>
      </label>
      <label className="runtime-foundry__field">
        <span>Authority-map receipt</span>
        <code className="runtime-foundry__mono">{props.draft.sceneAuthorityMapDigest || "not selected"}</code>
      </label>
    </div>
  );
}

type VisualBoardState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly completed: number }
  | { readonly kind: "ready"; readonly previews: readonly { readonly path: string; readonly url: string }[] }
  | { readonly kind: "error"; readonly message: string };

function VisualEvidenceBoard(props: {
  readonly releaseId: string;
  readonly files: readonly ReconstructionReleaseFile[];
  readonly selectedPaths: readonly string[];
  readonly onSelectAll: (paths: readonly string[]) => void;
}): ReactElement {
  const [state, setState] = useState<VisualBoardState>({ kind: "idle" });
  const [decodedPaths, setDecodedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const controller = useRef<AbortController | null>(null);
  const objectUrls = useRef<string[]>([]);
  const releaseId = props.releaseId;
  useEffect(() => () => {
    controller.current?.abort();
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current = [];
    setDecodedPaths(new Set());
  }, [releaseId]);
  const load = (): void => {
    controller.current?.abort();
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current = [];
    const nextController = new AbortController();
    controller.current = nextController;
    setState({ kind: "loading", completed: 0 });
    void (async () => {
      const previews = new Array<{ readonly path: string; readonly url: string } | undefined>(
        props.files.length,
      );
      let cursor = 0;
      let completed = 0;
      const worker = async (): Promise<void> => {
        while (cursor < props.files.length) {
          const current = cursor;
          cursor += 1;
          const file = props.files[current];
          if (file === undefined) continue;
          const blob = await fetchReconstructionVisualEvidence(releaseId, file.path, nextController.signal);
          const url = URL.createObjectURL(blob);
          objectUrls.current.push(url);
          previews[current] = { path: file.path, url };
          completed += 1;
          setState({ kind: "loading", completed });
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, props.files.length) }, () => worker()));
      if (nextController.signal.aborted) return;
      const complete = previews.filter((preview): preview is { readonly path: string; readonly url: string } => preview !== undefined);
      if (complete.length !== props.files.length) throw new Error("The visual review board was incomplete.");
      setState({ kind: "ready", previews: complete });
    })().catch((error: unknown) => {
      if (nextController.signal.aborted) return;
      setState({ kind: "error", message: error instanceof Error ? error.message : "The visual review board could not be loaded." });
    });
  };
  const allSelected = props.files.length > 0 && props.files.every((file) => props.selectedPaths.includes(file.path));
  const allDecoded = state.kind === "ready" && decodedPaths.size === state.previews.length;
  return (
    <div className="runtime-foundry__visual-board">
      <div className="runtime-foundry__action-group">
        <button type="button" className="runtime-foundry__button" onClick={load} disabled={state.kind === "loading" || props.files.length === 0}>
          {state.kind === "loading" ? `Opening exact previews ${String(state.completed)}/${String(props.files.length)}…` : "Open complete visual review board"}
        </button>
        <button type="button" className="runtime-foundry__button runtime-foundry__button--primary" disabled={!allDecoded || allSelected} onClick={() => { props.onSelectAll(props.files.map((file) => file.path)); }}>
          {allSelected ? "Complete board bound" : allDecoded ? "Bind every displayed preview to this review" : `Waiting for image decode ${String(decodedPaths.size)}/${String(props.files.length)}`}
        </button>
      </div>
      {state.kind === "error" ? <p className="runtime-foundry__notice" data-kind="error" role="alert">{state.message}</p> : null}
      {state.kind === "ready" ? (
        <div className="runtime-foundry__visual-board-grid" aria-label="Exact private visual review board">
          {state.previews.map((preview) => (
            <a key={preview.path} href={preview.url} target="_blank" rel="noreferrer" title={`Open ${preview.path} full size`}>
              <img src={preview.url} alt={preview.path} loading="eager" onLoad={() => {
                setDecodedPaths((current) => new Set([...current, preview.path]));
              }} />
              <span>{preview.path}</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EvidenceBinding(props: {
  readonly detail: ReconstructionReleaseDetail;
  readonly evidenceArtifacts: readonly ReconstructionReviewEvidenceArtifact[];
  readonly draft: FoundryReviewEvidenceDraft;
  readonly onChange: (patch: Partial<FoundryReviewEvidenceDraft>) => void;
  readonly onToggleEvidence: (path: string) => void;
  readonly onSelectEvidence: (paths: readonly string[]) => void;
}): ReactElement {
  const files = reviewableEvidence(props.detail);
  return (
    <section className="runtime-foundry__evidence-binding" aria-labelledby="foundry-evidence-binding-title">
      <div>
        <p className="runtime-foundry__micro-label">Human evidence binding</p>
        <h4 id="foundry-evidence-binding-title">Bind the decision to exact artifacts</h4>
        <p>Select the immutable visual records actually reviewed. Public approval also requires exact transform and scene-authority references.</p>
      </div>
      {files.length === 0 ? <p className="runtime-foundry__notice" data-kind="error" role="alert">Candidate manifest has no bounded low-resolution visual review images.</p> : (
        <VisualEvidenceBoard key={props.detail.registration.id} releaseId={props.detail.registration.id} files={files} selectedPaths={props.draft.selectedEvidencePaths} onSelectAll={props.onSelectEvidence} />
      )}
      <EvidenceReferenceFields draft={props.draft} evidenceArtifacts={props.evidenceArtifacts} onChange={props.onChange} />
    </section>
  );
}

function QaPanel(props: {
  readonly detail: ReconstructionReleaseDetail;
  readonly evidenceArtifacts: readonly ReconstructionReviewEvidenceArtifact[];
  readonly draft: FoundryReviewEvidenceDraft;
  readonly onDraftChange: (patch: Partial<FoundryReviewEvidenceDraft>) => void;
  readonly onToggleEvidence: (path: string) => void;
  readonly onSelectEvidence: (paths: readonly string[]) => void;
}): ReactElement {
  return (
    <div className="runtime-foundry__tab-panel" role="tabpanel" id="foundry-qa-panel" aria-labelledby="foundry-qa-tab">
      <ul className="runtime-foundry__qa-list">
        {props.detail.registration.qaReport.checks.map((check) => (
          <li key={check.checkKey} className="runtime-foundry__qa-item">
            <dl><dt>{QA_LABELS[check.checkKey] ?? humanize(check.checkKey)}</dt><dd>{humanize(check.messageKey)}</dd></dl>
            <span className="runtime-foundry__chip" data-tone={check.status === "passed" ? "passed" : "failed"}>
              {check.status === "passed" ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}{check.status}
            </span>
            <div className="runtime-foundry__evidence-refs">
              {check.evidence.map((evidence) => <code key={`${check.checkKey}:${evidence.sha256}`}>{evidence.label} · {evidence.sha256}</code>)}
            </div>
          </li>
        ))}
      </ul>
      <EvidenceBinding
        detail={props.detail}
        evidenceArtifacts={props.evidenceArtifacts}
        draft={props.draft}
        onChange={props.onDraftChange}
        onToggleEvidence={props.onToggleEvidence}
        onSelectEvidence={props.onSelectEvidence}
      />
    </div>
  );
}

interface HistoryEntry {
  readonly key: string;
  readonly at: string;
  readonly title: string;
  readonly detail: string;
}

function historyEntries(detail: ReconstructionReleaseDetail): readonly HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const review of detail.reviews) entries.push({ key: `review:${review.id}`, at: review.reviewedAt, title: `${review.decision} for ${humanize(review.targetExposure)}`, detail: review.note });
  for (const item of detail.attestations) entries.push({ key: `attestation:${item.id}`, at: item.verifiedAt, title: "Detached attestation verified", detail: `${item.algorithm} · key ${item.keyId}` });
  if (detail.publication !== null) entries.push({ key: `publication:${detail.publication.id}`, at: detail.publication.publishedAt, title: "Immutable release published", detail: detail.publication.publicR2Prefix });
  for (const event of detail.channelEvents) entries.push({ key: `channel:${event.id}`, at: event.createdAt, title: event.action === "rollback" ? "Production rollback" : "Production promotion", detail: `${event.reason} · revision ${String(event.resultingRevision)}` });
  return entries.sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

function HistoryPanel(props: { readonly detail: ReconstructionReleaseDetail }): ReactElement {
  const entries = historyEntries(props.detail);
  return (
    <div className="runtime-foundry__tab-panel" role="tabpanel" id="foundry-history-panel" aria-labelledby="foundry-history-tab">
      {entries.length === 0 ? <p className="runtime-foundry__notice">No review, publication or production-pointer events are recorded.</p> : (
        <ol className="runtime-foundry__history">
          {entries.map((entry) => <li key={entry.key} className="runtime-foundry__history-item"><div><strong>{entry.title}</strong><p>{entry.detail}</p></div><time dateTime={entry.at}>{formatDate(entry.at)}</time></li>)}
        </ol>
      )}
    </div>
  );
}

function DetailTabs(props: { readonly tab: FoundryTab; readonly onChange: (tab: FoundryTab) => void }): ReactElement {
  const tabs = [{ id: "summary", label: "Summary", Icon: FileCheck2 }, { id: "qa", label: "QA evidence", Icon: ShieldCheck }, { id: "history", label: "History", Icon: History }] as const;
  return (
    <div className="runtime-foundry__tabs" role="tablist" aria-label="Release detail">
      {tabs.map(({ id, label, Icon }, index) => <button key={id} id={`foundry-${id}-tab`} type="button" role="tab" tabIndex={props.tab === id ? 0 : -1} aria-selected={props.tab === id} aria-controls={`foundry-${id}-panel`} className="runtime-foundry__tab" onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
        const nextIndex = event.key === "ArrowRight"
          ? (index + 1) % tabs.length
          : event.key === "ArrowLeft"
            ? (index + tabs.length - 1) % tabs.length
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : null;
        if (nextIndex === null) return;
        event.preventDefault();
        const next = tabs[nextIndex];
        if (next !== undefined) {
          props.onChange(next.id);
          document.getElementById(`foundry-${next.id}-tab`)?.focus();
        }
      }} onClick={() => { props.onChange(id); }}><Icon aria-hidden="true" /> {label}</button>)}
    </div>
  );
}

function ActionBar(props: {
  readonly detail: ReconstructionReleaseDetail;
  readonly draft: FoundryReviewEvidenceDraft;
  readonly busy: boolean;
  readonly onAction: (action: FoundryAction) => void;
}): ReactElement {
  const blockers = actionBlockers(props.detail, props.draft);
  const wasPreviouslyActive = props.detail.channelEvents.some((event) => event.toReleaseId === props.detail.registration.id);
  const currentReview = latestReview(props.detail.reviews);
  const hasPublicApproval = currentReview?.decision === "approved" && currentReview.targetExposure === "public";
  const isProductionCurrent = props.detail.productionChannel?.activeReleaseId === props.detail.registration.id;
  const visibleBlockers = [...new Set([
    ...(hasPublicApproval ? [] : blockers.approve),
    ...(props.detail.publication === null ? blockers.publish : []),
    ...(isProductionCurrent ? [] : wasPreviouslyActive ? blockers.rollback : blockers.promote),
  ])];
  return (
    <>
      {visibleBlockers.length > 0 ? <ul className="runtime-foundry__blockers" aria-label="Release action blockers">{visibleBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
      <footer className="runtime-foundry__action-bar">
        <div className="runtime-foundry__action-group">
          <button type="button" className="runtime-foundry__button" disabled={props.busy || blockers.reject.length > 0} onClick={() => { props.onAction("reject"); }}><CircleAlert aria-hidden="true" /> Reject</button>
          <button type="button" className="runtime-foundry__button" disabled={props.busy || blockers.approve.length > 0} onClick={() => { props.onAction("approve"); }}><ShieldCheck aria-hidden="true" /> Approve public evidence</button>
        </div>
        <div className="runtime-foundry__action-group">
          {props.detail.publication === null ? <button type="button" className="runtime-foundry__button" disabled={props.busy || blockers.publish.length > 0} onClick={() => { props.onAction("publish"); }}><Upload aria-hidden="true" /> Publish immutable release</button> : null}
          {props.detail.productionChannel?.activeReleaseId !== props.detail.registration.id ? <button type="button" className="runtime-foundry__button runtime-foundry__button--primary" disabled={props.busy || (wasPreviouslyActive ? blockers.rollback.length > 0 : blockers.promote.length > 0)} onClick={() => { props.onAction(wasPreviouslyActive ? "rollback" : "promote"); }}>{wasPreviouslyActive ? <RotateCcw aria-hidden="true" /> : <Send aria-hidden="true" />}{wasPreviouslyActive ? "Roll back to this release" : "Promote to production"}</button> : <span className="runtime-foundry__chip" data-tone="current"><LockKeyhole aria-hidden="true" /> Production current</span>}
        </div>
      </footer>
    </>
  );
}

export function FoundryReleaseDetail(props: {
  readonly detail: ReconstructionReleaseDetail;
  readonly evidenceArtifacts: readonly ReconstructionReviewEvidenceArtifact[];
  readonly tab: FoundryTab;
  readonly draft: FoundryReviewEvidenceDraft;
  readonly busy: boolean;
  readonly envelopeJson: string;
  readonly signingError: string | null;
  readonly onTabChange: (tab: FoundryTab) => void;
  readonly onDraftChange: (patch: Partial<FoundryReviewEvidenceDraft>) => void;
  readonly onToggleEvidence: (path: string) => void;
  readonly onSelectEvidence: (paths: readonly string[]) => void;
  readonly onAction: (action: FoundryAction) => void;
  readonly onEnvelopeChange: (value: string) => void;
  readonly onDownloadSigningPayload: () => void;
  readonly onVerifyAttestation: () => void;
}): ReactElement {
  const manifest = props.detail.registration.manifest;
  const review = latestReview(props.detail.reviews);
  const needsAttestation = review?.decision === "approved" &&
    review.targetExposure === "public" &&
    matchingAttestation(props.detail) === null;
  return (
    <section className="runtime-foundry__panel" aria-labelledby="foundry-release-detail-title">
      <header className="runtime-foundry__detail-heading">
        <div><h3 id="foundry-release-detail-title">Release evidence</h3><code className="runtime-foundry__mono">{manifest.releaseDigest}</code><p>{manifest.venueSlug} · recorded {formatDate(props.detail.registration.registeredAt)}</p></div>
        <StatusChip detail={props.detail} />
      </header>
      <DetailTabs tab={props.tab} onChange={props.onTabChange} />
      {props.tab === "summary" ? <SummaryPanel detail={props.detail} /> : null}
      {props.tab === "qa" ? <QaPanel detail={props.detail} evidenceArtifacts={props.evidenceArtifacts} draft={props.draft} onDraftChange={props.onDraftChange} onToggleEvidence={props.onToggleEvidence} onSelectEvidence={props.onSelectEvidence} /> : null}
      {props.tab === "history" ? <HistoryPanel detail={props.detail} /> : null}
      {needsAttestation ? <FoundrySigningControls envelopeJson={props.envelopeJson} busy={props.busy} error={props.signingError} onEnvelopeChange={props.onEnvelopeChange} onDownloadPayload={props.onDownloadSigningPayload} onVerifyEnvelope={props.onVerifyAttestation} /> : null}
      <ActionBar detail={props.detail} draft={props.draft} busy={props.busy} onAction={props.onAction} />
    </section>
  );
}

export function buildSelectedVisualEvidence(
  detail: ReconstructionReleaseDetail,
  selectedPaths: readonly string[],
): readonly { readonly label: string; readonly objectKey: string; readonly sha256: string }[] {
  const selected = new Set(selectedPaths);
  return reviewableEvidence(detail)
    .filter((file) => selected.has(file.path))
    .map((file) => ({ label: file.path, objectKey: file.path, sha256: file.sha256 }));
}

export function getLatestFoundryReview(detail: ReconstructionReleaseDetail): ReconstructionReleaseReview | null {
  return latestReview(detail.reviews);
}

export function getMatchingFoundryAttestation(detail: ReconstructionReleaseDetail): ReconstructionReleaseDetail["attestations"][number] | null {
  return matchingAttestation(detail);
}
