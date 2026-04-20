import type { FastifyBaseLogger } from "fastify";
import type { HallkeeperSheetV2, SheetApproval } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Typed in-process event bus
//
// The hallkeeper approval flow has multiple downstream side effects:
//
//   - Fire the pdf-prerender service (writes to R2, updates pdfUrl)
//   - Send configApproved email to the planner
//   - Send hallkeeperNotified email to each hallkeeper at the venue
//   - Append a row to configuration_review_history (audit trail)
//
// Before this module, the approve route handler invoked each of these
// inline — fire-and-forget for emails, awaited for DB writes. That
// works but has three ops gaps:
//
//   1. A failing email is swallowed. Ops can't observe retry patterns.
//   2. Adding a new subscriber (Slack notification, webhook out,
//      analytics event) requires editing the hot approval handler.
//   3. Testing the handler means mocking every downstream service.
//
// This bus makes the approval moment an EVENT that subscribers attach
// to. The handler emits once; subscribers each get their own
// try/catch around the side effect, with structured logging on
// failure.
//
// The bus is IN-PROCESS and synchronous-dispatch (each subscriber
// fires in sequence but emit() returns immediately). A future version
// can move this onto a durable queue (SQS, BullMQ) without changing
// the subscriber API — the emit() call site stays the same.
//
// Design tenets:
//   - TYPED payloads via a discriminated `EventMap`. Adding a new
//     event requires a new key; TypeScript enforces subscribers match.
//   - ERROR-ISOLATED subscribers: one crashing subscriber doesn't
//     starve the next. Structured `{ err, event, subscriber }` log
//     lines feed ops alarms.
//   - FIRE-AND-FORGET emit() returns void — hot paths (the approve
//     route) stay snappy.
// ---------------------------------------------------------------------------

/** Map of event names → typed payloads. */
export interface EventMap {
  readonly "approval.recorded": {
    readonly configId: string;
    readonly snapshotId: string;
    readonly version: number;
    readonly sourceHash: string;
    readonly approval: SheetApproval;
    readonly payload: HallkeeperSheetV2;
  };
  readonly "approval.revoked": {
    readonly configId: string;
    readonly fromStatus: string;
    readonly toStatus: string;
  };
  readonly "snapshot.created": {
    readonly configId: string;
    readonly snapshotId: string;
    readonly version: number;
    readonly sourceHash: string;
  };
}

export type EventName = keyof EventMap;
export type EventPayload<K extends EventName> = EventMap[K];

export interface Subscriber<K extends EventName> {
  readonly name: string;
  readonly handle: (payload: EventPayload<K>) => Promise<void> | void;
}

type Registry = {
  [K in EventName]?: Subscriber<K>[];
};

const registry: Registry = {};

/**
 * Typed accessor — reads the subscriber list for an event as
 * `Subscriber<K>[]`. A `Partial<Record<K, …>>` mapping would make TS
 * lose the generic specialization when indexed by a variable of type
 * `K`; this helper re-types the access back to the expected shape.
 */
function listFor<K extends EventName>(event: K): Subscriber<K>[] {
  return registry[event] ?? [];
}

/**
 * Attach a subscriber to an event. Subscribers run in registration
 * order when the event fires. Returns an unsubscribe function for
 * tests and dynamic plugins.
 */
export function subscribe<K extends EventName>(
  event: K,
  subscriber: Subscriber<K>,
): () => void {
  const list = listFor(event);
  list.push(subscriber);
  registry[event] = list as unknown as Registry[K];
  return () => {
    const current = listFor(event);
    const idx = current.indexOf(subscriber);
    if (idx >= 0) current.splice(idx, 1);
  };
}

/**
 * Emit an event. Fires every registered subscriber in sequence with
 * independent error isolation. Returns void immediately — the caller
 * does NOT await subscriber completion (that's the point: the hot
 * path isn't blocked by slow side effects).
 *
 * Subscribers that throw are logged at ERROR level with event name +
 * subscriber name + error. The bus does NOT retry — retry is a
 * subscriber-level concern handled by wrappers at the subscriber site.
 */
export function emit<K extends EventName>(
  logger: FastifyBaseLogger,
  event: K,
  payload: EventPayload<K>,
): void {
  const subscribers = listFor(event);
  if (subscribers.length === 0) {
    logger.debug({ event }, "event-bus: emit with no subscribers");
    return;
  }

  void (async () => {
    for (const sub of subscribers) {
      try {
        await sub.handle(payload);
      } catch (err) {
        logger.error(
          { err, event, subscriber: sub.name },
          "event-bus: subscriber threw — other subscribers continue",
        );
      }
    }
  })();
}

/**
 * Test helper — clears all subscribers. Call in `beforeEach` to keep
 * tests independent. Never call in production code.
 */
export function __resetRegistryForTests(): void {
  for (const key of Object.keys(registry) as EventName[]) {
    (registry as Record<string, unknown>)[key] = undefined;
  }
}
