import type { FastifyInstance, FastifyReply } from "fastify";
import { and, eq, TransactionRollbackError } from "drizzle-orm";
import { z } from "zod";
import {
  ContactPointInputSchema,
  CreateOrganisationSchema,
  CreatePersonSchema,
  KeepApartRequestSchema,
  MergeRequestSchema,
  PeopleSearchQuerySchema,
  SetMembershipsSchema,
  UpdateOrganisationSchema,
  UpdatePersonSchema,
  type PersonProfile,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { contacts } from "../db/schema.js";
import { authenticate, isPlatformAdmin, type JwtUser } from "../middleware/auth.js";
import { canManageCommercial } from "../utils/query.js";
import {
  adoptLegacyMirror,
  insertPerson,
  isCommercialMember,
  liveContact,
  lockPerson,
  readPersonProfile,
  removeContactPoint,
  setPersonMemberships,
  updatePersonFields,
  upsertContactPoint,
  type PeopleTx,
} from "../services/people-records.js";
import { duplicateSuggestions, keepApart, withdrawKeptApart } from "../services/people-duplicates.js";
import {
  insertOrganisation,
  lockOrganisation,
  readOrganisationProfile,
  updateOrganisationFields,
} from "../services/people-organisations.js";
import { searchPeople } from "../services/people-search.js";
import { applyPersonMerge, isMergeFailure, previewPersonMerge, type MergeFailure } from "../services/people-merge.js";

// ---------------------------------------------------------------------------
// The People Book's only door (T-665): /people.
//
// Every route asks the same question first — is this the venue's commercial
// team? — before it reads the request or the database; then it validates;
// then it finds the record at the actor's venue. Another venue's record is
// not found, never forbidden. Every write is one transaction that locks the
// person first, and every log line carries ids and outcomes, never a name,
// an email or a phone. A person merged into another is read as where they
// went, and every write to them is refused with the record that speaks for
// them now (409 MERGED).
// ---------------------------------------------------------------------------

const PersonParams = z.object({ personId: z.string().uuid() });
const OrganisationParams = z.object({ organisationId: z.string().uuid() });
const PointParams = PersonParams.extend({ pointId: z.string().uuid() });
const PairParams = PersonParams.extend({ otherPersonId: z.string().uuid() });

const FORBIDDEN = { error: "Only the venue's commercial team can use the People Book", code: "FORBIDDEN" } as const;
const INVALID_ID = { error: "Invalid ID", code: "VALIDATION_ERROR" } as const;
const PERSON_NOT_FOUND = { error: "Person not found", code: "NOT_FOUND" } as const;
const ORGANISATION_NOT_FOUND = { error: "Organisation not found", code: "NOT_FOUND" } as const;
const OWNER_NOT_AT_VENUE = {
  error: "The owner must be on this venue's commercial team",
  code: "OWNER_NOT_AT_VENUE",
} as const;

/** A write to a person who has been merged into another record. */
function mergedPerson(mergedIntoId: string): { error: string; code: "MERGED"; mergedIntoId: string } {
  return { error: "This person has been merged into another record", code: "MERGED", mergedIntoId };
}

/** Why a merge, or its preview, was refused. */
function refuseMerge(reply: FastifyReply, failure: MergeFailure): FastifyReply {
  switch (failure.kind) {
    case "not_found": return reply.status(404).send(PERSON_NOT_FOUND);
    case "same_record":
      return reply.status(422).send({ error: "A person cannot be merged into themself", code: "SAME_RECORD" });
    case "already_merged":
      return reply.status(409).send({
        error: "This person has already been merged into another record",
        code: "ALREADY_MERGED",
        survivorId: failure.survivorId,
      });
    case "survivor_merged":
      return reply.status(409).send({
        error: "The record to keep has itself been merged into another record",
        code: "SURVIVOR_MERGED",
        mergedIntoId: failure.mergedIntoId,
      });
  }
}

/**
 * The venue this actor works the People Book at: null means every venue (a
 * platform admin). The shape of crm.ts's commercialScope.
 */
function peopleScope(user: JwtUser): { ok: true; venueId: string | null } | { ok: false } {
  if (isPlatformAdmin(user)) return { ok: true, venueId: null };
  if (user.venueId !== null && canManageCommercial(user, user.venueId)) {
    return { ok: true, venueId: user.venueId };
  }
  return { ok: false };
}

function invalidBody(reply: FastifyReply, error: z.ZodError): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: error.issues });
}

