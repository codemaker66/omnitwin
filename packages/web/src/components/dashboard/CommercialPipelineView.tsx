import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import {
  addFollowUpTask,
  addOpportunityActivity,
  createOpportunity,
  createOpportunityFromEnquiry,
  getOpportunity,
  getPipeline,
  updateFollowUpTaskStatus,
  updateOpportunity,
  type Activity,
  type FollowUpTask,
  type Opportunity,
  type OpportunityDetail,
} from "../../api/crm.js";
import { createProposal, type StaffProposal } from "../../api/proposals.js";
import { parsePoundsToMinor } from "../../lib/money-input.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useToastStore } from "../../stores/toast-store.js";

const STAGES = [
  "new",
  "qualified",
  "proposal_drafting",
  "proposal_sent",
  "negotiation",
  "won",
  "lost",
] as const;

const STAGE_LABELS: Record<string, string> = {
  new: "New",
  qualified: "Qualified",
  proposal_drafting: "Proposal drafting",
  proposal_sent: "Proposal sent",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
  archived: "Archived",
};

const STAGE_NEXT: Record<string, string> = {
  new: "Confirm event basics",
  qualified: "Draft proposal",
  proposal_drafting: "Save proposal version",
  proposal_sent: "Await client response",
  negotiation: "Resolve changes",
  won: "Prepare handoff path",
  lost: "Record outcome",
};

const card: React.CSSProperties = {
  background:
    "linear-gradient(180deg, rgba(20, 27, 28, 0.96), rgba(9, 12, 12, 0.96)), radial-gradient(circle at 90% 0%, rgba(104, 216, 210, 0.1), transparent 34%)",
  border: "1px solid rgba(215, 181, 109, 0.24)",
  borderRadius: 8,
  padding: 16,
  boxShadow: "0 22px 70px rgba(0, 0, 0, 0.3)",
  color: "#f4efe4",
};

const label: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 700,
  color: "#d7b56d",
  marginBottom: 4,
};

const input: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 40,
  border: "1px solid rgba(215, 181, 109, 0.24)",
  borderRadius: 6,
  background: "rgba(255, 247, 232, 0.07)",
  color: "#fff7e8",
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "inherit",
};

