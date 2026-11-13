import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HallkeeperSheetV2Schema, type HallkeeperSheetV2 } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import type { configurationSheetSnapshots } from "../db/schema.js";
import type { SheetDataV2Internal } from "../services/hallkeeper-sheet-v2-data.js";

// ---------------------------------------------------------------------------
// Hallkeeper sheet PDFs never leave through a public bucket.
//
// The sheet can carry free-text allergy and access notes, which are health
// data. It used to be pre-rendered at approval and written to the public R2
// bucket with `Cache-Control: public, max-age=31536000, immutable`, and its
// public URL was stored on the snapshot as `pdfUrl`. These tests pin the
// replacement contract:
//
//   1. The signed-in sheet route renders the PDF itself, never redirects,
//      never touches object storage, and marks the bytes `private, no-store`
//      — even with every R2 variable set.
//   2. Snapshot reads never serve a `pdfUrl`, whatever a legacy row holds.
//   3. No API source can upload a sheet PDF or publish a URL for one: the
//      pre-render module is gone, nothing that renders sheets imports the S3
//      SDK or names the public bucket, and `pdfUrl` is only ever null.
// ---------------------------------------------------------------------------

const s3 = vi.hoisted(() => ({
  clientConstructed: vi.fn(),
  commandConstructed: vi.fn(),
}));

// Any storage interaction, however it is reached, is recorded here.
vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    constructor(config: unknown) { s3.clientConstructed(config); }
    send(command: unknown): Promise<never> {
      return Promise.reject(new Error(`unexpected S3 send: ${JSON.stringify(command)}`));
    }
  }
  class Command {
    readonly input: unknown;
    constructor(input: unknown) {
      this.input = input;
      s3.commandConstructed(input);
    }
  }
  return {
    S3Client,
    PutObjectCommand: Command,
    GetObjectCommand: Command,
    HeadObjectCommand: Command,
  };
});

const assemble = vi.hoisted(() => vi.fn<() => Promise<SheetDataV2Internal | null>>());
vi.mock("../services/hallkeeper-sheet-v2-data.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/hallkeeper-sheet-v2-data.js")>();
  return { ...actual, assembleSheetDataV2: assemble };
});

const { hallkeeperSheetRoutes } = await import("../routes/hallkeeper-sheet.js");
const { getLatestApprovedSnapshot, getLatestSnapshot } = await import("../services/sheet-snapshot.js");

const CONFIG_ID = "00000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000002";
const VENUE_ID = "00000000-0000-4000-8000-000000000003";
const USER_ID = "00000000-0000-4000-8000-000000000004";
const SOURCE_HASH = "a".repeat(64);
const LEGACY_PUBLIC_URL = `https://cdn.example.test/sheets/${CONFIG_ID}/v1-${SOURCE_HASH}.pdf`;

const SHEET: HallkeeperSheetV2 = HallkeeperSheetV2Schema.parse({
  config: { id: CONFIG_ID, name: "Allergy Notes Dinner", guestCount: 10, layoutStyle: "dinner-rounds" },
  venue: { name: "Trades Hall Glasgow", address: "85 Glassford St", logoUrl: null, timezone: "Europe/London" },
  space: { name: "Grand Hall", widthM: 21, lengthM: 10.5, heightM: 7 },
  timing: null,
  instructions: null,
  phases: [],
  totals: { entries: [], totalRows: 0, totalItems: 0 },
  diagramUrl: null,
  webViewUrl: `https://example.test/hallkeeper/${CONFIG_ID}`,
  generatedAt: "2026-10-18T10:00:00.000Z",
  approval: { version: 1, approvedAt: "2026-10-18T09:00:00.000Z", approverName: "Venue reviewer" },
});

const R2_ENV = {
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "access-key",
  R2_SECRET_ACCESS_KEY: "secret-key",
  R2_BUCKET_NAME: "bucket",
  R2_PUBLIC_URL: "https://cdn.example.test",
} as const;

