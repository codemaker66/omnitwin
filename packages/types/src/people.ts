import { z } from "zod";
import { VenueIdSchema } from "./venue.js";
import { UserIdSchema } from "./user.js";
import { EnquiryIdSchema } from "./enquiry.js";
import { ClientAccountIdSchema, ContactIdSchema } from "./commercial-spine.js";

// ---------------------------------------------------------------------------
// People Book: one venue-scoped record per client person and organisation,
// with several emails and phones, duplicate suggestions and undoable merges.
// ---------------------------------------------------------------------------

export const CONTACT_POINT_KINDS = ["email", "phone"] as const;
export const ContactPointKindSchema = z.enum(CONTACT_POINT_KINDS);
export type ContactPointKind = z.infer<typeof ContactPointKindSchema>;

export const CONTACT_POINT_LABELS = ["work", "personal", "mobile", "other"] as const;
export const ContactPointLabelSchema = z.enum(CONTACT_POINT_LABELS);
export type ContactPointLabel = z.infer<typeof ContactPointLabelSchema>;

export const CLIENT_ACCOUNT_KINDS = ["organisation", "household"] as const;
export const ClientAccountKindSchema = z.enum(CLIENT_ACCOUNT_KINDS);
export type ClientAccountKind = z.infer<typeof ClientAccountKindSchema>;

export const DUPLICATE_REASONS = ["shared_email", "shared_phone", "close_name"] as const;
export const DuplicateReasonSchema = z.enum(DUPLICATE_REASONS);
export type DuplicateReason = z.infer<typeof DuplicateReasonSchema>;

export const MERGE_KINDS = ["person", "organisation"] as const;
export const MergeKindSchema = z.enum(MERGE_KINDS);
export type MergeKind = z.infer<typeof MergeKindSchema>;

/** The rows a merge repoints, in the order the merge moves them. */
export const MERGE_MOVE_TARGETS = [
  "contact_points.contact_id",
  "account_memberships.contact_id",
  "enquiries.contact_id",
  "opportunities.primary_contact_id",
  "client_accounts.primary_contact_id",
  "contacts.merged_into_id",
] as const;
export const MergeMoveTargetSchema = z.enum(MERGE_MOVE_TARGETS);
export type MergeMoveTarget = z.infer<typeof MergeMoveTargetSchema>;

/** The survivor's blank fields a merge may fill from the merged person. */
export const MERGE_FILLED_FIELDS = [
  "givenName",
  "familyName",
  "jobTitle",
  "postalAddress",
  "notes",
  "ownerUserId",
  "lastContactAt",
] as const;
export const MergeFilledFieldSchema = z.enum(MERGE_FILLED_FIELDS);
export type MergeFilledField = z.infer<typeof MergeFilledFieldSchema>;

export const PHONE_DIGITS_MIN = 6;
export const PHONE_DIGITS_MAX = 15;
/** How long a merge can be undone. */
export const MERGE_UNDO_DAYS = 30;
/** Trigram similarity from which two names are suggested as the same person. */
export const CLOSE_NAME_SIMILARITY = 0.6;

// ---------------------------------------------------------------------------
// Normalisers. normalisePhone is the same algorithm the SQL function runs.
// ---------------------------------------------------------------------------

export function normaliseEmail(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const email = raw.trim().toLowerCase();
  return email === "" ? null : email;
}

function toNationalNumber(digitsAfterCountryCode: string): string | null {
  if (digitsAfterCountryCode === "") return null;
  return digitsAfterCountryCode.startsWith("0") ? digitsAfterCountryCode : `0${digitsAfterCountryCode}`;
}

export function normalisePhone(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits === "") return null;
  if (trimmed.startsWith("+")) {
    if (digits.startsWith("44")) return toNationalNumber(digits.slice(2));
    return `+${digits}`;
  }
  if (digits.startsWith("0044")) return toNationalNumber(digits.slice(4));
  return digits;
}

export function isUsablePhone(raw: string): boolean {
  const normalised = normalisePhone(raw);
  if (normalised === null) return false;
  const digitCount = normalised.replace(/\D/g, "").length;
  return digitCount >= PHONE_DIGITS_MIN && digitCount <= PHONE_DIGITS_MAX;
}

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

