import { useRef, useState, type ReactElement } from "react";
import { BILLING_PROVIDERS, ONBOARDING_PROJECT_STATUSES, OPERATOR_REVIEW_STATES, PROVIDER_VERIFICATION_STATUSES,
  type OnboardingProject, type Workspace, type WorkspaceEntitlement } from "@omnitwin/types";
import { updateOnboardingProject, verifyWorkspaceEntitlement } from "../../api/onboarding.js";
import { ActivityIndicator } from "../shared/Activity.js";

const labelize = (value: string): string => value.replace(/_/g, " ");
const nullableText = (value: string | null): string | null => value?.trim() || null;

export function OnboardingSetupControls({ workspace, project, entitlement, onChanged, onBusy }: {
  readonly workspace: Workspace; readonly project?: OnboardingProject; readonly entitlement?: WorkspaceEntitlement;
  readonly onChanged: () => Promise<void>; readonly onBusy: (busy: boolean) => void;
}): ReactElement {
  const [projectDraft, setProjectDraft] = useState(project); const [billingDraft, setBillingDraft] = useState(entitlement);
  const [busy, setBusy] = useState<"project" | "billing" | null>(null);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null); const lock = useRef(false);
  const providerValid = billingDraft === undefined || billingDraft.providerVerificationStatus !== "provider_verified" ||
    billingDraft.billingProvider !== "none" && [billingDraft.providerCustomerRef, billingDraft.providerEntitlementRef, billingDraft.providerEvidenceRef].some((value) => value?.trim());
  const save = async (kind: "project" | "billing"): Promise<void> => {
    if (lock.current) return;
    lock.current = true; setBusy(kind); onBusy(true); setError(null); setNotice(null);
    try {
      if (kind === "project" && projectDraft !== undefined) await updateOnboardingProject(projectDraft.id, {
        status: projectDraft.status, currentStep: projectDraft.currentStep, operatorReviewState: projectDraft.operatorReviewState, evidenceNote: nullableText(projectDraft.evidenceNote),
      });
      if (kind === "billing" && billingDraft !== undefined) await verifyWorkspaceEntitlement(billingDraft.id, {
        billingProvider: billingDraft.billingProvider, providerVerificationStatus: billingDraft.providerVerificationStatus,
        providerCustomerRef: nullableText(billingDraft.providerCustomerRef), providerEntitlementRef: nullableText(billingDraft.providerEntitlementRef),
        providerEvidenceRef: nullableText(billingDraft.providerEvidenceRef), accessEnforced: billingDraft.providerVerificationStatus === "provider_verified" && billingDraft.accessEnforced,
      });
      setNotice(kind === "project" ? "Setup review saved." : "Billing verification saved."); await onChanged();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The setup change could not be saved. Please try again."); }
    finally { lock.current = false; setBusy(null); onBusy(false); }
  };
  return <details className="onboarding-details"><summary>Setup review and billing</summary><p className="onboarding-note">Keep commercial verification and setup review separate from a person's venue role.</p>
    <fieldset disabled={busy !== null} className="onboarding-fieldset"><div className="onboarding-create-grid">
      <div className="onboarding-fields"><h3>Setup review</h3>{projectDraft === undefined ? <p>No setup review is recorded.</p> : <>
        <label className="onboarding-field"><span>Project status</span><select aria-label={`Project status for ${workspace.name}`} value={projectDraft.status} onChange={(event) => {
          const value = ONBOARDING_PROJECT_STATUSES.find((status) => status === event.target.value); if (value !== undefined) setProjectDraft({ ...projectDraft, status: value });
        }}>{ONBOARDING_PROJECT_STATUSES.map((value) => <option key={value} value={value}>{labelize(value)}</option>)}</select></label>
        <label className="onboarding-field"><span>Operator review</span><select aria-label={`Operator review for ${workspace.name}`} value={projectDraft.operatorReviewState} onChange={(event) => {
          const value = OPERATOR_REVIEW_STATES.find((status) => status === event.target.value); if (value !== undefined) setProjectDraft({ ...projectDraft, operatorReviewState: value });
        }}>{OPERATOR_REVIEW_STATES.map((value) => <option key={value} value={value}>{labelize(value)}</option>)}</select></label>
        <label className="onboarding-field"><span>Current step</span><input aria-label={`Current step for ${workspace.name}`} value={projectDraft.currentStep} onChange={(event) => { setProjectDraft({ ...projectDraft, currentStep: event.target.value }); }} /></label>
        <label className="onboarding-field"><span>Evidence note</span><textarea aria-label={`Evidence note for ${workspace.name}`} value={projectDraft.evidenceNote ?? ""} onChange={(event) => { setProjectDraft({ ...projectDraft, evidenceNote: event.target.value }); }} /></label>
        <button type="button" className="onboarding-button onboarding-button--secondary" disabled={projectDraft.currentStep.trim() === ""} aria-busy={busy === "project"} aria-label={`Save project gate for ${workspace.name}`} onClick={() => { void save("project"); }}>
          {busy === "project" && <ActivityIndicator size={18} />}{busy === "project" ? "Saving review…" : "Save setup review"}</button>
      </>}</div>
      <div className="onboarding-fields"><h3>Provider verification</h3>{billingDraft === undefined ? <p>No billing arrangement is recorded.</p> : <>
        <label className="onboarding-field"><span>Billing provider</span><select aria-label={`Billing provider for ${workspace.name}`} value={billingDraft.billingProvider} onChange={(event) => {
          const value = BILLING_PROVIDERS.find((provider) => provider === event.target.value); if (value !== undefined) setBillingDraft({ ...billingDraft, billingProvider: value });
        }}>{BILLING_PROVIDERS.map((value) => <option key={value} value={value}>{labelize(value)}</option>)}</select></label>
        <label className="onboarding-field"><span>Provider status</span><select aria-label={`Provider status for ${workspace.name}`} value={billingDraft.providerVerificationStatus} onChange={(event) => {
          const value = PROVIDER_VERIFICATION_STATUSES.find((status) => status === event.target.value);
          if (value !== undefined) setBillingDraft({ ...billingDraft, providerVerificationStatus: value, accessEnforced: value === "provider_verified" && billingDraft.accessEnforced });
        }}>{PROVIDER_VERIFICATION_STATUSES.map((value) => <option key={value} value={value}>{labelize(value)}</option>)}</select></label>
        <label className="onboarding-field"><span>Customer reference</span><input aria-label={`Customer reference for ${workspace.name}`} value={billingDraft.providerCustomerRef ?? ""} onChange={(event) => { setBillingDraft({ ...billingDraft, providerCustomerRef: event.target.value }); }} /></label>
        <label className="onboarding-field"><span>Entitlement reference</span><input aria-label={`Entitlement reference for ${workspace.name}`} value={billingDraft.providerEntitlementRef ?? ""} onChange={(event) => { setBillingDraft({ ...billingDraft, providerEntitlementRef: event.target.value }); }} /></label>
        <label className="onboarding-field"><span>Provider evidence reference</span><input aria-label={`Provider evidence reference for ${workspace.name}`} value={billingDraft.providerEvidenceRef ?? ""} onChange={(event) => { setBillingDraft({ ...billingDraft, providerEvidenceRef: event.target.value }); }} /></label>
        <label className="onboarding-checkbox"><input type="checkbox" aria-label={`Enforce managed access for ${workspace.name}`} checked={billingDraft.accessEnforced} disabled={billingDraft.providerVerificationStatus !== "provider_verified"} onChange={(event) => { setBillingDraft({ ...billingDraft, accessEnforced: event.target.checked }); }} />Enforce managed access</label>
        {!providerValid && <p className="onboarding-error">Verified provider state requires a real provider plus at least one evidence reference.</p>}
        <button type="button" className="onboarding-button onboarding-button--secondary" disabled={!providerValid} aria-busy={busy === "billing"} aria-label={`Save provider gate for ${workspace.name}`} onClick={() => { void save("billing"); }}>
          {busy === "billing" && <ActivityIndicator size={18} />}{busy === "billing" ? "Saving verification…" : "Save billing verification"}</button>
      </>}</div>
    </div></fieldset>{error !== null && <p className="onboarding-error" role="alert">{error}</p>}{notice !== null && <p role="status" className="onboarding-success">{notice}</p>}
  </details>;
}
