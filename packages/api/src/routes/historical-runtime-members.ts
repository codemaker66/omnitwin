import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import type { Env } from "../env.js";
import { authenticate } from "../middleware/auth.js";
import { MAX_HISTORICAL_RUNTIME_MEMBER_BYTES } from "../services/phase-layout-runtime-admission.js";
import { canReadVenuePlanningData } from "../utils/query.js";

const HistoricalRuntimeMemberParamsSchema = z.object({
  venueId: z.string().uuid(),
  spaceId: z.string().uuid(),
  bindingId: z.string().uuid(),
  memberIndex: z.coerce.number().int().nonnegative().max(7),
  fileName: z.string().trim().min(1).max(255).regex(/^[^/\\]+$/u),
}).strict();

export type HistoricalRuntimeMemberByteLoader = (
  storageKey: string,
  expectedSizeBytes: number,
  signal: AbortSignal,
) => Promise<Buffer>;

const MAX_CONCURRENT_HISTORICAL_RUNTIME_TRANSFERS = 4;
let activeHistoricalRuntimeTransfers = 0;

export function tryAcquireHistoricalRuntimeTransfer(): (() => void) | null {
  if (activeHistoricalRuntimeTransfers >= MAX_CONCURRENT_HISTORICAL_RUNTIME_TRANSFERS) {
    return null;
  }
  activeHistoricalRuntimeTransfers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeHistoricalRuntimeTransfers -= 1;
  };
}

function historicalRuntimeAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Historical runtime transfer was cancelled", "AbortError");
}

export async function readBoundedHistoricalRuntimeMember(
  body: Readable,
  expectedSizeBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  if (
    !Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes <= 0 ||
    expectedSizeBytes > MAX_HISTORICAL_RUNTIME_MEMBER_BYTES
  ) {
    body.destroy();
    throw new Error("Historical runtime member exceeds the verified byte limit");
  }
  const abortBody = (): void => {
    if (!body.destroyed) body.destroy(historicalRuntimeAbortError(signal));
  };
  signal.addEventListener("abort", abortBody, { once: true });
  if (signal.aborted) abortBody();
  const bytes = Buffer.allocUnsafe(expectedSizeBytes);
  let offset = 0;
  try {
    for await (const chunk of body) {
      const part = typeof chunk === "string"
        ? Buffer.from(chunk)
        : Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as Uint8Array);
      if (offset + part.byteLength > expectedSizeBytes) {
        throw new Error("Historical runtime member exceeded its exact size");
      }
      part.copy(bytes, offset);
      offset += part.byteLength;
    }
  } finally {
    signal.removeEventListener("abort", abortBody);
    if (!body.destroyed) body.destroy();
  }
  if (offset !== expectedSizeBytes) {
    throw new Error("Historical runtime member did not match its exact size");
  }
  return bytes;
}

function notFound(reply: FastifyReply): FastifyReply {
  return reply.status(404).send({ error: "Historical runtime member not found", code: "NOT_FOUND" });
}


export async function historicalRuntimeMemberRoutes(
  server: FastifyInstance,
  opts: {
    readonly db: Database;
    readonly env: Env;
    readonly loadMemberBytes?: HistoricalRuntimeMemberByteLoader;
  },
): Promise<void> {
  // The legacy descriptor and delivery path is deliberately absent. T-541 must
  // replace this quarantine handler with a typed, DB-authenticated execution
  // attestation verifier; changing a boolean cannot re-enable byte delivery.
  void opts;
  server.get(
    "/venues/:venueId/spaces/:spaceId/runtime-bindings/:bindingId/members/:memberIndex/:fileName",
    { preHandler: [authenticate] },
    (request, reply) => {
      const params = HistoricalRuntimeMemberParamsSchema.safeParse(request.params);
      if (!params.success) return notFound(reply);
      if (!canReadVenuePlanningData(request.user, params.data.venueId)) return notFound(reply);
      return notFound(reply);
    },
  );
}
