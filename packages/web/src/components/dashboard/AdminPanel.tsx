import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import type { FloorPlanPoint } from "@omnitwin/types";
import * as spacesApi from "../../api/spaces.js";
import * as pricingApi from "../../api/pricing.js";
import type { Venue, VenueDetail, Space } from "../../api/spaces.js";
import type { PricingRule } from "../../api/pricing.js";
import { useFocusTrap } from "../../lib/use-focus-trap.js";
import { useToastStore } from "../../stores/toast-store.js";
import { ConfirmModal } from "../shared/ConfirmModal.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import { PolygonEditor } from "./PolygonEditor.js";
import { clockFace, describeWindow, readWindowDraft, ruleSaveError, WINDOW_COPY } from "./pricing-rule-window.js";
import "./AdminPanel.css";
import { useLatestRequest } from "../../hooks/use-latest-request.js";

const MIN_POLYGON_POINTS = 3;

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function polygonsEqual(
  a: readonly FloorPlanPoint[],
  b: readonly FloorPlanPoint[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const pa = a[i];
    const pb = b[i];
    if (pa === undefined || pb === undefined) return false;
    if (pa.x !== pb.x || pa.y !== pb.y) return false;
  }
  return true;
}

function actionError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function formatCurrency(amount: string): string {
  const parsed = Number.parseFloat(amount);
  return Number.isFinite(parsed) ? `£${parsed.toFixed(2)}` : amount;
}

function labelize(value: string): string {
  return value.replace(/_/g, " ");
}

function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** The rule form is open for a new rule, or on a rule being changed. */
type RuleForm = { readonly mode: "create" } | { readonly mode: "edit"; readonly rule: PricingRule };

/** What the rule form's inputs say, as strings, for the dirty check. */
interface RuleFormFields {
  readonly name: string;
  readonly type: PricingRule["type"];
  readonly amount: string;
  readonly spaceId: string;
  readonly from: string;
  readonly until: string;
}

const EMPTY_RULE_FIELDS: RuleFormFields = { name: "", type: "flat_rate", amount: "", spaceId: "", from: "", until: "" };

function ruleFormButtonLabel(form: RuleForm, saving: boolean): string {
  if (form.mode === "edit") return saving ? "Saving Changes" : "Save Changes";
  return saving ? "Creating Rule" : "Create Rule";
}

/** A rule as the form shows it: Postgres's "HH:MM:SS" on the clock face. */
function ruleFormFieldsOf(rule: PricingRule): RuleFormFields {
  return {
    name: rule.name,
    type: rule.type,
    amount: rule.amount,
    spaceId: rule.spaceId ?? "",
    from: rule.appliesFrom === null || rule.appliesFrom === undefined ? "" : clockFace(rule.appliesFrom),
    until: rule.appliesUntil === null || rule.appliesUntil === undefined ? "" : clockFace(rule.appliesUntil),
  };
}

interface FormModalProps {
  readonly title: string;
  readonly description?: string;
  readonly onClose: () => void;
  /** Something is entered: a click beside the form then leaves it open.
   *  Cancel and Escape still close it on purpose. */
  readonly dirty?: boolean;
  readonly children: ReactNode;
  readonly footer: ReactNode;
  readonly wide?: boolean;
}

