import { useEffect, type ReactElement } from "react";
import { ClerkFailed, ClerkLoaded, ClerkLoading, OAuthConsent, Show } from "@clerk/react";
import "./OAuthConsentPage.css";

const REFERRER_META_SELECTOR = 'meta[name="referrer"]';
const OAUTH_CONSENT_REFERRER_POLICY = "strict-origin-when-cross-origin";

const OAUTH_CONSENT_APPEARANCE = {
  variables: {
    colorPrimary: "#dba64b",
    colorBackground: "#050807",
    colorText: "#fff7e8",
    colorTextSecondary: "rgba(246, 239, 224, 0.72)",
    colorDanger: "#ff6f59",
    borderRadius: "8px",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  },
  elements: {
    card: {
      border: "1px solid rgba(219, 166, 75, 0.28)",
      boxShadow: "none",
    },
  },
} as const;

function useStrictConsentReferrerPolicy(): void {
  useEffect(() => {
    document.title = "OAuth consent - Venviewer";

    const existing = document.head.querySelector<HTMLMetaElement>(REFERRER_META_SELECTOR);
    const previousContent = existing?.content ?? null;
    const meta = existing ?? document.createElement("meta");
    if (existing === null) {
      meta.name = "referrer";
      document.head.append(meta);
    }
    meta.content = OAUTH_CONSENT_REFERRER_POLICY;

    return () => {
      if (existing !== null && previousContent !== null) {
        existing.content = previousContent;
        return;
      }
      meta.remove();
    };
  }, []);
}

function ConsentLoadingState(): ReactElement {
  return (
    <div className="oauth-consent-page__status" role="status" aria-live="polite">
      <strong>Loading secure consent.</strong>
      <span>Keep this page open while Clerk loads the requesting application and scopes.</span>
    </div>
  );
}

function SignedOutConsentState(): ReactElement {
  return (
    <div className="oauth-consent-page__status" role="status" aria-live="polite">
      <strong>Sign in required.</strong>
      <span>Sign in to Venviewer first, then return to the requesting application to review access.</span>
    </div>
  );
}

function ConsentUnavailableState(): ReactElement {
  return (
    <div className="oauth-consent-page__status" role="alert">
      <strong>Consent screen unavailable.</strong>
      <span>
        Clerk could not load the secure consent controls. Refresh this page from the requesting application, or return to
        Venviewer and try again.
      </span>
    </div>
  );
}

export function OAuthConsentPage(): ReactElement {
  useStrictConsentReferrerPolicy();

  return (
    <main className="oauth-consent-page" aria-label="Venviewer OAuth consent">
      <section className="oauth-consent-page__context" aria-label="Consent review context">
        <div className="oauth-consent-page__brand">Venviewer</div>
        <h1>Review external access before anything is shared.</h1>
        <p>
          Clerk displays the requesting application, requested scopes, and allow or deny controls below. Approve only
          when the application and access level match what you intended.
        </p>
      </section>

      <section className="oauth-consent-page__shell" aria-label="OAuth consent decision">
        <ClerkLoading>
          <ConsentLoadingState />
        </ClerkLoading>
        <ClerkFailed>
          <ConsentUnavailableState />
        </ClerkFailed>
        <ClerkLoaded>
          <Show when="signed-in" fallback={<SignedOutConsentState />}>
            <OAuthConsent appearance={OAUTH_CONSENT_APPEARANCE} />
          </Show>
        </ClerkLoaded>
      </section>
    </main>
  );
}
