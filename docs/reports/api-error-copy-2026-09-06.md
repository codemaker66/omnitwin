# Readable save failures — 6 September 2026

The read-only browser harness returned a nested JSON error during a denied save. The web client cast the unknown `error` field to a string and passed the actual object into `Error`, displaying `[object Object]`. The inspected API normalizer uses the flat `{ error: string, code, details? }` contract; a nested production response was not established.

The client now checks failure fields at runtime, preserves canonical flat messages/codes/details, and accepts a nested error message/code/details when a proxy or harness supplies it. Malformed JSON fields, empty bodies and non-JSON failures produce a readable message containing the actual HTTP status. Raw response bodies are not rendered. Authenticated 401 handling, 204 behavior and successful response validation are unchanged.

Nine regressions failed before the repair. **98/98 focused tests passed** after it, including API response validation, conflict details, editor session ownership and event routing. Web TypeScript, changed-file ESLint, `git diff --check` and the Vite test-mode build passed. The API, fixtures, external delivery and production deployment were not changed; root owns the rendered browser check.

Receipts are retained in `D:/claude/venviewer-save-lifecycle-20260906/`: `api-error-baseline-red.json`, `api-error-final-tests.json`, `api-error-typecheck.log`, `api-error-lint.log`, and `api-error-build.log`.
