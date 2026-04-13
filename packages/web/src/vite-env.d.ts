/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Clerk publishable key. Required in production. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  /** Backend API URL. Defaults to http://localhost:3001. */
  readonly VITE_API_URL?: string;
  /** Cloudflare R2 public URL for file previews. Optional. */
  readonly VITE_R2_PUBLIC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
