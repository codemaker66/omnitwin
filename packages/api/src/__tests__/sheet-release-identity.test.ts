import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  HallkeeperSheetV2Schema,
  paperFingerprint,
  parseSheetPaperLink,
  sheetSetupSteps,
  sheetStoreList,
  type HallkeeperSheetV2,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import type { SheetDataV2Internal } from "../services/hallkeeper-sheet-v2-data.js";
import { decideSheetPaperCheck, type SheetPaperFacts } from "../services/sheet-paper-check.js";
import { weddingSheet } from "./fixtures/hallkeeper-sheet-fixtures.js";
import {
  bodyText,
  encodes,
  footers,
  printedLink,
  printedQr,
  queryOf,
  releaseLine,
  roomDisagreements,
  seatedChairs,
} from "./helpers/sheet-paper-reading.js";

// ---------------------------------------------------------------------------
// Goal 05: the sheet names its release on screen and on paper, the phone
// view and the print agree, and a newer approval retires the old print.
//
// The phone reads GET /hallkeeper/:configId/v2; the paper is GET
// /hallkeeper/:configId/sheet. Both run the real routes, the real paper
// check and the real PDF renderer over one assembled sheet (the demo
// wedding fixture, approved as v3), so what is compared is what each reader
// is actually handed. The PDF is read back from its own bytes: its words and
// its QR code's modules (helpers/sheet-paper-reading.ts).
//
// The served sheet is also kept in fixtures/served-wedding-sheet.json, which
// the web's HallkeeperPage release test renders, so the phone view is tested
// on the same bytes the print is made from. Refresh it after a fixture change
// with `pnpm --filter @omnitwin/api exec vitest run sheet-release-identity -u`.
// The database round trip is in sheet-release-identity-postgres.test.ts.
// ---------------------------------------------------------------------------

// Built first, before any other fixture, so its generated ids are stable.
const WEDDING = weddingSheet();

const BASE = "https://venviewer.com";
const VENUE_ID = "00000000-0000-4000-8000-00000000a001";
const USER_ID = "00000000-0000-4000-8000-00000000a002";
const V3 = { snapshotId: "3c0a1e52-6b7d-4f80-9a1b-2c3d4e5f6a73", version: 3, sourceHash: `3e1f0a2b4c5d6e7f${"3".repeat(48)}` } as const;
const V4 = { snapshotId: "4d1b2f63-7c8e-4a91-8b2c-3d4e5f6a7b84", version: 4, sourceHash: `4f2a1b3c5d6e7f80${"4".repeat(48)}` } as const;
const V3_APPROVED_AT = "2026-10-22T15:12:00.000Z";
// v4 is approved that morning, after the v3 copies were printed at 07:42.
const V4_APPROVAL = { version: 4, approvedAt: "2026-10-24T08:15:00.000Z", approverName: "Callum Reid" } as const;
const V4_SERVED_AT = "2026-10-24T08:20:00.000Z";

const assemble = vi.hoisted(() => vi.fn<() => Promise<SheetDataV2Internal | null>>());
vi.mock("../services/hallkeeper-sheet-v2-data.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/hallkeeper-sheet-v2-data.js")>();
  return { ...actual, assembleSheetDataV2: assemble };
});
const { hallkeeperSheetRoutes } = await import("../routes/hallkeeper-sheet.js");

interface FakeLimitedQuery { limit: (count: number) => Promise<readonly unknown[]> }
interface FakeWhereQuery extends FakeLimitedQuery { orderBy: (...columns: readonly unknown[]) => FakeLimitedQuery }
interface FakeFromQuery { where: (...conditions: readonly unknown[]) => FakeWhereQuery }
interface FakeSelectQuery { from: (table: unknown) => FakeFromQuery }

/** The routes' access check reads the layout's venue and owner; nothing else reads it here. */
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

const HEADERS = {
  authorization: `Bearer ${JSON.stringify({ id: USER_ID, email: "hallkeeper@sheet-release.invalid", role: "hallkeeper", venueId: VENUE_ID })}`,
};