type SnapshotRow = typeof configurationSheetSnapshots.$inferSelect;

interface FakeLimitedQuery {
  limit: (count: number) => Promise<readonly unknown[]>;
}

interface FakeWhereQuery extends FakeLimitedQuery {
  orderBy: (...columns: readonly unknown[]) => FakeLimitedQuery;
}

interface FakeFromQuery {
  where: (...conditions: readonly unknown[]) => FakeWhereQuery;
}

interface FakeSelectQuery {
  from: (table: unknown) => FakeFromQuery;
}

/** A database whose every select chain resolves to `rows`. Writes are absent
 *  on purpose: a code path that tried to record a URL would throw. */
function fakeDb(rows: readonly unknown[]): Database {
  const limited: FakeLimitedQuery = { limit: () => Promise.resolve(rows) };
  const select = (() => ({
    from(table: unknown): FakeFromQuery {
      expect(table).toBeDefined();
      return { where: () => ({ ...limited, orderBy: () => limited }) };
    },
  }) satisfies FakeSelectQuery) as Database["select"];
  return { select } as Database;
}

function snapshotRow(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: SNAPSHOT_ID,
    configurationId: CONFIG_ID,
    version: 1,
    payload: SHEET,
    coordinateSpace: "real_m_v1",
    diagramUrl: null,
    pdfUrl: LEGACY_PUBLIC_URL,
    sourceHash: SOURCE_HASH,
    createdAt: new Date("2026-10-18T08:00:00.000Z"),
    createdBy: USER_ID,
    approvedAt: new Date("2026-10-18T09:00:00.000Z"),
    approvedBy: USER_ID,
    ...overrides,
  };
}

const HEADERS = {
  authorization: `Bearer ${JSON.stringify({ id: USER_ID, email: "staff@sheet-privacy.invalid", role: "staff", venueId: VENUE_ID })}`,
};

