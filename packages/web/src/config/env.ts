// ---------------------------------------------------------------------------
// Environment configuration — Vite injects VITE_ prefixed vars at build time
// ---------------------------------------------------------------------------

export const API_URL: string =
  import.meta.env["VITE_API_URL"] ?? "http://localhost:3001";

// There is deliberately no public bucket URL here. Uploaded files are read
// through the URLs the API returns (signed for private files), never built
// from a file key, so a private key can never be turned into a public URL.
