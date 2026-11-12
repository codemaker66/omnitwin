import { z } from "zod";
import { OpsHandoffPackBundleSchema, type OpsHandoffPackBundle } from "@omnitwin/types";
import { api } from "./client.js";

export async function getOpsHandoffPack(id: string): Promise<OpsHandoffPackBundle> {
  return api.get(`/ops/handoff-packs/${id}`, OpsHandoffPackBundleSchema);
}

/** The compile route's whole reply: the pack, and whether this compile made
 *  it (false when the event's standing pack already said this and was
 *  returned as it stands, with the floor's progress kept).
 *
 *  `created` is absent from an API a deploy behind this page. That API made
 *  a new pack on every compile, so a reply without it reads as made, and the
 *  page never fails a compile that succeeded while the two deploys land. */
const CompileReplySchema = z.object({
  data: OpsHandoffPackBundleSchema,
  created: z.boolean().default(true),
});

export interface OpsHandoffCompileResult {
  readonly bundle: OpsHandoffPackBundle;
  readonly created: boolean;
}

export async function compileOpsHandoffPack(input: {
  readonly configId: string;
  readonly eventId?: string | null;
  readonly clientNotes?: string | null;
}): Promise<OpsHandoffCompileResult> {
  const reply = await api.post(
    `/ops/handoff-packs/from-configuration/${input.configId}`,
    {
      eventId: input.eventId ?? null,
      clientNotes: input.clientNotes ?? null,
    },
    false,
    CompileReplySchema,
    { keepEnvelope: true },
  );
  return { bundle: reply.data, created: reply.created };
}
