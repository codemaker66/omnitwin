import { useState, type ReactElement } from "react";

export type GrandHallEvidenceMode = "spatial" | "twin" | "reference";

export interface GrandHallEvidenceSummary {
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly candidateDigest: string;
  readonly splatFiles: number;
  readonly selectedSplatTier: "desktop" | "mobile";
  readonly selectedSplatMembers: number;
  readonly declaredSplats: number;
  readonly panoramaViewpoints: number;
  readonly capturedImages: number;
  readonly unclassifiedImages: number;
  readonly generatedImages: number;
  readonly editedReferenceVideos: number;
  readonly meshPlyFiles: number;
  readonly smallObjFiles: number;
  readonly btreeFiles: number;
  readonly poseCount: number;
  readonly historicalCubefaces: number;
  readonly excludedDerivativeReason: string;
  readonly rawXgridsBytes: number;
  readonly e57Bytes: number;
  readonly matterpakObjBytes: number;
  readonly technicalSlots: readonly {
    readonly id: string;
    readonly state: "not_produced";
    readonly reason: string;
  }[];
}

export type GrandHallEvidenceDockState =
  | { readonly status: "loading" }
  | {
      readonly status: "error";
      readonly message: string;
      readonly retryable: boolean;
      readonly retry: () => void;
    }
  | {
      readonly status: "ready";
      readonly summary: GrandHallEvidenceSummary;
      readonly retry: () => void;
    };

export interface GrandHallEvidenceDockProps {
  readonly state: GrandHallEvidenceDockState;
  readonly mode: GrandHallEvidenceMode;
  readonly onModeChange: (mode: GrandHallEvidenceMode) => void;
  readonly spatialRuntime?: {
    readonly status: "idle" | "loading" | "loaded" | "error";
    readonly loadedMembers: number;
    readonly totalMembers: number;
    readonly browserReportedSplats: number | null;
    readonly message: string | null;
    readonly retry: () => void;
  };
}

const MODES: readonly {
  readonly id: GrandHallEvidenceMode;
  readonly label: string;
  readonly supporting: string;
}[] = [
  {
    id: "spatial",
    label: "Spatial capture",
    supporting: "Gaussian splat · appearance only",
  },
  {
    id: "twin",
    label: "Walk + mesh",
    supporting: "Captured panoramas · bounded GLB",
  },
  {
    id: "reference",
    label: "Reference media",
    supporting: "Stills · edited video · generated concept",
  },
];

