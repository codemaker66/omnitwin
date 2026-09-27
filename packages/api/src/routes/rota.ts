import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  CancelRotaShiftSchema,
  CreateRotaShiftSchema,
  CreateStaffMemberSchema,
  CreateStaffUnavailabilitySchema,
  KeepRotaWarningSchema,
  PublishRotaWeekSchema,
  RotaWeekQuerySchema,
  UpdateRotaShiftSchema,
  UpdateStaffMemberSchema,
  resolveRotaTimeZone,
  rotaMondayOf,
  rotaWeekStartOf,
  type RotaAccess,
  type RotaFinding,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { authenticate, type JwtUser } from "../middleware/auth.js";
import { canAdministerVenue, canManageVenue } from "../utils/query.js";
import {
  cancelPublishedShift,
  createRotaShift,
  createStaffMember,
  createUnavailability,
  keepRotaWarning,
  loadRotaWeek,
  publishRotaWeek,
  removeDraftShift,
  removeUnavailability,
  updateRotaShift,
  updateStaffMember,
  venueTimeZone,
  type ReferenceProblem,
  type StaffOutcome,
} from "../services/rota.js";

// ---------------------------------------------------------------------------
// The staff rota, version 1 (T-637 slice B)
//
//   /venues/:venueId/rota/week          the week: people, shifts, warnings
//   /venues/:venueId/rota/shifts        add, change, remove a draft, cancel,
//                                       keep a warning with a reason
//   /venues/:venueId/rota/publish       publish the drafts that were shown
//   /venues/:venueId/rota/people        staff records
//   /venues/:venueId/rota/unavailability leave, and times someone cannot work
//
// Who may do what, through the capability helpers:
//   - the roles that administer the venue manage the rota (canAdministerVenue);
//   - everyone on the venue floor reads the published week (canManageVenue);
//   - anyone else whose account is linked to a person on the rota sees their
//     own shifts, at the venue their account belongs to.
// Every row is read and written inside the venue in the path, so a record of
// another venue answers 404, never its contents.
// ---------------------------------------------------------------------------

const VenueParam = z.object({ venueId: z.string().uuid() });
const ItemParam = z.object({ venueId: z.string().uuid(), id: z.string().uuid() });
const RevisionQuery = z.object({ expectedRevision: z.coerce.number().int().min(1) }).strict();

export function rotaAccess(user: Pick<JwtUser, "role" | "venueId" | "platformRole">, venueId: string): RotaAccess | null {
  if (canAdministerVenue(user, venueId)) return "manage";
  if (canManageVenue(user, venueId)) return "read";
  // A person linked to an account always sees their own shifts, whatever
  // their role, but only where their account belongs.
  if (user.venueId === venueId) return "own";
  return null;
}

function actorOf(user: JwtUser): { readonly id: string; readonly name: string } {
  return { id: user.id, name: user.name };
}

function forbidden(reply: FastifyReply): FastifyReply {
  return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
}

function invalid(reply: FastifyReply, details: unknown, error = "Validation failed"): FastifyReply {
  return reply.status(400).send({ error, code: "VALIDATION_ERROR", details });
}

function venueMissing(reply: FastifyReply): FastifyReply {
  return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
}

function shiftMissing(reply: FastifyReply): FastifyReply {
  return reply.status(404).send({ error: "Shift not found", code: "NOT_FOUND" });
}

function referenceRefused(reply: FastifyReply, problem: ReferenceProblem): FastifyReply {
  switch (problem.kind) {
    case "person_not_found":
      return reply.status(404).send({ error: "That person is not on this venue's rota.", code: "NOT_FOUND" });
    case "person_inactive":
      return reply.status(422).send({
        error: `${problem.name} is no longer on the rota. Put them back in Staff first.`, code: "PERSON_INACTIVE",
      });
    case "event_not_found":
      return reply.status(404).send({ error: "That event is not in this venue.", code: "NOT_FOUND" });
    case "room_not_found":
      return reply.status(404).send({ error: "That room is not in this venue.", code: "NOT_FOUND" });
  }
}

function blocked(reply: FastifyReply, finding: RotaFinding): FastifyReply {
  return reply.status(422).send({ error: finding.message, code: "ROTA_BLOCKED", details: { blocks: [finding] } });
}

const SHIFT_CHANGED = "Someone changed this shift a moment ago. Here is how it stands now.";

function staffRefused(reply: FastifyReply, outcome: Exclude<StaffOutcome, { kind: "saved" }>): FastifyReply {
  switch (outcome.kind) {
    case "not_found":
      return reply.status(404).send({ error: "That person is not on this venue's rota.", code: "NOT_FOUND" });
    case "stale":
      return reply.status(409).send({
        error: "Someone changed this record a moment ago. Here is how it stands now.", code: "PERSON_CHANGED", details: outcome.record,
      });
    case "invalid":
      return invalid(reply, [{ message: outcome.message }], outcome.message);
    case "account_outside_team":
      return reply.status(422).send({ error: "Only an account of this venue's team can be linked.", code: "ACCOUNT_OUTSIDE_TEAM" });
    case "account_linked":
      return reply.status(409).send({
        error: outcome.name === null ? "That account is already linked to someone on the rota." : `That account is already linked to ${outcome.name}.`,
        code: "ACCOUNT_LINKED",
      });
  }
}