/** What the server hands the phone, and the PDF it prints, for one approved version. */
interface Served {
  readonly sheet: HallkeeperSheetV2;
  readonly body: unknown;
  readonly pdf: Buffer;
}

let server: FastifyInstance;

async function serve(payload: HallkeeperSheetV2, issue: { snapshotId: string; version: number; sourceHash: string }): Promise<Served> {
  assemble.mockResolvedValue({ authPivot: { venueId: VENUE_ID, configUserId: null }, payload, issue });
  const json = await server.inject({ method: "GET", url: `/hallkeeper/${payload.config.id}/v2`, headers: HEADERS });
  expect(json.statusCode).toBe(200);
  const body: unknown = json.json();
  const sheet = HallkeeperSheetV2Schema.parse((body as { data: unknown }).data);
  const paper = await server.inject({ method: "GET", url: `/hallkeeper/${payload.config.id}/sheet`, headers: HEADERS });
  expect(paper.statusCode).toBe(200);
  expect(paper.headers["content-type"]).toBe("application/pdf");
  return { sheet, body, pdf: paper.rawPayload };
}

const serveV3 = (): Promise<Served> => serve(WEDDING, V3);
const serveV4 = (): Promise<Served> => serve({ ...WEDDING, approval: V4_APPROVAL, generatedAt: V4_SERVED_AT }, V4);

beforeAll(async () => {
  vi.stubEnv("FRONTEND_URL", BASE);
  server = Fastify();
  await server.register(hallkeeperSheetRoutes, { db: fakeDb([{ venueId: VENUE_ID, ownerId: null }]), prefix: "/hallkeeper" });
  await server.ready();
});
afterAll(async () => { await server.close(); vi.unstubAllEnvs(); });

describe("the phone and the paper name one release", () => {
  it("serves the phone and prints the paper from the same approved version, in the same words", async () => {
    const { sheet, pdf } = await serveV3();
    expect(sheet.approval).toEqual({ version: 3, approvedAt: V3_APPROVED_AT, approverName: "Fiona Grant" });
    const line = releaseLine(sheet);
    expect(line).toBe("v3, issued 22 Oct 16:12, printed 24 Oct 07:42");
    // Page 1 says who approved it and which copy it is; every page's foot repeats the copy.
    expect(bodyText(pdf)).toContain(`Approved by Fiona Grant · ${line}`);
    const feet = footers(pdf);
    expect(feet.length).toBeGreaterThan(1);
    for (const [index, foot] of feet.entries()) expect(foot, `page ${String(index + 1)}`).toContain(line);
  });

  it("prints a code that opens the same release the phone was served", async () => {
    const { sheet, pdf } = await serveV3();
    const served = sheet.paperCheck;
    if (served === undefined) throw new Error("The served sheet carries no paper check");
    // The phone holds the release by its snapshot, version and fingerprint.
    expect(queryOf(served.url)).toEqual({ s: V3.snapshotId, v: 3, h: paperFingerprint(V3.sourceHash) });
    // The paper's code is exactly that link with this copy's printed minute.
    const link = printedLink(sheet);
    expect(link).toBe(`${served.url}&p=2026-10-24T07:42`);
    expect(await encodes(printedQr(pdf), link)).toBe(true);
    expect(queryOf(link)).toEqual(queryOf(served.url));
    expect(parseSheetPaperLink(new URL(link).searchParams)?.claim).toEqual({ kind: "issued", version: 3, printed: "2026-10-24T07:42" });
    // A browser print draws the code the phone was served: the same link.
    expect(await encodes(served.qr.rows, served.url)).toBe(true);
  });

  it("names a newly approved version on both, with a new code", async () => {
    const before = await serveV3();
    const after = await serveV4();
    expect(after.sheet.approval?.version).toBe(4);
    expect(releaseLine(after.sheet)).toBe("v4, issued 24 Oct 09:15, printed 24 Oct 09:20");
    expect(bodyText(after.pdf)).toContain(`Approved by Callum Reid · ${releaseLine(after.sheet)}`);
    expect(bodyText(after.pdf)).not.toContain("v3, issued");
    expect(queryOf(printedLink(after.sheet))).toEqual({ s: V4.snapshotId, v: 4, h: paperFingerprint(V4.sourceHash) });
    expect(await encodes(printedQr(after.pdf), printedLink(after.sheet))).toBe(true);
    expect(await encodes(printedQr(after.pdf), printedLink(before.sheet))).toBe(false);
  });
});

