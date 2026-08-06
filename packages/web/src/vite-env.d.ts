/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Clerk publishable key. Required in production. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  /** Enable Clerk social providers only after production OAuth provider credentials are verified. */
  readonly VITE_CLERK_GOOGLE_SIGN_IN_ENABLED?: string;
  /** Backend API URL. Defaults to http://localhost:3001. */
  readonly VITE_API_URL?: string;
  /** Cloudflare R2 public URL for file previews. Optional. */
  readonly VITE_R2_PUBLIC_URL?: string;
  /** Base URL twin bundles are served from. Defaults to /twin (local public dir). */
  readonly VITE_TWIN_ASSET_BASE?: string;
  /** Sentry browser DSN. Optional; when omitted, browser error tracking is disabled. */
  readonly VITE_SENTRY_DSN?: string;
  /** Sentry environment label. Defaults to the current Vite mode. */
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  /** Sentry release name, usually a git SHA or deployment id. */
  readonly VITE_SENTRY_RELEASE?: string;
  /** Optional browser traces sample rate in the inclusive range 0..1. */
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
  /** Development-only loopback origin for the exact Reception Quality files. */
  readonly VITE_RECEPTION_QUALITY_ORIGIN?: string;
  /** Development-only loopback origin for the exact Reception Mobile files. */
  readonly VITE_RECEPTION_MOBILE_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __VENVIEWER_CLERK_PUBLISHABLE_KEY__: string | undefined;
/** SHA-256 identity of the exact Reception capture route and dependency inputs. */
declare const __VENVIEWER_RECEPTION_CAPTURE_RUNTIME_BUILD_DIGEST__: string;
/** SHA-256 identity of the two non-secret Reception candidate origins. */
declare const __VENVIEWER_RECEPTION_CAPTURE_RUNTIME_ENVIRONMENT_DIGEST__: string;
