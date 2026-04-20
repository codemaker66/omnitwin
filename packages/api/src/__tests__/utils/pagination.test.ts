import { describe, it, expect } from "vitest";
import {
  PaginationQuerySchema,
  paginate,
} from "../../utils/pagination.js";

// ---------------------------------------------------------------------------
// Pagination — query coercion + response envelope
//
// Every list route consumes `PaginationQuerySchema.parse(request.query)`
// and wraps results with `paginate()`. Tests pin:
//   - defaults (limit=20, offset=0)
//   - upper bound on limit (anti-DoS cap at 100)
//   - numeric coercion (Fastify delivers query params as strings)
//   - envelope shape
// ---------------------------------------------------------------------------

describe("PaginationQuerySchema", () => {
  it("applies default limit=20 + offset=0 when both fields are missing", () => {
    const parsed = PaginationQuerySchema.parse({});
    expect(parsed).toEqual({ limit: 20, offset: 0 });
  });

  it("accepts explicit limit + offset", () => {
    const parsed = PaginationQuerySchema.parse({ limit: 50, offset: 100 });
    expect(parsed).toEqual({ limit: 50, offset: 100 });
  });

  it("coerces numeric strings to numbers (Fastify query-param behavior)", () => {
    const parsed = PaginationQuerySchema.parse({ limit: "25", offset: "50" });
    expect(parsed).toEqual({ limit: 25, offset: 50 });
  });

  it("rejects limit=0 (page would be empty)", () => {
    expect(PaginationQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it("rejects negative limit", () => {
    expect(PaginationQuerySchema.safeParse({ limit: -1 }).success).toBe(false);
  });

  it("rejects non-integer limit", () => {
    expect(PaginationQuerySchema.safeParse({ limit: 10.5 }).success).toBe(false);
  });

  it("caps limit at 100 (anti-DoS)", () => {
    expect(PaginationQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    // Exactly 100 is valid (boundary)
    expect(PaginationQuerySchema.safeParse({ limit: 100 }).success).toBe(true);
  });

  it("rejects negative offset", () => {
    expect(PaginationQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
  });

  it("allows offset=0 (first page)", () => {
    const parsed = PaginationQuerySchema.parse({ offset: 0 });
    expect(parsed.offset).toBe(0);
  });
});

describe("paginate", () => {
  const sample = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("wraps data + total + paging metadata", () => {
    const env = paginate(sample, 57, { limit: 20, offset: 40 });
    expect(env).toEqual({
      data: sample,
      meta: { total: 57, limit: 20, offset: 40 },
    });
  });

  it("preserves the array reference (no defensive copy — caller responsibility)", () => {
    const env = paginate(sample, 3, { limit: 10, offset: 0 });
    expect(env.data).toBe(sample);
  });

  it("works with empty data + zero total", () => {
    const env = paginate([], 0, { limit: 20, offset: 0 });
    expect(env.data).toEqual([]);
    expect(env.meta.total).toBe(0);
  });

  it("preserves total even when data is empty (past-the-end page)", () => {
    // A request with offset=100 on a 57-row table returns 0 rows but
    // `total: 57` so clients know to paginate backward.
    const env = paginate([], 57, { limit: 20, offset: 100 });
    expect(env.meta).toEqual({ total: 57, limit: 20, offset: 100 });
  });
});
