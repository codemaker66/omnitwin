import { useEffect, useRef } from "react";
import { claimTrackedDraft, trackedClaimSecret, type DraftClaim } from "../lib/planner-claim.js";
import { layoutClaimedEventKind } from "../lib/event-kind-record.js";
import { useAuthStore } from "../stores/auth-store.js";
import { captureEditorSession, isCurrentEditorSession, useEditorStore } from "../stores/editor-store.js";

// ---------------------------------------------------------------------------
// Making the open draft the signed-in person's own.
//
// Only a draft this browser created is claimed (release audit
// public-surface-1): a layout opened from someone's shared link stays theirs.
// Two places ask, and share one request: the planner page, whenever a
// signed-in person has their own draft open, and the sign-in dialog, which
// shows the claim happening and offers "Try again".
//
// The page asks because the dialog cannot be relied on (audit
// web-auth-routing-2). Signing in sends the person back to the plan's address,
// or puts the planner inside Clerk's provider, whose access gate stands in for
// the page while access is checked. Either way the dialog is gone before the
// account is known, and the plan used to stay ownerless.
// ---------------------------------------------------------------------------

// Claim is not idempotent. Share its result across StrictMode effect replay,
// the page and the dialog, and dismissal/reopening; server settlement belongs
// to this editor/account session.
const pendingClaims = new Map<string, Promise<DraftClaim>>();

/**
 * Claims the open draft for the signed-in person and, once it is theirs,
 * saves it through their account. Resolves "not-created-here", with nothing
 * sent, for a draft this browser did not create; rejects with the server's
 * error when the claim is refused or does not arrive.
 */
export function claimOpenDraft(configId: string, userId: string | null): Promise<DraftClaim> {
  const session = captureEditorSession();
  const key = JSON.stringify([configId, session.generation, userId]);
  const pending = pendingClaims.get(key);
  if (pending !== undefined) return pending;
  const request = claimTrackedDraft(configId).then((outcome) => {
    const auth = useAuthStore.getState();
    if (outcome !== "claimed" || !isCurrentEditorSession(session) || !auth.isAuthenticated || (auth.user?.id ?? null) !== userId) return outcome;
    useEditorStore.setState({ isPublicPreview: false });
    // The event's answer, given while it was a guest's draft, now belongs with the layout (T-674).
    layoutClaimedEventKind(configId);
    void useEditorStore.getState().saveToServer(true);
    return outcome;
  }).finally(() => { pendingClaims.delete(key); });
  pendingClaims.set(key, request);
  return request;
}

/**
 * On the planner page: a signed-in person's own draft, open at its address,
 * becomes theirs. `openAtAddress` is false while the page is still starting a
 * plan: it claims a new plan itself, before it navigates to it.
 *
 * Asked once each time the page opens the draft for the person. A claim that
 * is refused or does not arrive leaves a public preview, which still opens
 * and saves as one (stores/editor-store.ts, usesSignedInRoutes).
 */
export function usePlannerDraftClaim(openAtAddress: boolean): void {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const configId = useEditorStore((state) => state.configId);
  const isPublicPreview = useEditorStore((state) => state.isPublicPreview);
  // A save under way went through the public route: it lands first, or the
  // claim would close that route under it.
  const isSaving = useEditorStore((state) => state.isSaving);
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (!openAtAddress || !isAuthenticated || configId === null || !isPublicPreview || isSaving) return;
    const key = JSON.stringify([configId, userId]);
    if (asked.current === key || trackedClaimSecret(configId) === null) return;
    asked.current = key;
    // The dialog, when open, says what went wrong; the preview stays usable.
    claimOpenDraft(configId, userId).catch(() => undefined);
  }, [openAtAddress, isAuthenticated, userId, configId, isPublicPreview, isSaving]);
}
