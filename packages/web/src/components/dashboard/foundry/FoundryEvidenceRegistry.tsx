import { useState, type FormEvent, type ReactElement } from "react";
import { FileUp, ShieldCheck } from "lucide-react";
import type {
  ReconstructionReviewEvidenceArtifact,
  ReconstructionReviewEvidenceArtifactKind,
} from "@omnitwin/types";

function kindLabel(kind: ReconstructionReviewEvidenceArtifactKind): string {
  return kind === "transform_artifact_v0" ? "TransformArtifactV0" : "Scene Authority Map v0";
}

export function FoundryEvidenceRegistry(props: {
  readonly artifacts: readonly ReconstructionReviewEvidenceArtifact[];
  readonly busy: boolean;
  readonly error: string | null;
  readonly onRegister: (
    kind: ReconstructionReviewEvidenceArtifactKind,
    file: File,
  ) => void;
}): ReactElement {
  const [kind, setKind] = useState<ReconstructionReviewEvidenceArtifactKind>("transform_artifact_v0");
  const [file, setFile] = useState<File | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (file !== null) props.onRegister(kind, file);
  };
  return (
    <section className="runtime-foundry__panel runtime-foundry__evidence-registry" aria-labelledby="foundry-evidence-registry-title">
      <header className="runtime-foundry__detail-heading">
        <div>
          <p className="runtime-foundry__micro-label">Immutable authority registry</p>
          <h3 id="foundry-evidence-registry-title">Import reviewed authority evidence</h3>
          <p>Choose a strict JSON artifact here. The server validates it, writes canonical bytes to private storage, reads them back, and makes only the verified receipt selectable for approval.</p>
        </div>
        <ShieldCheck aria-hidden="true" />
      </header>
      <form className="runtime-foundry__evidence-import" onSubmit={submit}>
        <label className="runtime-foundry__field">
          <span>Evidence type</span>
          <select value={kind} onChange={(event) => {
            const value = event.target.value;
            if (value === "transform_artifact_v0" || value === "scene_authority_map_v0") setKind(value);
          }}>
            <option value="transform_artifact_v0">TransformArtifactV0</option>
            <option value="scene_authority_map_v0">Scene Authority Map v0</option>
          </select>
        </label>
        <label className="runtime-foundry__field">
          <span>Reviewed JSON file</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => { setFile(event.target.files?.[0] ?? null); }}
          />
        </label>
        <button className="runtime-foundry__button" type="submit" disabled={props.busy || file === null}>
          <FileUp aria-hidden="true" /> {props.busy ? "Verifying evidence…" : "Import and verify evidence"}
        </button>
      </form>
      {props.error !== null ? <p className="runtime-foundry__notice" data-kind="error" role="alert">{props.error}</p> : null}
      {props.artifacts.length === 0 ? (
        <p className="runtime-foundry__notice">No authority evidence is registered for this venue. Import a TransformArtifact first, then a Scene Authority Map that references it.</p>
      ) : (
        <ul className="runtime-foundry__evidence-registry-list">
          {props.artifacts.map((artifact) => (
            <li key={artifact.id}>
              <strong>{kindLabel(artifact.artifactKind)} · {artifact.artifactId}</strong>
              <code>{artifact.artifactDigest}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