function decimalGigabytes(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

function humanId(id: string): string {
  return id.replaceAll("_", " ");
}

export function GrandHallEvidenceDock({
  state,
  mode,
  onModeChange,
  spatialRuntime,
}: GrandHallEvidenceDockProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const activeMode = MODES.find((item) => item.id === mode) ?? {
    id: "spatial" as const,
    label: "Spatial capture",
    supporting: "Gaussian splat · appearance only",
  };

  return (
    <aside
      className={`grand-hall-evidence-dock${expanded ? " is-expanded" : ""}`}
      aria-label="Multimodal room evidence"
      data-testid="grand-hall-evidence-dock"
    >
      <header className="grand-hall-evidence-dock__header">
        <div>
          <strong>Multimodal room evidence</strong>
          <span>Grand Hall master evidence view · internal review</span>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((current) => !current);
          }}
        >
          {expanded ? "Hide evidence ledger" : "Show evidence ledger"}
        </button>
      </header>

      <div className="grand-hall-evidence-dock__boundary" aria-label="Evidence boundaries">
        <span>
          {state.status === "ready"
            ? "Use rights · owner authorized · licensing blocker none"
            : state.status === "loading"
              ? "Use rights · verifying sealed owner attestation"
              : "Use rights · not asserted while profile is unavailable"}
        </span>
        <span>Operational scene authority · unregistered</span>
        <span>Alignment · source-frame only / sources not registered</span>
      </div>

      <nav className="grand-hall-evidence-dock__modes" aria-label="Master evidence view mode">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === mode ? "is-active" : undefined}
            aria-pressed={item.id === mode}
            disabled={state.status !== "ready"}
            onClick={() => {
              onModeChange(item.id);
            }}
          >
            <strong>{item.label}</strong>
            <span>{item.supporting}</span>
          </button>
        ))}
      </nav>

      {state.status === "loading" && (
        <p className="grand-hall-evidence-dock__state" role="status">
          Verifying the exact all-source evidence profile…
        </p>
      )}
      {state.status === "error" && (
        <div className="grand-hall-evidence-dock__error" role="alert">
          <strong>Master evidence profile unavailable</strong>
          <p>{state.message}</p>
          {state.retryable && (
            <button type="button" onClick={state.retry}>Retry evidence profile</button>
          )}
        </div>
      )}
      {state.status === "ready" && (
        <p className="grand-hall-evidence-dock__active">
          <strong>{activeMode.label}</strong>
          <span>
            {mode === "spatial"
              ? `${state.summary.selectedSplatTier} selected · ${state.summary.selectedSplatMembers.toLocaleString("en-GB")} exact members · ${state.summary.declaredSplats.toLocaleString("en-GB")} declared splats · runtime status shown above`
              : mode === "twin"
                ? `${state.summary.panoramaViewpoints.toLocaleString("en-GB")} captured viewpoints · venue-context mesh`
                : `${(state.summary.capturedImages + state.summary.unclassifiedImages).toLocaleString("en-GB")} reference stills · ${state.summary.editedReferenceVideos.toLocaleString("en-GB")} edited video · ${state.summary.generatedImages.toLocaleString("en-GB")} generated concept`}
          </span>
        </p>
      )}

      {state.status === "ready" && mode === "spatial" && spatialRuntime !== undefined && (
        spatialRuntime.status === "error" ? (
          <p className="grand-hall-evidence-dock__stream is-error" role="alert">
            <strong>Spatial capture render failed</strong>
            <span>{spatialRuntime.message ?? "A selected SOG member could not be decoded."}</span>
            <button type="button" onClick={spatialRuntime.retry}>Retry spatial evidence</button>
          </p>
        ) : (
          <p className="grand-hall-evidence-dock__stream" role="status">
            <strong>
              {spatialRuntime.status === "loaded"
                ? "Spatial capture decoded"
                : "Spatial capture loading"}
            </strong>
            <span>
              {spatialRuntime.loadedMembers.toLocaleString("en-GB")}/
              {spatialRuntime.totalMembers.toLocaleString("en-GB")} selected members
              {spatialRuntime.status === "loaded" && spatialRuntime.browserReportedSplats !== null
                ? ` · ${spatialRuntime.browserReportedSplats.toLocaleString("en-GB")} browser-reported splats`
                : ""}
            </span>
          </p>
        )
      )}

      {expanded && state.status === "ready" && (
        <div className="grand-hall-evidence-dock__ledger">
          <section>
            <h3>Inspectable now</h3>
            <dl>
              <div><dt>Gaussian splat inventory</dt><dd>{state.summary.splatFiles.toLocaleString("en-GB")} SOG</dd></div>
              <div><dt>Panorama walk</dt><dd>{state.summary.panoramaViewpoints.toLocaleString("en-GB")} viewpoints</dd></div>
              <div><dt>Bounded mesh</dt><dd>1 venue-context GLB</dd></div>
              <div><dt>Captured reference</dt><dd>{state.summary.capturedImages.toLocaleString("en-GB")} classified stills</dd></div>
              <div><dt>Unclassified reference</dt><dd>{state.summary.unclassifiedImages.toLocaleString("en-GB")} lineage-unverified still</dd></div>
              <div><dt>Edited reference video</dt><dd>{state.summary.editedReferenceVideos.toLocaleString("en-GB")} exact MOV</dd></div>
              <div><dt>Generated derivatives</dt><dd>{state.summary.generatedImages.toLocaleString("en-GB")} generated concept · embedded C2PA claim inspected, not cryptographically validated</dd></div>
            </dl>
          </section>
          <section>
            <h3>Retained source evidence</h3>
            <dl>
              <div><dt>E57 point cloud</dt><dd>{decimalGigabytes(state.summary.e57Bytes)} · stage/inspection verified; large-member hash not recomputed; bounded derivative pending</dd></div>
              <div><dt>PortalCam raw</dt><dd>{decimalGigabytes(state.summary.rawXgridsBytes)} · current sizes matched; audit hashes not recomputed; decoder pending</dd></div>
              <div><dt>MatterPak OBJ</dt><dd>{(state.summary.matterpakObjBytes / 1_000_000).toFixed(1)} MB · inventory only</dd></div>
              <div><dt>LCC2 mesh review</dt><dd>{state.summary.meshPlyFiles.toLocaleString("en-GB")} PLY + {state.summary.smallObjFiles.toLocaleString("en-GB")} OBJ</dd></div>
              <div><dt>Vendor spatial indexes</dt><dd>{state.summary.btreeFiles.toLocaleString("en-GB")} BTree</dd></div>
              <div><dt>Camera poses</dt><dd>{state.summary.poseCount.toLocaleString("en-GB")}</dd></div>
              <div><dt>Historical cubefaces</dt><dd>{state.summary.historicalCubefaces.toLocaleString("en-GB")} retained</dd></div>
              <div><dt>Brush PLY derivative series</dt><dd>Excluded · {state.summary.excludedDerivativeReason}</dd></div>
            </dl>
          </section>
          <section>
            <h3>Technical promotion gaps</h3>
            <ul>
              {state.summary.technicalSlots.map((slot) => (
                <li key={slot.id}>
                  <span>{humanId(slot.id)}<small>{slot.reason}</small></span>
                  <strong>{humanId(slot.state)}</strong>
                </li>
              ))}
            </ul>
            <p>
              Furniture, planner dimensions, placement, collision, capacity, and exports remain
              independent of every unregistered evidence layer shown here.
            </p>
          </section>
          <footer>
            <span>{state.summary.candidateId} · revision {state.summary.candidateRevision}</span>
            <code>{state.summary.candidateDigest}</code>
            <button type="button" onClick={state.retry}>Reload exact profile</button>
          </footer>
        </div>
      )}
    </aside>
  );
}
