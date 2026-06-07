/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Clerk publishable key. Required in production. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  /** Backend API URL. Defaults to http://localhost:3001. */
  readonly VITE_API_URL?: string;
  /** Cloudflare R2 public URL for file previews. Optional. */
  readonly VITE_R2_PUBLIC_URL?: string;
  /** Sentry browser DSN. Optional; when omitted, browser error tracking is disabled. */
  readonly VITE_SENTRY_DSN?: string;
  /** Sentry environment label. Defaults to the current Vite mode. */
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  /** Sentry release name, usually a git SHA or deployment id. */
  readonly VITE_SENTRY_RELEASE?: string;
  /** Optional browser traces sample rate in the inclusive range 0..1. */
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
