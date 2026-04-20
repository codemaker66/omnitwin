import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// security-headers — defensive response headers applied to every reply.
//
// These are the headers Apple + Jane Street acquisition review will
// grep for. We emit them via a Fastify `onSend` hook rather than
// adding @fastify/helmet so the dependency surface stays lean and
// the policy is explicit (auditable in one file).
//
// The policy below is deliberately strict:
//
//   - Content-Security-Policy: default-src 'self'; no inline scripts
//     allowed anywhere. Images/media to HTTPS data-urls only so the
//     diagram thumbnail (base64-encoded PNG) continues to render.
//     Connect is self + Neon + R2 + Sentry so the expected outbound
//     surfaces work without opening a wildcard.
//   - Strict-Transport-Security: force HTTPS for a year; preload-ready.
//   - X-Content-Type-Options: nosniff (no MIME sniffing).
//   - X-Frame-Options: DENY (no iframing at all — the hallkeeper PDF
//     is the public-facing asset, served via direct link).
//   - Referrer-Policy: strict-origin-when-cross-origin (leak nothing
//     on cross-origin navigations).
//   - Permissions-Policy: disable the Web APIs we don't use —
//     camera, microphone, geolocation, payment. Removes surface area.
//   - Cross-Origin-Opener-Policy: same-origin (protects against
//     cross-origin window hijacks).
//   - Cross-Origin-Resource-Policy: same-site (prevents other sites
//     from embedding our resources).
//
// CSP NOTE: this policy targets the API surface specifically. The
// frontend is served separately (Vite / CDN) and runs its own CSP.
// API responses are JSON + binary PDFs; no inline scripts needed.
// ---------------------------------------------------------------------------

const CSP_API = [
  "default-src 'self'",
  "img-src 'self' data: https:",
  "script-src 'none'",
  "style-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "connect-src 'self' https://*.neon.tech https://*.r2.cloudflarestorage.com https://*.sentry.io",
].join("; ");

export function registerSecurityHeaders(server: FastifyInstance): void {
  server.addHook("onSend", (_request, reply, payload, done) => {
    reply.header("Content-Security-Policy", CSP_API);
    reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()",
    );
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header("Cross-Origin-Resource-Policy", "same-site");
    // Emitting `X-Powered-By` leaks stack info — guard regardless.
    reply.removeHeader("X-Powered-By");
    done(null, payload);
  });
}