function FormModal({ title, description, onClose, dirty = false, children, footer, wide = false }: FormModalProps): ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>();
  const titleId = `${slugify(title)}-modal-title`;
  const descriptionId = `${slugify(title)}-modal-description`;

  return (
    <div
      className="admin-panel-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      tabIndex={-1}
      onClick={() => { if (!dirty) onClose(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <section
        ref={trapRef}
        className={`admin-panel-modal${wide ? " admin-panel-modal--wide" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <header className="admin-panel-modal-header">
          <h3 id={titleId}>{title}</h3>
          {description !== undefined ? <p id={descriptionId}>{description}</p> : null}
        </header>
        <div className="admin-panel-form-grid">{children}</div>
        <footer className="admin-panel-modal-footer">{footer}</footer>
      </section>
    </div>
  );
}

interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Whether the clock or number is only partly typed (the browser's
   *  `badInput`): its value reads as empty while it is. Told on every change
   *  and on blur, since an empty value that stays empty raises no change. */
  readonly onPartial?: (partial: boolean) => void;
  readonly placeholder?: string;
  readonly type?: "text" | "number" | "time";
  readonly step?: string;
  readonly min?: string;
  readonly describedBy?: string;
  readonly invalid?: boolean;
}

function TextField({
  label,
  value,
  onChange,
  onPartial,
  placeholder,
  type = "text",
  step,
  min,
  describedBy,
  invalid = false,
}: TextFieldProps): ReactElement {
  return (
    <label className="admin-panel-field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        step={step}
        min={min}
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          onPartial?.(event.target.validity.badInput);
        }}
        onBlur={(event) => {
          onPartial?.(event.target.validity.badInput);
        }}
      />
    </label>
  );
}

interface SelectFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly children: ReactNode;
}

function SelectField({ label, value, onChange, children }: SelectFieldProps): ReactElement {
  return (
    <label className="admin-panel-field">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {children}
      </select>
    </label>
  );
}

interface StatusPanelProps {
  readonly title: string;
  readonly body?: string;
  readonly active?: boolean;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

function StatusPanel({ title, body, active = false, actionLabel, onAction }: StatusPanelProps): ReactElement {
  return (
    <section className="admin-panel-state" role={onAction === undefined ? "status" : "alert"}>
      <h2>{active && <ActivityIndicator size={28} />} {title}</h2>
      {body !== undefined ? <p>{body}</p> : null}
      {actionLabel !== undefined && onAction !== undefined ? (
        <button type="button" className="admin-panel-button admin-panel-button--primary" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </section>
  );
}

export function AdminPanel(): ReactElement {
  const addToast = useToastStore((state) => state.addToast);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedVenue, setSelectedVenue] = useState<VenueDetail | null>(null);
  const [loadingVenueId, setLoadingVenueId] = useState<string | null>(null);
  const [venueDetailError, setVenueDetailError] = useState<string | null>(null);

  const [showCreateVenue, setShowCreateVenue] = useState(false);
  const [creatingVenue, setCreatingVenue] = useState(false);
  const [venueName, setVenueName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");

  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [creatingSpace, setCreatingSpace] = useState(false);
  const [spaceName, setSpaceName] = useState("");
  const [spaceHeight, setSpaceHeight] = useState("");
  const [spaceOutline, setSpaceOutline] = useState<readonly FloorPlanPoint[]>([]);

  const [showDeleteVenue, setShowDeleteVenue] = useState(false);
  const [deletingVenue, setDeletingVenue] = useState(false);

  const [editingSpace, setEditingSpace] = useState<Space | null>(null);
  const [updatingSpace, setUpdatingSpace] = useState(false);
  const [editSpaceName, setEditSpaceName] = useState("");
  const [editSpaceHeight, setEditSpaceHeight] = useState("");
  const [editSpaceOutline, setEditSpaceOutline] = useState<readonly FloorPlanPoint[]>([]);
  const [deletingSpaceId, setDeletingSpaceId] = useState<string | null>(null);
  const [deletingSpace, setDeletingSpace] = useState(false);
  // A deleted room that can be brought back: the one just deleted, or the
  // one whose address a new room asked for.
  const [deletedSpace, setDeletedSpace] = useState<{ readonly id: string; readonly name: string; readonly venueId: string } | null>(null);
  const [slugHolder, setSlugHolder] = useState<{ readonly id: string; readonly name: string } | null>(null);
  const [restoringSpace, setRestoringSpace] = useState(false);

  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [pricingRequests, setPricingRequests] = useState(0);
  const [pricingError, setPricingError] = useState<string | null>(null);
  // The rule form: open for a new rule, open on a rule being changed, or shut.
  const [ruleForm, setRuleForm] = useState<RuleForm | null>(null);
  const [savingRule, setSavingRule] = useState(false);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);
  // The rule just deleted, offered back until the next delete or venue.
  const [deletedRule, setDeletedRule] = useState<PricingRule | null>(null);
  const [restoringRule, setRestoringRule] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [ruleType, setRuleType] = useState<PricingRule["type"]>("flat_rate");
  const [ruleAmount, setRuleAmount] = useState("");
  const [ruleSpaceId, setRuleSpaceId] = useState("");
  // The time of day the rule is for, "HH:MM" each or both empty for any time.
  const [ruleFrom, setRuleFrom] = useState("");
  const [ruleUntil, setRuleUntil] = useState("");
  // A clock only partly typed reads as empty; the save waits for it.
  const [ruleFromPartial, setRuleFromPartial] = useState(false);
  const [ruleUntilPartial, setRuleUntilPartial] = useState(false);
  // What the form said when it opened, so a stray click only closes an
  // untouched form.
  const [ruleFormOpened, setRuleFormOpened] = useState<RuleFormFields>(EMPTY_RULE_FIELDS);

  const generatedVenueSlug = useMemo(() => slugify(venueName), [venueName]);
  const createVenueDisabled = creatingVenue || venueName.trim() === "" || venueAddress.trim() === "";
  const createSpaceDisabled = creatingSpace ||
    spaceName.trim() === "" ||
    spaceHeight.trim() === "" ||
    spaceOutline.length < MIN_POLYGON_POINTS;
  const editSpaceDisabled = updatingSpace ||
    editSpaceName.trim() === "" ||
    editSpaceHeight.trim() === "" ||
    editSpaceOutline.length < MIN_POLYGON_POINTS;
  const ruleWindow = readWindowDraft({ from: ruleFrom, until: ruleUntil });
  const ruleWindowNote = ruleFromPartial || ruleUntilPartial
    ? WINDOW_COPY.clockNeeded
    : ruleWindow.kind === "half" || ruleWindow.kind === "invalid" ? ruleWindow.message : null;
  const ruleFormFields: RuleFormFields = { name: ruleName, type: ruleType, amount: ruleAmount, spaceId: ruleSpaceId, from: ruleFrom, until: ruleUntil };
  const ruleFormDirty = (Object.keys(ruleFormFields) as (keyof RuleFormFields)[]).some((key) => ruleFormFields[key] !== ruleFormOpened[key]);
  const saveRuleDisabled = savingRule || ruleName.trim() === "" || ruleAmount.trim() === "" || ruleWindowNote !== null
    || (ruleForm?.mode === "edit" && !ruleFormDirty);
  // A rule's room may have left the venue since; it is named so the office
  // can keep it or move the rule, instead of reading as venue-wide.
  const ruleRoomMissing = ruleForm?.mode === "edit" && ruleFormOpened.spaceId !== ""
    && selectedVenue?.spaces.every((space) => space.id !== ruleFormOpened.spaceId) === true;
  const venueMutationPending = creatingSpace || updatingSpace || deletingSpace || restoringSpace
    || deletingVenue || savingRule || deletingRuleId !== null || restoringRule;

  const loadVenues = useCallback((): void => {
    setLoading(true);
    setLoadError(null);
    void spacesApi.listVenues()
      .then((nextVenues) => {
        setVenues(nextVenues);
      })
      .catch((error: unknown) => {
        const message = actionError(error, "Failed to load venues");
        setLoadError(message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const pricingRequest = useLatestRequest();
  const venueRequest = useLatestRequest();
  const loadPricingRules = useCallback((venueId: string): void => {
    const ownsRequest = pricingRequest.begin();
    setPricingError(null);
    setPricingRequests(1);
    void pricingApi.listPricingRules(venueId)
      .then((rules) => {
        if (!ownsRequest()) return;
        setPricingRules(rules);
      })
      .catch((error: unknown) => {
        if (!ownsRequest()) return;
        setPricingError(actionError(error, "Pricing rules could not be loaded."));
      })
      .finally(() => { if (ownsRequest()) setPricingRequests(0); });
  }, [pricingRequest]);

  useEffect(() => {
    loadVenues();
  }, [loadVenues]);

  const handleSelectVenue = useCallback((venueId: string): void => {
    const ownsRequest = venueRequest.begin();
    pricingRequest.invalidate();
    setPricingRequests(0);
    setVenueDetailError(null);
    setLoadingVenueId(venueId);
    setPricingRules([]);
    setPricingError(null);
    setDeletedRule(null);
    void spacesApi.getVenue(venueId)
      .then((venue) => {
        if (!ownsRequest()) return;
        setSelectedVenue(venue);
        loadPricingRules(venue.id);
      })
      .catch((error: unknown) => {
        if (!ownsRequest()) return;
        const message = actionError(error, "Failed to load venue");
        setVenueDetailError(message);
        addToast(message, "error");
      })
      .finally(() => {
        if (ownsRequest()) setLoadingVenueId(null);
      });
  }, [addToast, loadPricingRules, pricingRequest, venueRequest]);

  const handleCreateVenue = async (): Promise<void> => {
    if (createVenueDisabled) return;
    setCreatingVenue(true);
    try {
      await spacesApi.createVenue({
        name: venueName.trim(),
        slug: generatedVenueSlug,
        address: venueAddress.trim(),
      });
      addToast("Venue created", "success");
      setShowCreateVenue(false);
      setVenueName("");
      setVenueAddress("");
      loadVenues();
    } catch (error: unknown) {
      addToast(actionError(error, "Failed to create venue"), "error");
    } finally {
      setCreatingVenue(false);
    }
  };

  const handleCreateSpace = async (): Promise<void> => {
    if (selectedVenue === null || createSpaceDisabled) return;
    const heightM = Number.parseFloat(spaceHeight);
    if (!Number.isFinite(heightM) || heightM <= 0) {
      addToast("Height must be a positive number", "error");
      return;
    }
    setCreatingSpace(true);
    try {
      await spacesApi.createSpace(selectedVenue.id, {
        name: spaceName.trim(),
        slug: slugify(spaceName),
        heightM,
        floorPlanOutline: spaceOutline,
      });
      addToast("Space created", "success");
      setShowCreateSpace(false);
      setSpaceName("");
      setSpaceHeight("");
      setSpaceOutline([]);
      handleSelectVenue(selectedVenue.id);
    } catch (error: unknown) {
      setSlugHolder(spacesApi.deletedRoomHoldingSlug(error));
      addToast(actionError(error, "Failed to create space"), "error");
    } finally {
      setCreatingSpace(false);
    }
  };

  const handleRestoreSpace = async (room: { readonly id: string; readonly name: string }): Promise<void> => {
    if (selectedVenue === null || restoringSpace) return;
    setRestoringSpace(true);
    try {
      await spacesApi.restoreSpace(selectedVenue.id, room.id);
      addToast(`"${room.name}" is back`, "success");
      setDeletedSpace(null);
      if (slugHolder?.id === room.id) {
        setSlugHolder(null);
        setShowCreateSpace(false);
        setSpaceName("");
        setSpaceHeight("");
        setSpaceOutline([]);
      }
      handleSelectVenue(selectedVenue.id);
    } catch (error: unknown) {
      addToast(actionError(error, "Could not bring the space back. It is still deleted."), "error");
    } finally {
      setRestoringSpace(false);
    }
  };

  const handleDeleteVenue = async (): Promise<void> => {
    if (selectedVenue === null || deletingVenue) return;
    setDeletingVenue(true);
    try {
      await spacesApi.deleteVenue(selectedVenue.id);
      venueRequest.invalidate();
      pricingRequest.invalidate();
      setLoadingVenueId(null);
      setPricingRequests(0);
      setPricingRules([]);
      setPricingError(null);
      addToast("Venue deleted", "success");
      setSelectedVenue(null);
      setShowDeleteVenue(false);
      loadVenues();
    } catch (error: unknown) {
      addToast(actionError(error, "Failed to delete venue"), "error");
    } finally {
      setDeletingVenue(false);
    }
  };

  const openEditSpace = (space: Space): void => {
    setEditingSpace(space);
    setEditSpaceName(space.name);
    setEditSpaceHeight(space.heightM);
    setEditSpaceOutline(space.floorPlanOutline);
  };

  const handleEditSpace = async (): Promise<void> => {
    if (selectedVenue === null || editingSpace === null || editSpaceDisabled) return;
    const heightM = Number.parseFloat(editSpaceHeight);
    if (!Number.isFinite(heightM) || heightM <= 0) {
      addToast("Name and positive height required", "error");
      return;
    }
    setUpdatingSpace(true);
    try {
      const polygonChanged = !polygonsEqual(editSpaceOutline, editingSpace.floorPlanOutline);
      await spacesApi.updateSpace(selectedVenue.id, editingSpace.id, {
        name: editSpaceName.trim(),
        heightM,
        ...(polygonChanged ? { floorPlanOutline: editSpaceOutline } : {}),
      });
      addToast("Space updated", "success");
      setEditingSpace(null);
      handleSelectVenue(selectedVenue.id);
    } catch (error: unknown) {
      addToast(actionError(error, "Failed to update space"), "error");
    } finally {
      setUpdatingSpace(false);
    }
  };

  const handleDeleteSpace = async (spaceId: string): Promise<void> => {
    if (selectedVenue === null || deletingSpace) return;
    setDeletingSpace(true);
    try {
      await spacesApi.deleteSpace(selectedVenue.id, spaceId);
      addToast("Space deleted", "success");
      setDeletedSpace({ id: spaceId, name: selectedVenue.spaces.find((space) => space.id === spaceId)?.name ?? "the space", venueId: selectedVenue.id });
      setDeletingSpaceId(null);
      handleSelectVenue(selectedVenue.id);
    } catch (error: unknown) {
      addToast(actionError(error, "Failed to delete space"), "error");
    } finally {
      setDeletingSpace(false);
    }
  };

  const openRuleForm = (form: RuleForm): void => {
    const fields = form.mode === "edit" ? ruleFormFieldsOf(form.rule) : EMPTY_RULE_FIELDS;
    setRuleName(fields.name);
    setRuleType(fields.type);
    setRuleAmount(fields.amount);
    setRuleSpaceId(fields.spaceId);
    setRuleFrom(fields.from);
    setRuleUntil(fields.until);
    setRuleFromPartial(false);
    setRuleUntilPartial(false);
    setRuleFormOpened(fields);
    setRuleForm(form);
  };

  const closeRuleForm = (): void => {
    setRuleForm(null);
    setRuleName("");
    setRuleType("flat_rate");
    setRuleAmount("");
    setRuleSpaceId("");
    setRuleFrom("");
    setRuleUntil("");
    setRuleFromPartial(false);
    setRuleUntilPartial(false);
    setRuleFormOpened(EMPTY_RULE_FIELDS);
  };

  const handleSaveRule = async (): Promise<void> => {
    if (selectedVenue === null || ruleForm === null || saveRuleDisabled) return;
    const amount = Number.parseFloat(ruleAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      addToast("Amount must be a non-negative number", "error");
      return;
    }
    // Both times or neither, as the API insists; the button is held while
    // the form says otherwise, so this only guards the type.
    if (ruleWindow.kind !== "any" && ruleWindow.kind !== "set") return;
    const body = {
      name: ruleName.trim(),
      type: ruleType,
      amount,
      spaceId: ruleSpaceId !== "" ? ruleSpaceId : null,
      appliesFrom: ruleWindow.appliesFrom,
      appliesUntil: ruleWindow.appliesUntil,
    };
    setSavingRule(true);
    try {
      if (ruleForm.mode === "edit") {
        // Only what changed goes: a field left as it was is not re-sent,
        // so a rule whose room has since left the venue can still be renamed.
        const opened = ruleFormOpened;
        const windowChanged = ruleFrom !== opened.from || ruleUntil !== opened.until;
        const change: pricingApi.UpdatePricingRuleInput = {
          ...(ruleName !== opened.name ? { name: body.name } : {}),
          ...(ruleType !== opened.type ? { type: body.type } : {}),
          ...(ruleAmount !== opened.amount ? { amount: body.amount } : {}),
          ...(ruleSpaceId !== opened.spaceId ? { spaceId: body.spaceId } : {}),
          ...(windowChanged ? { appliesFrom: body.appliesFrom, appliesUntil: body.appliesUntil } : {}),
        };
        await pricingApi.updatePricingRule(selectedVenue.id, ruleForm.rule.id, change);
        addToast("Pricing rule saved", "success");
      } else {
        await pricingApi.createPricingRule(selectedVenue.id, body);
        addToast("Pricing rule created", "success");
      }
      closeRuleForm();
      loadPricingRules(selectedVenue.id);
    } catch (error: unknown) {
      addToast(ruleSaveError(error, ruleForm.mode === "edit" ? "Failed to save pricing rule" : "Failed to create pricing rule"), "error");
    } finally {
      setSavingRule(false);
    }
  };

  const handleDeleteRule = async (rule: PricingRule): Promise<void> => {
    if (selectedVenue === null || deletingRuleId !== null) return;
    setDeletingRuleId(rule.id);
    try {
      await pricingApi.deletePricingRule(selectedVenue.id, rule.id);
      setDeletedRule(rule);
      loadPricingRules(selectedVenue.id);
    } catch (error: unknown) {
      addToast(actionError(error, "Failed to delete pricing rule"), "error");
    } finally {
      setDeletingRuleId(null);
    }
  };

  const handleRestoreRule = async (): Promise<void> => {
    if (selectedVenue === null || deletedRule === null || restoringRule) return;
    setRestoringRule(true);
    try {
      await pricingApi.restorePricingRule(selectedVenue.id, deletedRule.id, deletedRule.isActive);
      addToast(`Pricing rule "${deletedRule.name}" is back`, "success");
      setDeletedRule(null);
      loadPricingRules(selectedVenue.id);
    } catch (error: unknown) {
      addToast(actionError(error, "Could not bring the pricing rule back. It is still deleted."), "error");
    } finally {
      setRestoringRule(false);
    }
  };

  if (loading) {
    return <StatusPanel active title="Loading venues" />;
  }

  if (loadError !== null) {
    return (
      <StatusPanel
        title="Venue registry unavailable"
        body={loadError}
        actionLabel="Retry"
        onAction={loadVenues}
      />
    );
  }

  if (selectedVenue !== null) {
    return (
      <section className="admin-panel-shell" aria-labelledby="admin-panel-venue-title">
        <button
          type="button"
          className="admin-panel-link"
          disabled={venueMutationPending}
          onClick={() => {
            venueRequest.invalidate();
            pricingRequest.invalidate();
            setLoadingVenueId(null);
            setPricingRequests(0);
            setSelectedVenue(null);
          }}
        >
          Back to venues
        </button>

        <header className="admin-panel-header">
          <div>
            <h2 id="admin-panel-venue-title">{selectedVenue.name}</h2>
            <p>{selectedVenue.address}</p>
          </div>
          <button
            type="button"
            className="admin-panel-button admin-panel-button--danger"
            onClick={() => {
              setShowDeleteVenue(true);
            }}
          >
            Delete Venue
          </button>
        </header>

        {loadingVenueId === selectedVenue.id && <ActivityStatus>Refreshing venue details…</ActivityStatus>}

        <div className="admin-panel-metrics" aria-label="Venue registry summary">
          <article>
            <span>{selectedVenue.spaces.length.toLocaleString("en-GB")}</span>
            <p>spaces registered</p>
          </article>
          <article>
            <span>{pricingRules.length.toLocaleString("en-GB")}</span>
            <p>pricing rules</p>
          </article>
          <article>
            <span>{selectedVenue.slug}</span>
            <p>public slug</p>
          </article>
        </div>

        <section className="admin-panel-section" aria-labelledby="admin-panel-spaces-title">
          <div className="admin-panel-section-header">
            <div>
              <h3 id="admin-panel-spaces-title">Spaces</h3>
            </div>
            <button
              type="button"
              className="admin-panel-button admin-panel-button--primary"
              onClick={() => {
                setShowCreateSpace(true);
              }}
            >
              New Space
            </button>
          </div>

          {deletedSpace !== null && deletedSpace.venueId === selectedVenue.id && (
            <div className="admin-panel-undo" role="status">
              <span>Deleted &ldquo;{deletedSpace.name}&rdquo;.</span>
              <button
                type="button"
                className="admin-panel-button admin-panel-button--secondary"
                disabled={restoringSpace}
                aria-busy={restoringSpace}
                aria-label={`Undo: bring back ${deletedSpace.name}`}
                onClick={() => {
                  void handleRestoreSpace(deletedSpace);
                }}
              >
                {restoringSpace && <ActivityIndicator size={16} />} Undo
              </button>
            </div>
          )}

          {selectedVenue.spaces.length === 0 ? (
            <div className="admin-panel-empty">No spaces yet. Create one before layout planning, pricing, or loadout work can be trusted.</div>
          ) : (
            <div className="admin-panel-list">
              {selectedVenue.spaces.map((space) => (
                <article key={space.id} className="admin-panel-record">
                  <div>
                    <h4>{space.name}</h4>
                    <p>{space.widthM}m x {space.lengthM}m x {space.heightM}m</p>
                    <small>slug: {space.slug}</small>
                  </div>
                  <div className="admin-panel-actions">
                    <button
                      type="button"
                      className="admin-panel-button admin-panel-button--secondary"
                      aria-label={`Edit space ${space.name}`}
                      onClick={() => {
                        openEditSpace(space);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="admin-panel-button admin-panel-button--danger-subtle"
                      aria-label={`Delete space ${space.name}`}
                      onClick={() => {
                        setDeletingSpaceId(space.id);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="admin-panel-section" aria-labelledby="admin-panel-pricing-title">
          <div className="admin-panel-section-header">
            <div>
              <h3 id="admin-panel-pricing-title">Room Hire Pricing</h3>
            </div>
            <button
              type="button"
              className="admin-panel-button admin-panel-button--primary"
              onClick={() => {
                openRuleForm({ mode: "create" });
              }}
            >
              New Rule
            </button>
          </div>

          {pricingError !== null ? (
            <div className="admin-panel-inline-error" role="alert">
              <span>{pricingError}</span>
              <button
                type="button"
                className="admin-panel-link"
                onClick={() => {
                  loadPricingRules(selectedVenue.id);
                }}
              >
                Retry pricing
              </button>
            </div>
          ) : null}

          {deletedRule !== null && (
            <div className="admin-panel-undo" role="status">
              <span>Deleted &ldquo;{deletedRule.name}&rdquo;.</span>
              <button
                type="button"
                className="admin-panel-button admin-panel-button--secondary"
                disabled={restoringRule}
                aria-busy={restoringRule}
                aria-label={`Undo: bring back ${deletedRule.name}`}
                onClick={() => {
                  void handleRestoreRule();
                }}
              >
                {restoringRule && <ActivityIndicator size={16} />} Undo
              </button>
            </div>
          )}
          {pricingRequests > 0 && <ActivityStatus>Loading pricing rules…</ActivityStatus>}
          {pricingRules.length === 0 ? (
            pricingRequests === 0 && <div className="admin-panel-empty">No pricing rules configured.</div>
          ) : (
            <div className="admin-panel-table-wrap">
              <table className="admin-panel-table">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Amount</th>
                    <th>Type</th>
                    <th>Hours</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pricingRules.map((rule) => (
                    <tr key={rule.id}>
                      <td>{rule.name}</td>
                      <td>{formatCurrency(rule.amount)}</td>
                      <td>{labelize(rule.type)}</td>
                      <td className="admin-panel-hours">{describeWindow(rule)}</td>
                      <td>
                        <span className={`admin-panel-chip ${rule.isActive ? "admin-panel-chip--ready" : "admin-panel-chip--blocked"}`}>
                          {rule.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="admin-panel-row-actions">
                        <button
                          type="button"
                          className="admin-panel-button admin-panel-button--secondary"
                          aria-label={`Edit pricing rule ${rule.name}`}
                          disabled={venueMutationPending}
                          onClick={() => {
                            openRuleForm({ mode: "edit", rule });
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="admin-panel-button admin-panel-button--danger-subtle"
                          aria-label={`Delete pricing rule ${rule.name}`}
                          disabled={deletingRuleId !== null}
                          aria-busy={deletingRuleId === rule.id}
                          onClick={() => {
                            void handleDeleteRule(rule);
                          }}
                        >
                          {deletingRuleId === rule.id && <ActivityIndicator size={16} />} {deletingRuleId === rule.id ? "Deleting" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {showCreateSpace ? (
          <FormModal
            title="New Space"
            description="Use the room’s actual floor outline."
            wide
            dirty={spaceName !== "" || spaceHeight !== "" || spaceOutline.length > 0}
            onClose={() => {
              if (creatingSpace) return;
              setShowCreateSpace(false);
              setSpaceOutline([]);
              setSlugHolder(null);
            }}
            footer={(
              <>
                <button
                  type="button"
                  className="admin-panel-button admin-panel-button--secondary"
                  disabled={creatingSpace}
                  onClick={() => {
                    setShowCreateSpace(false);
                    setSpaceOutline([]);
                    setSlugHolder(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="admin-panel-button admin-panel-button--primary"
                  disabled={createSpaceDisabled}
                  onClick={() => {
                    void handleCreateSpace();
                  }}
                >
                  {creatingSpace && <ActivityIndicator size={18} />} {creatingSpace ? "Creating Space" : "Create Space"}
                </button>
              </>
            )}
          >
            <TextField label="Space Name" value={spaceName} onChange={(name) => { setSpaceName(name); setSlugHolder(null); }} placeholder="Grand Hall" />
            {slugHolder !== null && (
              <div className="admin-panel-undo" role="status">
                <span>&ldquo;{slugHolder.name}&rdquo; was deleted and still has this name. Bring it back as it was, or choose another name.</span>
                <button
                  type="button"
                  className="admin-panel-button admin-panel-button--secondary"
                  disabled={restoringSpace}
                  aria-busy={restoringSpace}
                  aria-label={`Bring back ${slugHolder.name}`}
                  onClick={() => {
                    void handleRestoreSpace(slugHolder);
                  }}
                >
                  {restoringSpace && <ActivityIndicator size={16} />} Bring it back
                </button>
              </div>
            )}
            <div className="admin-panel-field admin-panel-field--wide">
              <span>Floor plan</span>
              <PolygonEditor value={spaceOutline} onChange={setSpaceOutline} disabled={creatingSpace} />
            </div>
            <TextField label="Height (m)" value={spaceHeight} onChange={setSpaceHeight} type="number" step="0.1" min="0" placeholder="7" />
          </FormModal>
        ) : null}

        {ruleForm !== null ? (
          <FormModal
            title={ruleForm.mode === "edit" ? "Edit Pricing Rule" : "New Pricing Rule"}
            dirty={ruleFormDirty}
            onClose={() => {
              if (!savingRule) closeRuleForm();
            }}
            footer={(
              <>
                <button
                  type="button"
                  className="admin-panel-button admin-panel-button--secondary"
                  disabled={savingRule}
                  onClick={closeRuleForm}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="admin-panel-button admin-panel-button--primary"
                  disabled={saveRuleDisabled}
                  onClick={() => {
                    void handleSaveRule();
                  }}
                >
                  {savingRule && <ActivityIndicator size={18} />} {ruleFormButtonLabel(ruleForm, savingRule)}
                </button>
              </>
            )}
          >
            <TextField label="Rule Name" value={ruleName} onChange={setRuleName} placeholder="Grand Hall Half Day" />
            <SelectField label="Space (optional)" value={ruleSpaceId} onChange={setRuleSpaceId}>
              <option value="">Venue-wide</option>
              {ruleRoomMissing ? <option value={ruleFormOpened.spaceId}>Room no longer listed (as entered)</option> : null}
              {selectedVenue.spaces.map((space) => (
                <option key={space.id} value={space.id}>{space.name}</option>
              ))}
            </SelectField>
            <SelectField
              label="Type"
              value={ruleType}
              onChange={(value) => {
                setRuleType(value as PricingRule["type"]);
              }}
            >
              <option value="flat_rate">Flat Rate</option>
              <option value="per_hour">Per Hour</option>
              <option value="per_head">Per Head</option>
              {/* No Tiered for a new rule: tiers cannot be entered here, and a
                  tiered rule without them prices at nothing
                  (services/price-calculator.ts). A tiered rule being changed
                  keeps its type. */}
              {ruleForm.mode === "edit" && ruleForm.rule.type === "tiered" ? <option value="tiered">Tiered (as entered)</option> : null}
            </SelectField>
            <TextField label="Amount (GBP)" value={ruleAmount} onChange={setRuleAmount} type="number" step="0.01" min="0" placeholder="500" />
            <fieldset className="admin-panel-fieldset">
              <legend>Time of day</legend>
              <div className="admin-panel-field-row">
                <TextField
                  label="Applies from"
                  value={ruleFrom}
                  type="time"
                  describedBy="pricing-rule-window-note"
                  invalid={ruleWindowNote !== null}
                  onChange={setRuleFrom}
                  onPartial={setRuleFromPartial}
                />
                <TextField
                  label="Applies until"
                  value={ruleUntil}
                  type="time"
                  describedBy="pricing-rule-window-note"
                  invalid={ruleWindowNote !== null}
                  onChange={setRuleUntil}
                  onPartial={setRuleUntilPartial}
                />
              </div>
              {/* One live region, always mounted, so a change of words is
                  read out; the inputs point at it. */}
              <p
                id="pricing-rule-window-note"
                role="status"
                className={`admin-panel-field-note${ruleWindowNote !== null ? " admin-panel-field-note--hold" : ""}`}
              >
                {ruleWindowNote ?? WINDOW_COPY.hint}
              </p>
            </fieldset>
          </FormModal>
        ) : null}

        {showDeleteVenue ? (
          <ConfirmModal
            title="Delete Venue"
            message={`Delete "${selectedVenue.name}"? It stops showing in Venviewer. Its ${counted(selectedVenue.spaces.length, "space")}, ${counted(pricingRules.length, "pricing rule")} and saved layouts are kept, not erased.`}
            confirmLabel={deletingVenue ? "Deleting" : "Delete"}
            inFlight={deletingVenue}
            onConfirm={() => {
              void handleDeleteVenue();
            }}
            onCancel={() => {
              if (!deletingVenue) setShowDeleteVenue(false);
            }}
          />
        ) : null}

        {deletingSpaceId !== null ? (
          <ConfirmModal
            title="Delete Space"
            message={`Delete "${selectedVenue.spaces.find((space) => space.id === deletingSpaceId)?.name ?? "this space"}"? It stops showing in Venviewer, and its past bookings leave the Diary with it. Its saved layouts and loadouts are kept, not erased, and it can be brought back. A space with bookings still to come cannot be deleted.`}
            confirmLabel={deletingSpace ? "Deleting" : "Delete"}
            inFlight={deletingSpace}
            onConfirm={() => {
              void handleDeleteSpace(deletingSpaceId);
            }}
            onCancel={() => {
              if (!deletingSpace) setDeletingSpaceId(null);
            }}
          />
        ) : null}

        {editingSpace !== null ? (
          <FormModal
            title="Edit Space"
            description="Match geometry to the reviewed floor plan."
            wide
            dirty={editSpaceName !== editingSpace.name || editSpaceHeight !== editingSpace.heightM
              || !polygonsEqual(editSpaceOutline, editingSpace.floorPlanOutline)}
            onClose={() => {
              if (!updatingSpace) setEditingSpace(null);
            }}
            footer={(
              <>
                <button
                  type="button"
                  className="admin-panel-button admin-panel-button--secondary"
                  disabled={updatingSpace}
                  onClick={() => {
                    setEditingSpace(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="admin-panel-button admin-panel-button--primary"
                  disabled={editSpaceDisabled}
                  onClick={() => {
                    void handleEditSpace();
                  }}
                >
                  {updatingSpace && <ActivityIndicator size={18} />} {updatingSpace ? "Saving Changes" : "Save Changes"}
                </button>
              </>
            )}
          >
            <TextField label="Space Name" value={editSpaceName} onChange={setEditSpaceName} />
            <div className="admin-panel-field admin-panel-field--wide">
              <span>Floor plan</span>
              <PolygonEditor value={editSpaceOutline} onChange={setEditSpaceOutline} disabled={updatingSpace} />
            </div>
            <TextField label="Height (m)" value={editSpaceHeight} onChange={setEditSpaceHeight} type="number" step="0.1" min="0" />
          </FormModal>
        ) : null}
      </section>
    );
  }

  return (
    <section className="admin-panel-shell" aria-labelledby="admin-panel-title">
      <header className="admin-panel-header">
        <div>
          <p className="admin-panel-kicker">Platform admin</p>
          <h2 id="admin-panel-title">Venue Registry</h2>
        </div>
        <button
          type="button"
          className="admin-panel-button admin-panel-button--primary"
          onClick={() => {
            setShowCreateVenue(true);
          }}
        >
          New Venue
        </button>
      </header>

      {venueDetailError !== null ? (
        <div className="admin-panel-inline-error" role="alert">
          <span>{venueDetailError}</span>
        </div>
      ) : null}

      {venues.length === 0 ? (
        <div className="admin-panel-empty">No venues found.</div>
      ) : (
        <div className="admin-panel-venue-grid">
          {venues.map((venue) => (
            <button
              key={venue.id}
              type="button"
              className="admin-panel-venue-card"
              disabled={loadingVenueId !== null}
              onClick={() => {
                handleSelectVenue(venue.id);
              }}
            >
              <span className="admin-panel-venue-name">{venue.name}</span>
              <span className="admin-panel-venue-meta">{venue.address}</span>
              <span className="admin-panel-venue-slug">/{venue.slug}</span>
              <span className="admin-panel-venue-action">
                {loadingVenueId === venue.id && <ActivityIndicator size={18} />} {loadingVenueId === venue.id ? "Loading" : "Open venue"}
              </span>
            </button>
          ))}
        </div>
      )}

      {showCreateVenue ? (
        <FormModal
          title="New Venue"
          dirty={venueName !== "" || venueAddress !== ""}
          onClose={() => {
            if (!creatingVenue) setShowCreateVenue(false);
          }}
          footer={(
            <>
              <button
                type="button"
                className="admin-panel-button admin-panel-button--secondary"
                disabled={creatingVenue}
                onClick={() => {
                  setShowCreateVenue(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-panel-button admin-panel-button--primary"
                disabled={createVenueDisabled}
                onClick={() => {
                  void handleCreateVenue();
                }}
              >
                {creatingVenue && <ActivityIndicator size={18} />} {creatingVenue ? "Creating Venue" : "Create Venue"}
              </button>
            </>
          )}
        >
          <TextField label="Venue Name" value={venueName} onChange={setVenueName} placeholder="Trades Hall Glasgow" />
          <TextField label="Address" value={venueAddress} onChange={setVenueAddress} placeholder="85 Glassford Street, Glasgow G1 1UH" />
          <div className="admin-panel-slug-preview" aria-live="polite">
            Slug: {generatedVenueSlug !== "" ? generatedVenueSlug : "auto-generated from name"}
          </div>
        </FormModal>
      ) : null}
    </section>
  );
}
