import { useState, type ReactElement } from "react";

interface CandidatePanelMember {
  readonly memberId: string;
  readonly relativePath: string;
  readonly sha256: string;
}

interface CandidatePanelReadyState {
  readonly status: "ready";
  readonly retry: () => void;
  readonly candidate: {
    readonly candidateId: string;
    readonly candidateRevision: number;
    readonly candidateDigest: string;
    readonly runtimeRegistration: "not_registered";
    readonly labels: {
      readonly title: string;
      readonly source: string;
      readonly status: string;
      readonly caveat: string;
    };
    readonly source: {
      readonly manifestSha256: string;
      readonly frontierReceiptSha256: string;
      readonly inventory: {
        readonly sog: { readonly count: number };
        readonly meshPly: { readonly count: number };
        readonly bvh: { readonly count: number };
        readonly obj: { readonly count: number };
        readonly poses: { readonly count: number };
      };
    };
    readonly rights: {
      readonly evidenceState: string;
      readonly licensedUse: string;
      readonly publicationAndDistributionRights: string;
      readonly licensingBlocker: false;
      readonly runtimeActivation: string;
    };
    readonly authority: {
      readonly appearance: string;
      readonly geometry: "none";
      readonly placement: "none";
      readonly measurement: "none";
      readonly collision: "none";
      readonly export: "none";
    };
    readonly availableEvidence: {
      readonly operationalAuthority: "none";
    };
  };
  readonly selection: {
    readonly tier: {
      readonly id: "desktop" | "mobile";
      readonly memberCount: number;
      readonly splatCount: number;
      readonly sizeBytes: number;
    };
    readonly members: readonly CandidatePanelMember[];
  };
}

export type LocalSogCandidatePanelState =
  | { readonly status: "inactive"; readonly retry: () => void }
  | { readonly status: "loading"; readonly retry: () => void }
  | {
      readonly status: "error";
      readonly retry: () => void;
      readonly message: string;
      readonly retryable: boolean;
    }
  | CandidatePanelReadyState;

export interface LocalSogCandidatePanelProps {
  readonly state: LocalSogCandidatePanelState;
  readonly streamError?: string | null;
}

function decimalMegabytes(sizeBytes: number): string {
  return `${(sizeBytes / 1_000_000).toFixed(1)} MB`;
}

function humanState(value: string): string {
  return value.replaceAll("_", " ");
}