const IsoDateTimeSchema = z.string().datetime();

function optionalText(max: number) {
  return z.string().trim().max(max).transform((value) => (value === "" ? null : value)).nullable().optional();
}

const NameSchema = z.string().trim().min(1).max(200);
const IdAndNameSchema = z.object({ id: z.string().uuid(), name: z.string() });
const CountSchema = z.number().int().nonnegative();

// ---------------------------------------------------------------------------
// Contact points
// ---------------------------------------------------------------------------

export const ContactPointInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("email"),
    value: z.string().trim().email().max(255),
    label: ContactPointLabelSchema.default("other"),
    isPrimary: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("phone"),
    value: z.string().trim().min(1).max(50).refine(isUsablePhone, "A phone number needs 6 to 15 digits"),
    label: ContactPointLabelSchema.default("other"),
    isPrimary: z.boolean().default(false),
  }),
]);
export type ContactPointInput = z.infer<typeof ContactPointInputSchema>;

export const ContactPointSchema = z.object({
  id: z.string().uuid(),
  contactId: ContactIdSchema,
  kind: ContactPointKindSchema,
  value: z.string(),
  displayValue: z.string(),
  label: ContactPointLabelSchema,
  isPrimary: z.boolean(),
  sourceSystem: z.string().nullable(),
  sourceId: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type ContactPoint = z.infer<typeof ContactPointSchema>;

export const ContactPointRowSchema = ContactPointSchema.extend({
  venueId: VenueIdSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ContactPointRow = z.infer<typeof ContactPointRowSchema>;

// ---------------------------------------------------------------------------
// People and organisations
// ---------------------------------------------------------------------------

export const PersonSchema = z.object({
  id: ContactIdSchema,
  venueId: VenueIdSchema,
  name: NameSchema,
  givenName: z.string().nullable(),
  familyName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  postalAddress: z.string().nullable(),
  notes: z.string().nullable(),
  roleLabel: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  clientAccountId: ClientAccountIdSchema.nullable(),
  ownerUserId: UserIdSchema.nullable(),
  lastContactAt: IsoDateTimeSchema.nullable(),
  sourceSystem: z.string().nullable(),
  sourceId: z.string().nullable(),
  sourceEnquiryId: EnquiryIdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Person = z.infer<typeof PersonSchema>;

export const PersonRowSchema = PersonSchema.extend({
  mergedIntoId: ContactIdSchema.nullable(),
  erasedAt: IsoDateTimeSchema.nullable(),
  deletedAt: IsoDateTimeSchema.nullable(),
});
export type PersonRow = z.infer<typeof PersonRowSchema>;

// Named apart from onboarding's OrganisationSchema/Organisation, which the package root already exports.
export const PeopleOrganisationSchema = z.object({
  id: ClientAccountIdSchema,
  venueId: VenueIdSchema,
  name: NameSchema,
  kind: ClientAccountKindSchema,
  accountType: z.string(),
  address: z.string().nullable(),
  website: z.string().nullable(),
  vatNumber: z.string().nullable(),
  notes: z.string().nullable(),
  ownerUserId: UserIdSchema.nullable(),
  primaryContactId: ContactIdSchema.nullable(),
  sourceSystem: z.string().nullable(),
  sourceId: z.string().nullable(),
  sourceEnquiryId: EnquiryIdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type PeopleOrganisation = z.infer<typeof PeopleOrganisationSchema>;

export const MembershipRowSchema = z.object({
  id: z.string().uuid(),
  venueId: VenueIdSchema,
  contactId: ContactIdSchema,
  clientAccountId: ClientAccountIdSchema,
  roleLabel: z.string().nullable(),
  isPrimary: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type MembershipRow = z.infer<typeof MembershipRowSchema>;

export const PersonMembershipSchema = z.object({
  id: z.string().uuid(),
  organisation: z.object({ id: ClientAccountIdSchema, name: z.string(), kind: ClientAccountKindSchema }),
  roleLabel: z.string().nullable(),
  isPrimary: z.boolean(),
});
export type PersonMembership = z.infer<typeof PersonMembershipSchema>;

export const PersonProfileSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("live"),
    person: PersonSchema,
    contactPoints: z.array(ContactPointSchema),
    memberships: z.array(PersonMembershipSchema),
    owner: IdAndNameSchema.nullable(),
    duplicateSuggestionCount: CountSchema,
  }),
  z.object({
    status: z.literal("merged"),
    mergedInto: IdAndNameSchema,
    mergeId: z.string().uuid(),
    mergedAt: IsoDateTimeSchema,
  }),
]);
export type PersonProfile = z.infer<typeof PersonProfileSchema>;

export const OrganisationProfileSchema = z.object({
  organisation: PeopleOrganisationSchema,
  members: z.array(z.object({
    personId: ContactIdSchema,
    name: z.string(),
    roleLabel: z.string().nullable(),
    isPrimary: z.boolean(),
  })),
  owner: IdAndNameSchema.nullable(),
});
export type OrganisationProfile = z.infer<typeof OrganisationProfileSchema>;

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const personFields = {
  givenName: optionalText(100),
  familyName: optionalText(100),
  jobTitle: optionalText(120),
  roleLabel: optionalText(120),
  postalAddress: optionalText(1000),
  notes: optionalText(5000),
  ownerUserId: UserIdSchema.nullable().optional(),
};

export const CreatePersonSchema = z.object({
  venueId: VenueIdSchema,
  name: NameSchema,
  ...personFields,
  contactPoints: z.array(ContactPointInputSchema).max(10).default([]),
});
export type CreatePerson = z.infer<typeof CreatePersonSchema>;

const NOTHING_TO_CHANGE = "Change at least one field";

function changesSomething(edit: Record<string, unknown>): boolean {
  return Object.entries(edit).some(([key, value]) => key !== "expectedUpdatedAt" && value !== undefined);
}

export const UpdatePersonSchema = z.object({
  name: NameSchema.optional(),
  ...personFields,
  expectedUpdatedAt: IsoDateTimeSchema.optional(),
}).refine(changesSomething, NOTHING_TO_CHANGE);
export type UpdatePerson = z.infer<typeof UpdatePersonSchema>;

const organisationFields = {
  address: optionalText(1000),
  website: optionalText(255),
  vatNumber: optionalText(40),
  notes: optionalText(5000),
  ownerUserId: UserIdSchema.nullable().optional(),
};

export const CreateOrganisationSchema = z.object({
  venueId: VenueIdSchema,
  name: NameSchema,
  kind: ClientAccountKindSchema,
  ...organisationFields,
});
export type CreateOrganisation = z.infer<typeof CreateOrganisationSchema>;

export const UpdateOrganisationSchema = z.object({
  name: NameSchema.optional(),
  kind: ClientAccountKindSchema.optional(),
  ...organisationFields,
  expectedUpdatedAt: IsoDateTimeSchema.optional(),
}).refine(changesSomething, NOTHING_TO_CHANGE);
export type UpdateOrganisation = z.infer<typeof UpdateOrganisationSchema>;

export const SetMembershipsSchema = z.object({
  memberships: z.array(z.object({
    organisationId: ClientAccountIdSchema,
    roleLabel: optionalText(120),
    isPrimary: z.boolean().default(false),
  })).max(20),
}).refine(
  ({ memberships }) => memberships.filter((membership) => membership.isPrimary).length <= 1,
  "Only one organisation can be primary",
).refine(
  ({ memberships }) => new Set(memberships.map((membership) => membership.organisationId)).size === memberships.length,
  "Each organisation can be listed once",
);
export type SetMemberships = z.infer<typeof SetMembershipsSchema>;

// ---------------------------------------------------------------------------
// Search and duplicates
// ---------------------------------------------------------------------------

export const PeopleSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
});
export type PeopleSearchQuery = z.infer<typeof PeopleSearchQuerySchema>;

export const PeopleSearchResultsSchema = z.object({
  people: z.array(z.object({
    id: ContactIdSchema,
    name: z.string(),
    organisationName: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    matched: z.enum(["name", "email", "phone"]),
  })),
  organisations: z.array(z.object({
    id: ClientAccountIdSchema,
    name: z.string(),
    kind: ClientAccountKindSchema,
    memberCount: CountSchema,
  })),
});
export type PeopleSearchResults = z.infer<typeof PeopleSearchResultsSchema>;

export const DuplicateSuggestionSchema = z.object({
  person: z.object({
    id: ContactIdSchema,
    name: z.string(),
    organisationName: z.string().nullable(),
  }),
  reasons: z.array(DuplicateReasonSchema).min(1),
});
export type DuplicateSuggestion = z.infer<typeof DuplicateSuggestionSchema>;

export const KeepApartRequestSchema = z.object({
  otherPersonId: ContactIdSchema,
});
export type KeepApartRequest = z.infer<typeof KeepApartRequestSchema>;

export const KeptApartMarkSchema = z.object({
  id: z.string().uuid(),
  venueId: VenueIdSchema,
  /** The two people, the lower id first, as stored. */
  personIds: z.tuple([ContactIdSchema, ContactIdSchema]),
  decidedBy: UserIdSchema.nullable(),
  decidedAt: IsoDateTimeSchema,
});
export type KeptApartMark = z.infer<typeof KeptApartMarkSchema>;

// ---------------------------------------------------------------------------
// Merges
// ---------------------------------------------------------------------------

export const MergeRequestSchema = z.object({
  survivorId: ContactIdSchema,
});
export type MergeRequest = z.infer<typeof MergeRequestSchema>;

export const MergeMovesSchema = z.object({
  "contact_points.contact_id": CountSchema,
  "account_memberships.contact_id": CountSchema,
  "enquiries.contact_id": CountSchema,
  "opportunities.primary_contact_id": CountSchema,
  "client_accounts.primary_contact_id": CountSchema,
  "contacts.merged_into_id": CountSchema,
} satisfies Record<MergeMoveTarget, z.ZodNumber>);
export type MergeMoves = z.infer<typeof MergeMovesSchema>;

const AlreadyHeldSchema = z.object({ contactPoints: CountSchema, memberships: CountSchema });

export const MergePreviewSchema = z.object({
  survivor: IdAndNameSchema,
  merged: IdAndNameSchema,
  moves: MergeMovesSchema,
  alreadyHeld: AlreadyHeldSchema,
});
export type MergePreview = z.infer<typeof MergePreviewSchema>;

export const MergeResultSchema = z.object({
  mergeId: z.string().uuid(),
  survivorId: ContactIdSchema,
  mergedId: ContactIdSchema,
  moves: MergeMovesSchema,
  alreadyHeld: AlreadyHeldSchema,
  undoUntil: IsoDateTimeSchema,
  replayed: z.boolean(),
});
export type MergeResult = z.infer<typeof MergeResultSchema>;

export const MergeSkipSchema = z.object({
  target: z.union([MergeMoveTargetSchema, z.enum(["survivor_field", "removed_row"])]),
  /** A row id, or a field name for a survivor_field skip. */
  ref: z.string().min(1),
});
export type MergeSkip = z.infer<typeof MergeSkipSchema>;

export const MergeUndoReportSchema = z.object({
  restored: MergeMovesSchema,
  skipped: z.array(MergeSkipSchema),
});
export type MergeUndoReport = z.infer<typeof MergeUndoReportSchema>;

export const MergeUndoResultSchema = MergeUndoReportSchema.extend({
  mergeId: z.string().uuid(),
  replayed: z.boolean(),
});
export type MergeUndoResult = z.infer<typeof MergeUndoResultSchema>;

export const RecordMergeMoveSchema = z.object({
  target: MergeMoveTargetSchema,
  ids: z.array(z.string().uuid()),
});
export type RecordMergeMove = z.infer<typeof RecordMergeMoveSchema>;

export const RecordMergeSnapshotSchema = z.object({
  person: PersonRowSchema,
  contactPoints: z.array(ContactPointRowSchema),
  memberships: z.array(MembershipRowSchema),
  removed: z.object({
    contactPointIds: z.array(z.string().uuid()),
    membershipIds: z.array(z.string().uuid()),
  }),
  survivorFilled: z.array(z.object({
    field: MergeFilledFieldSchema,
    before: z.string().nullable(),
    after: z.string().nullable(),
  })),
});
export type RecordMergeSnapshot = z.infer<typeof RecordMergeSnapshotSchema>;
