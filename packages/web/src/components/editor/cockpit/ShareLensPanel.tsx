import { useMemo, useState, type ChangeEvent, type ReactElement } from "react";
import { Share2 } from "lucide-react";
import { ActivityIndicator } from "../../shared/Activity.js";
import { ProposalVersionPayloadSchema } from "@omnitwin/types";
import { LensPanel, LensPanelSection, LensPanelMetric } from "./LensPanel.js";
import { SeatShortfallFix } from "./SeatShortfallFix.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useShareStore } from "../../../stores/share-store.js";
import { usePlannerTruth } from "../../../hooks/use-planner-truth.js";
import { RENDER_SCALE } from "../../../constants/scale.js";
import { plannerLayoutStyle, publishedFormatForStyle } from "../../../lib/planner-truth.js";
import { seatingCountsFromPlacedItems } from "../../../lib/seating-counts.js";
import { occasionPhrase } from "../../../lib/auto-fill.js";
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
import { seatingCountsFromPlacedItems } from "../../../lib/seating-counts.js";
import { useVisitorPlanPdf } from "../../../hooks/use-visitor-plan-pdf.js";
import { useVisitorPlanLinks } from "../../../hooks/use-visitor-plan-links.js";
import { VisitorPlanPdfActions } from "../VisitorPlanPdfActions.js";
import { VisitorPlanLinkActions } from "../VisitorPlanLinkActions.js";

// ---------------------------------------------------------------------------
// ShareLensPanel — hand this layout off to a client as a shareable proposal
// (Epic 0 Share lens, third real lens panel).
//
// The preview is built LIVE from the placed layout by cockpit-share-model: an
// honest title, room + layout summary, and a capacity note stating the venue's
// published figure for the layout with who stated it and when (never floor
// area ÷ generic spacing). "Create client share link"
// runs the proven proposal chain (createProposal → version → send → share
// token) so the planner gets a real, sendable /proposal-share link — the same
// surface the dashboard uses — without leaving the cockpit. The server captures
// the layout SVG from the linked configuration, so a SAVED layout is required;
// staff sign-in supplies the venue. Both preconditions are gated honestly.
// SAFE: figures are planning estimates; no quote is attached (the Costs lens's
// example rates are not a client price), and the footer keeps that visible.
//
// VISITORS (fix-first item 11, 16 Oct 2026 brief). An organiser with no venue
// account used to meet "Sign in as venue staff" here: a dead end on the one
// job they came to do, sending the plan to someone. They now get the plan as
// a PDF to send themselves and, beside it, a view-only link of its own
// (VisitorShareLens). The proposal chain stays staff-only, and nothing a
// visitor shares carries the planner address, which is the edit capability
// of an anonymous plan. The visitor's counts are what is placed: a guest
// count is the organiser's hope, not seating, so it is never stated as such.
// ---------------------------------------------------------------------------

type SharePhase = "idle" | "creating" | "error";

export function ShareLensPanel(): ReactElement {
  const venueId = useAuthStore((state) => state.user?.venueId ?? null);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isPublicPreview = useEditorStore((state) => state.isPublicPreview);
  // No venue account, and the plan is a guest plan (or not saved yet).
  const isVisitor = venueId === null && (isPublicPreview || !isAuthenticated);
  return isVisitor ? <VisitorShareLens /> : <StaffShareLens />;
}

function VisitorShareLens(): ReactElement {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const configId = useEditorStore((state) => state.configId);
  const spaceName = useEditorStore((state) => state.space?.name ?? null);
  const roomName = spaceName ?? "Room";
  const hasSavedObjects = useEditorStore((state) => state.objects.length > 0);
  const pdf = useVisitorPlanPdf(configId, roomName);
  const links = useVisitorPlanLinks(configId);

  // What is placed, as the PDF and the link show it.
  const seating = useMemo(() => seatingCountsFromPlacedItems(placedItems), [placedItems]);
  const totalTables = seating.roundTables + seating.banquetTables;
  const unavailableReason = configId === null
    ? "Your plan saves as you work. Once it has saved, it can be sent as a PDF."
    : !hasSavedObjects
      ? "Place some furniture first; the PDF shows your layout."
      : null;
  const linkUnavailableReason = configId === null
    ? "Once your plan has saved, it can be sent as a view-only link."
    : !hasSavedObjects
      ? "Place some furniture first; the link shows your layout."
      : null;

  return (
    <LensPanel
      title="Share this plan"
      icon={<Share2 size={18} />}
      source="PDF · link"
      testId="share-lens-panel"
      footer="Planning estimates require human review; no safety, occupancy, or compliance approval."
    >
      <LensPanelSection label={spaceName === null ? "Placed in the room" : `Placed in the ${spaceName}`}>
        <LensPanelMetric label="Tables" value={String(totalTables)} />
        <LensPanelMetric label="Chairs" value={String(seating.chairs)} />
      </LensPanelSection>

      <LensPanelSection label="Send it to someone">
        <p className="lens-panel__paragraph" data-testid="visitor-share-explainer">
          A one-page PDF of the room and your layout to scale, for anyone you are planning with. It shows
          no prices, and says it was drawn by a visitor and not reviewed by the venue.
        </p>
        <VisitorPlanPdfActions pdf={pdf} tone="dock" unavailableReason={unavailableReason} />
      </LensPanelSection>

      <LensPanelSection label="Or send a link">
        <VisitorPlanLinkActions links={links} tone="dock" unavailableReason={linkUnavailableReason} />
      </LensPanelSection>

      <LensPanelSection label="Ask the venue">
        <p className="lens-panel__note" data-testid="visitor-share-venue">
          To have the events team look at this plan, use Send to Events Team.
        </p>
      </LensPanelSection>
    </LensPanel>
  );
}

