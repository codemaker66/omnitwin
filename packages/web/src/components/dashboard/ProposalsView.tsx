import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  findUnsupportedProposalClaim,
  LAYOUT_STYLES,
  PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION,
  ProposalVersionPayloadSchema,
  type LayoutStyle,
  type ProposalVersionPayload,
} from "@omnitwin/types";
import {
  createProposal,
  createProposalShareToken,
  createProposalVersion,
  createQuote,
  getLatestProposalVersion,
  getProposal,
  getProposalComments,
  getProposalHistory,
  listProposals,
  postProposalComment,
  transitionProposal,
  type ProposalCommentRow,
  type ProposalHistoryEntry,
  type StaffProposal,
  type StaffProposalVersion,
} from "../../api/proposals.js";
import { formatMinorAsCurrency, parsePoundsToMinor } from "../../lib/money-input.js";
import {
  buildProposalCapacityGuidance,
  buildProposalCapacityNote,
  CAPACITY_STYLE_LABELS,
} from "../../lib/proposal-capacity-note.js";
import { listSpaces, type Space } from "../../api/spaces.js";
import { useAuthStore } from "../../stores/auth-store.js";

// ---------------------------------------------------------------------------
// ProposalsView — staff authoring surface (T-427 phase 4).
//
// Create a draft → compose a version (message, capacity note, optional quote
// with exact minor-unit money) → send (the API mints the share link) →
// track client responses through the status history. The types-level claim
// guard runs CLIENT-SIDE before anything is posted, so unsupported certainty
// wording is explained inline instead of bouncing off the API.
// ---------------------------------------------------------------------------

const card: React.CSSProperties = {
  background: "linear-gradient(180deg, #fffdf8 0%, #f8f1e5 100%)",
  border: "1px solid rgba(92, 69, 38, 0.18)",
  borderRadius: 8,
  padding: 20,
  boxShadow: "0 18px 42px rgba(44, 31, 16, 0.08)",
};

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 700, color: "#715f42", marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 40,
  padding: "8px 10px",
  fontSize: 14,
  border: "1px solid rgba(92, 69, 38, 0.22)",
  borderRadius: 6,
  background: "#fffaf1",
  color: "#21190f",
  fontFamily: "inherit",
};

