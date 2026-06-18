import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactElement } from "react";
import { BadgeCheck, Building2, CircleAlert, ClipboardCheck, RefreshCw, Send, ShieldCheck, UserPlus } from "lucide-react";
import type { BillingProvider, OnboardingSummary, WorkspaceEntitlement } from "@omnitwin/types";
import { createManagedOnboarding, getOnboardingSummary } from "../../api/onboarding.js";
import { useToastStore } from "../../stores/toast-store.js";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly data: OnboardingSummary }
  | { readonly status: "error"; readonly message: string };

interface FormState {
  readonly organisationName: string;
  readonly workspaceName: string;
  readonly venueName: string;
  readonly venueSlug: string;
  readonly venueAddress: string;
  readonly ownerEmail: string;
  readonly staffEmails: string;
  readonly planKey: string;
  readonly billingProvider: BillingProvider;
  readonly providerCustomerRef: string;
  readonly providerEntitlementRef: string;
  readonly providerEvidenceRef: string;
  readonly providerVerified: boolean;
  readonly accessEnforced: boolean;
}

const initialForm: FormState = {
  organisationName: "",
  workspaceName: "",
  venueName: "",
  venueSlug: "",
  venueAddress: "",
  ownerEmail: "",
  staffEmails: "",
  planKey: "managed_deployment",
  billingProvider: "none",
  providerCustomerRef: "",
  providerEntitlementRef: "",
  providerEvidenceRef: "",
  providerVerified: false,
  accessEnforced: false,
};

const shellStyle: CSSProperties = {
  display: "grid",
  gap: 18,
};

const heroStyle: CSSProperties = {
  border: "1px solid rgba(215,181,109,0.22)",
  borderRadius: 8,
  background: "linear-gradient(135deg, #120f0c 0%, #262018 70%, #15110d 100%)",
  color: "#fff7e8",
  padding: 22,
  boxShadow: "0 24px 70px rgba(35, 24, 12, 0.18)",
};

const panelStyle: CSSProperties = {
  border: "1px solid rgba(92, 69, 38, 0.18)",
  borderRadius: 8,
  background: "linear-gradient(180deg, #fffdf8 0%, #f7efe1 100%)",
  padding: 18,
  boxShadow: "0 18px 42px rgba(44, 31, 16, 0.08)",
};

const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: 6,
  color: "#5d4a2d",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: 0,
  textTransform: "uppercase",
};

const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: 40,
  border: "1px solid rgba(92, 69, 38, 0.22)",
  borderRadius: 8,
  background: "#fffaf1",
  color: "#21190f",
  padding: "8px 10px",
  fontFamily: "inherit",
  fontSize: 14,
  boxSizing: "border-box",
};

const primaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 40,
  border: 0,
  borderRadius: 8,
  background: "#21190f",
  color: "#fff7e8",
  padding: "0 14px",
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 40,
  border: "1px solid rgba(215,181,109,0.34)",
  borderRadius: 8,
  background: "rgba(255,250,241,0.08)",
  color: "#fff7e8",
  padding: "0 14px",
  fontWeight: 800,
  cursor: "pointer",
};

const mutedTextStyle: CSSProperties = {
  margin: 0,
  color: "#75644c",
  fontSize: 13,
  lineHeight: 1.5,
};

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseStaffEmails(raw: string): readonly string[] {
  const unique = new Set<string>();
  raw
    .split(/[\n,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0)
    .forEach((item) => { unique.add(item); });
  return [...unique];
}

function entitlementTone(entitlement: WorkspaceEntitlement): "ready" | "review" | "blocked" {
  if (entitlement.accessEnforced && entitlement.providerVerificationStatus === "provider_verified") return "ready";
  if (entitlement.providerVerificationStatus === "provider_verified") return "review";
  return "blocked";
}

function statusChip(label: string, tone: "ready" | "review" | "blocked"): ReactElement {
  const colours: Record<typeof tone, { readonly bg: string; readonly color: string; readonly border: string }> = {
    ready: { bg: "#e8f7ef", color: "#0f6a42", border: "rgba(15,106,66,0.18)" },
    review: { bg: "#fff4d6", color: "#8a5a00", border: "rgba(138,90,0,0.2)" },
    blocked: { bg: "#fee2e2", color: "#991b1b", border: "rgba(153,27,27,0.18)" },
  };
  const colour = colours[tone];
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      minHeight: 24,
      borderRadius: 999,
      border: `1px solid ${colour.border}`,
      background: colour.bg,
      color: colour.color,
      padding: "0 10px",
      fontSize: 12,
      fontWeight: 800,
    }}>
      {label}
    </span>
  );
}

