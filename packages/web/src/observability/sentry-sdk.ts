// The only Sentry entry points the browser uses, re-exported by name so the
// deferred chunk stays tree-shakeable. Importing the "@sentry/react" namespace
// dynamically keeps every export — Session Replay, Feedback, profiling and the
// AI-tracing integrations — which roughly tripled the chunk for code this app
// never calls. Add a name here before calling it from sentry.ts.
export { captureException, init, withScope } from "@sentry/react";
