import { useMemo, useState, type ChangeEvent, type ReactElement } from "react";
import { Share2 } from "lucide-react";
import { ProposalVersionPayloadSchema } from "@omnitwin/types";
import { LensPanel, LensPanelSection, LensPanelMetric } from "./LensPanel.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useShareStore } from "../../../stores/share-store.js";
import { RENDER_SCALE } from "../../../constants/scale.js";
import {
  buildShareProposalDraft,
  buildShareVersionPayloadCandidate,
  coversSourceLabel,
} from "../../../lib/cockpit-share-model.js";
import {
  createProposal,
  createProposalShareToken,
  createProposalVersion,
  transitionProposal,
} from "../../../api/proposals.js";

// ---------------------------------------------------------------------------
// ShareLensPanel — hand this layout off to a client as a shareable proposal
// (Epic 0 Share lens, third real lens panel).
//
// The preview is built LIVE from the placed layout by cockpit-share-model: an
// honest title, room + layout summary, and a planning-grade capacity note that
// passes the proposal claim guard by construction. "Create client share link"
// runs the proven proposal chain (createProposal → version → send → share
// token) so the planner gets a real, sendable /proposal-share link — the same
// surface the dashboard uses — without leaving the cockpit. The server captures
// the layout SVG from the linked configuration, so a SAVED layout is required;
// staff sign-in supplies the venue. Both preconditions are gated honestly.
// SAFE: figures are planning estimates; no quote is attached (the Costs lens's
// example rates are not a client price), and the footer keeps that visible.
// ---------------------------------------------------------------------------

type SharePhase = "idle" | "creating" | "error";

