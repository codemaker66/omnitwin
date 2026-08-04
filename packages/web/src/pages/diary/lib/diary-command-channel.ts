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
//   channel absent → plain REST, carrying the same minted commandId as an
//                    Idempotency-Key (T-538).
//   channel FAILS  → REST retry with the SAME commandId (T-538). The
//                    fallback sends the id as an Idempotency-Key, so the
//                    server's diary_commands ledger dedupes across BOTH
//                    transports: if the ws attempt committed, the REST
//                    resend replays the recorded outcome instead of
//                    re-executing — no duplicate is possible even for a
//                    create (holds/prospects overlap by design, so this
//                    was T-537's P0; its refusal-based guard is superseded
//                    by identity). The sender still rejects with
//                    ChannelDispatchError whose `sent` flag records
//                    whether the frame reached the socket — diagnostic
//                    now, no longer a retry gate.
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

/** Route a mutation command-first with REST fallback (see module comment).
 *  ONE commandId is minted per logical operation and travels with BOTH
 *  transports — the fallback passes it as an Idempotency-Key, so the
 *  server's ledger dedupes a channel attempt and its REST retry. */
export async function sendViaChannelOrRest(
  buildCommand: (commandId: string) => DiaryCommand,
  restFallback: (commandId: string) => Promise<Booking>,
): Promise<Booking> {
  const commandId = crypto.randomUUID();
  const channel = currentChannel;
  if (channel === null) return restFallback(commandId);

  const command = buildCommand(commandId);
  let ack: DiaryCommandAck;
  try {
    ack = await channel(command);
  } catch {
    // Channel-level failure — the server never ANSWERED, but it may still
    // have EXECUTED. The retry carries the SAME commandId, so a committed
    // ws attempt replays instead of re-executing (T-538).
    return restFallback(commandId);
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
    // server variant ever omits it, the SAME-id REST call replays the
    // recorded outcome with a fresh row read — authoritative state.
    return restFallback(command.commandId);
  }
  return ack.booking;
}
