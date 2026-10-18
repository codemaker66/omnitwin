import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DIETARY_MEMORY_CONSENT, RememberDietaryNoteRequestSchema } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { isClientSideRole } from "../utils/query.js";
import {
  listRememberedDietaryNotes,
  rememberDietaryNote,
  removeRememberedDietaryNote,
} from "../services/dietary-memory.js";

// ---------------------------------------------------------------------------
// /account/dietary-notes — the client's remembered allergy notes ("ask once,
// then remember", Blake, 17 October 2026). Every route answers for the
// signed-in account only: there is no path by which one account reads or
// removes another's note, staff and administrators included. A health note
// must never sit in a shared cache, so every answer is private, no-store.
//
//   GET    /            the account's remembered notes, one per venue
//   PUT    /            remember the note on one of the account's own saved
//                       layouts, under the wording version the page showed
//   DELETE /:id         remove one; its consent record stays, without it
// ---------------------------------------------------------------------------

const IdParam = z.object({ id: z.string().uuid() });

export async function dietaryMemoryRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    return { data: await listRememberedDietaryNotes(db, request.user.id) };
  });

  server.put("/", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const body = RememberDietaryNoteRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request", code: "VALIDATION_ERROR", details: body.error.issues });
    }
    // Only the person planning the event agrees for themselves. Staff who
    // type a note for a client cannot agree on the client's behalf; the note
    // stays on the layout under its own rule.
    if (!isClientSideRole(request.user.role)) {
      return reply.status(403).send({
        error: "Only the client can ask for their notes to be remembered, from their own account. The note on this layout is kept for this event.",
        code: "FORBIDDEN",
      });
    }
    // A page opened before the wording changed would record words the client
    // never read. Refuse, and say how to see the current words.
    if (body.data.consentVersion !== DIETARY_MEMORY_CONSENT.version) {
      return reply.status(409).send({
        error: "The words beside the box have changed since this page opened. Reload the page, read them, and tick the box again.",
        code: "CONSENT_WORDING_CHANGED",
      });
    }

    const outcome = await rememberDietaryNote(db, request.user.id, body.data.configurationId);
    switch (outcome.kind) {
      case "remembered":
        return { data: outcome.note };
      case "layout-not-found":
        return reply.status(404).send({
          error: "That layout is not one of your saved layouts. Open it from your account and save it again.",
          code: "NOT_FOUND",
        });
      case "no-note":
        return reply.status(409).send({
          error: "This layout has no allergy note to remember. Add the note, save the layout, then tick the box.",
          code: "NO_NOTE",
        });
      case "note-too-long":
        return reply.status(409).send({
          error: "This note is longer than 1,000 characters. Shorten it on the layout, save, then tick the box.",
          code: "NOTE_TOO_LONG",
        });
    }
  });

  server.delete("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }
    const removed = await removeRememberedDietaryNote(db, request.user.id, params.data.id);
    if (!removed) {
      return reply.status(404).send({
        error: "That note is not remembered with your account. It may already have been removed; reload to see what is kept.",
        code: "NOT_FOUND",
      });
    }
    return reply.status(204).send();
  });
}