const buttonPrimary: React.CSSProperties = {
  background: "#21190f",
  color: "#fff7e8",
  border: "none",
  borderRadius: 6,
  minHeight: 40,
  padding: "9px 18px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

const buttonSecondary: React.CSSProperties = {
  background: "#fffaf1",
  color: "#21190f",
  border: "1px solid rgba(92, 69, 38, 0.24)",
  borderRadius: 6,
  minHeight: 40,
  padding: "9px 18px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "#6b7280",
  sent: "#2563eb",
  changes_requested: "#d97706",
  accepted: "#059669",
  declined: "#dc2626",
  expired: "#9ca3af",
  withdrawn: "#9ca3af",
  archived: "#9ca3af",
};

function StatusPill({ status }: { readonly status: string }): ReactElement {
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 12,
      fontWeight: 600, color: "#fff", background: STATUS_COLORS[status] ?? "#6b7280",
    }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

const SENDABLE_STATUSES = ["draft", "changes_requested"];
const WITHDRAWABLE_STATUSES = ["draft", "sent", "changes_requested"];
const ARCHIVABLE_STATUSES = ["accepted", "declined", "expired", "withdrawn"];

interface QuoteLineDraft {
  description: string;
  quantity: string;
  pounds: string;
}

const EMPTY_LINE: QuoteLineDraft = { description: "", quantity: "1", pounds: "" };

export function ProposalsView(): ReactElement {
  const user = useAuthStore((s) => s.user);

  const [proposals, setProposals] = useState<StaffProposal[]>([]);
  const [listError, setListError] = useState(false);
  const [selected, setSelected] = useState<StaffProposal | null>(null);
  const [history, setHistory] = useState<ProposalHistoryEntry[]>([]);
  const [latestVersion, setLatestVersion] = useState<StaffProposalVersion | null>(null);
  const [comments, setComments] = useState<ProposalCommentRow[]>([]);
  const [replyText, setReplyText] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState("");
  const [clientMessage, setClientMessage] = useState("");
  const [capacityNote, setCapacityNote] = useState("");
  const [quoteLines, setQuoteLines] = useState<QuoteLineDraft[]>([]);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [latestShareUrl, setLatestShareUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshList = useCallback(() => {
    listProposals()
      .then((rows) => { setProposals(rows); setListError(false); })
      .catch(() => { setListError(true); });
  }, []);

  useEffect(() => { refreshList(); }, [refreshList]);

  // Rooms power the capacity guidance block (T-429). Failure is non-fatal —
  // the guidance simply stays unavailable and the note stays hand-written.
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [capSpaceId, setCapSpaceId] = useState("");
  const [capGuests, setCapGuests] = useState("");
  const [capStyle, setCapStyle] = useState<LayoutStyle>("dinner-rounds");

  useEffect(() => {
    const venueId = user?.venueId;
    if (venueId === undefined || venueId === null) return;
    listSpaces(venueId)
      .then((rows) => {
        setSpaces(rows);
        setCapSpaceId((current) => (current.length > 0 ? current : (rows[0]?.id ?? "")));
      })
      .catch(() => { /* guidance unavailable — note stays manual */ });
  }, [user?.venueId]);

  const loadComments = useCallback((id: string) => {
    getProposalComments(id)
      .then(setComments)
      .catch(() => { setComments([]); });
  }, []);

  const selectProposal = useCallback((proposal: StaffProposal) => {
    setSelected(proposal);
    setComposerError(null);
    setActionError(null);
    setCommentError(null);
    setReplyText("");
    setClientMessage("");
    setCapacityNote("");
    setQuoteLines([]);
    setLatestShareUrl(null);
    getProposalHistory(proposal.id)
      .then(setHistory)
      .catch(() => { setHistory([]); });
    getLatestProposalVersion(proposal.id)
      .then(setLatestVersion)
      .catch(() => { setLatestVersion(null); });
    loadComments(proposal.id);
  }, [loadComments]);

  const refreshSelected = useCallback((id: string) => {
    getProposal(id)
      .then((proposal) => {
        setSelected(proposal);
        refreshList();
        getProposalHistory(id).then(setHistory).catch(() => { setHistory([]); });
        getLatestProposalVersion(id).then(setLatestVersion).catch(() => { setLatestVersion(null); });
        loadComments(id);
      })
      .catch(() => { setActionError("Could not refresh the proposal. Reload the page and try again."); });
  }, [refreshList, loadComments]);

  const handlePostReply = (): void => {
    if (selected === null || busy || replyText.trim().length === 0) return;
    setCommentError(null);

    // The reply is shown to the client, so the claim guard runs here too —
    // client-side first (precise inline message), server-side as the backstop.
    const claim = findUnsupportedProposalClaim(replyText);
    if (claim !== null) {
      setCommentError(`Reply contains an unsupported certainty claim ("${claim}") that can't be shown to a client. Reword and try again.`);
      return;
    }

    setBusy(true);
    const proposalId = selected.id;
    postProposalComment(proposalId, replyText.trim())
      .then(() => {
        setReplyText("");
        loadComments(proposalId);
      })
      .catch(() => { setCommentError("Could not post the reply. Please try again."); })
      .finally(() => { setBusy(false); });
  };

  const handleCreate = (): void => {
    if (user?.venueId === undefined || user.venueId === null || newTitle.trim().length === 0 || busy) return;
    setBusy(true);
    createProposal({ venueId: user.venueId, title: newTitle.trim() })
      .then((created) => {
        setNewTitle("");
        refreshList();
        selectProposal(created);
      })
      .catch(() => { setActionError("Could not create the proposal. Please try again."); })
      .finally(() => { setBusy(false); });
  };

  const handleSaveVersion = (): void => {
    if (selected === null || busy) return;
    setComposerError(null);

    const activeLines = quoteLines.filter(
      (line) => line.description.trim().length > 0 || line.pounds.trim().length > 0,
    );
    const parsedLines: { description: string; quantity: number; unitAmountMinor: number }[] = [];
    for (const [index, line] of activeLines.entries()) {
      const quantity = Number(line.quantity);
      const unitAmountMinor = parsePoundsToMinor(line.pounds);
      if (line.description.trim().length === 0) {
        setComposerError(`Quote line ${String(index + 1)} needs a description.`);
        return;
      }
      if (!Number.isInteger(quantity) || quantity < 1) {
        setComposerError(`Quote line ${String(index + 1)} needs a whole-number quantity of at least 1.`);
        return;
      }
      if (unitAmountMinor === null) {
        setComposerError(`Quote line ${String(index + 1)} needs a price like 120 or 120.50.`);
        return;
      }
      parsedLines.push({ description: line.description.trim(), quantity, unitAmountMinor });
    }

    setBusy(true);
    const proposalId = selected.id;

    const buildAndSave = async (): Promise<void> => {
      let quoteSnapshot: ProposalVersionPayload["quote"] = null;
      if (parsedLines.length > 0) {
        // Totals come back from the server's exact money engine — the
        // snapshot reuses them verbatim, never recomputing client-side.
        const quote = await createQuote({
          venueId: selected.venueId,
          opportunityId: selected.opportunityId,
          proposalId: selected.id,
          name: `${selected.title} quote`,
          currency: "GBP",
          lineItems: parsedLines,
        });
        quoteSnapshot = {
          quoteId: quote.id,
          currency: "GBP",
          lineItems: quote.lineItems.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitAmountMinor: item.unitAmountMinor,
            lineTotalMinor: item.lineTotalMinor,
          })),
          subtotalMinor: quote.subtotalMinor,
          totalMinor: quote.totalMinor,
        };
      }

      const candidate = {
        schemaVersion: PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION,
        title: selected.title,
        clientMessage: clientMessage.trim().length > 0 ? clientMessage.trim() : null,
        configurationId: selected.configurationId,
        layoutRevision: null,
        capacityNote: capacityNote.trim().length > 0 ? capacityNote.trim() : null,
        quote: quoteSnapshot,
      };
      // Claim guard runs here, client-side, so unsupported certainty wording
      // is explained before anything is persisted.
      const parsed = ProposalVersionPayloadSchema.safeParse(candidate);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        setComposerError(first?.message ?? "The proposal content is not valid.");
        return;
      }

      await createProposalVersion(proposalId, parsed.data);
      setClientMessage("");
      setCapacityNote("");
      setQuoteLines([]);
      refreshSelected(proposalId);
    };

    buildAndSave()
      .catch(() => { setComposerError("Could not save this version. Please try again."); })
      .finally(() => { setBusy(false); });
  };

  const handleTransition = (status: string): void => {
    if (selected === null || busy) return;
    setBusy(true);
    setActionError(null);
    transitionProposal(selected.id, status)
      .then(() => { refreshSelected(selected.id); })
      .catch(() => { setActionError("That action did not go through. Refresh and try again."); })
      .finally(() => { setBusy(false); });
  };

  const handleCreateShareToken = (): void => {
    if (selected === null || busy) return;
    setBusy(true);
    setActionError(null);
    createProposalShareToken(selected.id)
      .then((result) => {
        setLatestShareUrl(`${window.location.origin}${result.shareUrl}`);
        setSelected(result.proposal);
        refreshList();
      })
      .catch(() => { setActionError("Could not generate the client share link. Save a version and try again."); })
      .finally(() => { setBusy(false); });
  };

  const shareUrl = latestShareUrl ?? (selected?.shareCode !== null && selected?.shareCode !== undefined
    ? `${window.location.origin}/proposal/${selected.shareCode}`
    : null);
  const canSend = selected !== null && SENDABLE_STATUSES.includes(selected.status) && selected.currentVersion >= 1;
  const canCompose = selected !== null && SENDABLE_STATUSES.includes(selected.status);

  // Capacity guidance derivations — bounding-box floor area is the same
  // planning-grade basis the planner HUD uses (geometry, not money: plain
  // number arithmetic is fine here).
  const capSpace = spaces.find((space) => space.id === capSpaceId) ?? null;
  const capFloorAreaM2 = capSpace !== null ? Number(capSpace.widthM) * Number(capSpace.lengthM) : 0;
  const capGuestCount = /^\d+$/.test(capGuests.trim()) ? Number(capGuests.trim()) : 0;
  const capacityIntel = capSpace !== null && capFloorAreaM2 > 0
    ? buildProposalCapacityGuidance(capFloorAreaM2, capGuestCount, capStyle)
    : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 340px) 1fr", gap: 20, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <section style={card} aria-label="Create proposal">
          <h2 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 600 }}>New proposal</h2>
          {user?.venueId === null || user?.venueId === undefined ? (
            <p style={{ fontSize: 13, color: "#75644c", margin: 0 }}>
              Your account isn't linked to a venue, so proposals can't be created from here.
            </p>
          ) : (
            <>
              <label style={labelStyle} htmlFor="new-proposal-title">Title</label>
              <input
                id="new-proposal-title"
                data-testid="create-title"
                style={inputStyle}
                value={newTitle}
                onChange={(e) => { setNewTitle(e.target.value); }}
                maxLength={200}
                placeholder="Autumn gala — Grand Hall"
              />
              <button
                type="button"
                data-testid="create-submit"
                style={{ ...buttonPrimary, marginTop: 10, opacity: newTitle.trim().length === 0 || busy ? 0.5 : 1 }}
                disabled={newTitle.trim().length === 0 || busy}
                onClick={handleCreate}
              >
                Create draft
              </button>
            </>
          )}
        </section>

        <section style={card} aria-label="Proposals">
          <h2 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 600 }}>Proposals</h2>
          {listError && (
            <p style={{ fontSize: 13, color: "#b91c1c" }}>Couldn't load proposals. Refresh to retry.</p>
          )}
          {!listError && proposals.length === 0 && (
            <p style={{ fontSize: 13, color: "#75644c", margin: 0 }}>
              No proposals yet. Create a draft to start a client conversation.
            </p>
          )}
          <ul data-testid="proposals-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {proposals.map((proposal) => (
              <li key={proposal.id}>
                <button
                  type="button"
                  data-testid={`proposal-row-${proposal.id}`}
                  onClick={() => { selectProposal(proposal); }}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                    width: "100%", textAlign: "left", padding: "10px 8px", fontSize: 13,
                    background: selected?.id === proposal.id ? "#efe0bf" : "transparent",
                    border: "none", borderBottom: "1px solid rgba(92, 69, 38, 0.14)", cursor: "pointer",
                    color: "#21190f",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proposal.title}</span>
                  <StatusPill status={proposal.status} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {selected === null ? (
        <section style={{ ...card, color: "#75644c", fontSize: 14 }}>
          Select a proposal to view and edit it, or create a new draft.
        </section>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section style={card} aria-label="Proposal detail">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#21190f" }}>{selected.title}</h2>
              <StatusPill status={selected.status} />
            </div>
            <div style={{ fontSize: 13, color: "#75644c", marginTop: 6 }}>
              Version {selected.currentVersion} {latestVersion !== null ? `— last saved ${new Date(latestVersion.createdAt).toLocaleString("en-GB")}` : "— no content saved yet"}
            </div>

            {shareUrl !== null && (
              <div style={{ marginTop: 12, fontSize: 13 }}>
                <span style={{ fontWeight: 600, marginRight: 8 }}>Client link:</span>
                <a data-testid="share-link" href={shareUrl}>{shareUrl}</a>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              {SENDABLE_STATUSES.includes(selected.status) && (
                <button
                  type="button"
                  data-testid="send-button"
                  style={{ ...buttonPrimary, opacity: canSend && !busy ? 1 : 0.5 }}
                  disabled={!canSend || busy}
                  title={canSend ? "Generate a client share link" : "Save a version before sharing"}
                  onClick={handleCreateShareToken}
                >
                  Generate client link
                </button>
              )}
              {WITHDRAWABLE_STATUSES.includes(selected.status) && (
                <button type="button" data-testid="withdraw-button" style={buttonSecondary} disabled={busy} onClick={() => { handleTransition("withdrawn"); }}>
                  Withdraw
                </button>
              )}
              {ARCHIVABLE_STATUSES.includes(selected.status) && (
                <button type="button" data-testid="archive-button" style={buttonSecondary} disabled={busy} onClick={() => { handleTransition("archived"); }}>
                  Archive
                </button>
              )}
            </div>
            {actionError !== null && (
              <div role="alert" style={{ marginTop: 10, fontSize: 13, color: "#b91c1c" }}>{actionError}</div>
            )}
          </section>

          {canCompose && (
            <section style={card} aria-label="Compose version">
              <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700, color: "#21190f" }}>Compose a new version</h3>
              <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "#75644c" }}>
                Saved versions are immutable snapshots — sending shares the latest one. Figures are
                planning estimates; wording that claims safety or compliance certainty is rejected.
              </p>

              <label style={labelStyle} htmlFor="composer-message">Message to the client</label>
              <textarea
                id="composer-message"
                data-testid="composer-message"
                style={{ ...inputStyle, resize: "vertical" }}
                rows={4}
                maxLength={4000}
                value={clientMessage}
                onChange={(e) => { setClientMessage(e.target.value); }}
              />

              <label style={{ ...labelStyle, marginTop: 12 }} htmlFor="composer-capacity">Capacity note (planning estimate wording)</label>
              <input
                id="composer-capacity"
                data-testid="composer-capacity"
                style={inputStyle}
                maxLength={500}
                value={capacityNote}
                onChange={(e) => { setCapacityNote(e.target.value); }}
              />

              {spaces.length > 0 && (
                <div style={{ marginTop: 10, padding: 12, background: "#fff7e8", border: "1px solid rgba(92, 69, 38, 0.18)", borderRadius: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#715f42", marginBottom: 8 }}>
                    Capacity guidance — planning-grade, from room floor area
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 1fr", gap: 8 }}>
                    <select
                      aria-label="Guidance room"
                      data-testid="capacity-space"
                      style={inputStyle}
                      value={capSpaceId}
                      onChange={(e) => { setCapSpaceId(e.target.value); }}
                    >
                      {spaces.map((space) => (
                        <option key={space.id} value={space.id}>{space.name}</option>
                      ))}
                    </select>
                    <input
                      aria-label="Guidance guest count"
                      data-testid="capacity-guests"
                      style={inputStyle}
                      inputMode="numeric"
                      placeholder="Guests"
                      value={capGuests}
                      onChange={(e) => { setCapGuests(e.target.value); }}
                    />
                    <select
                      aria-label="Guidance layout style"
                      data-testid="capacity-style"
                      style={inputStyle}
                      value={capStyle}
                      onChange={(e) => { setCapStyle(e.target.value as LayoutStyle); }}
                    >
                      {LAYOUT_STYLES.map((style) => (
                        <option key={style} value={style}>{CAPACITY_STYLE_LABELS[style]}</option>
                      ))}
                    </select>
                  </div>
                  {capacityIntel !== null && capSpace !== null && (
                    <>
                      <div data-testid="capacity-result" style={{ fontSize: 13, color: "#3b2c1b", marginTop: 10 }}>
                        Comfortable for around {capacityIntel.comfortableCapacity} guests
                        {capacityIntel.plannedSeats > 0 && ` — ${String(capacityIntel.plannedSeats)} requested (${capacityIntel.band.replace(/-/g, " ")})`}
                        . Planning estimate only — human review required.
                      </div>
                      <button
                        type="button"
                        data-testid="capacity-insert"
                        style={{ ...buttonSecondary, marginTop: 8, padding: "6px 14px", fontSize: 12 }}
                        onClick={() => { setCapacityNote(buildProposalCapacityNote(capSpace.name, capacityIntel)); }}
                      >
                        Insert into capacity note
                      </button>
                    </>
                  )}
                </div>
              )}

              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Quote lines (optional)</span>
                  <button
                    type="button"
                    data-testid="add-quote-line"
                    style={{ ...buttonSecondary, padding: "5px 12px", fontSize: 12 }}
                    onClick={() => { setQuoteLines((lines) => [...lines, { ...EMPTY_LINE }]); }}
                  >
                    Add line
                  </button>
                </div>
                {quoteLines.map((line, index) => (
                  <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 80px 110px", gap: 8, marginTop: 8 }}>
                    <input
                      aria-label={`Line ${String(index + 1)} description`}
                      data-testid={`quote-desc-${String(index)}`}
                      style={inputStyle}
                      placeholder="Grand Hall hire"
                      value={line.description}
                      onChange={(e) => {
                        setQuoteLines((lines) => lines.map((l, i) => i === index ? { ...l, description: e.target.value } : l));
                      }}
                    />
                    <input
                      aria-label={`Line ${String(index + 1)} quantity`}
                      data-testid={`quote-qty-${String(index)}`}
                      style={inputStyle}
                      inputMode="numeric"
                      value={line.quantity}
                      onChange={(e) => {
                        setQuoteLines((lines) => lines.map((l, i) => i === index ? { ...l, quantity: e.target.value } : l));
                      }}
                    />
                    <input
                      aria-label={`Line ${String(index + 1)} unit price (£)`}
                      data-testid={`quote-price-${String(index)}`}
                      style={inputStyle}
                      inputMode="decimal"
                      placeholder="£ 0.00"
                      value={line.pounds}
                      onChange={(e) => {
                        setQuoteLines((lines) => lines.map((l, i) => i === index ? { ...l, pounds: e.target.value } : l));
                      }}
                    />
                  </div>
                ))}
              </div>

              {composerError !== null && (
                <div role="alert" data-testid="composer-error" style={{ marginTop: 12, fontSize: 13, color: "#b91c1c" }}>
                  {composerError}
                </div>
              )}

              <button
                type="button"
                data-testid="composer-save"
                style={{ ...buttonPrimary, marginTop: 14, opacity: busy ? 0.5 : 1 }}
                disabled={busy}
                onClick={handleSaveVersion}
              >
                Save version
              </button>
            </section>
          )}

          {latestVersion !== null && latestVersion.payload.quote !== null && (
            <section style={card} aria-label="Latest quote">
              <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700, color: "#21190f" }}>Latest saved quote</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <tbody>
                  {latestVersion.payload.quote.lineItems.map((item, index) => (
                    <tr key={index} style={{ borderBottom: "1px solid rgba(92, 69, 38, 0.14)" }}>
                      <td style={{ padding: "6px 0" }}>{item.description}</td>
                      <td style={{ padding: "6px 0", textAlign: "right" }}>{item.quantity}×</td>
                      <td style={{ padding: "6px 0", textAlign: "right" }}>{formatMinorAsCurrency(item.lineTotalMinor, latestVersion.payload.quote?.currency ?? "GBP")}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={2} style={{ padding: "8px 0", fontWeight: 600 }}>Total</td>
                    <td data-testid="latest-quote-total" style={{ padding: "8px 0", textAlign: "right", fontWeight: 600 }}>
                      {formatMinorAsCurrency(latestVersion.payload.quote.totalMinor, latestVersion.payload.quote.currency)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}

          <section style={card} aria-label="Client conversation" data-testid="proposal-conversation">
            <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700, color: "#21190f" }}>Conversation</h3>
            {comments.length === 0 ? (
              <p style={{ fontSize: 13, color: "#75644c", margin: 0 }}>
                No messages yet. Client comments left on the share link appear here.
              </p>
            ) : (
              <ul data-testid="conversation-thread" style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 13 }}>
                {comments.map((comment) => (
                  <li
                    key={comment.id}
                    data-testid={`comment-${comment.authorType}`}
                    style={{ padding: "8px 0", borderBottom: "1px solid rgba(92, 69, 38, 0.14)" }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                      <span style={{ fontWeight: 700, color: comment.authorType === "client" ? "#2563eb" : "#21190f" }}>
                        {comment.authorType === "client" ? (comment.authorName ?? "Client") : (comment.authorName ?? "Venue team")}
                      </span>
                      <span style={{ color: "#9c8a6f", fontSize: 12 }}>{new Date(comment.createdAt).toLocaleString("en-GB")}</span>
                      {comment.kind === "request_changes" && (
                        <span style={{ color: "#d97706", fontSize: 12 }}>· requested changes</span>
                      )}
                    </div>
                    <div style={{ color: "#3b2c1b", marginTop: 2, whiteSpace: "pre-wrap" }}>{comment.body}</div>
                  </li>
                ))}
              </ul>
            )}

            <div style={{ marginTop: 12 }}>
              <label style={labelStyle} htmlFor="proposal-reply">Reply to the client</label>
              <textarea
                id="proposal-reply"
                data-testid="reply-input"
                style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
                rows={2}
                maxLength={4000}
                value={replyText}
                onChange={(e) => { setReplyText(e.target.value); }}
                placeholder="Reply — shown to the client on the share link"
              />
              {commentError !== null && (
                <div role="alert" data-testid="reply-error" style={{ marginTop: 8, fontSize: 13, color: "#b91c1c" }}>
                  {commentError}
                </div>
              )}
              <button
                type="button"
                data-testid="reply-submit"
                style={{ ...buttonPrimary, marginTop: 8, padding: "7px 16px", fontSize: 13, opacity: busy || replyText.trim().length === 0 ? 0.5 : 1 }}
                disabled={busy || replyText.trim().length === 0}
                onClick={handlePostReply}
              >
                Post reply
              </button>
            </div>
          </section>

          <section style={card} aria-label="Status history">
            <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700, color: "#21190f" }}>History</h3>
            {history.length === 0 ? (
              <p style={{ fontSize: 13, color: "#75644c", margin: 0 }}>No status changes yet.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 13 }}>
                {history.map((entry) => (
                  <li key={entry.id} style={{ padding: "6px 0", borderBottom: "1px solid rgba(92, 69, 38, 0.14)" }}>
                    <span style={{ fontWeight: 600 }}>{entry.fromStatus.replace(/_/g, " ")} → {entry.toStatus.replace(/_/g, " ")}</span>
                    <span style={{ color: "#999", marginLeft: 8 }}>{new Date(entry.createdAt).toLocaleString("en-GB")}</span>
                    {entry.changedBy === null && <span style={{ color: "#2563eb", marginLeft: 8 }}>(client via share link)</span>}
                    {entry.note !== null && <div style={{ color: "#75644c", marginTop: 2 }}>{entry.note}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
