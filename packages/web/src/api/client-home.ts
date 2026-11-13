import { ClientHomeSchema, type ClientHome } from "@omnitwin/types";
import { api } from "./client.js";

/** The signed-in person's own events and plans (GET /client-home). */
export async function getClientHome(signal?: AbortSignal): Promise<ClientHome> {
  return api.get("/client-home", ClientHomeSchema, signal);
}
