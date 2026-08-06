import {
  getLocalOfflinePreviewBundledReleaseAuthority,
} from "../src/local-offline-normalization-preview-bundled-release.ts";

const lookup = getLocalOfflinePreviewBundledReleaseAuthority();
const serialized = lookup.toJSON();

if (
  lookup.status !== "unavailable" ||
  lookup.code !== "NO_DOCKER_QUALIFIED_BUNDLED_RELEASE" ||
  lookup.capability !== null ||
  lookup.rejectionCode !== null ||
  serialized.liveAuthorityCapable !== false ||
  serialized.authority !== "none" ||
  serialized.claimStatus !== "unauthenticated_integrity_claim" ||
  serialized.attestationAuthority !== "none" ||
  serialized.cryptographicallyAuthenticated !== false
) {
  throw new Error(
    "The production bundled-release lookup did not remain explicitly unavailable.",
  );
}

process.stdout.write("NO_DOCKER_QUALIFIED_BUNDLED_RELEASE\n");
