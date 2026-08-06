import { Check, CircleAlert, Clock3, Cpu, ShieldCheck } from "lucide-react";
import type { ReconstructionReleaseListItem } from "@omnitwin/types";
import type { ReactElement } from "react";

function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const;
  if (bytes === 0) return "0 B";
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

function stateLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function stateTone(item: ReconstructionReleaseListItem): string {
  if (item.active) return "current";
  if (item.state === "rejected" || item.state === "machine_qa_failed") return "failed";
  if (item.published || item.state === "ready_to_publish") return "passed";
  if (item.qaOutcome === "passed") return "machine";
  return "review";
}

function StateIcon(props: { readonly item: ReconstructionReleaseListItem }): ReactElement {
  if (props.item.active) return <Check aria-hidden="true" />;
  if (props.item.state === "rejected" || props.item.state === "machine_qa_failed") {
    return <CircleAlert aria-hidden="true" />;
  }
  if (props.item.qaOutcome === "passed") return <ShieldCheck aria-hidden="true" />;
  return <Clock3 aria-hidden="true" />;
}

export function FoundryReleaseLedger(props: {
  readonly releases: readonly ReconstructionReleaseListItem[];
  readonly selectedReleaseId: string | null;
  readonly onSelect: (releaseId: string) => void;
}): ReactElement {
  return (
    <section className="runtime-foundry__panel" aria-labelledby="foundry-release-ledger-title">
      <header className="runtime-foundry__panel-heading">
        <h3 id="foundry-release-ledger-title">Immutable releases</h3>
        <span>{props.releases.length} recorded</span>
      </header>
      {props.releases.length === 0 ? (
        <div className="runtime-foundry__empty">
          <h3>No releases recorded</h3>
          <p>Register a verified candidate bundle before review, publication or production promotion can begin.</p>
        </div>
      ) : (
        <div
          className="runtime-foundry__table-scroll"
          role="region"
          aria-label="Reconstruction release ledger"
          tabIndex={0}
        >
          <table className="runtime-foundry__table">
            <caption>Immutable reconstruction releases for the selected venue</caption>
            <thead>
              <tr>
                <th scope="col">Release</th>
                <th scope="col">State</th>
                <th scope="col">QA</th>
                <th scope="col">Bundle</th>
                <th scope="col">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {props.releases.map((release) => (
                <tr
                  key={release.id}
                  data-current={release.active}
                  data-selected={release.id === props.selectedReleaseId}
                >
                  <td>
                    <button
                      type="button"
                      className="runtime-foundry__release-button runtime-foundry__mono"
                      aria-label={`Open release ${release.releaseDigest}`}
                      aria-current={release.id === props.selectedReleaseId ? "true" : undefined}
                      onClick={() => { props.onSelect(release.id); }}
                    >
                      {release.releaseDigest.slice(0, 12)}
                    </button>
                  </td>
                  <td>
                    <span className="runtime-foundry__chip" data-tone={stateTone(release)}>
                      <StateIcon item={release} />
                      {release.active ? "Current" : stateLabel(release.state)}
                    </span>
                  </td>
                  <td>
                    <span className="runtime-foundry__chip" data-tone={release.qaOutcome === "passed" ? "passed" : "failed"}>
                      <Cpu aria-hidden="true" />
                      {release.qaOutcome}
                    </span>
                  </td>
                  <td className="runtime-foundry__mono">
                    {release.fileCount} files · {formatBytes(release.totalBytes)}
                  </td>
                  <td>{formatDate(release.registeredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
