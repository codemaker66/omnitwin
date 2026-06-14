import {
  copyForEditorSaveStatus,
  deriveEditorSaveStatus,
  type EditorSaveStatus,
  type EditorSaveStatusInput,
} from "./editor-save-status.js";

// Pure view-model for the cockpit top bar. Keeping the label derivation out of
// the component makes the SAFE wording and save-status mapping unit-testable
// without rendering.

export interface TopBarModelInput {
  readonly spaceName: string | null;
  readonly venueName?: string | null;
  readonly isPublicPreview: boolean;
  readonly objectCount: number;
  readonly userName: string | null;
  readonly save: EditorSaveStatusInput;
  readonly runtimeAssetStatus: string;
}

export interface TopBarModel {
  readonly brandSubtitle: string;
  readonly venueLabel: string;
  readonly saveStatus: EditorSaveStatus;
  readonly saveLabel: string;
  readonly userInitials: string | null;
  readonly summaryLabel: string;
  readonly runtimeLabel: string;
  readonly reviewBadge: string;
}

export function initialsFromName(name: string | null): string | null {
  if (name === null) return null;
  const parts = name.trim().split(/\s+/u).filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  const initials = `${first}${last}`.toUpperCase();
  return initials.length > 0 ? initials : null;
}

export function buildTopBarModel(input: TopBarModelInput): TopBarModel {
  const status = deriveEditorSaveStatus(input.save);
  const room = input.spaceName ?? "Opening layout";
  const hasVenue = input.venueName !== undefined && input.venueName !== null && input.venueName.length > 0;
  const venueLabel = hasVenue ? `${String(input.venueName)} / ${room}` : room;
  const formattedCount = input.objectCount.toLocaleString("en-GB");
  const summaryLabel = input.objectCount === 1 ? "1 placed item" : `${formattedCount} placed items`;
  return {
    brandSubtitle: input.isPublicPreview ? "Guest draft" : "Team layout",
    venueLabel,
    saveStatus: status,
    saveLabel: copyForEditorSaveStatus(status).label,
    userInitials: initialsFromName(input.userName),
    summaryLabel,
    runtimeLabel: input.runtimeAssetStatus,
    reviewBadge: "Planning evidence / human review required",
  };
}
