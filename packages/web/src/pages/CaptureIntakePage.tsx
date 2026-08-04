import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Database,
  FileCheck2,
  Fingerprint,
  FolderLock,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import type { CaptureIntakeCaveat, CaptureIntakeOperatorStatus } from "@omnitwin/types";
import { getCaptureIntakeOperatorStatus } from "../api/capture-intake.js";
import "./CaptureIntakePage.css";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly status: CaptureIntakeOperatorStatus };

const CAVEAT_COPY: Readonly<Record<CaptureIntakeCaveat, string>> = {
  INSPECTION_NOT_CONFIGURED: "The API has no configured inspection ledger path.",
  INSPECTION_UNAVAILABLE: "The configured inspection ledger could not be read.",
  INSPECTION_INVALID: "The inspection ledger failed schema or plan-digest validation.",
  STAGE_MANIFEST_NOT_CONFIGURED: "The API has no configured stage manifest path.",
  STAGE_MANIFEST_UNAVAILABLE: "The configured stage manifest could not be read.",
  STAGE_MANIFEST_INVALID: "The stage manifest failed schema validation.",
  LEDGER_MISMATCH: "The inspection copy plan and stage manifest do not match.",
  SOURCE_BYTES_ARE_NOT_RUNTIME_READY: "Verified source bytes are not a loadable runtime twin.",
  NO_RECONSTRUCTION_QA: "No reconstruction or visual runtime QA has been recorded by this intake.",
  NO_SPATIAL_ACCURACY_CERTIFICATION: "File identity does not establish survey or spatial accuracy.",
  DERIVED_REFERENCES_EXCLUDED_FROM_TRUTH_INPUTS: "Later derived experiments remain outside the truth-source stage.",
  STAGED_FILES_MISSING_OR_CHANGED: "One or more planned staged targets are missing or have a different byte size.",
  STATUS_READ_DOES_NOT_REHASH_STAGED_BYTES: "This fast status read checks containment and byte sizes; the sealed factory run performed the full SHA-256 verification.",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const;
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const unit = units[index] ?? "B";
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${unit}`;
}

function stateLabel(status: CaptureIntakeOperatorStatus): string {
  if (status.status === "staged") return "Verified candidate source stage";
  if (status.status === "inspected") return "Inspection available · stage not verified";
  return "Capture intake unavailable";
}

export function CaptureIntakePage(): ReactElement {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => { setReloadToken((value) => value + 1); }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    void getCaptureIntakeOperatorStatus(controller.signal)
      .then((status) => { setState({ kind: "ready", status }); })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ kind: "error", message: "The protected capture status route could not be loaded." });
        }
      });
    return () => { controller.abort(); };
  }, [reloadToken]);

  return (
    <main className="capture-intake-page" aria-label="Capture-to-Truth Factory">
      <header className="capture-intake-hero">
        <div>
          <p className="capture-intake-kicker"><Fingerprint aria-hidden="true" /> Capture-to-Truth Factory</p>
          <h1>Raw capture in. Verifiable candidate source bundle out.</h1>
          <p>Read-only inventory, deterministic classification, digest-addressed copies, and an immutable source-stage ledger for Trades Hall.</p>
        </div>
        <div className="capture-intake-trust"><ShieldCheck aria-hidden="true" /><span>Platform-admin evidence surface</span></div>
      </header>

      {state.kind === "loading" && (
        <section className="capture-intake-state" role="status"><RefreshCw className="capture-intake-spin" aria-hidden="true" /><div><h2>Reading sealed ledgers</h2><p>Checking the inspection plan and verified stage manifest.</p></div></section>
      )}
      {state.kind === "error" && (
        <section className="capture-intake-state capture-intake-state--error" role="alert"><AlertTriangle aria-hidden="true" /><div><h2>Operator status unavailable</h2><p>{state.message}</p></div><button type="button" onClick={reload}>Retry</button></section>
      )}
      {state.kind === "ready" && <CaptureStatus status={state.status} onReload={reload} />}
    </main>
  );
}

function CaptureStatus(props: {
  readonly status: CaptureIntakeOperatorStatus;
  readonly onReload: () => void;
}): ReactElement {
  const inspection = props.status.inspection;
  const manifest = props.status.stageManifest;
  return (
    <>
      <section className="capture-intake-command">
        <div className="capture-intake-command-head">
          <div><p>Current boundary</p><h2>{stateLabel(props.status)}</h2></div>
          <span data-status={props.status.qaStatus}>{props.status.qaStatus.replace(/_/gu, " ")}</span>
        </div>
        <div className="capture-intake-metrics">
          <article><ScanSearch aria-hidden="true" /><strong>{inspection?.inventoryFileCount ?? 0}</strong><span>files inventoried</span></article>
          <article><FileCheck2 aria-hidden="true" /><strong>{inspection?.plannedFileCount ?? 0}</strong><span>files selected</span></article>
          <article><Database aria-hidden="true" /><strong>{formatBytes(inspection?.plannedBytes ?? 0)}</strong><span>candidate-source bytes</span></article>
          <article><FolderLock aria-hidden="true" /><strong>{manifest?.fileCount ?? 0}</strong><span>manifest entries</span></article>
        </div>
        <dl className="capture-intake-ledger">
          <div><dt>Consistency</dt><dd>{props.status.consistencyStatus.replace(/_/gu, " ")}</dd></div>
          <div><dt>Copy-plan digest</dt><dd><code>{inspection?.planSha256 ?? "not available"}</code></dd></div>
          <div><dt>Source boundary</dt><dd><code>{props.status.roots?.sourceRoot ?? "not exposed"}</code></dd></div>
          <div><dt>Immutable stage</dt><dd><code>{props.status.roots?.stagingRoot ?? "not exposed"}</code></dd></div>
        </dl>
        <button type="button" className="capture-intake-refresh" onClick={props.onReload}><RefreshCw aria-hidden="true" /> Re-read ledgers</button>
      </section>

      <section className="capture-intake-flow" aria-labelledby="capture-flow-title">
        <div className="capture-intake-section-head"><p>Factory path</p><h2 id="capture-flow-title">A trust boundary, not a folder copy</h2></div>
        <ol>
          <li data-complete={inspection !== null}><span>01</span><div><strong>Read-only inventory</strong><p>Regular files, signatures, byte sizes, timestamps, and source mutation checks.</p></div><Check aria-hidden="true" /></li>
          <li data-complete={inspection !== null}><span>02</span><div><strong>Evidence-led classification</strong><p>Primary capture and original vendor controls are separated from later experiments.</p></div><Check aria-hidden="true" /></li>
          <li data-complete={props.status.status === "staged"}><span>03</span><div><strong>Digest-addressed staging</strong><p>Partial copies are verified before atomic promotion; matching reruns are reused.</p></div><Check aria-hidden="true" /></li>
          <li data-complete={props.status.status === "staged"}><span>04</span><div><strong>Immutable manifest</strong><p>The selected file list, byte total, SHA-256 values, and plan digest are sealed together.</p></div><Check aria-hidden="true" /></li>
          <li data-complete={false}><span>05</span><div><strong>Runtime derivation + review</strong><p>Reconstruction, transform review, runtime QA, signing, and exposure remain separate gates.</p></div><ArrowRight aria-hidden="true" /></li>
        </ol>
      </section>

      <section className="capture-intake-caveats" aria-labelledby="capture-caveats-title">
        <div className="capture-intake-section-head"><p>Open gates</p><h2 id="capture-caveats-title">What this evidence does not establish</h2></div>
        <ul>{props.status.caveats.map((caveat) => <li key={caveat}><AlertTriangle aria-hidden="true" /><div><strong>{caveat.replace(/_/gu, " ").toLowerCase()}</strong><p>{CAVEAT_COPY[caveat]}</p></div></li>)}</ul>
      </section>

      <footer className="capture-intake-footer">
        <p>The staged source can now enter the existing artifact-factory and human-review gates.</p>
        <Link to="/dev/assets/rooms">Open runtime asset registry <ArrowRight aria-hidden="true" /></Link>
      </footer>
    </>
  );
}