/** The owner a write sets: left out, the actor when they are on the venue's
 *  commercial team, else nobody; named, someone who is on it, or a refusal. */
async function resolveOwner(
  tx: PeopleTx,
  venueId: string,
  requested: string | null | undefined,
  actorId: string,
): Promise<{ ok: true; ownerUserId: string | null } | { ok: false }> {
  if (requested === undefined) {
    return { ok: true, ownerUserId: (await isCommercialMember(tx, venueId, actorId)) ? actorId : null };
  }
  if (requested === null) return { ok: true, ownerUserId: null };
  return (await isCommercialMember(tx, venueId, requested)) ? { ok: true, ownerUserId: requested } : { ok: false };
}

/** The profile of a person this transaction has locked and found live. */
async function lockedProfile(tx: PeopleTx, person: { id: string; venueId: string }): Promise<PersonProfile> {
  const profile = await readPersonProfile(tx, person.venueId, person.id);
  if (profile === null) throw new Error("A locked live person could not be read back");
  return profile;
}

/**
 * One write transaction whose refusals keep nothing: `work` either returns an
 * answer, which commits, or calls `refuse(answer)`, which rolls back every row
 * the transaction wrote (adopted legacy rows included) and returns that answer.
 */
async function writeOrRefuse<T>(
  db: Database,
  work: (tx: PeopleTx, refuse: (answer: T) => never) => Promise<T>,
): Promise<T> {
  const refusal: { answer: T | undefined } = { answer: undefined };
  try {
    return await db.transaction((tx) => work(tx, (answer: T): never => {
      refusal.answer = answer;
      return tx.rollback();
    }));
  } catch (error) {
    if (error instanceof TransactionRollbackError && refusal.answer !== undefined) return refusal.answer;
    throw error;
  }
}

/** Two ids, the lower first: the order every transaction locks people in. */
function ascending(a: string, b: string): readonly [string, string] {
  return a < b ? [a, b] : [b, a];
}

type PairLock =
  | { kind: "not_found" }
  | { kind: "merged"; mergedIntoId: string }
  | { kind: "live"; venueId: string; ids: readonly [string, string] };

/** Locks two people, the lower id first, and needs both live at one venue. */
async function lockPair(tx: PeopleTx, scopeVenueId: string | null, personId: string, otherPersonId: string): Promise<PairLock> {
  const [first, second] = ascending(personId, otherPersonId);
  const a = await lockPerson(tx, scopeVenueId, first);
  if (a.state === "merged") return { kind: "merged", mergedIntoId: a.mergedIntoId };
  if (a.state !== "live") return { kind: "not_found" };
  const b = await lockPerson(tx, scopeVenueId, second);
  if (b.state === "merged") return { kind: "merged", mergedIntoId: b.mergedIntoId };
  // An unscoped (platform admin) lock finds people anywhere: the two must
  // still be at one venue.
  if (b.state !== "live" || b.row.venueId !== a.row.venueId) return { kind: "not_found" };
  return { kind: "live", venueId: a.row.venueId, ids: [a.row.id, b.row.id] };
}

