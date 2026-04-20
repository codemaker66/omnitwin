import type { FastifyBaseLogger } from "fastify";
import { subscribe } from "./event-bus.js";

// ---------------------------------------------------------------------------
// Default event-bus subscribers
//
// Wired once at `buildServer` boot. Each subscriber is a small,
// focused consumer of a single event type — adding a new one is a
// one-function change with no edits to the hot-path routes.
//
// Subscribers here are production-safe: structured-logging only, no
// external I/O. Webhook + analytics subscribers can be added
// alongside without disturbing this layer.
// ---------------------------------------------------------------------------

/**
 * Structured audit-log subscriber. Writes a single INFO-level log
 * line for every approval event — feeds ops dashboards and alarm
 * rules (e.g. "alert if approval rate drops 50% in 1h"). Does NOT
 * write to DB; the audit trail lives in `configuration_review_history`
 * and is written by the route handler before the event fires.
 */
export function registerDefaultSubscribers(logger: FastifyBaseLogger): void {
  subscribe("approval.recorded", {
    name: "audit-log",
    handle: (payload) => {
      logger.info(
        {
          event: "approval.recorded",
          configId: payload.configId,
          snapshotId: payload.snapshotId,
          version: payload.version,
          approver: payload.approval.approverName,
          approvedAt: payload.approval.approvedAt,
        },
        "approval recorded",
      );
    },
  });

  subscribe("approval.revoked", {
    name: "audit-log",
    handle: (payload) => {
      logger.info(
        {
          event: "approval.revoked",
          configId: payload.configId,
          fromStatus: payload.fromStatus,
          toStatus: payload.toStatus,
        },
        "approval revoked / withdrawn",
      );
    },
  });

  subscribe("snapshot.created", {
    name: "audit-log",
    handle: (payload) => {
      logger.info(
        {
          event: "snapshot.created",
          configId: payload.configId,
          snapshotId: payload.snapshotId,
          version: payload.version,
        },
        "snapshot created",
      );
    },
  });
}