export function LocalSogCandidatePanel({
  state,
  streamError = null,
}: LocalSogCandidatePanelProps): ReactElement | null {
  const [detailsVisible, setDetailsVisible] = useState(false);
  if (state.status === "inactive") return null;

  return (
    <aside
      className={`local-sog-candidate-panel${detailsVisible ? " is-expanded" : ""}`}
      aria-label="Local SOG candidate status"
      aria-live="polite"
      data-testid="local-sog-candidate-panel"
    >
      <div className="local-sog-candidate-panel__boundary">
        <span>Local candidate</span>
        <span>Use rights · owner authorized</span>
        <span>Appearance-only review</span>
        <span>Operational scene authority · unregistered</span>
        {state.status === "ready" && (
          <button
            type="button"
            className="local-sog-candidate-panel__toggle"
            aria-expanded={detailsVisible}
            onClick={() => { setDetailsVisible((visible) => !visible); }}
          >
            {detailsVisible ? "Hide details" : "Show candidate details"}
          </button>
        )}
      </div>

      {state.status === "loading" && (
        <p className="local-sog-candidate-panel__state">Loading the exact local candidate descriptor…</p>
      )}

      {state.status === "error" && (
        <div className="local-sog-candidate-panel__error" role="alert">
          <strong>Local candidate unavailable</strong>
          <p>{state.message}</p>
          {state.retryable && (
            <button type="button" onClick={state.retry}>Try again</button>
          )}
        </div>
      )}

      {state.status === "ready" && (
        <>
          {!detailsVisible && (
            <p className="local-sog-candidate-panel__compact-summary">
              Grand Hall · {state.selection.tier.id} · {state.selection.tier.splatCount.toLocaleString("en-GB")} splats
            </p>
          )}
          {detailsVisible && (
            <>
              <div className="local-sog-candidate-panel__heading">
                <div>
                  <strong>{state.candidate.labels.title}</strong>
                  <span>{state.candidate.labels.source}</span>
                </div>
                <button type="button" onClick={state.retry}>Reload</button>
              </div>
              <p className="local-sog-candidate-panel__status">{state.candidate.labels.status}</p>
              <p className="local-sog-candidate-panel__caveat">
                {state.candidate.labels.caveat} No planner measurements or operational export.
              </p>
              <dl className="local-sog-candidate-panel__metrics">
                <div><dt>Rendered tier</dt><dd>{state.selection.tier.id}</dd></div>
                <div><dt>Members</dt><dd>{state.selection.tier.memberCount.toLocaleString("en-GB")}</dd></div>
                <div><dt>Splats</dt><dd>{state.selection.tier.splatCount.toLocaleString("en-GB")}</dd></div>
                <div><dt>Transfer</dt><dd>{decimalMegabytes(state.selection.tier.sizeBytes)}</dd></div>
              </dl>
            </>
          )}
          {streamError !== null && (
            <p className="local-sog-candidate-panel__stream-error" role="alert">
              SOG rendering failed: {streamError}
            </p>
          )}
          {detailsVisible && <details className="local-sog-candidate-panel__details">
            <summary>Coverage and provenance</summary>
            <p>
              Rendered now: the selected SOG tier only. Available evidence retained: {" "}
              {state.candidate.source.inventory.sog.count.toLocaleString("en-GB")} SOG · {" "}
              {state.candidate.source.inventory.meshPly.count.toLocaleString("en-GB")} mesh PLY · {" "}
              {state.candidate.source.inventory.bvh.count.toLocaleString("en-GB")} BVH · {" "}
              {state.candidate.source.inventory.obj.count.toLocaleString("en-GB")} OBJ · {" "}
              {state.candidate.source.inventory.poses.count.toLocaleString("en-GB")} poses.
            </p>
            <p>
              Mesh PLY, BVH, OBJ, poses, and other SOG alternatives are retained candidates; they are not
              rendered here and have no operational authority.
            </p>
            <dl className="local-sog-candidate-panel__provenance">
              <div><dt>Candidate</dt><dd>{state.candidate.candidateId} · revision {state.candidate.candidateRevision}</dd></div>
              <div><dt>Registration</dt><dd>{humanState(state.candidate.runtimeRegistration)}</dd></div>
              <div><dt>Appearance</dt><dd>{humanState(state.candidate.authority.appearance)}</dd></div>
              <div><dt>Operational scene authority</dt><dd>unregistered</dd></div>
              <div><dt>Rights evidence</dt><dd>{humanState(state.candidate.rights.evidenceState)}</dd></div>
              <div><dt>Licensed use</dt><dd>{humanState(state.candidate.rights.licensedUse)}</dd></div>
              <div><dt>Publication and distribution</dt><dd>{humanState(state.candidate.rights.publicationAndDistributionRights)}</dd></div>
              <div><dt>Licensing blocker</dt><dd>none</dd></div>
              <div><dt>Runtime activation</dt><dd>{humanState(state.candidate.rights.runtimeActivation)}</dd></div>
              <div><dt>Candidate digest</dt><dd><code>{state.candidate.candidateDigest}</code></dd></div>
              <div><dt>Manifest digest</dt><dd><code>{state.candidate.source.manifestSha256}</code></dd></div>
              <div><dt>Frontier receipt</dt><dd><code>{state.candidate.source.frontierReceiptSha256}</code></dd></div>
            </dl>
            <ul className="local-sog-candidate-panel__members" aria-label="Rendered SOG member identities">
              {state.selection.members.map((member) => (
                <li key={`${member.memberId}:${member.sha256}`}>
                  <strong>{member.memberId}</strong>
                  <code>{member.relativePath}</code>
                  <code>{member.sha256}</code>
                </li>
              ))}
            </ul>
          </details>}
        </>
      )}
    </aside>
  );
}
