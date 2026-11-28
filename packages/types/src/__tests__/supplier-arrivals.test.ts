import { describe, expect, it } from "vitest";
import {
  CreateSupplierArrivalSchema,
  SUPPLIER_ARRIVAL_RETENTION,
  SupplierArrivalSchema,
  UpdateSupplierArrivalSchema,
} from "../supplier-arrivals.js";

// ---------------------------------------------------------------------------
// Supplier arrivals (T-692): a read is lenient and a write is strict. The
// board's read of the day must survive one odd row and a newer server; the
// office's writes are held to the shapes PostgreSQL stores.
// ---------------------------------------------------------------------------

const ROW = {
  id: "00000000-0000-4000-8000-0000000005a1",
  venueId: "00000000-0000-4000-8000-000000000001",
  bookingId: "00000000-0000-4000-8000-0000000000b1",
  supplierName: "The Kelvin Reelers",
  category: "band",
  arrivesAt: "2026-11-14T20:30:00.000Z",
  leavesBy: null,
  entrance: "the Glassford Street door",
  contact: "Siobhan",
  note: "Five players",
  arrivedAt: null,
  arrivedByName: null,
  leftAt: null,
  leftByName: null,
  revision: 1,
  updatedAt: "2026-11-14T09:00:00.000Z",
};

const CREATE = {
  bookingId: "00000000-0000-4000-8000-0000000000b1",
  supplierName: "Thistle & Fern Flowers",
  category: "florist",
  arrivesAt: "2026-11-14T12:00:00.000Z",
  leavesBy: null,
  entrance: null,
  contact: "Morven",
  note: null,
};

describe("the supplier arrival read", () => {
  it("reads a blank or long field a later fix left in the database, rather than losing the day", () => {
    const parsed = SupplierArrivalSchema.safeParse({ ...ROW, note: "", supplierName: "x".repeat(400) });
    expect(parsed.success).toBe(true);
  });

  it("drops a field a newer server adds, rather than refusing the arrival", () => {
    const parsed = SupplierArrivalSchema.parse({ ...ROW, passId: "00000000-0000-4000-8000-0000000000aa" });
    expect(parsed).toEqual(ROW);
  });
});

describe("the office's writes", () => {
  it("refuse a NUL character in any text field with a 400, before PostgreSQL would refuse it", () => {
    for (const field of ["supplierName", "category", "entrance", "contact", "note"] as const) {
      expect(CreateSupplierArrivalSchema.safeParse({ ...CREATE, [field]: "A\u0000B" }).success, field).toBe(false);
      expect(UpdateSupplierArrivalSchema.safeParse({ expectedRevision: 1, [field]: "A\u0000B" }).success, field).toBe(false);
    }
    expect(CreateSupplierArrivalSchema.safeParse(CREATE).success).toBe(true);
  });

  it("still read a blank field as nothing and refuse an unknown one", () => {
    expect(CreateSupplierArrivalSchema.parse({ ...CREATE, note: "   " }).note).toBeNull();
    expect(CreateSupplierArrivalSchema.safeParse({ ...CREATE, passId: "x" }).success).toBe(false);
  });
});

describe("how long a supplier's contact and note are kept", () => {
  it("is a year after the booking ends (Blake, 12 November 2026)", () => {
    expect(SUPPLIER_ARRIVAL_RETENTION).toEqual({ daysAfterBooking: 365 });
  });
});
