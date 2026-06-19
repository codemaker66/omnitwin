import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import type { FloorPlanPoint } from "@omnitwin/types";
import * as spacesApi from "../../api/spaces.js";
import * as pricingApi from "../../api/pricing.js";
import type { Venue, VenueDetail, Space } from "../../api/spaces.js";
import type { PricingRule } from "../../api/pricing.js";
import { useFocusTrap } from "../../lib/use-focus-trap.js";
import { useToastStore } from "../../stores/toast-store.js";
import { ConfirmModal } from "../shared/ConfirmModal.js";
import { PolygonEditor } from "./PolygonEditor.js";
import "./AdminPanel.css";

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

interface FormModalProps {
  readonly title: string;
  readonly description: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer: ReactNode;
  readonly wide?: boolean;
}

function FormModal({ title, description, onClose, children, footer, wide = false }: FormModalProps): ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>();
  const titleId = `${slugify(title)}-modal-title`;
  const descriptionId = `${slugify(title)}-modal-description`;

  return (
    <div
      className="admin-panel-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
      onClick={onClose}
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
          <p className="admin-panel-kicker">Admin record</p>
          <h3 id={titleId}>{title}</h3>
          <p id={descriptionId}>{description}</p>
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
  readonly placeholder?: string;
  readonly type?: "text" | "number";
  readonly step?: string;
  readonly min?: string;
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  step,
  min,
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
        onChange={(event) => {
          onChange(event.target.value);
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
  readonly body: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

function StatusPanel({ title, body, actionLabel, onAction }: StatusPanelProps): ReactElement {
  return (
    <section className="admin-panel-state" role={onAction === undefined ? "status" : "alert"}>
      <p className="admin-panel-kicker">Admin registry</p>
      <h2>{title}</h2>
      <p>{body}</p>
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

  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [creatingRule, setCreatingRule] = useState(false);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [ruleType, setRuleType] = useState<PricingRule["type"]>("flat_rate");
  const [ruleAmount, setRuleAmount] = useState("");
  const [ruleSpaceId, setRuleSpaceId] = useState("");

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
  const createRuleDisabled = creatingRule || ruleName.trim() === "" || ruleAmount.trim() === "";

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

  const loadPricingRules = useCallback((venueId: string): void => {
    setPricingError(null);
    void pricingApi.listPricingRules(venueId)
      .then((rules) => {
        setPricingRules(rules);
      })
      .catch((error: unknown) => {
        setPricingError(actionError(error, "Pricing rules could not be loaded."));
      });
  }, []);

  useEffect(() => {
    loadVenues();
  }, [loadVenues]);

  const handleSelectVenue = useCallback((venueId: string): void => {
    setVenueDetailError(null);
    setLoadingVenueId(venueId);
    setPricingRules([]);
    setPricingError(null);
    void spacesApi.getVenue(venueId)
      .then((venue) => {
        setSelectedVenue(venue);
        loadPricingRules(venue.id);
      })
      .catch((error: unknown) => {
        const message = actionError(error, "Failed to load venue");
        setVenueDetailError(message);
        addToast(message, "error");
      })
      .finally(() => {
        setLoadingVenueId(null);
      });
  }, [addToast, loadPricingRules]);

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
      addToast(actionError(error, "Failed to create space"), "error");
    } finally {
      setCreatingSpace(false);
    }
  };

  const handleDeleteVenue = async (): Promise<void> => {
    if (selectedVenue === null || deletingVenue) return;
    setDeletingVenue(true);
    try {
      await spacesApi.deleteVenue(selectedVenue.id);
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
      setDeletingSpaceId(null);
      handleSelectVenue(selectedVenue.id);
    } catch (error: unknown) {
      addToast(actionError(error, "Failed to delete space"), "error");
    } finally {
      setDeletingSpace(false);
    }
  };

  const handleCreateRule = async (): Promise<void> => {
    if (selectedVenue === null || createRuleDisabled) return;
    const amount = Number.parseFloat(ruleAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      addToast("Amount must be a non-negative number", "error");
      return;
    }
    setCreatingRule(true);
    try {
      await pricingApi.createPricingRule(selectedVenue.id, {
        name: ruleName.trim(),
        type: ruleType,
        amount,
        spaceId: ruleSpaceId !== "" ? ruleSpaceId : null,
      });
      addToast("Pricing rule created", "success");
      setShowCreateRule(false);
      setRuleName("");
      setRuleAmount("");
      setRuleSpaceId("");
      loadPricingRules(selectedVenue.id);
    } catch (error: unknown) {
      addToast(actionError(error, "Failed to create pricing rule"), "error");
    } finally {
      setCreatingRule(false);
    }
  };

  const handleDeleteRule = async (ruleId: string): Promise<void> => {
    if (selectedVenue === null || deletingRuleId !== null) return;
    setDeletingRuleId(ruleId);
    try {
      await pricingApi.deletePricingRule(selectedVenue.id, ruleId);
      addToast("Pricing rule deleted", "success");
      loadPricingRules(selectedVenue.id);
    } catch (error: unknown) {
      addToast(actionError(error, "Failed to delete pricing rule"), "error");
    } finally {
      setDeletingRuleId(null);
    }
  };

  if (loading) {
    return <StatusPanel title="Loading venues" body="Venue, room, and pricing registry records are loading." />;
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
          onClick={() => {
            setSelectedVenue(null);
          }}
        >
          Back to venues
        </button>

        <header className="admin-panel-header">
          <div>
            <p className="admin-panel-kicker">Admin venue record</p>
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
              <p className="admin-panel-kicker">Room registry</p>
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
              <p className="admin-panel-kicker">Commercial registry</p>
              <h3 id="admin-panel-pricing-title">Room Hire Pricing</h3>
            </div>
            <button
              type="button"
              className="admin-panel-button admin-panel-button--primary"
              onClick={() => {
                setShowCreateRule(true);
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

          {pricingRules.length === 0 ? (
            <div className="admin-panel-empty">No pricing rules configured.</div>
          ) : (
            <div className="admin-panel-table-wrap">
              <table className="admin-panel-table">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Amount</th>
                    <th>Type</th>
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
                      <td>
                        <span className={`admin-panel-chip ${rule.isActive ? "admin-panel-chip--ready" : "admin-panel-chip--blocked"}`}>
                          {rule.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="admin-panel-button admin-panel-button--danger-subtle"
                          aria-label={`Delete pricing rule ${rule.name}`}
                          disabled={deletingRuleId !== null}
                          onClick={() => {
                            void handleDeleteRule(rule.id);
                          }}
                        >
                          {deletingRuleId === rule.id ? "Deleting" : "Delete"}
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
            description="Create a room record with planning geometry. The polygon must describe a real floor outline before the space can be saved."
            wide
            onClose={() => {
              if (creatingSpace) return;
              setShowCreateSpace(false);
              setSpaceOutline([]);
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
                  {creatingSpace ? "Creating Space" : "Create Space"}
                </button>
              </>
            )}
          >
            <TextField label="Space Name" value={spaceName} onChange={setSpaceName} placeholder="Grand Hall" />
            <div className="admin-panel-field admin-panel-field--wide">
              <span>Floor plan</span>
              <PolygonEditor value={spaceOutline} onChange={setSpaceOutline} disabled={creatingSpace} />
            </div>
            <TextField label="Height (m)" value={spaceHeight} onChange={setSpaceHeight} type="number" step="0.1" min="0" placeholder="7" />
          </FormModal>
        ) : null}

        {showCreateRule ? (
          <FormModal
            title="New Pricing Rule"
            description="Create an auditable room-hire rule. Proposal pricing can only be trusted when the underlying rule is explicit."
            onClose={() => {
              if (!creatingRule) setShowCreateRule(false);
            }}
            footer={(
              <>
                <button
                  type="button"
                  className="admin-panel-button admin-panel-button--secondary"
                  disabled={creatingRule}
                  onClick={() => {
                    setShowCreateRule(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="admin-panel-button admin-panel-button--primary"
                  disabled={createRuleDisabled}
                  onClick={() => {
                    void handleCreateRule();
                  }}
                >
                  {creatingRule ? "Creating Rule" : "Create Rule"}
                </button>
              </>
            )}
          >
            <TextField label="Rule Name" value={ruleName} onChange={setRuleName} placeholder="Grand Hall Half Day" />
            <SelectField label="Space (optional)" value={ruleSpaceId} onChange={setRuleSpaceId}>
              <option value="">Venue-wide</option>
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
              <option value="tiered">Tiered</option>
            </SelectField>
            <TextField label="Amount (GBP)" value={ruleAmount} onChange={setRuleAmount} type="number" step="0.01" min="0" placeholder="500" />
          </FormModal>
        ) : null}

        {showDeleteVenue ? (
          <ConfirmModal
            title="Delete Venue"
            message={`Delete "${selectedVenue.name}"? Spaces, pricing rules, configurations, and linked loadout references will be permanently removed.`}
            confirmLabel={deletingVenue ? "Deleting" : "Delete"}
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
            message="Delete this space? Associated configurations and loadouts will be removed."
            confirmLabel={deletingSpace ? "Deleting" : "Delete"}
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
            description="Update the authoritative room record. Geometry changes should only be saved when they match the reviewed floor-plan source."
            wide
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
                  {updatingSpace ? "Saving Changes" : "Save Changes"}
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
          <p>Authoritative venue records, room geometry, and room-hire pricing.</p>
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
                {loadingVenueId === venue.id ? "Loading" : "Open venue"}
              </span>
            </button>
          ))}
        </div>
      )}

      {showCreateVenue ? (
        <FormModal
          title="New Venue"
          description="Create the venue record that rooms, runtime packages, proposals, and staff access will attach to."
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
                {creatingVenue ? "Creating Venue" : "Create Venue"}
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
