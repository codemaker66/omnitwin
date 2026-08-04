import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleAlert,
  CircleDollarSign,
  DraftingCompass,
  LoaderCircle,
  RotateCcw,
  Ruler,
  Sparkles,
  Users,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import type {
  EventArchitectCandidate,
  EventArchitectCandidateSelection,
  EventArchitectRepairHint,
  LayoutValidatorWitness,
  PersistedEventArchitectRun,
} from "@omnitwin/types";
import {
  createEventArchitectRun,
  getEventArchitectRun,
  selectEventArchitectCandidate,
} from "../api/event-architect.js";
import { getVenue, listVenues, type Space, type Venue } from "../api/spaces.js";
import { EventArchitectOpsReviewPanel } from "../components/event-architect/EventArchitectOpsReviewPanel.js";
import { useAuthStore } from "../stores/auth-store.js";
import "./EventArchitectPage.css";

interface FormDraft {
  readonly venueId: string;
  readonly spaceId: string;
  readonly eventName: string;
  readonly eventType: string;
  readonly guestCount: string;
  readonly layoutStyle: "dinner-rounds" | "theatre";
  readonly budgetPounds: string;
  readonly preferredDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly serviceModel: "none" | "plated" | "buffet" | "reception";
  readonly stepFreeRoute: boolean;
  readonly wheelchairSpaces: boolean;
  readonly hearingLoop: boolean;
  readonly planningPrompt: string;
}

type WorkspaceState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly venues: readonly Venue[];
      readonly spaces: readonly Space[];
    };

type RunLoadState = "idle" | "loading" | "error" | "ready";

const EMPTY_FORM: FormDraft = {
  venueId: "",
  spaceId: "",
  eventName: "",
  eventType: "dinner",
  guestCount: "80",
  layoutStyle: "dinner-rounds",
  budgetPounds: "",
  preferredDate: "",
  startTime: "",
  endTime: "",
  serviceModel: "plated",
  stepFreeRoute: false,
  wheelchairSpaces: false,
  hearingLoop: false,
  planningPrompt: "",
};

const MONEY = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
});
const GBP_INPUT = /^\d+(?:\.\d{1,2})?$/u;

const STRATEGY_LABELS = {
  comfort_first: "Comfort first",
  balanced: "Balanced",
  capacity_first: "Capacity first",
} as const;

const RULE_LABELS: Readonly<Record<string, string>> = {
  "layout.snapshot_identity": "Snapshot identity",
  "layout.footprint_containment": "Room containment",
  "layout.seating_provision": "Seating provision",
  "layout.primary_furniture_clearance": "Primary furniture clearance",
  "layout.budget": "Budget comparison",
};

const STATUS_LABELS: Readonly<Record<string, string>> = {
  pass: "Pass",
  warn: "Near threshold",
  fail: "Needs change",
  not_checked: "Not checked",
  inapplicable: "Not applicable",
  requires_human_review: "Human review",
  stale: "Stale",
};

function idempotencyKey(scope: string): string {
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `event-architect:${scope}:${suffix}`.slice(0, 160);
}

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function poundsToMinor(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!GBP_INPUT.test(trimmed)) return null;
  const pounds = Number(trimmed);
  if (!Number.isFinite(pounds) || pounds < 0) return null;
  const minor = Math.round(pounds * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}

