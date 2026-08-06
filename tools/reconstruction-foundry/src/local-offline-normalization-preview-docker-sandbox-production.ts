/**
 * Production-only runtime facade for the Docker sandbox.
 *
 * Keep this export list explicit. The execution bridge dynamically imports
 * this module, so every runtime export becomes callable in the production
 * chunk. Test factories and dependency-injection seams must never be added.
 */
export {
  createLocalOfflineNormalizationPreviewDockerSandbox,
  isLocalOfflinePreviewDockerSandboxLiveWitness,
  localOfflinePreviewDockerSandboxLiveWitnessMatchesEvidence,
} from "./local-offline-normalization-preview-docker-sandbox.js";

export type {
  LocalOfflinePreviewDockerSandboxBackend,
  LocalOfflinePreviewDockerSandboxLiveWitness,
  LocalOfflinePreviewDockerSandboxSession,
} from "./local-offline-normalization-preview-docker-sandbox.js";
