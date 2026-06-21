import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import { AlertCircle, ClipboardCheck, FileText, Printer, RefreshCw, Truck } from "lucide-react";
import type { OpsHandoffPackBundle, OpsTask, TaskGroup } from "@omnitwin/types";
import { getOpsHandoffPack } from "../api/ops-handoff.js";
import { AIDraftPanel } from "../components/ai/AIDraftPanel.js";
import "./OpsHandoffPage.css";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly bundle: OpsHandoffPackBundle };

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function groupTasks(groups: readonly TaskGroup[], tasks: readonly OpsTask[]): readonly {
  readonly group: TaskGroup;
  readonly tasks: readonly OpsTask[];
}[] {
  return groups.map((group) => ({
    group,
    tasks: tasks.filter((task) => task.taskGroupId === group.id),
  }));
}

function Metric(props: { readonly label: string; readonly value: string | number }): ReactElement {
  return (
    <div className="ops-handoff-metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function EmptyState(props: { readonly children: string }): ReactElement {
  return <p className="ops-handoff-empty">{props.children}</p>;
}

export function OpsHandoffPage(): ReactElement {
  const { handoffPackId } = useParams<{ handoffPackId: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const loadPack = useCallback(() => {
    if (handoffPackId === undefined || handoffPackId.length === 0) {
      setState({ kind: "error", message: "The handoff pack link is missing an ID." });
      return;
    }
    setState({ kind: "loading" });
    getOpsHandoffPack(handoffPackId)
      .then((bundle) => { setState({ kind: "ready", bundle }); })
      .catch(() => {
        setState({
          kind: "error",
          message: "This handoff pack could not be loaded. Check the link or compile it again from an approved snapshot.",
        });
      });
  }, [handoffPackId]);

  useEffect(() => {
    let cancelled = false;
    if (handoffPackId === undefined || handoffPackId.length === 0) {
      setState({ kind: "error", message: "The handoff pack link is missing an ID." });
      return;
    }
    setState({ kind: "loading" });
    getOpsHandoffPack(handoffPackId)
      .then((bundle) => {
        if (!cancelled) setState({ kind: "ready", bundle });
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: "This handoff pack could not be loaded. Check the link or compile it again from an approved snapshot.",
          });
        }
      });
    return () => { cancelled = true; };
  }, [handoffPackId]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const readyBundle = state.kind === "ready" ? state.bundle : null;
  const taskGroups = useMemo(
    () => readyBundle === null ? [] : groupTasks(readyBundle.taskGroups, readyBundle.opsTasks),
    [readyBundle],
  );
  const setupTasks = taskGroups.find((entry) => entry.group.kind === "setup")?.tasks ?? [];
  const breakdownTasks = taskGroups.find((entry) => entry.group.kind === "breakdown")?.tasks ?? [];
  const roomFlipTasks = taskGroups.find((entry) => entry.group.kind === "room_flip")?.tasks ?? [];
  const supplierTasks = taskGroups.find((entry) => entry.group.kind === "supplier")?.tasks ?? [];

  if (state.kind === "loading") {
    return (
      <main className="ops-handoff-page ops-handoff-centered" aria-label="Operations handoff loading">
        <RefreshCw aria-hidden="true" className="ops-handoff-spin" />
        <h1>Loading handoff pack</h1>
        <p>Preparing the latest compiled operations view.</p>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="ops-handoff-page ops-handoff-centered" aria-label="Operations handoff unavailable">
        <AlertCircle aria-hidden="true" />
        <h1>Handoff pack unavailable</h1>
        <p>{state.message}</p>
        <button type="button" onClick={loadPack} className="ops-handoff-secondary">
          <RefreshCw aria-hidden="true" />
          Retry
        </button>
      </main>
    );
  }

  const { bundle } = state;

  return (
    <main className="ops-handoff-page" aria-label="Operations handoff pack">
      <header className="ops-handoff-hero">
        <div>
          <p className="ops-handoff-kicker">Internal operations handoff</p>
          <h1>Ops handoff pack</h1>
          <p>{bundle.pack.summary}</p>
        </div>
        <button type="button" onClick={handlePrint} className="ops-handoff-primary">
          <Printer aria-hidden="true" />
          Print / export
        </button>
      </header>

      <section className="ops-handoff-metrics" aria-label="Handoff overview">
        <Metric label="Snapshot" value={`v${String(bundle.pack.version)}`} />
        <Metric label="Pick lines" value={bundle.pickListItems.length} />
        <Metric label="Tasks" value={bundle.opsTasks.length} />
        <Metric label="Supplier notes" value={bundle.supplierInstructions.length} />
        <Metric label="Compiled" value={formatDateTime(bundle.pack.compiledAt)} />
      </section>

      <section className="ops-handoff-section">
        <div className="ops-handoff-section-head">
          <ClipboardCheck aria-hidden="true" />
          <div>
            <h2>Pick list</h2>
            <p>{bundle.furniturePickList.totalItems} total item(s) from the approved snapshot.</p>
          </div>
        </div>
        {bundle.pickListItems.length === 0 ? (
          <EmptyState>No pick-list rows were captured in this handoff pack.</EmptyState>
        ) : (
          <div className="ops-handoff-table" role="table" aria-label="Furniture pick list">
            <div className="ops-handoff-row ops-handoff-row-head" role="row">
              <span role="columnheader">Item</span>
              <span role="columnheader">Category</span>
              <span role="columnheader">Qty</span>
            </div>
            {bundle.pickListItems.map((item) => (
              <div className="ops-handoff-row" role="row" key={item.id}>
                <span role="cell">{item.name}</span>
                <span role="cell">{item.category}</span>
                <span role="cell">{item.quantity}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="ops-handoff-section">
        <div className="ops-handoff-section-head">
          <ClipboardCheck aria-hidden="true" />
          <div>
            <h2>Setup tasks</h2>
            <p>Checklist generated from the frozen hallkeeper snapshot.</p>
          </div>
        </div>
        {setupTasks.length === 0 ? (
          <EmptyState>No setup rows were captured in this handoff pack.</EmptyState>
        ) : (
          <ol className="ops-handoff-task-list">
            {setupTasks.map((task) => (
              <li key={task.id}>
                <strong>{task.title}</strong>
                <span>{task.detail}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="ops-handoff-section">
        <div className="ops-handoff-section-head">
          <RefreshCw aria-hidden="true" />
          <div>
            <h2>Room flip tasks</h2>
            <p>Planning handoff only; event-day live execution is separate.</p>
          </div>
        </div>
        {roomFlipTasks.length === 0 && bundle.roomFlipPlans.length === 0 ? (
          <EmptyState>No room flip phase is linked to this handoff pack.</EmptyState>
        ) : (
          <ol className="ops-handoff-task-list">
            {roomFlipTasks.map((task) => (
              <li key={task.id}>
                <strong>{task.title}</strong>
                <span>{task.detail}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="ops-handoff-section">
        <div className="ops-handoff-section-head">
          <Truck aria-hidden="true" />
          <div>
            <h2>Supplier notes</h2>
            <p>Internal dispatch notes derived from snapshot quantities and event notes.</p>
          </div>
        </div>
        <div className="ops-handoff-note-grid">
          {bundle.supplierInstructions.map((instruction) => (
            <article key={instruction.id} className="ops-handoff-note">
              <span>{instruction.category}</span>
              <h3>{instruction.title}</h3>
              <p>{instruction.detail}</p>
            </article>
          ))}
        </div>
        {supplierTasks.length > 0 && (
          <p className="ops-handoff-small">{supplierTasks.length} supplier task(s) are included in the checklist.</p>
        )}
      </section>

      <section className="ops-handoff-section">
        <div className="ops-handoff-section-head">
          <FileText aria-hidden="true" />
          <div>
            <h2>What changed</h2>
            <p>{bundle.snapshotDiff.summary}</p>
          </div>
        </div>
        <div className="ops-handoff-diff">
          <div>
            <h3>Added</h3>
            {bundle.snapshotDiff.payload.added.length === 0 ? (
              <EmptyState>No added pick-list rows.</EmptyState>
            ) : (
              <ul>{bundle.snapshotDiff.payload.added.map((item) => <li key={item}>{item}</li>)}</ul>
            )}
          </div>
          <div>
            <h3>Removed</h3>
            {bundle.snapshotDiff.payload.removed.length === 0 ? (
              <EmptyState>No removed pick-list rows.</EmptyState>
            ) : (
              <ul>{bundle.snapshotDiff.payload.removed.map((item) => <li key={item}>{item}</li>)}</ul>
            )}
          </div>
          <div>
            <h3>Changed</h3>
            {bundle.snapshotDiff.payload.changed.length === 0 ? (
              <EmptyState>No changed pick-list rows.</EmptyState>
            ) : (
              <ul>{bundle.snapshotDiff.payload.changed.map((item) => <li key={item}>{item}</li>)}</ul>
            )}
          </div>
        </div>
      </section>

      <section className="ops-handoff-section">
        <div className="ops-handoff-section-head">
          <FileText aria-hidden="true" />
          <div>
            <h2>BEO internal handoff</h2>
            <p>Generated from the approved snapshot for staff review.</p>
          </div>
        </div>
        <div className="ops-handoff-ai-draft">
          <AIDraftPanel
            title="AI BEO / supplier draft"
            useCase="beo_supplier_instruction_draft"
            actionLabel="Draft handoff wording"
            context={{
              handoffPackId: bundle.pack.id,
              summary: bundle.pack.summary,
              version: bundle.pack.version,
              pickListItems: bundle.pickListItems.length,
              setupTasks: setupTasks.length,
              roomFlipTasks: roomFlipTasks.length,
              supplierInstructions: bundle.supplierInstructions.map((instruction) => instruction.title),
              snapshotDiff: bundle.snapshotDiff.summary,
            }}
          />
        </div>
        <pre className="ops-handoff-beo">{bundle.beoDocument.body}</pre>
      </section>

      <section className="ops-handoff-section ops-handoff-sequences">
        <div>
          <h2>Load-in sequence</h2>
          <ol>
            {bundle.loadInSequence.map((step) => (
              <li key={step.id}>
                <strong>{step.title}</strong>
                <span>{step.detail}</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h2>Breakdown sequence</h2>
          <ol>
            {bundle.breakdownSequence.map((step) => (
              <li key={step.id}>
                <strong>{step.title}</strong>
                <span>{step.detail}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {breakdownTasks.length > 0 && (
        <section className="ops-handoff-section">
          <div className="ops-handoff-section-head">
            <ClipboardCheck aria-hidden="true" />
            <div>
              <h2>Breakdown tasks</h2>
              <p>Pack-down checklist from approved snapshot totals.</p>
            </div>
          </div>
          <ol className="ops-handoff-task-list">
            {breakdownTasks.map((task) => (
              <li key={task.id}>
                <strong>{task.title}</strong>
                <span>{task.detail}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
