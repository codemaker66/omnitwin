import type { Booking, DiaryCommand, DiaryCommandAck } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";

// ---------------------------------------------------------------------------
// Diary command channel registry (T-537; Canon §9).
//
// The live socket (useDiaryLive) registers a sender while /ws/diary is open
// and authenticated; the api layer (api/diary.ts) routes every booking
// mutation through sendViaChannelOrRest. The result:
//
//   channel open   → the mutation travels as a command envelope; a rejected
//                    ack re-throws as a REAL ApiError (status/code/details
//                    verbatim), so every existing error branch — drawer
//                    copy, the board's 409 handling — works unchanged.
//   channel absent → plain REST, exactly as before T-537.
//   channel FAILS  → two distinct cases (reviewer P0, T-537). The sender
//                    rejects with ChannelDispatchError whose `sent` flag
//                    records whether the frame was handed to the socket:
//        never sent (socket closed before dispatch) → REST retry, always
//          safe — the server provably saw nothing.
//        sent but unconfirmed (ack timeout / drop after send) → REST retry
//          ONLY for update/transition, whose cores re-apply to the SAME
//          row (a repeat is a no-op or a clean 4xx). A create carries no
//          idempotency identity over REST — the commandId ledger covers
//          the ws transport alone — so a blind retry could commit a
//          SECOND booking (holds/prospects overlap by design). An
//          unconfirmed create therefore surfaces COMMAND_UNCONFIRMED and
//          the board's next refetch shows the truth.
//
// Ack integrity: the protocol layer (live-protocol.ts) parses every server
// frame against the SHARED DiaryCommandAckSchema — which embeds
// BookingSchema — before an ack ever reaches this module, so a
// presence-check on `ack.booking` suffices here (no double parse).
//
// The registry is deliberately module-level: the api layer must stay a
// plain function surface (no hooks), and exactly one live board exists per
// tab (the Diary route).
// ---------------------------------------------------------------------------

export type DiaryCommandSender = (command: DiaryCommand) => Promise<DiaryCommandAck>;

/** How a channel dispatch failed. `sent === false` means the frame provably
 *  never left this client (socket not open, or send threw synchronously) —
 *  the only case where a blind REST retry of a create is safe. */
export class ChannelDispatchError extends Error {
  constructor(
    readonly sent: boolean,
    message: string,
  ) {
    super(message);
    this.name = "ChannelDispatchError";
  }
}

let currentChannel: DiaryCommandSender | null = null;

/** Registered by useDiaryLive on hello; cleared on close/unmount. */
export function setDiaryCommandChannel(sender: DiaryCommandSender | null): void {
  currentChannel = sender;
}

/** Clear the registry ONLY if `sender` is still the registered channel — a
 *  stale cleanup (unusual remount ordering, a second board instance) must
 *  never tear down its successor's registration (reviewer P2, T-537). */
export function releaseDiaryCommandChannel(sender: DiaryCommandSender): void {
  if (currentChannel === sender) currentChannel = null;
}

/** Route a mutation command-first with REST fallback (see module comment). */
export async function sendViaChannelOrRest(
  buildCommand: (commandId: string) => DiaryCommand,
  restFallback: () => Promise<Booking>,
): Promise<Booking> {
  const channel = currentChannel;
  if (channel === null) return restFallback();

  const command = buildCommand(crypto.randomUUID());
  let ack: DiaryCommandAck;
  try {
    ack = await channel(command);
  } catch (error) {
    // Channel-level failure — the server never ANSWERED, but it may still
    // have EXECUTED (see module comment). REST retry is allowed when the
    // frame provably never left this client, or when the command's core is
    // shape-idempotent (update/transition). An unconfirmed create must not
    // re-execute as a new operation.
    const neverSent = error instanceof ChannelDispatchError && !error.sent;
    if (neverSent || command.kind !== "booking.create") return restFallback();
    throw new ApiError(
      0,
      "Could not confirm this booking was created — check the board before retrying",
      "COMMAND_UNCONFIRMED",
    );
  }

  if (ack.outcome === "rejected") {
    throw new ApiError(
      ack.status,
      ack.error ?? "The command was rejected",
      ack.code ?? "COMMAND_REJECTED",
      ack.details,
    );
  }
  if (ack.booking === undefined) {
    // Defensive: an applied ack should always carry the booking; if a
    // server variant ever omits it, REST re-reads authoritative state.
    return restFallback();
  }
  return ack.booking;
}
