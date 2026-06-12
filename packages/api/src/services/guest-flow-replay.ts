import {
  GuestFlowReplayArtifactSchema,
  GuestFlowReplayInputSchema,
  runGuestFlowReplayV0,
  type GuestFlowReplayArtifact,
  type GuestFlowReplayInput,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Guest Flow Replay service boundary
//
// V0 runs a deterministic in-process planning replay. It is intentionally small
// and swappable: future worker-backed engines should call through this boundary
// or replace its implementation without changing route/UI contracts.
// ---------------------------------------------------------------------------

export function generateGuestFlowReplayV0(input: GuestFlowReplayInput): GuestFlowReplayArtifact {
  const parsed = GuestFlowReplayInputSchema.parse(input);
  return GuestFlowReplayArtifactSchema.parse(runGuestFlowReplayV0(parsed));
}

export function replayDisclosureSummary(artifact: GuestFlowReplayArtifact): string {
  const replay = GuestFlowReplayArtifactSchema.parse(artifact);
  return [
    replay.disclosureLabel,
    `${String(replay.metrics.agentCount)} agents`,
    `${String(replay.metrics.routeConflictCount)} route conflict marker(s)`,
    `${String(replay.metrics.densityHotspotCount)} density hotspot(s)`,
    "Human review required before operational reliance.",
  ].join(" · ");
}
