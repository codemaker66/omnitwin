import { z } from "zod";
import { ChangeoverSchema, type Changeover } from "@omnitwin/types";
import { ApiError, api } from "./client.js";

/**
 * What moves when a room goes from one booking's layout to the next one's:
 * the two layouts' configuration ids, the same one twice when the next
 * booking keeps the layout.
 */
export async function getChangeover(
  input: { readonly from: string; readonly to: string },
  signal?: AbortSignal,
): Promise<Changeover> {
  const params = new URLSearchParams({ from: input.from, to: input.to });
  return api.get(`/hallkeeper/changeover?${params.toString()}`, ChangeoverSchema, signal);
}

/**
 * Why the changeover could not be read: for now (the connection dropped, the
 * server was busy), which a second read may mend, or lastingly, which no
 * retry changes: an approved sheet that cannot be read, a layout removed,
 * two rooms, a layout this account may not open. A lasting refusal names
 * the layouts it is about, when the server says.
 */
export type ChangeoverFailure =
  | { readonly lasting: false }
  | {
    readonly lasting: true;
    readonly reason: "unreadable" | "removed" | "rooms" | "no-access" | "refused";
    readonly configIds: readonly string[];
  };

const RefusalDetailsSchema = z.object({ configIds: z.array(z.string()) });

/** For now: no answer, a busy or failing server, a session being renewed. */
const FOR_NOW = new Set([0, 401, 408, 429]);

export function changeoverFailure(error: unknown): ChangeoverFailure {
  if (!(error instanceof ApiError) || FOR_NOW.has(error.status)) return { lasting: false };
  const details = RefusalDetailsSchema.safeParse(error.details);
  const configIds = details.success ? details.data.configIds : [];
  if (error.status === 503 && error.code === "APPROVED_SNAPSHOT_UNAVAILABLE") return { lasting: true, reason: "unreadable", configIds };
  if (error.status >= 500) return { lasting: false };
  if (error.status === 404) return { lasting: true, reason: "removed", configIds };
  if (error.status === 409 && error.code === "NOT_ONE_ROOM") return { lasting: true, reason: "rooms", configIds };
  if (error.status === 403) return { lasting: true, reason: "no-access", configIds };
  return { lasting: true, reason: "refused", configIds };
}
