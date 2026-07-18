import { Download, FileJson2, KeyRound } from "lucide-react";
import { useRef, type ChangeEvent, type ReactElement } from "react";

export function FoundrySigningControls(props: {
  readonly envelopeJson: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onEnvelopeChange: (value: string) => void;
  readonly onDownloadPayload: () => void;
  readonly onVerifyEnvelope: () => void;
}): ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const readFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    void file.text().then(props.onEnvelopeChange);
    event.target.value = "";
  };

  return (
    <section className="runtime-foundry__signing" aria-labelledby="foundry-signing-title">
      <div>
        <p className="runtime-foundry__micro-label">Detached attestation</p>
        <h4 id="foundry-signing-title">Sign outside the application boundary</h4>
        <p>Download the exact in-toto statement, sign its DSSE payload with the controlled Ed25519 key, then upload or paste the envelope for server verification.</p>
      </div>
      <div className="runtime-foundry__action-group">
        <button type="button" className="runtime-foundry__button" disabled={props.busy} onClick={props.onDownloadPayload}>
          <Download aria-hidden="true" /> Download signing payload
        </button>
        <button type="button" className="runtime-foundry__button" disabled={props.busy} onClick={() => { fileInputRef.current?.click(); }}>
          <FileJson2 aria-hidden="true" /> Upload DSSE JSON
        </button>
        <input ref={fileInputRef} className="vv-sr-only" type="file" accept="application/json,.json" tabIndex={-1} disabled={props.busy} onChange={readFile} />
      </div>
      <label className="runtime-foundry__field">
        <span>Signed DSSE envelope JSON</span>
        <textarea
          className="runtime-foundry__signing-json runtime-foundry__mono"
          value={props.envelopeJson}
          spellCheck={false}
          disabled={props.busy}
          onChange={(event) => { props.onEnvelopeChange(event.target.value); }}
          placeholder="Paste the complete signed DSSE envelope object."
        />
      </label>
      {props.error !== null ? <p className="runtime-foundry__notice" data-kind="error" role="alert">{props.error}</p> : null}
      <button
        type="button"
        className="runtime-foundry__button runtime-foundry__button--primary"
        disabled={props.busy || props.envelopeJson.trim() === ""}
        onClick={props.onVerifyEnvelope}
      >
        <KeyRound aria-hidden="true" /> Verify signed envelope
      </button>
    </section>
  );
}