describe("GET /hallkeeper/:configId/sheet — signed-in rendering only", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = Fastify();
    await server.register(hallkeeperSheetRoutes, {
      db: fakeDb([{ venueId: VENUE_ID, ownerId: null }]),
      prefix: "/hallkeeper",
    });
    await server.ready();
  });
  afterAll(async () => { await server.close(); });

  beforeEach(() => {
    // Every R2 variable set, so "R2 is unconfigured" cannot be why nothing uploads.
    for (const [key, value] of Object.entries(R2_ENV)) vi.stubEnv(key, value);
    s3.clientConstructed.mockClear();
    s3.commandConstructed.mockClear();
    assemble.mockReset();
    assemble.mockResolvedValue({
      authPivot: { venueId: VENUE_ID, configUserId: null },
      payload: SHEET,
      issue: { snapshotId: SNAPSHOT_ID, version: 1, sourceHash: SOURCE_HASH },
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it.each(["sheet", "sheet?download=true"])("renders %s in the response, private and uncached, with no redirect", async (path) => {
    const response = await server.inject({ method: "GET", url: `/hallkeeper/${CONFIG_ID}/${path}`, headers: HEADERS });

    expect(response.statusCode).toBe(200);
    expect(response.headers["location"]).toBeUndefined();
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect(response.body).not.toContain(R2_ENV.R2_PUBLIC_URL);
    expect(s3.clientConstructed).not.toHaveBeenCalled();
    expect(s3.commandConstructed).not.toHaveBeenCalled();
  });

  it("refuses a request that is not signed in, without rendering or redirecting", async () => {
    const response = await server.inject({ method: "GET", url: `/hallkeeper/${CONFIG_ID}/sheet` });

    expect(response.statusCode).toBe(401);
    expect(response.headers["location"]).toBeUndefined();
    expect(assemble).not.toHaveBeenCalled();
    expect(s3.clientConstructed).not.toHaveBeenCalled();
  });

  it("refuses a signed-in user from another venue before rendering", async () => {
    const outsider = {
      authorization: `Bearer ${JSON.stringify({ id: "00000000-0000-4000-8000-000000000009", email: "other@sheet-privacy.invalid", role: "staff", venueId: "00000000-0000-4000-8000-000000000008" })}`,
    };
    const response = await server.inject({ method: "GET", url: `/hallkeeper/${CONFIG_ID}/sheet`, headers: outsider });

    expect(response.statusCode).toBe(403);
    expect(response.headers["location"]).toBeUndefined();
    expect(assemble).not.toHaveBeenCalled();
  });
});

describe("snapshot reads never serve a public PDF URL", () => {
  it("drops a legacy pdfUrl from the latest snapshot", async () => {
    const snapshot = await getLatestSnapshot(fakeDb([snapshotRow()]), CONFIG_ID);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.pdfUrl).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain(LEGACY_PUBLIC_URL);
  });

  it("drops a legacy pdfUrl from the latest approved snapshot", async () => {
    const snapshot = await getLatestApprovedSnapshot(fakeDb([snapshotRow()]), CONFIG_ID);
    expect(snapshot?.version).toBe(1);
    expect(snapshot?.pdfUrl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Source guard: no upload path can come back unnoticed. The S3 SDK is loaded
// lazily with `await import(...)`, so a module mock alone would not catch a
// new uploader that is never exercised by a test; these checks read the code.
// ---------------------------------------------------------------------------

const API_SRC = resolve(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

/** Strip comments so prose about the retired copy does not trip the checks. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:"'`])\/\/.*$/gmu, "$1");
}

describe("API source cannot publish a sheet PDF", () => {
  const files = sourceFiles(API_SRC);

  it("scans the API source tree", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((path) => path.endsWith(join("routes", "hallkeeper-sheet.ts")))).toBe(true);
  });

  it("has no pre-render uploader", () => {
    expect(existsSync(join(API_SRC, "services", "pdf-prerender.ts"))).toBe(false);
    const callers = files.filter((path) => /pdf-prerender|schedulePrerender|prerenderSnapshotPdf/u.test(code(path)));
    expect(callers.map((path) => relative(API_SRC, path))).toEqual([]);
  });

  it("keeps every module that renders a sheet PDF away from object storage and the public bucket", () => {
    // The modules that import the renderer, and the renderer's own parts.
    const renderers = files.filter((path) => /hallkeeper-pdf-v2(\.js)?["']/u.test(code(path))
      || path.includes(join("services", "sheet-pdf")) || path.endsWith(join("services", "hallkeeper-pdf-v2.ts")));
    expect(renderers.length).toBeGreaterThan(0);
    expect(renderers.some((path) => path.endsWith(join("sheet-pdf", "blocks.ts")))).toBe(true);
    for (const path of renderers) {
      const source = code(path);
      const name = relative(API_SRC, path);
      expect(source, name).not.toMatch(/@aws-sdk\/client-s3|PutObjectCommand|R2_PUBLIC_URL|R2_BUCKET_NAME/u);
      expect(source, name).not.toMatch(/public,\s*max-age|immutable/u);
      expect(source, name).not.toMatch(/\.redirect\(/u);
    }
  });

  it("never names a sheets/ object key", () => {
    const offenders = files.filter((path) => /["'`]sheets\//u.test(code(path)));
    expect(offenders.map((path) => relative(API_SRC, path))).toEqual([]);
  });

  it("only ever sets pdfUrl to null", () => {
    const uses = files.flatMap((path) =>
      [...code(path).matchAll(/pdfUrl\b[^,\n]*/gu)].map((match) => `${relative(API_SRC, path)}: ${match[0].trim()}`));
    const allowed = /: pdfUrl: (null|text\("pdf_url"\))$/u;
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter((use) => !allowed.test(use))).toEqual([]);
  });
});