describe("the phone and the paper list the same room", () => {
  it("prints exactly the store counts and setup lines the phone's rows add up to", async () => {
    const { sheet, pdf } = await serveV3();
    // The demo wedding is not a trivial room: five phases, six store groups.
    expect(sheetSetupSteps(sheet).map((step) => step.phase)).toEqual(["structure", "furniture", "dress", "technical", "final"]);
    expect(sheetStoreList(sheet).map((group) => group.title)).toHaveLength(6);
    expect(seatedChairs(sheet)).toBe(120);
    expect(roomDisagreements(sheet, pdf)).toEqual([]);
    // The phone's "pieces to set" is the rows' own total.
    expect(sheet.totals.totalItems).toBe(sheet.phases.flatMap((phase) => phase.zones.flatMap((zone) => zone.rows)).reduce((sum, row) => sum + row.qty, 0));
  });

  it("is the served sheet the web's release test renders", async () => {
    const v3 = await serveV3();
    const v4 = await serveV4();
    // v4 is v3 approved again: only its approval, check link and serve time differ.
    expect({ ...v4.sheet, approval: v3.sheet.approval, paperCheck: v3.sheet.paperCheck, generatedAt: v3.sheet.generatedAt }).toEqual(v3.sheet);
    const fixture = {
      about: "GET /hallkeeper/:configId/v2 for the demo wedding fixture approved as v3, and what v4 changes. Kept by packages/api/src/__tests__/sheet-release-identity.test.ts; rendered by packages/web/src/pages/__tests__/HallkeeperPage.release.test.tsx.",
      v3: v3.body,
      v4: { approval: v4.sheet.approval, paperCheck: v4.sheet.paperCheck, generatedAt: v4.sheet.generatedAt },
    };
    await expect(`${JSON.stringify(fixture, null, 1)}\n`).toMatchFileSnapshot("./fixtures/served-wedding-sheet.json");
  });
});

describe("a newer approval retires the old print", () => {
  /** The record a scan of `link` reads once `inForce` is the layout's newest approved version. */
  function factsFor(link: string, inForce: typeof V3 | typeof V4): SheetPaperFacts {
    const query = queryOf(link);
    if (!("s" in query)) throw new Error("An approved copy's link names its snapshot");
    const named = [V3, V4].find((candidate) => candidate.snapshotId === query.s);
    const approvedAt = (version: number): Date => new Date(version === 3 ? V3_APPROVED_AT : V4_APPROVAL.approvedAt);
    return {
      claim: { kind: "issued", snapshotId: query.s, version: query.v, fingerprint: query.h },
      named: named === undefined ? null : { version: named.version, sourceHash: named.sourceHash, approvedAt: approvedAt(named.version) },
      config: { reviewStatus: "approved", approvedAt: approvedAt(inForce.version) },
      latestApproved: { id: inForce.snapshotId, version: inForce.version, approvedAt: approvedAt(inForce.version) },
    };
  }

  it("answers the v3 paper's code 'superseded: v4' once v4 is in force, and the v4 paper's 'current'", async () => {
    const v3Link = printedLink((await serveV3()).sheet);
    const v4Link = printedLink((await serveV4()).sheet);
    expect(decideSheetPaperCheck(factsFor(v3Link, V3))).toEqual({ state: "current", version: 3 });
    expect(decideSheetPaperCheck(factsFor(v3Link, V4))).toEqual({ state: "superseded", currentVersion: 4 });
    expect(decideSheetPaperCheck(factsFor(v4Link, V4))).toEqual({ state: "current", version: 4 });
  });
});
