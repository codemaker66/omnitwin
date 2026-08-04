import { useId, useState, type FormEvent, type ReactElement } from "react";
import { useFocusTrap } from "../../../lib/use-focus-trap.js";

export type FoundryAction = "approve" | "reject" | "publish" | "promote" | "rollback";

interface FoundryActionCopy {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly danger: boolean;
}

const ACTION_COPY: Readonly<Record<FoundryAction, FoundryActionCopy>> = {
  approve: {
    title: "Approve this release evidence?",
    description: "This records an append-only human decision against the exact release and machine QA digests. It does not make the release current.",
    confirmLabel: "Record approval",
    danger: false,
  },
  reject: {
    title: "Reject this release evidence?",
    description: "The candidate remains immutable and inspectable, but it cannot be published or promoted while rejection is the latest decision.",
    confirmLabel: "Record rejection",
    danger: true,
  },
  publish: {
    title: "Publish this immutable release?",
    description: "Verified objects will be copied to their digest-addressed public prefix. This does not change the production pointer.",
    confirmLabel: "Publish release",
    danger: false,
  },
  promote: {
    title: "Promote this release to production?",
    description: "The production pointer will move only if its revision is unchanged. Existing release objects and history remain immutable.",
    confirmLabel: "Promote to production",
    danger: false,
  },
  rollback: {
    title: "Roll production back to this release?",
    description: "Rollback is a new audited pointer event. It does not copy, replace, edit, or delete either release.",
    confirmLabel: "Roll back production",
    danger: true,
  },
};

interface FoundryActionDialogProps {
  readonly action: FoundryAction;
  readonly releaseDigest: string;
  readonly currentDigest: string | null;
  readonly inFlight: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: (note: string) => void;
}

function DigestSummary(props: {
  readonly action: FoundryAction;
  readonly releaseDigest: string;
  readonly currentDigest: string | null;
}): ReactElement {
  return (
    <dl className="runtime-foundry__dialog-summary">
      {props.currentDigest !== null && (props.action === "promote" || props.action === "rollback") ? (
        <div>
          <dt>Current</dt>
          <dd className="runtime-foundry__mono">{props.currentDigest}</dd>
        </div>
      ) : null}
      <div>
        <dt>{props.action === "rollback" ? "Rollback to" : "Release"}</dt>
        <dd className="runtime-foundry__mono">{props.releaseDigest}</dd>
      </div>
    </dl>
  );
}

export function FoundryActionDialog(props: FoundryActionDialogProps): ReactElement {
  const copy = ACTION_COPY[props.action];
  const [note, setNote] = useState("");
  const titleId = useId();
  const descriptionId = useId();
  const trapRef = useFocusTrap<HTMLDivElement>();

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = note.trim();
    if (trimmed.length < 20 || props.inFlight) return;
    props.onConfirm(trimmed);
  };

  return (
    <div
      className="runtime-foundry__dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !props.inFlight) props.onCancel();
      }}
    >
      <div
        ref={trapRef}
        className="runtime-foundry__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !props.inFlight) props.onCancel();
        }}
      >
        <h3 id={titleId}>{copy.title}</h3>
        <p id={descriptionId}>{copy.description}</p>
        <DigestSummary
          action={props.action}
          releaseDigest={props.releaseDigest}
          currentDigest={props.currentDigest}
        />
        <label className="runtime-foundry__field">
          <span>Operator reason</span>
          <textarea
            autoFocus
            value={note}
            minLength={20}
            maxLength={2_000}
            required
            disabled={props.inFlight}
            onChange={(event) => { setNote(event.target.value); }}
            placeholder="Record the evidence reviewed or the reason for this pointer change."
          />
        </label>
        {props.error !== null ? (
          <p className="runtime-foundry__notice" data-kind="error" role="alert">{props.error}</p>
        ) : null}
        <form className="runtime-foundry__dialog-actions" onSubmit={submit}>
          <button
            type="button"
            className="runtime-foundry__button"
            onClick={props.onCancel}
            disabled={props.inFlight}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`runtime-foundry__button ${copy.danger ? "runtime-foundry__button--danger" : "runtime-foundry__button--primary"}`}
            disabled={props.inFlight || note.trim().length < 20}
          >
            {props.inFlight ? "Recording…" : copy.confirmLabel}
          </button>
        </form>
      </div>
    </div>
  );
}
