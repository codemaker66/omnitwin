// ---------------------------------------------------------------------------
// Environment configuration — Vite injects VITE_ prefixed vars at build time
// ---------------------------------------------------------------------------

export const API_URL: string =
  import.meta.env["VITE_API_URL"] ?? "http://localhost:3001";

// R2 public URL prefix for uploaded files. When set, the loadout detail
// view renders actual image previews instead of filename text. When unset
// (R2 not configured), photo cards fall back to showing the filename.
export const R2_PUBLIC_URL: string | null =
  import.meta.env["VITE_R2_PUBLIC_URL"] ?? null;
