import type { AssetEvidenceStatus, RuntimePackage } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Runtime asset decision — what the /dev/trades-hall-visual canvas should
// render, and the honest label to show for it.
//
// Precedence: a manually-mounted dev URL wins (explicit operator override),
// then the latest published RuntimePackage, then nothing (procedural room).
// All labels stay inside the planning-evidence vocabulary — they never assert
// legal/safety certification, occupancy approval, or photoreal fidelity.
// ---------------------------------------------------------------------------

export type RuntimeAssetSource = "manual" | "published" | "none";

export interface RuntimeAssetDecision {
  /** URL to hand to SparkSplatLayer, or null to render the procedural room only. */
  readonly splatUrl: string | null;
  readonly source: RuntimeAssetSource;
  readonly evidenceStatus: AssetEvidenceStatus | null;
  /** SAFE, human-readable status line. Never a certification claim. */
  readonly evidenceLabel: string;
  readonly isProceduralFallback: boolean;
}

export function evidenceStatusLabel(status: AssetEvidenceStatus): string {
  switch (status) {
    case "unverified":
      return "Runtime asset loaded — unverified, human review required";
    case "machine_checked":
      return "Runtime asset loaded — machine checked, human review required";
    case "human_reviewed":
      return "Runtime asset loaded — human reviewed, not legally certified";
  }
}

export function decideRuntimeAsset(
  manualUrl: string | null,
  published: RuntimePackage | null,
): RuntimeAssetDecision {
  if (manualUrl !== null && manualUrl.length > 0) {
    return {
      splatUrl: manualUrl,
      source: "manual",
      evidenceStatus: null,
      evidenceLabel: "Runtime asset URL mounted manually — not signed, human review required",
      isProceduralFallback: false,
    };
  }

  if (published !== null && published.assetUrl !== null && published.assetUrl.length > 0) {
    return {
      splatUrl: published.assetUrl,
      source: "published",
      evidenceStatus: published.assetVersion.evidenceStatus,
      evidenceLabel: evidenceStatusLabel(published.assetVersion.evidenceStatus),
      isProceduralFallback: false,
    };
  }

  return {
    splatUrl: null,
    source: "none",
    evidenceStatus: null,
    evidenceLabel: "No runtime asset published — showing procedural planning context",
    isProceduralFallback: true,
  };
}
