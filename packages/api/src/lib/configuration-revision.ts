export interface RevisionConflictBody {
  readonly error: string;
  readonly code: "REVISION_CONFLICT";
  readonly details: {
    readonly expectedRevision: number;
    readonly currentRevision: number;
  };
}

export function configurationRevisionEtag(revision: number): string {
  return `"configuration:${String(revision)}"`;
}

export function revisionConflictBody(
  expectedRevision: number,
  currentRevision: number,
): RevisionConflictBody {
  return {
    error: "Layout changed on the server. Reload before saving again.",
    code: "REVISION_CONFLICT",
    details: { expectedRevision, currentRevision },
  };
}