function StaffShareLens(): ReactElement {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  const plannedGuestCount = useCockpitStore((state) => state.plannedGuestCount);
  const configId = useEditorStore((state) => state.configId);
  const venueId = useAuthStore((state) => state.user?.venueId ?? null);

  const eventTitle = useShareStore((state) => state.eventTitle);
  const clientMessage = useShareStore((state) => state.clientMessage);
  const lastShareUrl = useShareStore((state) => state.lastShareUrl);
  const lastShareProposalId = useShareStore((state) => state.lastShareProposalId);
  const setEventTitle = useShareStore((state) => state.setEventTitle);
  const setClientMessage = useShareStore((state) => state.setClientMessage);
  const setLastShareUrl = useShareStore((state) => state.setLastShareUrl);

  const [phase, setPhase] = useState<SharePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // The capacity line states the venue's published figure, never a computed one.
  const { published, roomName, ask } = usePlannerTruth();
  // When the tables are full and there is no room for another, the shortfall
  // fix names the person to ask; the capacity note above already gives the
  // published figure.
  const shortfallAsk = useMemo(() => {
    if (plannedGuestCount === null) return null;
    const format = publishedFormatForStyle(plannerLayoutStyle(placedItems));
    return ask({
      kind: "layout",
      guests: plannedGuestCount,
      seatsPlaced: seatingCountsFromPlacedItems(placedItems).chairs,
      occasion: format === null ? "our event" : occasionPhrase(format),
    });
  }, [ask, placedItems, plannedGuestCount]);

  const draft = useMemo(
    () => buildShareProposalDraft({
      placedItems,
      roomWidthM: dimensions.width / RENDER_SCALE,
      roomLengthM: dimensions.length / RENDER_SCALE,
      plannedGuestCount,
      titleOverride: eventTitle,
      roomName,
      published,
    }),
    [placedItems, dimensions, plannedGuestCount, eventTitle, roomName, published],
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
      setLastShareUrl(url, proposal.id);
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
      title="Share this plan"
      icon={<Share2 size={18} />}
      source="Proposal"
      testId="share-lens-panel"
      footer="Planning estimates require human review; no safety, occupancy, or compliance approval."
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
        {draft.seatingShortfall !== null && (
          <p className="lens-panel__note lens-panel__note--warn" data-testid="share-seating-short">
            {draft.seatingShortfall.next}
          </p>
        )}
        <p className="lens-panel__paragraph lens-panel__paragraph--muted">{draft.capacityNote}</p>
        <SeatShortfallFix statement={false} testId="share-seat-fix" ask={shortfallAsk} />
        <label className="lens-panel__field">
          <span className="lens-panel__field-label">Message to the client (optional)</span>
          <textarea
            className="lens-panel__input lens-panel__input--area"
            value={clientMessage}
            onChange={onMessage}
            placeholder="Add a message…"
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
              {creating && <ActivityIndicator size={18} />}
              {creating ? "Creating link…" : lastShareUrl !== null ? "Create another link" : "Create client share link"}
            </button>
          </div>
        )}

        {canShare && lastShareUrl !== null && (
          <p className="lens-panel__hint" data-testid="share-another-hint">
            Another link starts a new proposal. This one stays in Proposals.
          </p>
        )}

        {error !== null && (
          <p className="lens-panel__error" role="alert" data-testid="share-error">{error}</p>
        )}

        {lastShareUrl !== null && (
          <div className="lens-panel__share-result" data-testid="share-result">
            {/* Nothing is emailed: the link exists, and staff send it (T-635 N5,
                item 3; it used to read "Client link — sent"). */}
            <span className="lens-panel__share-result-label">Link ready. Not emailed; copy it into your message.</span>
            <span className="lens-panel__share-url" data-testid="share-url">{lastShareUrl}</span>
            <div className="lens-panel__share-buttons">
              <button type="button" className="lens-panel__chip-link" onClick={handleCopy} data-testid="share-copy">
                {copied ? "Copied" : "Copy link"}
              </button>
              {/* Opening the client's own link would count as the client
                  opening it; the preview shows the same page and stamps nothing. */}
              {lastShareProposalId !== null && (
                <a className="lens-panel__chip-link" href={`/proposal-preview/${encodeURIComponent(lastShareProposalId)}`}
                  target="_blank" rel="noopener noreferrer" data-testid="share-preview">
                  Preview as the client
                </a>
              )}
            </div>
          </div>
        )}
      </LensPanelSection>
    </LensPanel>
  );
}
