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
//   channel FAILS  → (timeout, socket died mid-flight) REST retry. Safe by
//                    construction: if the command actually committed, the
//                    REST attempt is a separate operation the server rules
//                    on normally, and a resend of the SAME command would
//                    have replayed via the diary_commands ledger.
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

let currentChannel: DiaryCommandSender | null = null;

/** Registered by useDiaryLive on hello; cleared on close/unmount. */
export function setDiaryCommandChannel(sender: DiaryCommandSender | null): void {
  currentChannel = sender;
}

/** Route a mutation command-first with REST fallback (see module comment). */
export async function sendViaChannelOrRest(
  buildCommand: (commandId: string) => DiaryCommand,
  restFallback: () => Promise<Booking>,
): Promise<Booking> {
  const channel = currentChannel;
  if (channel === null) return restFallback();

  let ack: DiaryCommandAck;
  try {
    ack = await channel(buildCommand(crypto.randomUUID()));
  } catch {
    // Channel-level failure only — the server never answered. REST decides.
    return restFallback();
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