export async function rotaRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  /** The venue's zone, or null when the venue does not exist. */
  const zoneOf = async (venueId: string): Promise<string | null> => {
    const stored = await venueTimeZone(db, venueId);
    return stored === null ? null : resolveRotaTimeZone(stored);
  };

  // GET /venues/:venueId/rota/week?start=YYYY-MM-DD — the week holding that
  // day, on the venue's calendar; this week when no day is given.
  server.get("/week", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues, "Invalid venue ID");
    const query = RotaWeekQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply, query.error.issues);
    const { venueId } = params.data;
    const access = rotaAccess(request.user, venueId);
    if (access === null) return forbidden(reply);
    const timeZone = await zoneOf(venueId);
    if (timeZone === null) return venueMissing(reply);
    const weekStart = query.data.start === undefined ? rotaWeekStartOf(Date.now(), timeZone) : rotaMondayOf(query.data.start);
    return { data: await loadRotaWeek(db, { venueId, timeZone, weekStart, access, viewerId: request.user.id }) };
  });

  // POST /venues/:venueId/rota/shifts — a draft, filled or not.
  server.post("/shifts", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues, "Invalid venue ID");
    const { venueId } = params.data;
    if (!canAdministerVenue(request.user, venueId)) return forbidden(reply);
    const body = CreateRotaShiftSchema.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error.issues);
    const timeZone = await zoneOf(venueId);
    if (timeZone === null) return venueMissing(reply);
    const outcome = await createRotaShift(db, { venueId, timeZone, body: body.data, actor: actorOf(request.user) });
    if (outcome.kind === "reference") return referenceRefused(reply, outcome.problem);
    if (outcome.kind === "blocked") return blocked(reply, outcome.finding);
    return reply.status(201).send({ data: outcome.shift });
  });

  // PATCH /venues/:venueId/rota/shifts/:id — from the revision the editor saw.
  server.patch("/shifts/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ItemParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues, "Invalid params");
    const { venueId, id } = params.data;
    if (!canAdministerVenue(request.user, venueId)) return forbidden(reply);
    const body = UpdateRotaShiftSchema.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error.issues);
    const timeZone = await zoneOf(venueId);
    if (timeZone === null) return venueMissing(reply);
    const outcome = await updateRotaShift(db, { venueId, timeZone, shiftId: id, body: body.data, actor: actorOf(request.user) });
    switch (outcome.kind) {
      case "changed":
        return { data: outcome.shift };
      case "not_found":
        return shiftMissing(reply);
      case "stale":
        return reply.status(409).send({ error: SHIFT_CHANGED, code: "SHIFT_CHANGED", details: outcome.shift });
      case "cancelled":
        return reply.status(409).send({ error: "This shift has been cancelled.", code: "SHIFT_CANCELLED", details: outcome.shift });
      case "invalid":
        return invalid(reply, [{ message: outcome.message }], outcome.message);
      case "reference":
        return referenceRefused(reply, outcome.problem);
      case "blocked":
        return blocked(reply, outcome.finding);
    }
  });

  // DELETE /venues/:venueId/rota/shifts/:id?expectedRevision=N — a draft
  // nobody has been told about.
  server.delete("/shifts/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ItemParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues, "Invalid params");
    const { venueId, id } = params.data;
    if (!canAdministerVenue(request.user, venueId)) return forbidden(reply);
    const query = RevisionQuery.safeParse(request.query);
    if (!query.success) return invalid(reply, query.error.issues);
    const timeZone = await zoneOf(venueId);
    if (timeZone === null) return venueMissing(reply);
    const outcome = await removeDraftShift(db, { venueId, timeZone, shiftId: id, expectedRevision: query.data.expectedRevision });
    switch (outcome.kind) {
      case "removed":
        return reply.status(204).send();
      case "not_found":
        return shiftMissing(reply);
      case "published":
        return reply.status(409).send({
          error: "The people on this shift have been told of it, so it is cancelled rather than removed.",
          code: "SHIFT_PUBLISHED", details: outcome.shift,
        });
      case "stale":
        return reply.status(409).send({ error: SHIFT_CHANGED, code: "SHIFT_CHANGED", details: outcome.shift });
    }
  });

  // POST /venues/:venueId/rota/shifts/:id/cancel — a published shift, with
  // the notice given recorded and the person told.
  server.post("/shifts/:id/cancel", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ItemParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues, "Invalid params");
    const { venueId, id } = params.data;
    if (!canAdministerVenue(request.user, venueId)) return forbidden(reply);
    const body = CancelRotaShiftSchema.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error.issues);
    const timeZone = await zoneOf(venueId);
    if (timeZone === null) return venueMissing(reply);
    const outcome = await cancelPublishedShift(db, {
      venueId, timeZone, shiftId: id, expectedRevision: body.data.expectedRevision, actor: actorOf(request.user),
    });
    switch (outcome.kind) {
      case "cancelled":
        return { data: outcome.shift };
      case "not_found":
        return shiftMissing(reply);
      case "draft":
        return reply.status(409).send({
          error: "Nobody has been told of this shift yet, so it can simply be removed.", code: "SHIFT_DRAFT", details: outcome.shift,
        });
      case "stale":
        return reply.status(409).send({ error: SHIFT_CHANGED, code: "SHIFT_CHANGED", details: outcome.shift });
    }
  });

  // POST /venues/:venueId/rota/shifts/:id/keep — keep a warning, with why.
  server.post("/shifts/:id/keep", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ItemParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues, "Invalid params");
    const { venueId, id } = params.data;
    if (!canAdministerVenue(request.user, venueId)) return forbidden(reply);
    const body = KeepRotaWarningSchema.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error.issues);
    const timeZone = await zoneOf(venueId);
    if (timeZone === null) return venueMissing(reply);
    const outcome = await keepRotaWarning(db, {
      venueId, timeZone, shiftId: id, code: body.data.code, reason: body.data.reason,
      expectedRevision: body.data.expectedRevision, actor: actorOf(request.user),
    });
    switch (outcome.kind) {
      case "kept":
        return { data: outcome.shift };
      case "not_found":
        return shiftMissing(reply);
      case "stale":
        return reply.status(409).send({ error: SHIFT_CHANGED, code: "SHIFT_CHANGED", details: outcome.shift });
      case "gone":
        return reply.status(409).send({ error: "That warning no longer applies.", code: "WARNING_GONE", details: outcome.shift });
    }
  });

  // POST /venues/:venueId/rota/publish — the drafts the manager was shown.
  server.post("/publish", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues, "Invalid venue ID");
    const { venueId } = params.data;
    if (!canAdministerVenue(request.user, venueId)) return forbidden(reply);
    const body = PublishRotaWeekSchema.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error.issues);
    const timeZone = await zoneOf(venueId);
    if (timeZone === null) return venueMissing(reply);
    const outcome = await publishRotaWeek(db, {
      venueId, timeZone, weekStart: rotaMondayOf(body.data.weekStart), shifts: body.data.shifts, actor: actorOf(request.user),
    });
    switch (outcome.kind) {
      case "published":
        return { data: { published: outcome.published, told: outcome.told, notTold: outcome.notTold } };
      case "stale":
        return reply.status(409).send({
          error: "The week changed while you were looking at it. Here it is as it stands now.",
          code: "WEEK_CHANGED", details: { shiftIds: outcome.shiftIds },
        });
      case "blocked":
        return reply.status(422).send({
          error: outcome.blocks[0]?.message ?? "Some shifts cannot be published yet.", code: "ROTA_BLOCKED", details: { blocks: outcome.blocks },
        });
    }
  });

  // POST /venues/:venueId/rota/people — a person on the rota; no login needed.
  server.post("/people", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues, "Invalid venue ID");
    const { venueId } = params.data;
    if (!canAdministerVenue(request.user, venueId)) return forbidden(reply);
    const body = CreateStaffMemberSchema.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error.issues);
    if (await zoneOf(venueId) === null) return venueMissing(reply);
    const outcome = await createStaffMember(db, { venueId, body: body.data, actor: actorOf(request.user) });
    if (outcome.kind === "saved") return reply.status(201).send({ data: outcome.record });
    return staffRefused(reply, outcome);
  });

  // PATCH /venues/:venueId/rota/people/:id — from the revision the editor saw.
  server.patch("/people/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ItemParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues, "Invalid params");
    const { venueId, id } = params.data;
    if (!canAdministerVenue(request.user, venueId)) return forbidden(reply);
    const body = UpdateStaffMemberSchema.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error.issues);
    const outcome = await updateStaffMember(db, { venueId, id, body: body.data, actor: actorOf(request.user) });
    if (outcome.kind === "saved") return { data: outcome.record };
    return staffRefused(reply, outcome);
  });

  // POST /venues/:venueId/rota/unavailability — leave, or a time someone
  // cannot work.
  server.post("/unavailability", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues, "Invalid venue ID");
    const { venueId } = params.data;
    if (!canAdministerVenue(request.user, venueId)) return forbidden(reply);
    const body = CreateStaffUnavailabilitySchema.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error.issues);
    const outcome = await createUnavailability(db, { venueId, body: body.data, actor: actorOf(request.user) });
    if (outcome.kind === "person_not_found") {
      return reply.status(404).send({ error: "That person is not on this venue's rota.", code: "NOT_FOUND" });
    }
    return reply.status(201).send({ data: outcome.absence });
  });

  // DELETE /venues/:venueId/rota/unavailability/:id
  server.delete("/unavailability/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ItemParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues, "Invalid params");
    const { venueId, id } = params.data;
    if (!canAdministerVenue(request.user, venueId)) return forbidden(reply);
    if (!await removeUnavailability(db, venueId, id)) {
      return reply.status(404).send({ error: "That leave or unavailability is not on this venue's rota.", code: "NOT_FOUND" });
    }
    return reply.status(204).send();
  });
}