export function ShareLensPanel(): ReactElement {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  const plannedGuestCount = useCockpitStore((state) => state.plannedGuestCount);
  const configId = useEditorStore((state) => state.configId);
  const venueId = useAuthStore((state) => state.user?.venueId ?? null);

  const eventTitle = useShareStore((state) => state.eventTitle);
  const clientMessage = useShareStore((state) => state.clientMessage);
  const lastShareUrl = useShareStore((state) => state.lastShareUrl);
  const setEventTitle = useShareStore((state) => state.setEventTitle);
  const setClientMessage = useShareStore((state) => state.setClientMessage);
  const setLastShareUrl = useShareStore((state) => state.setLastShareUrl);

  const [phase, setPhase] = useState<SharePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const draft = useMemo(
    () => buildShareProposalDraft({
      placedItems,
      roomWidthM: dimensions.width / RENDER_SCALE,
      roomLengthM: dimensions.length / RENDER_SCALE,
      plannedGuestCount,
      titleOverride: eventTitle,
    }),
    [placedItems, dimensions, plannedGuestCount, eventTitle],
  );

  const canShare = venueId !== null && configId !== null;
  const totalTables = draft.summary.roundTables + draft.summary.banquetTables;
  const features = draft.summary.features.length > 0 ? draft.summary.features.join(", ") : "Open layout";

  const handleCreate = (): void => {
    if (phase === "creating" || venueId === null || configId === null) return;
    setPhase("creating");
    setError(null);
    setCopied(false);

    const candidate = buildShareVersionPayloadCandidate(draft, configId, clientMessage);
    const parsed = ProposalVersionPayloadSchema.safeParse(candidate);
    if (!parsed.success) {
      // The claim guard runs here, client-side, so unsupported certainty
      // wording in the title/message is explained before anything is posted.
      setError(parsed.error.issues[0]?.message ?? "The proposal content isn't valid. Adjust the title or message and retry.");
      setPhase("error");
      return;
    }

    const run = async (): Promise<void> => {
      const proposal = await createProposal({ venueId, title: draft.title, configurationId: configId });
      await createProposalVersion(proposal.id, parsed.data);
      await transitionProposal(proposal.id, "sent");
      const token = await createProposalShareToken(proposal.id);
      const url = token.shareUrl.startsWith("http")
        ? token.shareUrl
        : `${window.location.origin}${token.shareUrl}`;
      setLastShareUrl(url);
      setPhase("idle");
    };

    run().catch(() => {
      setError("Couldn't create the share link. Check the connection and try again, or use Proposals in your dashboard.");
      setPhase("error");
    });
  };

  const handleCopy = (): void => {
    if (lastShareUrl === null) return;
    try {
      void navigator.clipboard.writeText(lastShareUrl).then(
        () => { setCopied(true); },
        () => { /* clipboard blocked — the link stays visible to copy manually */ },
      );
    } catch {
      /* Clipboard API unavailable (insecure context) — the link stays visible to copy manually. */
    }
  };

  const onTitle = (event: ChangeEvent<HTMLInputElement>): void => { setEventTitle(event.target.value); };
  const onMessage = (event: ChangeEvent<HTMLTextAreaElement>): void => { setClientMessage(event.target.value); };

  const creating = phase === "creating";

  return (
    <LensPanel
      eyebrow="Share lens"
      title="Share this plan"
      icon={<Share2 size={18} />}
      source="Proposal"
      testId="share-lens-panel"
      footer="Creates a real, sendable client proposal from this layout. Figures are planning estimates, reviewed by a human — nothing here is a safety, occupancy, or compliance determination."
    >
      <LensPanelSection label="Event details">
        <label className="lens-panel__field">
          <span className="lens-panel__field-label">Event title</span>
          <input
            className="lens-panel__input"
            type="text"
            value={eventTitle}
            onChange={onTitle}
            placeholder={draft.title}
            maxLength={200}
            data-testid="share-title"
            aria-label="Event title"
          />
        </label>
        <p className="lens-panel__note" data-testid="share-effective-title">Shared as “{draft.title}”.</p>
        <p className="lens-panel__paragraph lens-panel__paragraph--muted">{draft.roomSummary}</p>
      </LensPanelSection>

      <LensPanelSection label="What the client sees">
        <p className="lens-panel__paragraph" data-testid="share-layout-summary">{draft.layoutSummary}</p>
        <p className="lens-panel__paragraph lens-panel__paragraph--muted">{draft.capacityNote}</p>
        <label className="lens-panel__field">
          <span className="lens-panel__field-label">Message to the client (optional)</span>
          <textarea
            className="lens-panel__input lens-panel__input--area"
            value={clientMessage}
            onChange={onMessage}
            placeholder="A short personal note shown at the top of the proposal…"
            maxLength={4000}
            rows={3}
            data-testid="share-message"
            aria-label="Message to the client"
          />
        </label>
      </LensPanelSection>

      <LensPanelSection label="From the layout">
        <LensPanelMetric label="Covers" value={`${String(draft.summary.covers)} · ${coversSourceLabel(draft.summary.coversSource)}`} />
        <LensPanelMetric label="Tables" value={String(totalTables)} />
        <LensPanelMetric label="Chairs" value={String(draft.summary.chairs)} />
        <LensPanelMetric label="Features" value={features} />
      </LensPanelSection>

      <LensPanelSection label="Client share link">
        {!canShare && (
          <p className="lens-panel__note lens-panel__note--warn" data-testid="share-precondition">
            {venueId === null
              ? "Sign in as venue staff to create a client share link."
              : "Save this layout first so the shared proposal shows your plan."}
          </p>
        )}

        {canShare && (
          <div className="lens-panel__actions">
            <button
              type="button"
              className="lens-panel__button"
              onClick={handleCreate}
              disabled={creating}
              data-testid="share-create"
            >
              {creating ? "Creating link…" : lastShareUrl !== null ? "Create another link" : "Create client share link"}
            </button>
          </div>
        )}

        {error !== null && (
          <p className="lens-panel__error" role="alert" data-testid="share-error">{error}</p>
        )}

        {lastShareUrl !== null && (
          <div className="lens-panel__share-result" data-testid="share-result">
            <span className="lens-panel__share-result-label">Client link — sent</span>
            <span className="lens-panel__share-url" data-testid="share-url">{lastShareUrl}</span>
            <div className="lens-panel__share-buttons">
              <button type="button" className="lens-panel__chip-link" onClick={handleCopy} data-testid="share-copy">
                {copied ? "Copied" : "Copy link"}
              </button>
              <a className="lens-panel__chip-link" href={lastShareUrl} target="_blank" rel="noreferrer" data-testid="share-open">
                Open
              </a>
            </div>
            <p className="lens-panel__note">The client can open this link and respond. Manage it under Proposals in your dashboard.</p>
          </div>
        )}
      </LensPanelSection>
    </LensPanel>
  );
}
