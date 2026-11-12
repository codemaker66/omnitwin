import { z } from "zod";

// ---------------------------------------------------------------------------
// Supplier arrivals (T-692): who is coming to the building for a booking,
// when, and at which door. The venue's office enters them against a booking;
// the floor marks each supplier arrived and gone, so the Day Board says who
// is due, who is late and who is still in the building at lock-up.
//
// A supplier pass (supplier-coordination.ts) is what a supplier is sent and
// acknowledges; an arrival is what the floor receives at the door. A contact
// is the office's working note for the day, never shown on the wall.
// ---------------------------------------------------------------------------

const IsoInstantSchema = z.iso.datetime({ offset: true });

export const SUPPLIER_ARRIVAL_LIMITS = {
  supplierName: 160,
  category: 40,
  entrance: 100,
  contact: 160,
  note: 500,
} as const;

/** How long a supplier may be due before their booking starts: a delivery the day before. */
export const SUPPLIER_ARRIVAL_LEAD_MS = 48 * 3_600_000;
/** How long a supplier may stay: a band from the afternoon to the small hours. */
export const SUPPLIER_ARRIVAL_STAY_MS = 36 * 3_600_000;

/**
 * How long the office's working words about a supplier are kept (Blake,
 * 12 November 2026): the nightly clean-up clears an arrival's contact and note
 * this many days after its booking ends. The supplier's name, their times and
 * the door marks stay as the venue's record, and so do the names of the staff
 * who marked them in and out: they are the record of who was in the building,
 * kept after a member of staff's account is closed. The API's pass and the
 * privacy policy both read this one definition.
 */
export const SUPPLIER_ARRIVAL_RETENTION = { daysAfterBooking: 365 } as const;

/**
 * An arrival as the API returns it. A read is lenient, as a read must be: plain
 * strings, with no lengths or blanks to refuse, and a field a later release
 * adds is dropped rather than refused, so one odd row, or a newer server,
 * never costs the board the day's suppliers. The strict rules are the writes'.
 */
export const SupplierArrivalSchema = z.object({
  id: z.uuid(),
  venueId: z.uuid(),
  bookingId: z.uuid(),
  supplierName: z.string(),
  /** What they do, in the office's words: "florist", "band". */
  category: z.string().nullable(),
  arrivesAt: IsoInstantSchema,
  leavesBy: IsoInstantSchema.nullable(),
  /** The door they come in by: "the Saloon's side door". */
  entrance: z.string().nullable(),
  /** Who to ring on the day, as the office wrote it. */
  contact: z.string().nullable(),
  note: z.string().nullable(),
  arrivedAt: IsoInstantSchema.nullable(),
  arrivedByName: z.string().nullable(),
  leftAt: IsoInstantSchema.nullable(),
  leftByName: z.string().nullable(),
  revision: z.number().int(),
  updatedAt: IsoInstantSchema,
});
export type SupplierArrival = z.infer<typeof SupplierArrivalSchema>;

/** Text PostgreSQL can store: no NUL character, which it refuses. */
function storable(schema: z.ZodString): z.ZodString {
  return schema.refine((value) => !value.includes("\u0000"), "Must not contain a NUL character");
}

/** A field the office may leave empty: blank reads as nothing. */
function optionalText(max: number) {
  return storable(z.string().trim().max(max)).nullable().transform((value) => (value === null || value.length === 0 ? null : value));
}

const ArrivalFieldsSchema = z.object({
  supplierName: storable(z.string().trim().min(1, "Name the supplier").max(SUPPLIER_ARRIVAL_LIMITS.supplierName)),
  category: optionalText(SUPPLIER_ARRIVAL_LIMITS.category),
  arrivesAt: IsoInstantSchema,
  leavesBy: IsoInstantSchema.nullable(),
  entrance: optionalText(SUPPLIER_ARRIVAL_LIMITS.entrance),
  contact: optionalText(SUPPLIER_ARRIVAL_LIMITS.contact),
  note: optionalText(SUPPLIER_ARRIVAL_LIMITS.note),
});

function leavesAfterArriving(value: { readonly arrivesAt?: string; readonly leavesBy?: string | null }): boolean {
  if (value.arrivesAt === undefined || value.leavesBy === undefined || value.leavesBy === null) return true;
  const arrives = Date.parse(value.arrivesAt);
  const leaves = Date.parse(value.leavesBy);
  return leaves > arrives && leaves - arrives <= SUPPLIER_ARRIVAL_STAY_MS;
}

const LEAVES_MESSAGE = { message: "They leave after they arrive, within a day and a half.", path: ["leavesBy"] };

export const CreateSupplierArrivalSchema = ArrivalFieldsSchema.extend({ bookingId: z.uuid() })
  .strict()
  .refine(leavesAfterArriving, LEAVES_MESSAGE);
export type CreateSupplierArrival = z.input<typeof CreateSupplierArrivalSchema>;
/** A create body as the API holds it: blanks already read as nothing. */
export type CreateSupplierArrivalData = z.output<typeof CreateSupplierArrivalSchema>;

export const UpdateSupplierArrivalSchema = ArrivalFieldsSchema.partial()
  .extend({ expectedRevision: z.number().int().min(1) })
  .strict()
  .refine(leavesAfterArriving, LEAVES_MESSAGE);
export type UpdateSupplierArrival = z.input<typeof UpdateSupplierArrivalSchema>;
/** A change as the API holds it: blanks already read as nothing. */
export type UpdateSupplierArrivalData = z.output<typeof UpdateSupplierArrivalSchema>;

export const RemoveSupplierArrivalQuerySchema = z.object({
  expectedRevision: z.coerce.number().int().min(1),
}).strict();

/** The board's read: arrivals due between two instants, at most three days apart. */
export const SupplierArrivalListQuerySchema = z.object({
  from: IsoInstantSchema,
  to: IsoInstantSchema,
}).strict().refine((query) => {
  const span = Date.parse(query.to) - Date.parse(query.from);
  return span > 0 && span <= 3 * 24 * 3_600_000;
}, { message: "Read up to three days at a time.", path: ["to"] });
export type SupplierArrivalListQuery = z.infer<typeof SupplierArrivalListQuerySchema>;

/** What the floor records at the door. */
export const SUPPLIER_ARRIVAL_STEPS = ["arrived", "left"] as const;
export const SupplierArrivalStepSchema = z.enum(SUPPLIER_ARRIVAL_STEPS);
export type SupplierArrivalStep = z.infer<typeof SupplierArrivalStepSchema>;