export async function peopleRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = peopleScope(request.user);
    if (!scope.ok) return reply.status(403).send(FORBIDDEN);
    const body = CreatePersonSchema.safeParse(request.body);
    if (!body.success) return invalidBody(reply, body.error);
    const input = body.data;
    if (!canManageCommercial(request.user, input.venueId)) return reply.status(403).send(FORBIDDEN);
    const actorId = request.user.id;

    const outcome = await db.transaction(async (tx) => {
      const owner = await resolveOwner(tx, input.venueId, input.ownerUserId, actorId);
      if (!owner.ok) return { kind: "owner_not_at_venue" } as const;
      const personId = await insertPerson(tx, {
        venueId: input.venueId,
        name: input.name,
        givenName: input.givenName,
        familyName: input.familyName,
        jobTitle: input.jobTitle,
        roleLabel: input.roleLabel,
        postalAddress: input.postalAddress,
        notes: input.notes,
        ownerUserId: owner.ownerUserId,
        contactPoints: input.contactPoints,
      });
      return { kind: "created", personId, profile: await lockedProfile(tx, { id: personId, venueId: input.venueId }) } as const;
    });

    if (outcome.kind === "owner_not_at_venue") return reply.status(422).send(OWNER_NOT_AT_VENUE);
    request.log.info({ event: "people.created", personId: outcome.personId }, "person created");
    return reply.status(201).send({ data: outcome.profile });
  });

  // `/search` is a static path, so it wins over `/:personId` in the router.
  server.get("/search", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = peopleScope(request.user);
    if (!scope.ok) return reply.status(403).send(FORBIDDEN);
    const query = PeopleSearchQuerySchema.safeParse(request.query);
    if (!query.success) return invalidBody(reply, query.error);
    return { data: await searchPeople(db, query.data.q, scope.venueId) };
  });

  server.get("/:personId", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = peopleScope(request.user);
    if (!scope.ok) return reply.status(403).send(FORBIDDEN);
    const params = PersonParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(INVALID_ID);

    // One snapshot, so the person, their points, organisations, owner and
    // suggestions are read as they stood at one moment.
    const profile = await db.transaction(
      (tx) => readPersonProfile(tx, scope.venueId, params.data.personId),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    if (profile === null) return reply.status(404).send(PERSON_NOT_FOUND);
    return { data: profile };
  });

  server.patch("/:personId", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = peopleScope(request.user);
    if (!scope.ok) return reply.status(403).send(FORBIDDEN);
    const params = PersonParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(INVALID_ID);
    const body = UpdatePersonSchema.safeParse(request.body);
    if (!body.success) return invalidBody(reply, body.error);
    const patch = body.data;

    const outcome = await db.transaction(async (tx) => {
      const lock = await lockPerson(tx, scope.venueId, params.data.personId);
      if (lock.state === "merged") return { kind: "merged", mergedIntoId: lock.mergedIntoId } as const;
      if (lock.state !== "live") return { kind: "not_found" } as const;
      const owner = patch.ownerUserId;
      if (typeof owner === "string" && !(await isCommercialMember(tx, lock.row.venueId, owner))) {
        return { kind: "owner_not_at_venue" } as const;
      }
      if (await updatePersonFields(tx, lock.row, patch) === "stale") return { kind: "stale" } as const;
      return { kind: "updated", personId: lock.row.id, profile: await lockedProfile(tx, lock.row) } as const;
    });

    switch (outcome.kind) {
      case "not_found": return reply.status(404).send(PERSON_NOT_FOUND);
      case "merged": return reply.status(409).send(mergedPerson(outcome.mergedIntoId));
      case "owner_not_at_venue": return reply.status(422).send(OWNER_NOT_AT_VENUE);
      case "stale":
        return reply.status(409).send({
          error: "Someone has changed this person since you opened them; reload to see their changes",
          code: "STALE_RECORD",
        });
      case "updated":
        request.log.info({ event: "people.updated", personId: outcome.personId }, "person updated");
        return { data: outcome.profile };
    }
  });

  // `/organisations` is a static path, so it wins over `/:personId` in the router.
  server.post("/organisations", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = peopleScope(request.user);
    if (!scope.ok) return reply.status(403).send(FORBIDDEN);
    const body = CreateOrganisationSchema.safeParse(request.body);
    if (!body.success) return invalidBody(reply, body.error);
    const input = body.data;
    if (!canManageCommercial(request.user, input.venueId)) return reply.status(403).send(FORBIDDEN);
    const actorId = request.user.id;

    const outcome = await db.transaction(async (tx) => {
      const owner = await resolveOwner(tx, input.venueId, input.ownerUserId, actorId);
      if (!owner.ok) return { kind: "owner_not_at_venue" } as const;
      const organisationId = await insertOrganisation(tx, { ...input, ownerUserId: owner.ownerUserId, createdBy: actorId });
      const profile = await readOrganisationProfile(tx, input.venueId, organisationId);
      if (profile === null) throw new Error("A new organisation could not be read back");
      return { kind: "created", organisationId, profile } as const;
    });

    if (outcome.kind === "owner_not_at_venue") return reply.status(422).send(OWNER_NOT_AT_VENUE);
    request.log.info({ event: "people.organisation_created", organisationId: outcome.organisationId }, "organisation created");
    return reply.status(201).send({ data: outcome.profile });
  });

  server.get("/organisations/:organisationId", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = peopleScope(request.user);
    if (!scope.ok) return reply.status(403).send(FORBIDDEN);
    const params = OrganisationParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(INVALID_ID);

    // One snapshot, so the organisation, its members and its owner are read as
    // they stood at one moment.
    const profile = await db.transaction(
      (tx) => readOrganisationProfile(tx, scope.venueId, params.data.organisationId),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    if (profile === null) return reply.status(404).send(ORGANISATION_NOT_FOUND);
    return { data: profile };
  });

  server.patch("/organisations/:organisationId", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = peopleScope(request.user);
    if (!scope.ok) return reply.status(403).send(FORBIDDEN);
    const params = OrganisationParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(INVALID_ID);
    const body = UpdateOrganisationSchema.safeParse(request.body);
    if (!body.success) return invalidBody(reply, body.error);
    const patch = body.data;

    const outcome = await db.transaction(async (tx) => {
      const row = await lockOrganisation(tx, scope.venueId, params.data.organisationId);
      if (row === undefined) return { kind: "not_found" } as const;
      const owner = patch.ownerUserId;
      if (typeof owner === "string" && !(await isCommercialMember(tx, row.venueId, owner))) {
        return { kind: "owner_not_at_venue" } as const;
      }
      if (await updateOrganisationFields(tx, row, patch) === "stale") return { kind: "stale" } as const;
      const profile = await readOrganisationProfile(tx, row.venueId, row.id);
      if (profile === null) throw new Error("A locked live organisation could not be read back");
      return { kind: "updated", organisationId: row.id, profile } as const;
    });

    switch (outcome.kind) {
      case "not_found": return reply.status(404).send(ORGANISATION_NOT_FOUND);
      case "owner_not_at_venue": return reply.status(422).send(OWNER_NOT_AT_VENUE);
      case "stale":
        return reply.status(409).send({
          error: "Someone has changed this organisation since you opened it; reload to see their changes",
          code: "STALE_RECORD",
        });
      case "updated":
        request.log.info({ event: "people.organisation_updated", organisationId: outcome.organisationId }, "organisation updated");
        return { data: outcome.profile };
    }
  });

  server.post("/:personId/contact-points", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = peopleScope(request.user);
    if (!scope.ok) return reply.status(403).send(FORBIDDEN);
    const params = PersonParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(INVALID_ID);
    const body = ContactPointInputSchema.safeParse(request.body);
    if (!body.success) return invalidBody(reply, body.error);
    const point = body.data;

    const outcome = await db.transaction(async (tx) => {
      const lock = await lockPerson(tx, scope.venueId, params.data.personId);
      if (lock.state === "merged") return { kind: "merged", mergedIntoId: lock.mergedIntoId } as const;
      if (lock.state !== "live") return { kind: "not_found" } as const;
      await adoptLegacyMirror(tx, lock.row);
      const { created } = await upsertContactPoint(tx, lock.row, point);
      return { kind: "saved", created, personId: lock.row.id, profile: await lockedProfile(tx, lock.row) } as const;
    });

    if (outcome.kind === "not_found") return reply.status(404).send(PERSON_NOT_FOUND);
    if (outcome.kind === "merged") return reply.status(409).send(mergedPerson(outcome.mergedIntoId));
    request.log.info(
      { event: outcome.created ? "people.contact_point_added" : "people.contact_point_already_held", personId: outcome.personId },
      "contact point saved",
    );
    return reply.status(outcome.created ? 201 : 200).send({ data: outcome.profile });
  });

  server.delete("/:personId/contact-points/:pointId", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = peopleScope(request.user);
    if (!scope.ok) return reply.status(403).send(FORBIDDEN);
    const params = PointParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(INVALID_ID);

    type Outcome =
      | { kind: "not_found" }
      | { kind: "merged"; mergedIntoId: string }
      | { kind: "point_not_found" }
      | { kind: "removed"; personId: string };
    const outcome = await writeOrRefuse<Outcome>(db, async (tx, refuse) => {
      const lock = await lockPerson(tx, scope.venueId, params.data.personId);
      if (lock.state === "merged") return { kind: "merged", mergedIntoId: lock.mergedIntoId };
      if (lock.state !== "live") return { kind: "not_found" };
      await adoptLegacyMirror(tx, lock.row);
      const removed = await removeContactPoint(tx, lock.row.id, params.data.pointId);
      return removed ? { kind: "removed", personId: lock.row.id } : refuse({ kind: "point_not_found" });
    });

    if (outcome.kind === "not_found") return reply.status(404).send(PERSON_NOT_FOUND);
    if (outcome.kind === "merged") return reply.status(409).send(mergedPerson(outcome.mergedIntoId));
    if (outcome.kind === "point_not_found") {
      return reply.status(404).send({ error: "Contact point not found", code: "NOT_FOUND" });
    }
    request.log.info({ event: "people.contact_point_removed", personId: outcome.personId }, "contact point removed");
    return reply.status(204).send();
  });

  server.put("/:personId/memberships", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = peopleScope(request.user);
    if (!scope.ok) return reply.status(403).send(FORBIDDEN);
    const params = PersonParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(INVALID_ID);
    const body = SetMembershipsSchema.safeParse(request.body);
    if (!body.success) return invalidBody(reply, body.error);
    const memberships = body.data;

    type Outcome =
      | { kind: "not_found" }
      | { kind: "merged"; mergedIntoId: string }
      | { kind: "organisation_not_found" }
      | { kind: "set"; personId: string; profile: PersonProfile };
    const outcome = await writeOrRefuse<Outcome>(db, async (tx, refuse) => {
      const lock = await lockPerson(tx, scope.venueId, params.data.personId);
      if (lock.state === "merged") return { kind: "merged", mergedIntoId: lock.mergedIntoId };
      if (lock.state !== "live") return { kind: "not_found" };
      await adoptLegacyMirror(tx, lock.row);
      if (await setPersonMemberships(tx, lock.row, memberships) === "organisation_not_found") {
        return refuse({ kind: "organisation_not_found" });
      }
      return { kind: "set", personId: lock.row.id, profile: await lockedProfile(tx, lock.row) };
    });

    if (outcome.kind === "not_found") return reply.status(404).send(PERSON_NOT_FOUND);
    if (outcome.kind === "merged") return reply.status(409).send(mergedPerson(outcome.mergedIntoId));
    if (outcome.kind === "organisation_not_found") {
      return reply.status(404).send({ error: "Organisation not found", code: "ORGANISATION_NOT_FOUND" });
    }
    request.log.info({ event: "people.memberships_set", personId: outcome.personId }, "memberships set");
    return { data: outcome.profile };
  });

  server.get("/:personId/duplicates", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = peopleScope(request.user);
    if (!scope.ok) return reply.status(403).send(FORBIDDEN);
    const params = PersonParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(INVALID_ID);

    const [person] = await db.select({ id: contacts.id, venueId: contacts.venueId }).from(contacts)
      .where(and(
        eq(contacts.id, params.data.personId),
        scope.venueId === null ? undefined : eq(contacts.venueId, scope.venueId),
        liveContact(),
      ))
      .limit(1);
    if (person === undefined) return reply.status(404).send(PERSON_NOT_FOUND);
    return { data: await duplicateSuggestions(db, person.venueId, person.id) };
  });

  // :personId is the record that closes; survivorId the one that stays.
  server.get("/:personId/merge-preview", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = peopleScope(request.user);
    if (!scope.ok) return reply.status(403).send(FORBIDDEN);
    const params = PersonParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(INVALID_ID);
    const query = MergeRequestSchema.safeParse(request.query);
    if (!query.success) return invalidBody(reply, query.error);

    // One snapshot, so every count is of the records as they stood at one moment.
    const answer = await db.transaction(
      (tx) => previewPersonMerge(tx, scope.venueId, params.data.personId, query.data.survivorId),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    if (isMergeFailure(answer)) return refuseMerge(reply, answer);
    return { data: answer };
  });

  server.post("/:personId/merge", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = peopleScope(request.user);
    if (!scope.ok) return reply.status(403).send(FORBIDDEN);
    const params = PersonParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(INVALID_ID);
    const body = MergeRequestSchema.safeParse(request.body);
    if (!body.success) return invalidBody(reply, body.error);

    const answer = await applyPersonMerge(db, scope.venueId, params.data.personId, body.data.survivorId, request.user.id);
    if (isMergeFailure(answer)) return refuseMerge(reply, answer);
    request.log.info(
      {
        event: answer.replayed ? "people.merge_replayed" : "people.merged",
        mergeId: answer.mergeId,
        survivorId: answer.survivorId,
        mergedId: answer.mergedId,
      },
      answer.replayed ? "merge answered again" : "people merged",
    );
    return reply.status(answer.replayed ? 200 : 201).send({ data: answer });
  });

  server.post("/:personId/kept-apart", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = peopleScope(request.user);
    if (!scope.ok) return reply.status(403).send(FORBIDDEN);
    const params = PersonParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(INVALID_ID);
    const body = KeepApartRequestSchema.safeParse(request.body);
    if (!body.success) return invalidBody(reply, body.error);
    const personId = params.data.personId.toLowerCase();
    const otherPersonId = body.data.otherPersonId.toLowerCase();
    if (personId === otherPersonId) {
      return reply.status(422).send({ error: "A person cannot be kept apart from themself", code: "SAME_RECORD" });
    }
    const actorId = request.user.id;

    const outcome = await db.transaction(async (tx) => {
      const pair = await lockPair(tx, scope.venueId, personId, otherPersonId);
      if (pair.kind !== "live") return pair;
      return { kind: "kept", ...(await keepApart(tx, pair.venueId, pair.ids, actorId)) } as const;
    });

    if (outcome.kind === "not_found") return reply.status(404).send(PERSON_NOT_FOUND);
    if (outcome.kind === "merged") return reply.status(409).send(mergedPerson(outcome.mergedIntoId));
    request.log.info(
      { event: outcome.created ? "people.kept_apart" : "people.kept_apart_already", personId, otherPersonId },
      "people kept apart",
    );
    return reply.status(outcome.created ? 201 : 200).send({ data: outcome.mark });
  });

  server.delete("/:personId/kept-apart/:otherPersonId", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = peopleScope(request.user);
    if (!scope.ok) return reply.status(403).send(FORBIDDEN);
    const params = PairParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(INVALID_ID);
    const personId = params.data.personId.toLowerCase();
    const otherPersonId = params.data.otherPersonId.toLowerCase();
    const notMarked = { error: "These two people are not marked as different people", code: "NOT_FOUND" } as const;
    if (personId === otherPersonId) return reply.status(404).send(notMarked);
    const actorId = request.user.id;

    const outcome = await db.transaction(async (tx) => {
      const pair = await lockPair(tx, scope.venueId, personId, otherPersonId);
      if (pair.kind !== "live") return pair;
      return await withdrawKeptApart(tx, pair.venueId, pair.ids, actorId)
        ? { kind: "withdrawn" } as const
        : { kind: "not_marked" } as const;
    });

    if (outcome.kind === "not_found") return reply.status(404).send(PERSON_NOT_FOUND);
    if (outcome.kind === "merged") return reply.status(409).send(mergedPerson(outcome.mergedIntoId));
    if (outcome.kind === "not_marked") return reply.status(404).send(notMarked);
    request.log.info({ event: "people.kept_apart_withdrawn", personId, otherPersonId }, "kept-apart mark withdrawn");
    return reply.status(204).send();
  });
}
