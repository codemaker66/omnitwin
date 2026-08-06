/**
 * Build-owned input for the offline-preview sandbox release authority.
 *
 * There is deliberately no qualified release in this source tree. A release
 * build may replace this value with its generated, digest-bound manifest only
 * after Docker qualification evidence exists. Runtime callers cannot provide a
 * substitute value to the production lookup API.
 */
export const LOCAL_OFFLINE_PREVIEW_GENERATED_BUNDLED_RELEASE_MANIFEST:
  unknown = null;

/**
 * Build-owned Ed25519 release-signing trust root. It remains absent whenever
 * the signed bundle above is absent. A production release generator must
 * replace both constants together; runtime input can replace neither.
 */
export const LOCAL_OFFLINE_PREVIEW_GENERATED_BUNDLED_RELEASE_TRUST_ROOT:
  unknown = null;