const primaryButton: React.CSSProperties = {
  border: "1px solid rgba(255, 224, 154, 0.52)",
  borderRadius: 6,
  background: "linear-gradient(135deg, #d7b56d, #f0cf84)",
  color: "#090807",
  minHeight: 40,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButton: React.CSSProperties = {
  border: "1px solid rgba(215, 181, 109, 0.26)",
  borderRadius: 6,
  background: "rgba(255, 247, 232, 0.07)",
  color: "#f4efe4",
  minHeight: 40,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
}

function formatDateTime(iso: string | null): string {
  if (iso === null) return "No due date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "No due date";
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage.replace(/_/g, " ");
}

interface DetailState {
  readonly opportunity: Opportunity;
  readonly activities: readonly Activity[];
  readonly tasks: readonly FollowUpTask[];
  readonly proposals: readonly StaffProposal[];
}

function toDetailState(detail: OpportunityDetail): DetailState {
  return {
    opportunity: detail.opportunity,
    activities: detail.activities,
    tasks: detail.tasks,
    proposals: detail.proposals,
  };
}

export function CommercialPipelineView(): ReactElement {
  const user = useAuthStore((state) => state.user);
  const addToast = useToastStore((state) => state.addToast);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [tasks, setTasks] = useState<FollowUpTask[]>([]);
  const [selected, setSelected] = useState<DetailState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enquiryId, setEnquiryId] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualValue, setManualValue] = useState("");
  const [activityText, setActivityText] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [enquiryError, setEnquiryError] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    getPipeline()
      .then((summary) => {
        setOpportunities(summary.opportunities);
        setTasks(summary.todayTasks);
        setError(null);
      })
      .catch(() => { setError("Could not load the commercial pipeline. Refresh or try again later."); })
      .finally(() => { setLoading(false); });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const reloadSelected = useCallback((id: string) => {
    setDetailError(null);
    getOpportunity(id)
      .then((detail) => { setSelected(toDetailState(detail)); })
      .catch(() => {
        setSelected(null);
        setDetailError("Could not load that opportunity. Retry from the stage card or refresh the pipeline.");
        addToast("Could not load opportunity detail", "error");
      });
  }, [addToast]);

  const pipelineValue = useMemo(
    () => opportunities.reduce((sum, opportunity) => sum + opportunity.estimatedValueMinor, 0),
    [opportunities],
  );

  const handleFromEnquiry = (): void => {
    if (enquiryId.trim().length === 0 || busy) return;
    setBusy(true);
    setEnquiryError(null);
    createOpportunityFromEnquiry(enquiryId.trim())
      .then((result) => {
        addToast(result.created ? "Opportunity created from enquiry" : "Existing opportunity opened", "success");
        setEnquiryId("");
        refresh();
        reloadSelected(result.opportunity.id);
      })
      .catch(() => {
        setEnquiryError("Could not create an opportunity from that enquiry ID. Check the ID and try again.");
        addToast("Could not create opportunity from that enquiry", "error");
      })
      .finally(() => { setBusy(false); });
  };

  const handleManualCreate = (): void => {
    setManualError(null);
    if (busy) return;
    if (user?.venueId === null || user?.venueId === undefined) {
      setManualError("Your account is not linked to a venue, so manual opportunities cannot be created here.");
      return;
    }
    if (manualTitle.trim().length === 0) return;
    const estimatedValueMinor = manualValue.trim().length === 0 ? 0 : parsePoundsToMinor(manualValue);
    if (estimatedValueMinor === null) {
      setManualError("Estimated value must be a non-negative pounds amount like 1200 or 1200.50.");
      return;
    }
    setBusy(true);
    createOpportunity({
      venueId: user.venueId,
      title: manualTitle.trim(),
      estimatedValueMinor,
      nextAction: "Qualify the enquiry and prepare the first proposal step.",
    })
      .then((result) => {
        addToast("Opportunity created", "success");
        setManualTitle("");
        setManualValue("");
        refresh();
        reloadSelected(result.opportunity.id);
      })
      .catch(() => {
        setManualError("Could not create the opportunity. Check the details and try again.");
        addToast("Could not create opportunity", "error");
      })
      .finally(() => { setBusy(false); });
  };

  const handleStageChange = (stage: string): void => {
    if (selected === null || busy) return;
    setBusy(true);
    setStageError(null);
    updateOpportunity(selected.opportunity.id, { stage, note: `Moved to ${stageLabel(stage)}` })
      .then((updated) => {
        setSelected((current) => current === null ? null : { ...current, opportunity: updated });
        refresh();
      })
      .catch(() => {
        setStageError("Could not update the stage. The opportunity has not moved.");
        addToast("Could not update stage", "error");
      })
      .finally(() => { setBusy(false); });
  };

  const handleAddActivity = (): void => {
    if (selected === null || activityText.trim().length === 0 || busy) return;
    setBusy(true);
    setActivityError(null);
    addOpportunityActivity(selected.opportunity.id, activityText.trim())
      .then((activity) => {
        setSelected((current) => current === null ? null : { ...current, activities: [...current.activities, activity] });
        setActivityText("");
      })
      .catch(() => {
        setActivityError("Could not add the note. The text is still here so you can retry.");
        addToast("Could not add note", "error");
      })
      .finally(() => { setBusy(false); });
  };

  const handleAddTask = (): void => {
    if (selected === null || taskTitle.trim().length === 0 || busy) return;
    setBusy(true);
    setTaskError(null);
    addFollowUpTask(selected.opportunity.id, taskTitle.trim())
      .then((task) => {
        setSelected((current) => current === null ? null : { ...current, tasks: [...current.tasks, task] });
        setTasks((current) => [...current, task]);
        setTaskTitle("");
      })
      .catch(() => {
        setTaskError("Could not add the follow-up task. Retry after checking the title.");
        addToast("Could not add task", "error");
      })
      .finally(() => { setBusy(false); });
  };

  const handleCompleteTask = (task: FollowUpTask): void => {
    if (selected === null || busy) return;
    setBusy(true);
    setTaskError(null);
    updateFollowUpTaskStatus(selected.opportunity.id, task.id, "done")
      .then((updated) => {
        setSelected((current) => current === null
          ? null
          : { ...current, tasks: current.tasks.map((row) => row.id === updated.id ? updated : row) });
        setTasks((current) => current.filter((row) => row.id !== updated.id));
      })
      .catch(() => {
        setTaskError("Could not complete that task. It remains open until the server confirms it.");
        addToast("Could not complete task", "error");
      })
      .finally(() => { setBusy(false); });
  };

  const handleCreateProposal = (): void => {
    if (selected === null || busy) return;
    setBusy(true);
    setProposalError(null);
    createProposal({
      venueId: selected.opportunity.venueId,
      opportunityId: selected.opportunity.id,
      enquiryId: selected.opportunity.sourceEnquiryId,
      title: `${selected.opportunity.title} proposal`,
    })
      .then(async (proposal) => {
        addToast("Proposal draft created", "success");
        setSelected((current) => current === null ? null : { ...current, proposals: [...current.proposals, proposal] });
        // Await the stage auto-advance before releasing `busy`. Returning this
        // promise keeps the outer .finally() (and the busy lock that disables
        // the stage <select>) held until the advance settles, so a manual
        // stage change can't interleave and get clobbered by a late resolve.
        try {
          const updated = await updateOpportunity(selected.opportunity.id, {
            stage: "proposal_drafting",
            note: "Proposal draft created",
          });
          setSelected((current) => current === null ? null : { ...current, opportunity: updated });
          refresh();
        } catch { /* non-critical; proposal still exists */ }
      })
      .catch(() => {
        setProposalError("Could not create the proposal draft. No proposal was added to this opportunity.");
        addToast("Could not create proposal draft", "error");
      })
      .finally(() => { setBusy(false); });
  };

  const stageGroups = STAGES.map((stage) => ({
    stage,
    rows: opportunities.filter((opportunity) => opportunity.stage === stage),
  }));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 20, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <section style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: "#fff7e8" }}>Commercial pipeline</h2>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "rgba(246, 241, 232, 0.68)" }}>
              Enquiries become opportunities, proposals, quotes, and client share links. Planning assumptions stay visible.
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, color: "#d7b56d", fontWeight: 700 }}>Pipeline value</div>
            <div data-testid="pipeline-value" style={{ fontSize: 22, fontWeight: 800, color: "#fff7e8" }}>
              {formatMoney(pipelineValue, "GBP")}
            </div>
          </div>
        </section>

        <section style={{ ...card, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <h3 style={{ margin: "0 0 10px", fontSize: 14 }}>Quick create from enquiry</h3>
            <label style={label} htmlFor="pipeline-enquiry-id">Enquiry ID</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input id="pipeline-enquiry-id" data-testid="pipeline-enquiry-id" style={input} value={enquiryId} onChange={(event) => { setEnquiryId(event.target.value); }} />
              <button
                type="button"
                data-testid="pipeline-enquiry-create"
                style={primaryButton}
                disabled={busy || enquiryId.trim().length === 0}
                onClick={handleFromEnquiry}
              >
                Create
              </button>
            </div>
            {enquiryError !== null && (
              <div role="alert" data-testid="pipeline-enquiry-error" style={{ marginTop: 8, fontSize: 12, color: "#ffb4a2" }}>
                {enquiryError}
              </div>
            )}
          </div>
          <div>
            <h3 style={{ margin: "0 0 10px", fontSize: 14 }}>Manual opportunity</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 8 }}>
              <input aria-label="Opportunity title" data-testid="manual-opportunity-title" style={input} placeholder="Grand Hall gala" value={manualTitle} onChange={(event) => { setManualTitle(event.target.value); }} />
              <input aria-label="Estimated value pounds" data-testid="manual-opportunity-value" style={input} inputMode="decimal" placeholder="£ value" value={manualValue} onChange={(event) => { setManualValue(event.target.value); }} />
              <button type="button" style={primaryButton} disabled={busy || manualTitle.trim().length === 0} onClick={handleManualCreate}>
                Add
              </button>
            </div>
            {manualError !== null && (
              <div role="alert" data-testid="manual-opportunity-error" style={{ marginTop: 8, fontSize: 12, color: "#ffb4a2" }}>
                {manualError}
              </div>
            )}
          </div>
        </section>

        {loading && <section style={card}>Loading pipeline...</section>}
        {error !== null && (
          <section role="alert" style={{ ...card, color: "#ffb4a2" }}>
            <p style={{ margin: "0 0 10px" }}>{error}</p>
            <button type="button" style={secondaryButton} disabled={loading} onClick={refresh}>
              Retry pipeline
            </button>
          </section>
        )}
        {!loading && error === null && opportunities.length === 0 && (
          <section style={card}>
            <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>No opportunities yet</h3>
            <p style={{ margin: 0, fontSize: 13, color: "rgba(246, 241, 232, 0.68)" }}>
              Create one from an enquiry, then build the proposal and quote from the same record.
            </p>
          </section>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(180px, 1fr))", gap: 12 }}>
          {stageGroups.map(({ stage, rows }) => (
            <section key={stage} style={{ ...card, minHeight: 150 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                <h3 style={{ margin: 0, fontSize: 13, textTransform: "uppercase", letterSpacing: 0.4, color: "#d7b56d" }}>
                  {stageLabel(stage)}
                </h3>
                <span style={{ fontSize: 12, color: "rgba(246, 241, 232, 0.68)" }}>{rows.length}</span>
              </div>
              {rows.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: "rgba(246, 241, 232, 0.55)" }}>{STAGE_NEXT[stage]}</p>
              ) : rows.map((opportunity) => (
                <button
                  key={opportunity.id}
                  type="button"
                  data-testid={`opportunity-${opportunity.id}`}
                  onClick={() => { reloadSelected(opportunity.id); }}
                  disabled={busy}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    border: "1px solid rgba(215, 181, 109, 0.18)",
                    borderRadius: 6,
                    background: selected?.opportunity.id === opportunity.id ? "rgba(215, 181, 109, 0.18)" : "rgba(255, 247, 232, 0.07)",
                    padding: 10,
                    marginBottom: 8,
                    cursor: busy ? "wait" : "pointer",
                    opacity: busy ? 0.65 : 1,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#fff7e8" }}>{opportunity.title}</div>
                  <div style={{ fontSize: 12, color: "rgba(246, 241, 232, 0.68)", marginTop: 4 }}>
                    {formatMoney(opportunity.estimatedValueMinor, opportunity.currency)} · {opportunity.guestCount ?? "Guest count pending"} guests
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(246, 241, 232, 0.68)", marginTop: 6 }}>{opportunity.nextAction}</div>
                </button>
              ))}
            </section>
          ))}
        </div>
      </div>

      <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <section style={card}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Today's follow-ups</h3>
          {tasks.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: "rgba(246, 241, 232, 0.68)" }}>No open follow-ups loaded.</p>
          ) : tasks.map((task) => (
            <div key={task.id} style={{ borderTop: "1px solid rgba(215, 181, 109, 0.14)", padding: "10px 0" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff7e8" }}>{task.title}</div>
              <div style={{ fontSize: 12, color: "rgba(246, 241, 232, 0.68)", marginTop: 2 }}>{formatDateTime(task.dueAt)}</div>
            </div>
          ))}
        </section>

        {selected === null ? (
          <section style={card}>
            <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>Select an opportunity</h3>
            {detailError !== null && (
              <div role="alert" data-testid="opportunity-detail-error" style={{ marginBottom: 10, fontSize: 13, color: "#ffb4a2" }}>
                {detailError}
              </div>
            )}
            <p style={{ margin: 0, fontSize: 13, color: "rgba(246, 241, 232, 0.68)" }}>
              The detail panel shows next action, proposal status, follow-ups, and client-safe notes.
            </p>
          </section>
        ) : (
          <section style={card} aria-label="Opportunity detail">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, color: "#fff7e8" }}>{selected.opportunity.title}</h3>
                <div style={{ fontSize: 12, color: "rgba(246, 241, 232, 0.68)", marginTop: 4 }}>
                  {formatMoney(selected.opportunity.estimatedValueMinor, selected.opportunity.currency)}
                </div>
              </div>
              <select
                aria-label="Opportunity stage"
                data-testid="opportunity-stage"
                style={{ ...input, width: 150 }}
                value={selected.opportunity.stage}
                disabled={busy}
                onChange={(event) => { handleStageChange(event.target.value); }}
              >
                {STAGES.map((stage) => <option key={stage} value={stage}>{stageLabel(stage)}</option>)}
              </select>
            </div>
            {stageError !== null && (
              <div role="alert" data-testid="opportunity-stage-error" style={{ marginTop: 10, fontSize: 13, color: "#ffb4a2" }}>
                {stageError}
              </div>
            )}

            <div style={{ marginTop: 14, padding: 12, background: "rgba(215, 181, 109, 0.08)", border: "1px solid rgba(215, 181, 109, 0.18)", borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#d7b56d" }}>Next action</div>
              <div style={{ fontSize: 13, color: "#fff7e8", marginTop: 4 }}>{selected.opportunity.nextAction}</div>
            </div>

            <button type="button" style={{ ...primaryButton, width: "100%", marginTop: 14 }} disabled={busy} onClick={handleCreateProposal}>
              Create proposal draft
            </button>
            {proposalError !== null && (
              <div role="alert" data-testid="opportunity-proposal-error" style={{ marginTop: 8, fontSize: 13, color: "#ffb4a2" }}>
                {proposalError}
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Proposal status</h4>
              {selected.proposals.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: "rgba(246, 241, 232, 0.68)" }}>No proposal draft yet.</p>
              ) : selected.proposals.map((proposal) => (
                <div key={proposal.id} style={{ fontSize: 12, padding: "6px 0", borderTop: "1px solid rgba(215, 181, 109, 0.14)" }}>
                  <strong>{proposal.title}</strong> · {proposal.status.replace(/_/g, " ")}
                </div>
              ))}
            </div>

            <div style={{ marginTop: 16 }}>
              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Tasks</h4>
              {taskError !== null && (
                <div role="alert" data-testid="opportunity-task-error" style={{ marginBottom: 8, fontSize: 12, color: "#ffb4a2" }}>
                  {taskError}
                </div>
              )}
              {selected.tasks.length === 0 && <p style={{ margin: 0, fontSize: 12, color: "rgba(246, 241, 232, 0.68)" }}>No tasks on this opportunity.</p>}
              {selected.tasks.map((task) => (
                <div key={task.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", borderTop: "1px solid rgba(215, 181, 109, 0.14)", padding: "7px 0" }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{task.title}</div>
                    <div style={{ fontSize: 12, color: "rgba(246, 241, 232, 0.68)" }}>{task.status} · {formatDateTime(task.dueAt)}</div>
                  </div>
                  {task.status === "open" && (
                    <button type="button" style={{ ...secondaryButton, padding: "5px 8px", fontSize: 12 }} disabled={busy} onClick={() => { handleCompleteTask(task); }}>
                      Done
                    </button>
                  )}
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input aria-label="New task title" style={input} value={taskTitle} onChange={(event) => { setTaskTitle(event.target.value); }} />
                <button
                  type="button"
                  data-testid="opportunity-task-add"
                  style={secondaryButton}
                  disabled={busy || taskTitle.trim().length === 0}
                  onClick={handleAddTask}
                >
                  Add
                </button>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Activity</h4>
              {activityError !== null && (
                <div role="alert" data-testid="opportunity-activity-error" style={{ marginBottom: 8, fontSize: 12, color: "#ffb4a2" }}>
                  {activityError}
                </div>
              )}
              {selected.activities.length === 0 && <p style={{ margin: 0, fontSize: 12, color: "rgba(246, 241, 232, 0.68)" }}>No notes yet.</p>}
              {selected.activities.slice(-4).map((activity) => (
                <div key={activity.id} style={{ borderTop: "1px solid rgba(215, 181, 109, 0.14)", padding: "7px 0", fontSize: 12, color: "rgba(246, 241, 232, 0.82)" }}>
                  {activity.body}
                </div>
              ))}
              <textarea
                aria-label="Activity note"
                style={{ ...input, resize: "vertical", marginTop: 8 }}
                rows={3}
                value={activityText}
                onChange={(event) => { setActivityText(event.target.value); }}
              />
              <button type="button" style={{ ...secondaryButton, marginTop: 8 }} disabled={busy || activityText.trim().length === 0} onClick={handleAddActivity}>
                Add note
              </button>
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}
