import { OpsHandoffPackBundleSchema, type OpsHandoffPackBundle } from "@omnitwin/types";
import { api } from "./client.js";

export async function getOpsHandoffPack(id: string): Promise<OpsHandoffPackBundle> {
  return api.get(`/ops/handoff-packs/${id}`, OpsHandoffPackBundleSchema);
}

export async function compileOpsHandoffPack(input: {
  readonly configId: string;
  readonly eventId?: string | null;
  readonly clientNotes?: string | null;
}): Promise<OpsHandoffPackBundle> {
  return api.post(
    `/ops/handoff-packs/from-configuration/${input.configId}`,
    {
      eventId: input.eventId ?? null,
      clientNotes: input.clientNotes ?? null,
    },
    false,
    OpsHandoffPackBundleSchema,
  );
}