function numberFact(witness: LayoutValidatorWitness, key: string): number | null {
  const value = witness.facts[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanFact(witness: LayoutValidatorWitness, key: string): boolean | null {
  const value = witness.facts[key];
  return typeof value === "boolean" ? value : null;
}

function formatMetres(value: number | null): string {
  return value === null ? "not available" : `${value.toFixed(2)} m`;
}

function witnessFactText(witness: LayoutValidatorWitness): string {
  switch (witness.ruleId) {
    case "layout.snapshot_identity": {
      const policyMatches = booleanFact(witness, "policyMatches");
      const objectCount = numberFact(witness, "objectCount");
      return `${String(objectCount ?? 0)} objects recorded; policy reference ${policyMatches === true ? "matches" : "does not match"} this snapshot.`;
    }
    case "layout.footprint_containment": {
      const checked = numberFact(witness, "checkedObjectCount") ?? 0;
      const outside = numberFact(witness, "outsideObjectCount") ?? 0;
      return `${String(checked)} conservative footprints checked; ${String(outside)} extend beyond the recorded room outline.`;
    }
    case "layout.seating_provision": {
      const guests = numberFact(witness, "guestCount") ?? 0;
      const seats = numberFact(witness, "seatsProvided") ?? 0;
      const deficit = numberFact(witness, "deficit") ?? 0;
      return `${String(seats)} seats represented for ${String(guests)} guests; ${String(deficit)} additional seats needed.`;
    }
    case "layout.primary_furniture_clearance": {
      const measured = numberFact(witness, "measuredM");
      const required = numberFact(witness, "requiredM");
      if (measured === null || required === null) {
        return `${String(numberFact(witness, "primaryObjectCount") ?? 0)} primary furniture objects; no pair comparison needed.`;
      }
      return `Closest recorded gap ${formatMetres(measured)}; planning threshold ${formatMetres(required)}.`;
    }
    case "layout.budget": {
      const projected = numberFact(witness, "projectedTotalMinor");
      const limit = numberFact(witness, "budgetLimitMinor");
      if (projected === null) return "No complete price-book input was available for this comparison.";
      if (limit === null) return `Projected planning total ${MONEY.format(projected / 100)}; no budget limit supplied.`;
      return `Projected planning total ${MONEY.format(projected / 100)} against ${MONEY.format(limit / 100)} budget.`;
    }
  }
}

function reviewGateText(witness: LayoutValidatorWitness): string | null {
  const gate = witness.reviewGate;
  if (gate === null) return null;
  switch (gate.reason) {
    case "missing_required_data": return "Required source data is missing before this result can be exported.";
    case "near_threshold": return "A venue reviewer should inspect this near-threshold result.";
    case "venue_policy_requires_review": return "The venue policy reference needs review before this snapshot is used.";
    default: return "This planning result has an open human-review gate.";
  }
}

function repairHintText(hint: EventArchitectRepairHint): string {
  switch (hint.action) {
    case "add_seating": return `Add space for ${String(hint.quantity ?? 1)} more guest seat${hint.quantity === 1 ? "" : "s"}.`;
    case "move_inside_room": return `Move ${String(hint.affectedObjectIds.length)} object${hint.affectedObjectIds.length === 1 ? "" : "s"} inside the recorded outline.`;
    case "increase_clearance": return `Increase the closest gap by at least ${formatMetres(hint.amountM)}.`;
    case "reduce_budget_scope": return `Reduce the planning total by at least ${MONEY.format((hint.amountMinor ?? 0) / 100)}.`;
    case "supply_pricing_data": return "Supply the missing price-book entries before comparing this option with a budget.";
  }
}

function candidateBounds(candidate: EventArchitectCandidate): {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
} {
  const outline = candidate.snapshot.venueRuntime.floorPlanOutline;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of outline) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const padding = Math.max(0.5, Math.max(maxX - minX, maxY - minY) * 0.04);
  return {
    minX: minX - padding,
    minY: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

function CandidatePlan(props: { readonly candidate: EventArchitectCandidate }): ReactElement {
  const { candidate } = props;
  const bounds = candidateBounds(candidate);
  const titleId = `event-architect-plan-${candidate.candidateId}`;
  const outlinePoints = candidate.snapshot.venueRuntime.floorPlanOutline
    .map((point) => `${String(point.x)},${String(point.y)}`)
    .join(" ");
  return (
    <svg
      className="event-architect-plan"
      viewBox={[bounds.minX, bounds.minY, bounds.width, bounds.height].join(" ")}
      role="img"
      aria-labelledby={titleId}
      preserveAspectRatio="xMidYMid meet"
    >
      <title id={titleId}>{STRATEGY_LABELS[candidate.strategy]} top-down snapshot plan</title>
      <polygon className="event-architect-plan-room" points={outlinePoints} />
      {candidate.snapshot.objects.map((object) => {
        const width = object.assetDefinition.widthM * object.scale;
        const depth = object.assetDefinition.depthM * object.scale;
        const degrees = object.rotation.y * (180 / Math.PI);
        const className = `event-architect-plan-object event-architect-plan-object--${object.assetDefinition.category}`;
        return object.assetDefinition.collisionType === "cylinder" ? (
          <ellipse
            key={object.objectId}
            className={className}
            cx={object.position.x}
            cy={object.position.z}
            rx={width / 2}
            ry={depth / 2}
            transform={`rotate(${[degrees, object.position.x, object.position.z].join(" ")})`}
          />
        ) : (
          <rect
            key={object.objectId}
            className={className}
            x={object.position.x - width / 2}
            y={object.position.z - depth / 2}
            width={width}
            height={depth}
            rx={0.04}
            transform={`rotate(${[degrees, object.position.x, object.position.z].join(" ")})`}
          />
        );
      })}
    </svg>
  );
}

function WitnessList(props: { readonly candidate: EventArchitectCandidate }): ReactElement {
  return (
    <div className="event-architect-witnesses">
      <h3>Replayable snapshot facts</h3>
      <ul>
        {props.candidate.validation.witnesses.map((witness) => {
          const gateText = reviewGateText(witness);
          return (
            <li key={witness.witnessId} className={`event-architect-witness event-architect-witness--${witness.status}`}>
              <div className="event-architect-witness-title">
                <strong>{RULE_LABELS[witness.ruleId] ?? "Planning check"}</strong>
                <span>{STATUS_LABELS[witness.status] ?? "Recorded"}</span>
              </div>
              <p>{witnessFactText(witness)}</p>
              {gateText === null ? null : (
                <p className="event-architect-review-gate">
                  <CircleAlert aria-hidden="true" />
                  <span><strong>Review gate:</strong> {gateText}</span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GuestFlowEvidencePanel(props: { readonly candidate: EventArchitectCandidate }): ReactElement {
  const flow = props.candidate.guestFlowEvidence;
  return (
    <section
      className="event-architect-flow"
      aria-label={`${STRATEGY_LABELS[props.candidate.strategy]} simulated guest flow evidence`}
    >
      <div className="event-architect-flow-head">
        <Users aria-hidden="true" />
        <div><h3>Simulated guest flow</h3><span>Replay artifact {flow.artifactHash.slice(0, 10)}</span></div>
      </div>
      <dl>
        <div><dt>Agents</dt><dd>{flow.metrics.agentCount}</dd></div>
        <div><dt>Max density</dt><dd>{flow.metrics.maxDensity.toFixed(2)} p/m²</dd></div>
        <div><dt>Bottleneck</dt><dd>{Math.round(flow.metrics.bottleneckScore * 100)}%</dd></div>
        <div><dt>Route markers</dt><dd>{flow.metrics.routeConflictCount}</dd></div>
      </dl>
      <p>{flow.disclosureLabel}. Door positions and the arrival window are recorded planning assumptions.</p>
      <p className="event-architect-flow-gate">
        <CircleAlert aria-hidden="true" />
        <span><strong>Ops handoff gate:</strong> surveyed doors, a reviewed route model, venue sign-off, configuration approval, and event binding are still required.</span>
      </p>
    </section>
  );
}

function CandidateCard(props: {
  readonly candidate: EventArchitectCandidate;
  readonly selectedCandidateId: string | null;
  readonly selectingCandidateId: string | null;
  readonly selectionLocked: boolean;
  readonly onSelect: (candidate: EventArchitectCandidate) => void;
}): ReactElement {
  const candidate = props.candidate;
  const isSelected = props.selectedCandidateId === candidate.candidateId;
  const isSelecting = props.selectingCandidateId === candidate.candidateId;
  const cost = candidate.projectedCost;
  const openGates = candidate.validation.witnesses.filter((witness) => witness.reviewGate !== null).length + 1;
  return (
    <article className={`event-architect-candidate${isSelected ? " event-architect-candidate--selected" : ""}`}>
      <header className="event-architect-candidate-head">
        <div>
          <p>Option {candidate.rank}</p>
          <h2>{STRATEGY_LABELS[candidate.strategy]}</h2>
        </div>
        {isSelected ? <span className="event-architect-selected-chip"><Check aria-hidden="true" /> Selected</span> : null}
      </header>

      <CandidatePlan candidate={candidate} />

      <dl className="event-architect-candidate-metrics">
        <div><dt>Objects</dt><dd>{candidate.snapshot.objects.length}</dd></div>
        <div><dt>Plan facts needing change</dt><dd>{candidate.validation.summary.fail}</dd></div>
        <div><dt>Open review gates</dt><dd>{openGates}</dd></div>
        <div><dt>Planning total</dt><dd>{cost === null ? "Not checked" : MONEY.format(cost.totalMinor / 100)}</dd></div>
      </dl>

      <div className="event-architect-strategy-facts" aria-label={`${STRATEGY_LABELS[candidate.strategy]} spacing inputs`}>
        <span><Ruler aria-hidden="true" /> {candidate.strategyParameters.primaryAisleM.toFixed(2)} m central aisle input</span>
        <span>{candidate.strategyParameters.minWallOffsetM.toFixed(2)} m wall offset input</span>
      </div>

      <WitnessList candidate={candidate} />

      <GuestFlowEvidencePanel candidate={candidate} />

      <div className="event-architect-repairs">
        <h3>Suggested next edits</h3>
        {candidate.repairHints.length === 0 ? (
          <p>No deterministic repair hints were produced for the checks above.</p>
        ) : (
          <ul>{candidate.repairHints.map((hint) => <li key={hint.hintId}>{repairHintText(hint)}</li>)}</ul>
        )}
      </div>

      <button
        type="button"
        className="event-architect-select"
        disabled={props.selectionLocked || props.selectingCandidateId !== null}
        onClick={() => { props.onSelect(candidate); }}
        aria-label={isSelected ? `${STRATEGY_LABELS[candidate.strategy]} selected` : `Select ${STRATEGY_LABELS[candidate.strategy]}`}
      >
        {isSelecting ? <LoaderCircle aria-hidden="true" className="event-architect-spin" /> : isSelected ? <Check aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
        {isSelecting ? "Saving exact snapshot" : isSelected ? "Selected" : "Use this layout"}
      </button>
    </article>
  );
}

export function EventArchitectPage(): ReactElement {
  const { runId } = useParams<{ runId?: string }>();
  const user = useAuthStore((state) => state.user);
  const [draft, setDraft] = useState<FormDraft>(EMPTY_FORM);
  const [workspace, setWorkspace] = useState<WorkspaceState>({ kind: "loading" });
  const [persisted, setPersisted] = useState<PersistedEventArchitectRun | null>(null);
  const [runLoadState, setRunLoadState] = useState<RunLoadState>(runId === undefined ? "idle" : "loading");
  const [runError, setRunError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selection, setSelection] = useState<EventArchitectCandidateSelection | null>(null);
  const [selectingCandidateId, setSelectingCandidateId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const createKeyRef = useRef<{ readonly fingerprint: string; readonly key: string } | null>(null);
  const selectionKeysRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setWorkspace({ kind: "loading" });
    const workspacePromise = user?.venueId === null || user?.venueId === undefined
      ? listVenues().then(async (venues) => {
          const first = venues[0];
          if (first === undefined) return { venues, spaces: [] };
          const detail = await getVenue(first.id);
          return { venues, spaces: detail.spaces };
        })
      : getVenue(user.venueId).then((venue) => ({ venues: [venue], spaces: venue.spaces }));

    void workspacePromise.then(({ venues, spaces }) => {
      if (cancelled) return;
      const firstVenue = venues[0];
      const firstSpace = spaces[0];
      setDraft((current) => ({
        ...current,
        venueId: firstVenue?.id ?? "",
        spaceId: firstSpace?.id ?? "",
      }));
      setWorkspace({ kind: "ready", venues, spaces });
    }).catch(() => {
      if (!cancelled) setWorkspace({ kind: "error", message: "Venue and room options could not be loaded." });
    });
    return () => { cancelled = true; };
  }, [user?.venueId]);

  useEffect(() => {
    if (runId === undefined || runId.length === 0) return;
    const controller = new AbortController();
    setRunLoadState("loading");
    setRunError(null);
    void getEventArchitectRun(runId, controller.signal).then((result) => {
      setPersisted(result);
      setRunLoadState("ready");
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setRunLoadState("error");
      setRunError("This Event Architect run could not be loaded. Check the link or create a new comparison.");
    });
    return () => { controller.abort(); };
  }, [runId]);

  const changeVenue = useCallback((venueId: string) => {
    setDraft((current) => ({ ...current, venueId, spaceId: "" }));
    if (workspace.kind !== "ready") return;
    setWorkspace({ kind: "loading" });
    void getVenue(venueId).then((venue) => {
      setDraft((current) => ({ ...current, spaceId: venue.spaces[0]?.id ?? "" }));
      setWorkspace({ kind: "ready", venues: workspace.venues, spaces: venue.spaces });
    }).catch(() => {
      setWorkspace({ kind: "error", message: "Rooms for that venue could not be loaded." });
    });
  }, [workspace]);

  const submit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (workspace.kind !== "ready" || draft.venueId.length === 0 || draft.spaceId.length === 0) {
      setRunError("Choose an available venue and room before generating options.");
      return;
    }
    const guestCount = Number.parseInt(draft.guestCount, 10);
    const budgetLimitMinor = poundsToMinor(draft.budgetPounds);
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 300) {
      setRunError("Guest count must be between 1 and 300.");
      return;
    }
    if (draft.budgetPounds.trim().length > 0 && budgetLimitMinor === null) {
      setRunError("Budget must be a non-negative GBP amount.");
      return;
    }
    const accessibilityRequirements: ("step_free_route" | "wheelchair_spaces" | "hearing_loop")[] = [];
    if (draft.stepFreeRoute) accessibilityRequirements.push("step_free_route");
    if (draft.wheelchairSpaces) accessibilityRequirements.push("wheelchair_spaces");
    if (draft.hearingLoop) accessibilityRequirements.push("hearing_loop");
    const brief = {
      eventName: draft.eventName.trim(),
      eventType: draft.eventType.trim(),
      guestCount,
      layoutStyle: draft.layoutStyle,
      budgetLimitMinor,
      preferredDate: optionalText(draft.preferredDate),
      startTime: optionalText(draft.startTime),
      endTime: optionalText(draft.endTime),
      serviceModel: draft.serviceModel,
      accessibilityRequirements,
      planningPrompt: optionalText(draft.planningPrompt),
    };
    const requestFingerprint = JSON.stringify({
      venueId: draft.venueId,
      spaceId: draft.spaceId,
      brief,
    });
    const previousKey = createKeyRef.current;
    const key = previousKey?.fingerprint === requestFingerprint
      ? previousKey.key
      : idempotencyKey("create");
    createKeyRef.current = { fingerprint: requestFingerprint, key };
    setSubmitting(true);
    setRunLoadState("loading");
    setRunError(null);
    setSelection(null);
    setSelectionError(null);
    void createEventArchitectRun({
      venueId: draft.venueId,
      spaceId: draft.spaceId,
      idempotencyKey: key,
      brief,
    }).then((result) => {
      setPersisted(result);
      setRunLoadState("ready");
    }).catch(() => {
      setRunLoadState("error");
      setRunError("The comparison could not be generated. Your inputs are still here; try again.");
    }).finally(() => { setSubmitting(false); });
  }, [draft, workspace]);

  const selectCandidate = useCallback((candidate: EventArchitectCandidate) => {
    if (persisted === null || persisted.selectedCandidateId !== null || selection !== null) return;
    const existingKey = selectionKeysRef.current.get(candidate.candidateId);
    const key = existingKey ?? idempotencyKey(`select:${candidate.candidateId}`);
    selectionKeysRef.current.set(candidate.candidateId, key);
    setSelectingCandidateId(candidate.candidateId);
    setSelectionError(null);
    void selectEventArchitectCandidate(candidate.candidateId, {
      idempotencyKey: key,
      expectedRequestDigest: persisted.run.requestDigest,
    }).then((result) => {
      setSelection(result);
      setPersisted((current) => current === null ? current : {
        ...current,
        selectedCandidateId: result.candidateId,
        selectedConfigurationId: result.configurationId,
        selectedSnapshotDigest: result.snapshotDigest,
        selectedProofDigest: result.proofDigest,
      });
    }).catch(() => {
      setSelectionError("That option could not be saved. No selection was changed; try again.");
    }).finally(() => { setSelectingCandidateId(null); });
  }, [persisted, selection]);

  const selectedCandidateId = selection?.candidateId ?? persisted?.selectedCandidateId ?? null;
  const plannerPath = selection?.plannerPath
    ?? (persisted?.selectedConfigurationId === null || persisted?.selectedConfigurationId === undefined
      ? null
      : `/plan/${persisted.selectedConfigurationId}`);
  const selectionLocked = selectedCandidateId !== null;
  const selectedCandidate = persisted?.run.candidates.find(
    (candidate) => candidate.candidateId === selectedCandidateId,
  ) ?? null;
  const canRecordOpsReview = user?.platformRole === "admin" ||
    user?.role === "admin" ||
    user?.role === "staff" ||
    user?.role === "hallkeeper";

  return (
    <main className="event-architect-page" aria-label="Event Architect workspace">
      <header className="event-architect-hero">
        <div>
          <p className="event-architect-kicker"><Sparkles aria-hidden="true" /> Event Architect</p>
          <h1>Three layouts. Every claim tied to a saved snapshot.</h1>
          <p>
            Compare deterministic room plans, price inputs, and replayable witness facts before choosing one to edit in the planner.
          </p>
        </div>
        <div className="event-architect-scope-note">
          <DraftingCompass aria-hidden="true" />
          <p><strong>Planning scope:</strong> deterministic checks cover room containment, represented seating, primary furniture gaps, and budget when complete pricing is available. A separate simulated guest-flow sidecar uses assumed doors; no door, egress/accessibility-route, or statutory determination is made.</p>
        </div>
      </header>

      <section className="event-architect-brief" aria-labelledby="event-architect-brief-title">
        <div className="event-architect-section-head">
          <div><p>01 / Brief</p><h2 id="event-architect-brief-title">Describe the event</h2></div>
          <span>{user?.name ?? "Protected venue workspace"}</span>
        </div>

        {workspace.kind === "loading" ? (
          <div className="event-architect-inline-state" role="status"><LoaderCircle aria-hidden="true" className="event-architect-spin" /> Loading venue rooms…</div>
        ) : workspace.kind === "error" ? (
          <div className="event-architect-inline-state event-architect-inline-state--error" role="alert"><AlertTriangle aria-hidden="true" /> {workspace.message}</div>
        ) : (
          <form onSubmit={submit} className="event-architect-form">
            <div className="event-architect-field-grid">
              <label>
                <span>Venue</span>
                <select
                  value={draft.venueId}
                  disabled={user?.venueId !== null && user?.venueId !== undefined}
                  onChange={(event) => { changeVenue(event.target.value); }}
                  required
                >
                  {workspace.venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
                </select>
              </label>
              <label>
                <span>Room</span>
                <select value={draft.spaceId} onChange={(event) => { setDraft((current) => ({ ...current, spaceId: event.target.value })); }} required>
                  {workspace.spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
                </select>
              </label>
              <label className="event-architect-field-wide">
                <span>Event name</span>
                <input value={draft.eventName} onChange={(event) => { setDraft((current) => ({ ...current, eventName: event.target.value })); }} maxLength={200} placeholder="Founders' dinner" required />
              </label>
              <label>
                <span>Event type</span>
                <input value={draft.eventType} onChange={(event) => { setDraft((current) => ({ ...current, eventType: event.target.value })); }} maxLength={120} required />
              </label>
              <label>
                <span>Guests</span>
                <input type="number" inputMode="numeric" min={1} max={300} value={draft.guestCount} onChange={(event) => { setDraft((current) => ({ ...current, guestCount: event.target.value })); }} required />
              </label>
              <label>
                <span>Layout style</span>
                <select value={draft.layoutStyle} onChange={(event) => { setDraft((current) => ({ ...current, layoutStyle: event.target.value === "theatre" ? "theatre" : "dinner-rounds" })); }}>
                  <option value="dinner-rounds">Dinner rounds</option>
                  <option value="theatre">Theatre seating</option>
                </select>
              </label>
              <label>
                <span>Service model</span>
                <select value={draft.serviceModel} onChange={(event) => {
                  const value = event.target.value;
                  if (value === "none" || value === "plated" || value === "buffet" || value === "reception") setDraft((current) => ({ ...current, serviceModel: value }));
                }}>
                  <option value="none">No catering service</option>
                  <option value="plated">Plated</option>
                  <option value="buffet">Buffet</option>
                  <option value="reception">Reception</option>
                </select>
              </label>
              <label>
                <span>Budget in GBP <small>optional</small></span>
                <input type="text" inputMode="decimal" pattern="\d+(?:\.\d{1,2})?" value={draft.budgetPounds} onChange={(event) => { setDraft((current) => ({ ...current, budgetPounds: event.target.value })); }} placeholder="12500.00" />
              </label>
              <label>
                <span>Preferred date <small>optional</small></span>
                <input type="date" value={draft.preferredDate} onChange={(event) => { setDraft((current) => ({ ...current, preferredDate: event.target.value })); }} />
              </label>
              <label>
                <span>Start time <small>optional</small></span>
                <input type="time" value={draft.startTime} onChange={(event) => { setDraft((current) => ({ ...current, startTime: event.target.value })); }} />
              </label>
              <label>
                <span>End time <small>optional</small></span>
                <input type="time" value={draft.endTime} onChange={(event) => { setDraft((current) => ({ ...current, endTime: event.target.value })); }} />
              </label>
            </div>

            <fieldset className="event-architect-accessibility">
              <legend>Accessibility requirements to carry into human review</legend>
              <label><input type="checkbox" checked={draft.stepFreeRoute} onChange={(event) => { setDraft((current) => ({ ...current, stepFreeRoute: event.target.checked })); }} /> Step-free route</label>
              <label><input type="checkbox" checked={draft.wheelchairSpaces} onChange={(event) => { setDraft((current) => ({ ...current, wheelchairSpaces: event.target.checked })); }} /> Wheelchair spaces</label>
              <label><input type="checkbox" checked={draft.hearingLoop} onChange={(event) => { setDraft((current) => ({ ...current, hearingLoop: event.target.checked })); }} /> Hearing loop</label>
              <p>These requirements are recorded as scenario assumptions. This generator does not validate an accessibility route.</p>
            </fieldset>

            <label className="event-architect-prompt">
              <span>Planning emphasis <small>optional, treated as untrusted guidance</small></span>
              <textarea value={draft.planningPrompt} onChange={(event) => { setDraft((current) => ({ ...current, planningPrompt: event.target.value })); }} maxLength={2000} rows={3} placeholder="Keep a generous welcome area near the entrance…" />
            </label>

            <button type="submit" className="event-architect-generate" disabled={submitting || workspace.spaces.length === 0}>
              {submitting ? <LoaderCircle aria-hidden="true" className="event-architect-spin" /> : <Sparkles aria-hidden="true" />}
              {submitting ? "Generating exact snapshots" : "Generate three options"}
            </button>
          </form>
        )}
      </section>

      {runLoadState === "loading" ? (
        <section className="event-architect-results-state" role="status" aria-live="polite">
          <LoaderCircle aria-hidden="true" className="event-architect-spin" />
          <h2>Building and checking three saved candidates</h2>
          <p>Room geometry, object footprints, and supplied price-book inputs are being frozen into replayable snapshots.</p>
        </section>
      ) : runLoadState === "error" ? (
        <section className="event-architect-results-state event-architect-results-state--error" role="alert">
          <AlertTriangle aria-hidden="true" />
          <h2>Comparison unavailable</h2>
          <p>{runError}</p>
          <button type="button" onClick={() => { setRunLoadState("idle"); setRunError(null); }}><RotateCcw aria-hidden="true" /> Return to the brief</button>
        </section>
      ) : persisted === null ? null : (
        <section className="event-architect-results" aria-labelledby="event-architect-results-title">
          <div className="event-architect-results-head">
            <div><p>02 / Compare</p><h2 id="event-architect-results-title">Three frozen candidate snapshots</h2></div>
            <span>Run {persisted.run.runId.slice(0, 8)}</span>
          </div>

          {selectionError === null ? null : <div className="event-architect-selection-error" role="alert"><AlertTriangle aria-hidden="true" /> {selectionError}</div>}

          {plannerPath === null ? null : (
            <div className="event-architect-selection-success" role="status">
              <Check aria-hidden="true" />
              <div><strong>Exact snapshot saved to a planner configuration.</strong><span>The snapshot and proof digests remain the selection record. This configuration stays draft until venue review, approval, and event binding.</span></div>
              <Link to={plannerPath}>Open in planner <ArrowRight aria-hidden="true" /></Link>
            </div>
          )}

          {selectedCandidate === null ? null : (
            <EventArchitectOpsReviewPanel
              candidate={selectedCandidate}
              requestDigest={persisted.run.requestDigest}
              canReview={canRecordOpsReview}
            />
          )}

          <div className="event-architect-candidates">
            {persisted.run.candidates.map((candidate) => (
              <CandidateCard
                key={candidate.candidateId}
                candidate={candidate}
                selectedCandidateId={selectedCandidateId}
                selectingCandidateId={selectingCandidateId}
                selectionLocked={selectionLocked}
                onSelect={selectCandidate}
              />
            ))}
          </div>

          <footer className="event-architect-disclosure">
            <CircleAlert aria-hidden="true" />
            <p>Validator facts are deterministic checks against recorded inputs; guest-flow cards are simulated planning support with explicit assumptions. They are not safety, occupancy, accessibility-route, or statutory determinations. Venue staff must resolve every review gate before downstream use.</p>
          </footer>
        </section>
      )}

      <aside className="event-architect-method" aria-label="Event Architect method">
        <div><Users aria-hidden="true" /><strong>Represented seats</strong><span>Chair objects are counted before table seat labels to avoid double-counting.</span></div>
        <div><DraftingCompass aria-hidden="true" /><strong>Conservative footprints</strong><span>Rotated object rectangles must fit the recorded room polygon.</span></div>
        <div><CircleDollarSign aria-hidden="true" /><strong>Exact minor units</strong><span>Budget comparisons run only with complete, referenced price-book inputs.</span></div>
        <div><Sparkles aria-hidden="true" /><strong>Simulated flow sidecar</strong><span>Deterministic replay metrics stay visibly separate from validator-owned checks and require venue review.</span></div>
      </aside>
    </main>
  );
}
