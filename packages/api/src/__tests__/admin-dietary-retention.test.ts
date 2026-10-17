import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// The dietary-note retention pass through the house cleanup endpoints
// (fix-first item 18): who may run it, that the rehearsal changes nothing,
// and that the real pass is wired with a way to remove stored sheet PDFs.
// The pass itself is proven in dietary-retention-postgres.test.ts.
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
process.env["CLERK_SECRET_KEY"] = "sk_test_not_a_real_clerk_secret_key";

const RESULT = { dryRun: false, layouts: 2, sheets: 3, sheetPdfsRemoved: 1, sheetsPending: 0 };

const removeLapsedDietaryNotes = vi.fn();
vi.mock("../services/dietary-retention.js", () => ({
  removeLapsedDietaryNotes: (...args: unknown[]) => removeLapsedDietaryNotes(...args) as unknown,
}));
vi.mock("../services/cleanup.js", () => ({
  cleanupPreviewConfigurations: () => Promise.resolve(0),
  cleanupOrphanedFiles: () => Promise.resolve(0),
}));

const { buildServer } = await import("../index.js");

let server: FastifyInstance;
beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });
beforeEach(() => { removeLapsedDietaryNotes.mockReset(); });

const token = (payload: Record<string, unknown>): string => JSON.stringify(payload);
const platformAdmin = token({ id: "u1", email: "admin@test.com", role: "admin", platformRole: "admin", venueId: "v1" });
const venueAdmin = token({ id: "u2", email: "venue@test.com", role: "admin", platformRole: "none", venueId: "v1" });

describe("POST /admin/retention/dietary-notes (the rehearsal)", () => {
  it("is for platform administrators only", async () => {
    expect((await server.inject({ method: "POST", url: "/admin/retention/dietary-notes" })).statusCode).toBe(401);
    const res = await server.inject({
      method: "POST", url: "/admin/retention/dietary-notes", headers: { authorization: `Bearer ${venueAdmin}` },
    });
    expect(res.statusCode).toBe(403);
    expect(removeLapsedDietaryNotes).not.toHaveBeenCalled();
  });

  it("runs the pass as a dry run and reports it", async () => {
    removeLapsedDietaryNotes.mockResolvedValueOnce({ ...RESULT, dryRun: true, sheetPdfsRemoved: 0 });
    const res = await server.inject({
      method: "POST", url: "/admin/retention/dietary-notes", headers: { authorization: `Bearer ${platformAdmin}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: { dryRun: boolean } }>().data.dryRun).toBe(true);
    expect(removeLapsedDietaryNotes.mock.calls[0]?.[1]).toEqual({ dryRun: true });
  });
});

describe("POST /admin/cleanup", () => {
  it("removes lapsed notes, with a way to remove stored sheet PDFs, and says what it did", async () => {
    removeLapsedDietaryNotes.mockResolvedValueOnce(RESULT);
    const res = await server.inject({
      method: "POST", url: "/admin/cleanup", headers: { authorization: `Bearer ${platformAdmin}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { dietaryNotes: unknown; message: string } }>().data;
    expect(body.dietaryNotes).toEqual(RESULT);
    expect(body.message).toContain("removed the allergy note from 2 layout(s) and 3 event sheet(s)");
    const options = removeLapsedDietaryNotes.mock.calls[0]?.[1] as { dryRun?: boolean; removeSheetPdf?: unknown };
    expect(options.dryRun).toBeUndefined();
    expect(options.removeSheetPdf).toBeTypeOf("function");
  });
});