function metricPanel(icon: ReactElement, label: string, value: string, note: string): ReactElement {
  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#6b542f" }}>
        {icon}
        <p style={labelStyle}>{label}</p>
      </div>
      <p style={{ margin: "8px 0 4px", color: "#21190f", fontSize: 28, fontWeight: 850, lineHeight: 1 }}>
        {value}
      </p>
      <p style={mutedTextStyle}>{note}</p>
    </div>
  );
}

export function OnboardingView(): ReactElement {
  const addToast = useToastStore((state) => state.addToast);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [form, setForm] = useState<FormState>(initialForm);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback((): void => {
    setLoadState({ status: "loading" });
    void getOnboardingSummary()
      .then((data) => { setLoadState({ status: "loaded", data }); })
      .catch((error: unknown) => {
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Onboarding records are unavailable.",
        });
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const summary = loadState.status === "loaded" ? loadState.data : null;
  const staffInviteCount = useMemo(() => parseStaffEmails(form.staffEmails).length, [form.staffEmails]);
  const pendingProviderCount = summary?.entitlements.filter((entitlement) => entitlement.providerVerificationStatus !== "provider_verified").length ?? 0;
  const enforcedAccessCount = summary?.entitlements.filter((entitlement) => entitlement.accessEnforced).length ?? 0;
  const reviewQueueCount = summary?.projects.filter((project) => project.operatorReviewState !== "approved").length ?? 0;

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleVenueNameChange = (value: string): void => {
    setForm((current) => ({
      ...current,
      venueName: value,
      venueSlug: current.venueSlug.length === 0 || current.venueSlug === slugify(current.venueName)
        ? slugify(value)
        : current.venueSlug,
    }));
  };

  const submitDisabled = submitting ||
    form.organisationName.trim().length === 0 ||
    form.venueName.trim().length === 0 ||
    form.venueSlug.trim().length === 0 ||
    form.venueAddress.trim().length === 0 ||
    form.ownerEmail.trim().length === 0 ||
    form.planKey.trim().length === 0;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitDisabled) return;

    setSubmitting(true);
    try {
      await createManagedOnboarding({
        organisationName: form.organisationName,
        workspaceName: form.workspaceName.trim().length > 0 ? form.workspaceName : undefined,
        venue: {
          name: form.venueName,
          slug: form.venueSlug,
          address: form.venueAddress,
          logoUrl: null,
          brandColour: null,
          timezone: "Europe/London",
        },
        ownerInvite: {
          email: form.ownerEmail,
          workspaceRole: "owner",
          venueRole: "staff",
        },
        staffInvites: parseStaffEmails(form.staffEmails).map((email) => ({
          email,
          workspaceRole: "staff",
          venueRole: "staff",
        })),
        entitlement: {
          planKey: form.planKey,
          billingProvider: form.billingProvider,
          providerCustomerRef: nullableText(form.providerCustomerRef),
          providerEntitlementRef: nullableText(form.providerEntitlementRef),
          providerEvidenceRef: nullableText(form.providerEvidenceRef),
          providerVerified: form.providerVerified,
          accessEnforced: form.accessEnforced,
        },
        operatorReviewNote: "Operator review required before deployment is marked ready.",
      });
      addToast("Workspace onboarding created", "success");
      setForm(initialForm);
      load();
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Failed to create onboarding workspace", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadState.status === "loading") {
    return (
      <section style={panelStyle} aria-live="polite">
        <p style={labelStyle}>Workspace onboarding</p>
        <h2 style={{ margin: "8px 0", color: "#21190f", fontSize: 22 }}>Loading managed rollout records</h2>
        <p style={mutedTextStyle}>Organisation, workspace, invite, and entitlement records are loading.</p>
      </section>
    );
  }

  if (loadState.status === "error") {
    return (
      <section style={panelStyle} role="alert">
        <p style={labelStyle}>Workspace onboarding</p>
        <h2 style={{ margin: "8px 0", color: "#991b1b", fontSize: 22 }}>Onboarding unavailable</h2>
        <p style={{ ...mutedTextStyle, marginBottom: 14 }}>{loadState.message}</p>
        <button type="button" onClick={load} style={{ ...primaryButtonStyle, width: "auto" }}>
          <RefreshCw size={16} aria-hidden="true" /> Retry
        </button>
      </section>
    );
  }

  const data = loadState.data;

  return (
    <div style={shellStyle}>
      <section style={heroStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 18 }}>
          <div>
            <p style={{ margin: 0, color: "#d7b56d", fontSize: 12, fontWeight: 900, textTransform: "uppercase" }}>
              Operator console
            </p>
            <h2 style={{ margin: "8px 0 6px", fontSize: 30, lineHeight: 1.05, letterSpacing: 0 }}>
              Workspace onboarding
            </h2>
            <p style={{ margin: 0, maxWidth: 760, color: "rgba(255,247,232,0.72)", lineHeight: 1.5 }}>
              Create the organisation, workspace, venue record, owner invitation, staff invitations, and entitlement record as one reviewed rollout.
            </p>
          </div>
          <button type="button" onClick={load} style={secondaryButtonStyle}>
            <RefreshCw size={16} aria-hidden="true" /> Refresh
          </button>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14 }}>
        {metricPanel(<Building2 size={18} aria-hidden="true" />, "Workspaces", String(data.workspaces.length), "Managed rollout records")}
        {metricPanel(<UserPlus size={18} aria-hidden="true" />, "Pending invites", String(data.memberships.filter((member) => member.status === "invited").length), "Owner and staff access")}
        {metricPanel(<ShieldCheck size={18} aria-hidden="true" />, "Access enforced", String(enforcedAccessCount), "Provider-verified only")}
        {metricPanel(<ClipboardCheck size={18} aria-hidden="true" />, "Review queue", String(reviewQueueCount), "Operator gates not approved")}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 18, alignItems: "start" }}>
        <form style={panelStyle} onSubmit={(event) => { void handleSubmit(event); }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
            <div>
              <p style={labelStyle}>New managed workspace</p>
              <h3 style={{ margin: 0, color: "#21190f", fontSize: 20 }}>Sales handoff package</h3>
            </div>
            <button type="submit" style={primaryButtonStyle} disabled={submitDisabled} data-testid="create-onboarding-workspace">
              <Send size={16} aria-hidden="true" /> {submitting ? "Creating" : "Create"}
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
            <label>
              <span style={labelStyle}>Organisation</span>
              <input
                value={form.organisationName}
                onChange={(event) => { setField("organisationName", event.target.value); }}
                style={inputStyle}
                placeholder="Trades Hall Trust"
                data-testid="organisation-name"
              />
            </label>
            <label>
              <span style={labelStyle}>Workspace</span>
              <input
                value={form.workspaceName}
                onChange={(event) => { setField("workspaceName", event.target.value); }}
                style={inputStyle}
                placeholder="Trades Hall deployment"
              />
            </label>
            <label>
              <span style={labelStyle}>Venue</span>
              <input
                value={form.venueName}
                onChange={(event) => { handleVenueNameChange(event.target.value); }}
                style={inputStyle}
                placeholder="Trades Hall Glasgow"
                data-testid="venue-name"
              />
            </label>
            <label>
              <span style={labelStyle}>Venue slug</span>
              <input
                value={form.venueSlug}
                onChange={(event) => { setField("venueSlug", event.target.value); }}
                style={inputStyle}
                placeholder="trades-hall-glasgow"
                data-testid="venue-slug"
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              <span style={labelStyle}>Address</span>
              <input
                value={form.venueAddress}
                onChange={(event) => { setField("venueAddress", event.target.value); }}
                style={inputStyle}
                placeholder="85 Glassford Street, Glasgow G1 1UH"
                data-testid="venue-address"
              />
            </label>
            <label>
              <span style={labelStyle}>Workspace owner email</span>
              <input
                value={form.ownerEmail}
                onChange={(event) => { setField("ownerEmail", event.target.value); }}
                style={inputStyle}
                placeholder="owner@venue.example"
                data-testid="owner-email"
              />
            </label>
            <label>
              <span style={labelStyle}>Plan key</span>
              <input
                value={form.planKey}
                onChange={(event) => { setField("planKey", event.target.value); }}
                style={inputStyle}
                placeholder="managed_deployment"
                data-testid="plan-key"
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              <span style={labelStyle}>Staff invite emails</span>
              <textarea
                value={form.staffEmails}
                onChange={(event) => { setField("staffEmails", event.target.value); }}
                style={{ ...inputStyle, minHeight: 88, resize: "vertical" }}
                placeholder="events@venue.example&#10;ops@venue.example"
                data-testid="staff-emails"
              />
            </label>
          </div>
        </form>

        <aside style={panelStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ShieldCheck size={18} aria-hidden="true" />
            <p style={labelStyle}>Entitlement gate</p>
          </div>
          <h3 style={{ margin: "8px 0", color: "#21190f", fontSize: 20 }}>Provider verification</h3>
          <p style={mutedTextStyle}>Access enforcement requires provider verification and a customer, entitlement, or evidence reference.</p>

          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <label>
              <span style={labelStyle}>Billing provider</span>
              <select
                value={form.billingProvider}
                onChange={(event) => { setField("billingProvider", event.target.value as BillingProvider); }}
                style={inputStyle}
                data-testid="billing-provider"
              >
                <option value="none">None</option>
                <option value="stripe">Stripe</option>
                <option value="manual_invoice">Manual invoice</option>
                <option value="external_procurement">External procurement</option>
              </select>
            </label>
            <label>
              <span style={labelStyle}>Customer ref</span>
              <input
                value={form.providerCustomerRef}
                onChange={(event) => { setField("providerCustomerRef", event.target.value); }}
                style={inputStyle}
                placeholder="cus_..."
              />
            </label>
            <label>
              <span style={labelStyle}>Entitlement ref</span>
              <input
                value={form.providerEntitlementRef}
                onChange={(event) => { setField("providerEntitlementRef", event.target.value); }}
                style={inputStyle}
                placeholder="subscription or invoice id"
              />
            </label>
            <label>
              <span style={labelStyle}>Evidence ref</span>
              <input
                value={form.providerEvidenceRef}
                onChange={(event) => { setField("providerEvidenceRef", event.target.value); }}
                style={inputStyle}
                placeholder="review ticket or receipt id"
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, color: "#21190f", fontSize: 13, fontWeight: 800 }}>
              <input
                type="checkbox"
                checked={form.providerVerified}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    providerVerified: event.target.checked,
                    accessEnforced: event.target.checked ? current.accessEnforced : false,
                  }));
                }}
              />
              Provider verified
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, color: "#21190f", fontSize: 13, fontWeight: 800 }}>
              <input
                type="checkbox"
                checked={form.accessEnforced}
                disabled={!form.providerVerified}
                onChange={(event) => { setField("accessEnforced", event.target.checked); }}
              />
              Enforce managed access
            </label>
          </div>

          <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: "#fff4d6", color: "#7c4a03", fontSize: 13, lineHeight: 1.45 }}>
            <CircleAlert size={16} aria-hidden="true" style={{ verticalAlign: "text-bottom", marginRight: 6 }} />
            {pendingProviderCount} entitlement record(s) still need provider verification. New package includes {staffInviteCount} staff invite(s).
          </div>
        </aside>
      </section>

      <section style={panelStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <p style={labelStyle}>Rollout queue</p>
            <h3 style={{ margin: 0, color: "#21190f", fontSize: 20 }}>Workspace records</h3>
          </div>
          {statusChip(`${String(data.auditEvents.length)} audit events`, "review")}
        </div>

        {data.workspaces.length === 0 ? (
          <p style={{ ...mutedTextStyle, marginTop: 14 }}>No managed workspaces have been created yet.</p>
        ) : (
          <div style={{ marginTop: 14, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", color: "#21190f", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(92,69,38,0.18)" }}>
                  <th style={{ textAlign: "left", padding: "10px 8px" }}>Workspace</th>
                  <th style={{ textAlign: "left", padding: "10px 8px" }}>Venue</th>
                  <th style={{ textAlign: "left", padding: "10px 8px" }}>Project</th>
                  <th style={{ textAlign: "left", padding: "10px 8px" }}>Entitlement</th>
                  <th style={{ textAlign: "right", padding: "10px 8px" }}>Members</th>
                </tr>
              </thead>
              <tbody>
                {data.workspaces.map((workspace) => {
                  const venue = data.venues.find((item) => item.id === workspace.primaryVenueId);
                  const project = data.projects.find((item) => item.workspaceId === workspace.id);
                  const entitlement = data.entitlements.find((item) => item.workspaceId === workspace.id);
                  const members = data.memberships.filter((member) => member.workspaceId === workspace.id);
                  return (
                    <tr key={workspace.id} style={{ borderBottom: "1px solid rgba(92,69,38,0.1)" }}>
                      <td style={{ padding: "11px 8px", fontWeight: 800 }}>{workspace.name}</td>
                      <td style={{ padding: "11px 8px", color: "#5d4a2d" }}>{venue?.name ?? "Venue pending"}</td>
                      <td style={{ padding: "11px 8px" }}>
                        {project === undefined
                          ? statusChip("No project", "blocked")
                          : statusChip(project.operatorReviewState.replace(/_/g, " "), project.operatorReviewState === "approved" ? "ready" : "review")}
                      </td>
                      <td style={{ padding: "11px 8px" }}>
                        {entitlement === undefined
                          ? statusChip("No entitlement", "blocked")
                          : statusChip(entitlement.providerVerificationStatus.replace(/_/g, " "), entitlementTone(entitlement))}
                      </td>
                      <td style={{ padding: "11px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {members.length}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ ...panelStyle, display: "flex", alignItems: "center", gap: 10 }}>
        <BadgeCheck size={18} aria-hidden="true" />
        <p style={{ ...mutedTextStyle, color: "#3b2c1b" }}>
          Provider state is recorded separately from access control. The database and shared contracts reject access enforcement without verified provider evidence.
        </p>
      </section>
    </div>
  );
}
