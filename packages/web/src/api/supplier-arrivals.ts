import { z } from "zod";
import {
  SupplierArrivalSchema,
  type CreateSupplierArrival,
  type SupplierArrival,
  type SupplierArrivalStep,
  type UpdateSupplierArrival,
} from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Supplier arrivals (T-692): the office plans who comes to the building for
// a booking, and the floor marks each one at the door. Every change carries
// the revision it was made from, so a colleague's newer change is refused
// rather than overwritten.
// ---------------------------------------------------------------------------

function arrivalsPath(venueId: string): string {
  return `/venues/${encodeURIComponent(venueId)}/supplier-arrivals`;
}

/** The arrivals due between two instants, earliest first. */
export function listSupplierArrivals(venueId: string, fromMs: number, toMs: number, signal?: AbortSignal): Promise<SupplierArrival[]> {
  const from = encodeURIComponent(new Date(fromMs).toISOString());
  const to = encodeURIComponent(new Date(toMs).toISOString());
  return api.get(`${arrivalsPath(venueId)}?from=${from}&to=${to}`, z.array(SupplierArrivalSchema), signal);
}

export function createSupplierArrival(venueId: string, body: CreateSupplierArrival): Promise<SupplierArrival> {
  return api.post(arrivalsPath(venueId), body, undefined, SupplierArrivalSchema);
}

export function updateSupplierArrival(venueId: string, id: string, body: UpdateSupplierArrival): Promise<SupplierArrival> {
  return api.patch(`${arrivalsPath(venueId)}/${encodeURIComponent(id)}`, body, SupplierArrivalSchema);
}

export function removeSupplierArrival(venueId: string, arrival: Pick<SupplierArrival, "id" | "revision">): Promise<void> {
  return api.delete(`${arrivalsPath(venueId)}/${encodeURIComponent(arrival.id)}?expectedRevision=${String(arrival.revision)}`);
}

/** The floor marks a supplier arrived or gone; a second tap reads the first back. */
export function recordSupplierArrivalStep(venueId: string, id: string, step: SupplierArrivalStep): Promise<SupplierArrival> {
  return api.post(`${arrivalsPath(venueId)}/${encodeURIComponent(id)}/${step}`, {}, undefined, SupplierArrivalSchema);
}
