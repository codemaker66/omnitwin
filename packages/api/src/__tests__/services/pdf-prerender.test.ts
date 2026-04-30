import { describe, it, expect, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import {
  pdfObjectKey,
  prerenderSnapshotPdf,
} from "../../services/pdf-prerender.js";
import type { Database } from "../../db/client.js";
import type { Env } from "../../env.js";
import type { HallkeeperSheetV2 } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// pdf-prerender — pure helpers + dev-safe skip path
//
// We don't test the actual R2 upload here — that would require either
// a live bucket or mocking the AWS SDK, both fragile. The tests cover:
//   - `pdfObjectKey` is deterministic and content-addressed
//   - The `skipped-no-r2` branch fires when R2 env is unset (dev path)
//   - The skip-path logs an ops signal
// ---------------------------------------------------------------------------

const MINIMAL_PAYLOAD: HallkeeperSheetV2 = {
  config: {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Test Event",
    guestCount: 10,
    layoutStyle: "dinner-rounds",
  },
  venue: {
    name: "Trades Hall Glasgow",
    address: "85 Glassford St",
    logoUrl: null,
    timezone: "Europe/London",
  },
  space: { name: "Grand Hall", widthM: 21, lengthM: 10.5, heightM: 7 },
  timing: null,
  instructions: null,
  phases: [],
  totals: { entries: [], totalRows: 0, totalItems: 0 },
  diagramUrl: null,
  webViewUrl: "https://example.com/hallkeeper/abc",
  generatedAt: "2026-04-17T10:00:00.000Z",
  approval: null,
};

function silentLogger(): FastifyBaseLogger {
  const noop = (): void => undefined;
  return {
    info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
    child: () => silentLogger(),
    level: "info",
  } as unknown as FastifyBaseLogger;
}

describe("pdfObjectKey", () => {
  it("builds sheets/<configId>/v<version>-<hash>.pdf", () => {
    const key = pdfObjectKey(
      "cfg-abc",
      3,
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    expect(key).toBe(
      "sheets/cfg-abc/v3-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.pdf",
    );
  });

  it("produces deterministic keys (same input → same key)", () => {
    expect(pdfObjectKey("c", 1, "h")).toBe(pdfObjectKey("c", 1, "h"));
  });

  it("changes when version changes (different revision → different key)", () => {
    expect(pdfObjectKey("c", 1, "h")).not.toBe(pdfObjectKey("c", 2, "h"));
  });

  it("changes when sourceHash changes (content-addressed invalidation)", () => {
    expect(pdfObjectKey("c", 1, "h1")).not.toBe(pdfObjectKey("c", 1, "h2"));
  });
});

describe("prerenderSnapshotPdf — dev skip path (R2 unconfigured)", () => {
  const fakeDb: Database = {} as unknown as Database;

  it("returns { status: 'skipped-no-r2' } when R2_BUCKET_NAME is missing", async () => {
    const env = {
      R2_BUCKET_NAME: undefined,
      R2_PUBLIC_URL: "https://cdn.example.com",
      R2_ACCOUNT_ID: "abc",
    } as unknown as Env;

    const result = await prerenderSnapshotPdf(fakeDb, env, silentLogger(), {
      snapshotId: "s1",
      configId: "c1",
      version: 1,
      sourceHash: "0".repeat(64),
      payload: MINIMAL_PAYLOAD,
    });

    expect(result.status).toBe("skipped-no-r2");
    expect(result.pdfUrl).toBeNull();
  });

  it("returns skipped-no-r2 when R2_PUBLIC_URL is missing", async () => {
    const env = {
      R2_BUCKET_NAME: "bucket",
      R2_PUBLIC_URL: undefined,
      R2_ACCOUNT_ID: "abc",
    } as unknown as Env;

    const result = await prerenderSnapshotPdf(fakeDb, env, silentLogger(), {
      snapshotId: "s1",
      configId: "c1",
      version: 1,
      sourceHash: "0".repeat(64),
      payload: MINIMAL_PAYLOAD,
    });

    expect(result.status).toBe("skipped-no-r2");
  });

  it("returns skipped-no-r2 when R2_ACCOUNT_ID is missing", async () => {
    const env = {
      R2_BUCKET_NAME: "bucket",
      R2_PUBLIC_URL: "https://cdn.example.com",
      R2_ACCOUNT_ID: undefined,
    } as unknown as Env;

    const result = await prerenderSnapshotPdf(fakeDb, env, silentLogger(), {
      snapshotId: "s1",
      configId: "c1",
      version: 1,
      sourceHash: "0".repeat(64),
      payload: MINIMAL_PAYLOAD,
    });

    expect(result.status).toBe("skipped-no-r2");
  });

  it("logs at info when skipping (ops signal)", async () => {
    const infoSpy = vi.fn();
    const logger = {
      ...silentLogger(),
      info: infoSpy,
    } as unknown as FastifyBaseLogger;

    await prerenderSnapshotPdf(fakeDb, { R2_BUCKET_NAME: undefined } as unknown as Env, logger, {
      snapshotId: "s1",
      configId: "c1",
      version: 1,
      sourceHash: "0".repeat(64),
      payload: MINIMAL_PAYLOAD,
    });

    expect(infoSpy).toHaveBeenCalled();
  });
});
