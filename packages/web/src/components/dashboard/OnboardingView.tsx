import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { Building2, Check, Copy, Plus, RefreshCw, ShieldCheck, UserPlus } from "lucide-react";
import { BILLING_PROVIDERS, VENUE_INVITATION_ROLES, type BillingProvider, type CreateManagedOnboardingResult,
  type OnboardingSummary, type VenueInvitationRole, type Workspace, type WorkspaceMembership } from "@omnitwin/types";
import { createManagedOnboarding, getOnboardingSummary, inviteWorkspaceMembers, revokeWorkspaceInvitation } from "../../api/onboarding.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import { OnboardingSetupControls } from "./OnboardingSetupControls.js";
import "./OnboardingView.css";

const ROLE_LABELS: Record<VenueInvitationRole, string> = {
  admin: "Venue administrator", staff: "Events staff", hallkeeper: "Hallkeeper", planner: "Planner", client: "Client",
};
const roleHelp = "Venue administrators manage this venue's settings, inventory and operations. Venviewer platform access is separate.";
const nullableText = (value: string): string | null => value.trim() || null;
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : "The change could not be saved. Please try again.";
const slugify = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const parseEmails = (value: string): string[] => [...new Set(value.split(/[\n,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];

function RoleSelect({ value, onChange, label = "Venue role" }: {
  readonly value: VenueInvitationRole; readonly onChange: (value: VenueInvitationRole) => void; readonly label?: string;
}): ReactElement {
  return <label className="onboarding-field"><span>{label}</span><select value={value} onChange={(event) => {
    const next = VENUE_INVITATION_ROLES.find((role) => role === event.target.value); if (next !== undefined) onChange(next);
  }}>{VENUE_INVITATION_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></label>;
}

function RegistrationLink(): ReactElement {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const link = `${window.location.origin}/register`;
  const copy = async (): Promise<void> => {
    setState("copying");
    try { await navigator.clipboard.writeText(link); setState("copied"); } catch { setState("failed"); }
  };
  return <div className="onboarding-registration"><div><strong>Share the account link</strong><p>Ask each person to create an account or sign in using the exact email listed above. Access is connected after their email is verified.</p></div>
    <div className="onboarding-link-row"><input aria-label="Account registration link" value={link} readOnly onFocus={(event) => { event.target.select(); }} />
      <button type="button" className="onboarding-button onboarding-button--secondary" disabled={state === "copying"} aria-busy={state === "copying"} onClick={() => { void copy(); }}>
        {state === "copying" ? <ActivityIndicator size={18} /> : state === "copied" ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
        {state === "copied" ? "Link copied" : state === "copying" ? "Copying link…" : "Copy account link"}
      </button></div>
    {state === "failed" && <p role="alert">Copying is unavailable. Select the link above and copy it manually.</p>}
    <p className="onboarding-note">No email is sent automatically. Only the people with access recorded here can join this venue.</p>
  </div>;
}

function CreateWorkspace({ summary, onCreated, onBusy, onCancel }: {
  readonly summary: OnboardingSummary; readonly onCreated: (result: CreateManagedOnboardingResult) => void;
  readonly onBusy: (busy: boolean) => void; readonly onCancel: () => void;
}): ReactElement {
  const availableVenues = summary.venues.filter((venue) => !summary.workspaces.some((workspace) => workspace.primaryVenueId === venue.id));
  const [mode, setMode] = useState<"existing" | "new">(availableVenues.length > 0 ? "existing" : "new");
  const [existingVenueId, setExistingVenueId] = useState("");
  const [form, setForm] = useState({ organisationName: "", workspaceName: "", venueName: "", venueSlug: "", venueAddress: "", timezone: "Europe/London",
    contactEmail: "", staffEmails: "", planKey: "managed_deployment", customerRef: "", entitlementRef: "", evidenceRef: "" });
  const [venueRole, setVenueRole] = useState<VenueInvitationRole>("admin");
  const [billingProvider, setBillingProvider] = useState<BillingProvider>("none");
  const [providerVerified, setProviderVerified] = useState(false);
  const [accessEnforced, setAccessEnforced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const setField = (key: keyof typeof form, value: string): void => { setForm((current) => ({ ...current, [key]: value })); };
  const selectedVenue = availableVenues.find((venue) => venue.id === existingVenueId);
  const verifiedValid = !providerVerified || billingProvider !== "none" && [form.customerRef, form.entitlementRef, form.evidenceRef].some((value) => value.trim());
  const complete = form.organisationName.trim() !== "" && form.contactEmail.trim() !== "" && form.planKey.trim() !== "" && verifiedValid &&
    (mode === "existing" ? selectedVenue !== undefined : [form.venueName, form.venueSlug, form.venueAddress, form.timezone].every((value) => value.trim() !== ""));
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault(); if (!complete || lock.current) return;
    lock.current = true; setBusy(true); onBusy(true); setError(null);
    try {
      const result = await createManagedOnboarding({ organisationName: form.organisationName, workspaceName: form.workspaceName.trim() || undefined,
        ...(mode === "existing" ? { existingVenueId } : { venue: { name: form.venueName, slug: form.venueSlug, address: form.venueAddress,
          timezone: form.timezone, logoUrl: null, brandColour: null } }),
        ownerInvite: { email: form.contactEmail.trim().toLowerCase(), name: null, workspaceRole: "owner", venueRole },
        staffInvites: parseEmails(form.staffEmails).map((email) => ({ email, workspaceRole: "staff", venueRole: "staff" })),
        entitlement: { planKey: form.planKey, billingProvider, providerCustomerRef: nullableText(form.customerRef),
          providerEntitlementRef: nullableText(form.entitlementRef), providerEvidenceRef: nullableText(form.evidenceRef), providerVerified, accessEnforced },
        operatorReviewNote: "Review client setup before marking onboarding complete.",
      }); onCreated(result);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  };
  return <section className="onboarding-panel" aria-labelledby="new-client-title">
    <div className="onboarding-section-heading"><div><p className="onboarding-eyebrow">Welcome a client</p><h2 id="new-client-title">A venue and its first administrator.</h2></div>
      {summary.workspaces.length > 0 && <button type="button" className="onboarding-button onboarding-button--text" disabled={busy} onClick={onCancel}>Back to clients</button>}</div>
    <form onSubmit={(event) => { void submit(event); }}><fieldset disabled={busy} className="onboarding-fieldset">
      <div className="onboarding-create-grid"><div className="onboarding-form-section"><h3><span className="onboarding-step">1</span> Choose the venue</h3>
        <div className="onboarding-mode" role="group" aria-label="Venue setup"><button type="button" aria-pressed={mode === "existing"} onClick={() => { setMode("existing"); }}>Use an existing venue</button><button type="button" aria-pressed={mode === "new"} onClick={() => { setMode("new"); }}>Create a new venue</button></div>
        {mode === "existing" ? <><label className="onboarding-field"><span>Existing venue</span><select value={existingVenueId} required onChange={(event) => {
          setExistingVenueId(event.target.value); if (form.organisationName.trim() === "") setField("organisationName", availableVenues.find((venue) => venue.id === event.target.value)?.name ?? "");
        }}><option value="">Choose a venue</option>{availableVenues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}</select></label>
          <p className="onboarding-note">This connects the client to the venue's existing rooms, bookings and inventory.</p>
          {availableVenues.length === 0 && <p className="onboarding-empty">Every existing venue already has a client workspace, or no venues have been added. Choose a client above to manage its access, or create a new venue.</p>}
          {selectedVenue !== undefined && <div className="onboarding-venue-preview"><Building2 size={22} aria-hidden="true" /><div><strong>{selectedVenue.name}</strong><p>{selectedVenue.address}</p></div></div>}
        </> : <div className="onboarding-fields">
          <label className="onboarding-field"><span>Venue name</span><input required value={form.venueName} data-testid="venue-name" onChange={(event) => {
            const next = event.target.value; setForm((current) => ({ ...current, venueName: next,
              venueSlug: current.venueSlug === "" || current.venueSlug === slugify(current.venueName) ? slugify(next) : current.venueSlug }));
          }} /></label>
          <label className="onboarding-field"><span>Venue address</span><input required value={form.venueAddress} data-testid="venue-address" onChange={(event) => { setField("venueAddress", event.target.value); }} /></label>
          <label className="onboarding-field"><span>Venue web address</span><input required value={form.venueSlug} data-testid="venue-slug" onChange={(event) => { setField("venueSlug", event.target.value); }} /><small>Lowercase words separated by hyphens.</small></label>
          <label className="onboarding-field"><span>Time zone</span><input required value={form.timezone} onChange={(event) => { setField("timezone", event.target.value); }} /></label>
        </div>}
        <label className="onboarding-field"><span>Client organisation</span><input required value={form.organisationName} data-testid="organisation-name" onChange={(event) => { setField("organisationName", event.target.value); }} /></label>
      </div><div className="onboarding-form-section onboarding-form-section--contact"><h3><span className="onboarding-step">2</span> Give your contact access</h3>
        <label className="onboarding-field"><span>First administrator email</span><input type="email" required value={form.contactEmail} autoComplete="off" data-testid="owner-email" onChange={(event) => { setField("contactEmail", event.target.value); }} /></label>
        <RoleSelect value={venueRole} onChange={setVenueRole} label="First contact's venue role" />
        <p className="onboarding-note"><ShieldCheck size={18} aria-hidden="true" /> {roleHelp}</p>
        <div className="onboarding-next"><strong>They create their own account.</strong><p>After you save, share the account link. Their verified email connects them to the access you grant here.</p></div>
      </div></div>
      <details className="onboarding-details"><summary>Team, billing and setup options</summary><div className="onboarding-fields onboarding-fields--two">
        <label className="onboarding-field"><span>Workspace name (optional)</span><input value={form.workspaceName} onChange={(event) => { setField("workspaceName", event.target.value); }} /></label>
        <label className="onboarding-field"><span>Additional staff emails (optional)</span><textarea value={form.staffEmails} data-testid="staff-emails" onChange={(event) => { setField("staffEmails", event.target.value); }} /><small>Separate addresses with commas or new lines. These people receive Events staff access.</small></label>
        <label className="onboarding-field"><span>Plan key</span><input required value={form.planKey} data-testid="plan-key" onChange={(event) => { setField("planKey", event.target.value); }} /></label>
        <label className="onboarding-field"><span>Billing provider</span><select value={billingProvider} data-testid="billing-provider" onChange={(event) => {
          const value = BILLING_PROVIDERS.find((provider) => provider === event.target.value); if (value !== undefined) setBillingProvider(value);
        }}>{BILLING_PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider.replace(/_/g, " ")}</option>)}</select></label>
        <label className="onboarding-field"><span>Customer reference</span><input value={form.customerRef} onChange={(event) => { setField("customerRef", event.target.value); }} /></label>
        <label className="onboarding-field"><span>Entitlement reference</span><input value={form.entitlementRef} onChange={(event) => { setField("entitlementRef", event.target.value); }} /></label>
        <label className="onboarding-field"><span>Provider evidence reference</span><input value={form.evidenceRef} onChange={(event) => { setField("evidenceRef", event.target.value); }} /></label>
        <div className="onboarding-fields"><label className="onboarding-checkbox"><input type="checkbox" checked={providerVerified} onChange={(event) => { setProviderVerified(event.target.checked); if (!event.target.checked) setAccessEnforced(false); }} />Provider verified</label>
          <label className="onboarding-checkbox"><input type="checkbox" checked={accessEnforced} disabled={!providerVerified} onChange={(event) => { setAccessEnforced(event.target.checked); }} />Enforce managed access</label></div>
        {!verifiedValid && <p className="onboarding-error" role="alert">Provider verification requires a billing provider and a customer, entitlement or evidence reference.</p>}
      </div></details>
    </fieldset>{error !== null && <p className="onboarding-error" role="alert">{error}</p>}
    <div className="onboarding-form-footer"><p>No email will be sent. Existing venue records are preserved.</p><button type="submit" className="onboarding-button" data-testid="create-onboarding-workspace" disabled={!complete || busy} aria-busy={busy}>
      {busy ? <ActivityIndicator size={18} /> : <Plus size={18} aria-hidden="true" />}{busy ? "Creating workspace…" : "Create client workspace"}
    </button></div></form>
  </section>;
}

function membershipState(member: WorkspaceMembership, summary: OnboardingSummary): { readonly label: string; readonly tone: string; readonly expiresAt: string | null } {
  const invitation = summary.invitations.find((invite) => invite.id === member.invitationId);
  if (member.status === "active") return { label: "Account connected", tone: "active", expiresAt: null };
  if (member.status === "removed" || invitation?.status === "revoked") return { label: "Invitation cancelled", tone: "muted", expiresAt: null };
  if (member.status === "suspended") return { label: "Access suspended", tone: "muted", expiresAt: null };
  if (invitation?.status === "expired" || invitation?.expiresAt != null && new Date(invitation.expiresAt).getTime() <= Date.now()) return { label: "Invitation expired", tone: "expired", expiresAt: invitation?.expiresAt ?? null };
  return { label: "Awaiting sign-in", tone: "pending", expiresAt: invitation?.expiresAt ?? null };
}

function WorkspaceAccess({ workspace, summary, onChanged, onBusy }: {
  readonly workspace: Workspace; readonly summary: OnboardingSummary; readonly onChanged: () => Promise<void>; readonly onBusy: (busy: boolean) => void;
}): ReactElement {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<VenueInvitationRole>("admin");
  const [editing, setEditing] = useState<string | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const members = summary.memberships.filter((member) => member.workspaceId === workspace.id);
  const venue = summary.venues.find((item) => item.id === workspace.primaryVenueId);
  const organisation = summary.organisations.find((item) => item.id === workspace.organisationId);
  const saveAccess = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault(); if (lock.current) return;
    lock.current = true; setBusy("grant"); onBusy(true); setError(null); setNotice(null);
    try {
      const result = await inviteWorkspaceMembers(workspace.id, { staffInvites: [{ email: email.trim().toLowerCase(), name: null, workspaceRole: role, venueRole: role }] });
      setNotice(result.memberships[0]?.status === "active" ? `Access is connected for ${email.trim()}.` : `Access recorded for ${email.trim()}. It will connect on their next verified sign-in.`);
      setEmail(""); setEditing(null); setRole("admin"); await onChanged();
    } catch (failure) { setError(errorMessage(failure)); } finally { lock.current = false; setBusy(null); onBusy(false); }
  };
  const revoke = async (member: WorkspaceMembership): Promise<void> => {
    if (lock.current) return;
    lock.current = true; setBusy(member.id); onBusy(true); setError(null); setNotice(null);
    try { await revokeWorkspaceInvitation(workspace.id, member.id); setNotice(`Invitation cancelled for ${member.email}.`); await onChanged(); }
    catch (failure) { setError(errorMessage(failure)); } finally { lock.current = false; setBusy(null); onBusy(false); }
  };
  return <section className="onboarding-panel" aria-labelledby="client-workspace-title">
    <div className="onboarding-section-heading"><div><p className="onboarding-eyebrow">{organisation?.name ?? "Client workspace"}</p><h2 id="client-workspace-title">{venue?.name ?? workspace.name}</h2><p>{workspace.name}</p></div>
      <div className="onboarding-counts"><span><strong>{members.filter((member) => member.status === "active").length}</strong> connected</span><span><strong>{members.filter((member) => membershipState(member, summary).tone === "pending").length}</strong> awaiting sign-in</span></div></div>
    <div className="onboarding-access-grid"><div><h3>People & access</h3><p className="onboarding-note">Each role applies to this venue. New and updated access connects when the person signs in with their verified email.</p>
      {members.length === 0 ? <p className="onboarding-empty">No people have been given access yet. Add your first venue administrator.</p> : <ul className="onboarding-members">{members.map((member) => {
        const state = membershipState(member, summary);
        return <li key={member.id} className="onboarding-member"><div className="onboarding-member-main"><strong>{member.email}</strong><span>{ROLE_LABELS[member.venueRole]}</span><span className={`onboarding-status onboarding-status--${state.tone}`}>{state.label}</span>
          {state.expiresAt !== null && <small>{state.tone === "expired" ? "Expired" : "Sign in by"} {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(state.expiresAt))}</small>}</div>
          <div className="onboarding-member-actions"><button type="button" className="onboarding-button onboarding-button--text" disabled={busy !== null} aria-label={`Manage access for ${member.email}`} onClick={() => {
            setEditing(member.id); setEmail(member.email); setRole(member.venueRole); setError(null); setNotice(null); document.getElementById("client-access-email")?.focus();
          }}>Manage access</button>
          {member.status === "invited" && <button type="button" className="onboarding-button onboarding-button--text" disabled={busy !== null} aria-busy={busy === member.id} aria-label={`Cancel invitation for ${member.email}`} onClick={() => { void revoke(member); }}>
            {busy === member.id && <ActivityIndicator size={16} />}{busy === member.id ? "Cancelling…" : "Cancel invitation"}</button>}</div></li>;
      })}</ul>}
    </div><form className="onboarding-grant" onSubmit={(event) => { void saveAccess(event); }} aria-label="Grant venue access"><h3>{editing === null ? "Give someone access" : "Update venue access"}</h3>
      <fieldset disabled={busy !== null} className="onboarding-fieldset onboarding-fields">
        <label className="onboarding-field"><span>Email address</span><input id="client-access-email" type="email" required value={email} readOnly={editing !== null} onChange={(event) => { setEmail(event.target.value); }} /></label>
        <RoleSelect value={role} onChange={setRole} /><p className="onboarding-note">{roleHelp}</p>
        {editing !== null && <p className="onboarding-note">Saving renews pending or expired invitations and applies the selected role on their next verified sign-in.</p>}
        <button type="submit" className="onboarding-button" disabled={email.trim() === ""} aria-busy={busy === "grant"}>
          {busy === "grant" ? <ActivityIndicator size={18} /> : <UserPlus size={18} aria-hidden="true" />}{busy === "grant" ? "Saving access…" : editing === null ? "Grant venue access" : "Save venue access"}</button>
        {editing !== null && <button type="button" className="onboarding-button onboarding-button--text" onClick={() => { setEditing(null); setEmail(""); setRole("admin"); }}>Cancel editing</button>}
      </fieldset></form></div>
    {error !== null && <p className="onboarding-error" role="alert">{error}</p>}{notice !== null && <p className="onboarding-success" role="status">{notice}</p>}
    <RegistrationLink /><OnboardingSetupControls workspace={workspace} project={summary.projects.find((item) => item.workspaceId === workspace.id)}
      entitlement={summary.entitlements.find((item) => item.workspaceId === workspace.id)} onChanged={onChanged} onBusy={onBusy} />
  </section>;
}

export function OnboardingView(): ReactElement {
  const [summary, setSummary] = useState<OnboardingSummary | null>(null); const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null); const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false); const [busy, setBusy] = useState(false); const [createdEmail, setCreatedEmail] = useState<string | null>(null);
  const requestId = useRef(0);
  const load = useCallback(async (): Promise<void> => {
    const request = ++requestId.current; setLoading(true); setError(null);
    try { const data = await getOnboardingSummary(); if (request === requestId.current) setSummary(data); }
    catch (failure) { if (request === requestId.current) setError(errorMessage(failure)); }
    finally { if (request === requestId.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => { requestId.current++; }; }, [load]);
  const workspace = summary?.workspaces.find((item) => item.id === selectedId) ?? summary?.workspaces[0];
  const showCreate = creating || summary?.workspaces.length === 0;
  const handleCreated = (result: CreateManagedOnboardingResult): void => {
    // Keep the confirmed mutation visible if the subsequent read fails.
    setSummary((current) => current === null ? current : { ...current, organisations: [...current.organisations, result.organisation], workspaces: [...current.workspaces, result.workspace],
      venues: [...current.venues.filter((venue) => venue.id !== result.venue.id), result.venue], memberships: [...current.memberships, result.ownerMembership, ...result.staffMemberships],
      projects: [...current.projects, result.project], entitlements: [...current.entitlements, result.entitlement] });
    setCreatedEmail(result.ownerMembership.email); setSelectedId(result.workspace.id); setCreating(false); void load();
  };
  return <div className="onboarding-shell"><header className="onboarding-hero"><div><p className="onboarding-eyebrow">Venviewer · client relationships</p><h1>A welcome that opens the right doors.</h1><p>Bring a venue into Venviewer, give its people the right access, and see who is ready to work.</p></div><div className="onboarding-hero-mark" aria-hidden="true"><Building2 strokeWidth={0.8} /><span>Places.<br />People.<br />Possibilities.</span></div></header>
    <div className="onboarding-toolbar"><div><h2>Clients & access</h2><p>Venviewer platform administration</p></div><div className="onboarding-toolbar-actions">
      {summary !== null && summary.workspaces.length > 0 && <label className="onboarding-field"><span className="onboarding-sr-only">Client workspace</span><select disabled={busy} value={showCreate ? "" : workspace?.id ?? ""} onChange={(event) => { setSelectedId(event.target.value); setCreating(false); setCreatedEmail(null); }}><option value="" disabled>Choose a client</option>{summary.workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <button type="button" className="onboarding-button onboarding-button--secondary" disabled={loading || busy} onClick={() => { void load(); }} aria-label="Refresh clients"><RefreshCw size={17} aria-hidden="true" />Refresh</button>
      {summary !== null && !showCreate && <button type="button" className="onboarding-button" disabled={busy} onClick={() => { setCreating(true); setCreatedEmail(null); }}><Plus size={18} aria-hidden="true" />Add client</button>}
    </div></div>
    {loading && <ActivityStatus variant={summary === null ? "panel" : "inline"}>{summary === null ? "Loading client workspaces…" : "Refreshing client access…"}</ActivityStatus>}
    {error !== null && <div className="onboarding-error" role="alert"><strong>{summary === null ? "Client workspaces are unavailable." : "The latest access state could not be loaded."}</strong><p>{error}</p><button type="button" className="onboarding-button onboarding-button--secondary" disabled={loading || busy} onClick={() => { void load(); }}>Retry</button></div>}
    {summary !== null && showCreate && <CreateWorkspace summary={summary} onCreated={handleCreated} onBusy={setBusy} onCancel={() => { setCreating(false); }} />}
    {summary !== null && !showCreate && workspace !== undefined && <>{createdEmail !== null && <div role="status" className="onboarding-success">Client workspace created. Access is recorded for {createdEmail}; share the account link below.</div>}
      <WorkspaceAccess key={workspace.id} workspace={workspace} summary={summary} onChanged={load} onBusy={setBusy} /></>}
  </div>;
}
