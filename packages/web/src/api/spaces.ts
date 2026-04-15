import type { FloorPlanPoint } from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Venue {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly address: string;
  readonly logoUrl: string | null;
  readonly brandColour: string | null;
}

export interface Space {
  readonly id: string;
  readonly venueId: string;
  readonly name: string;
  readonly slug: string;
  // widthM / lengthM are denormalised bbox values derived from
  // floorPlanOutline on every write (see backend invariant in
  // packages/api/src/db/schema.ts). They remain in the response because
  // several hot-path web readers consume them directly; but on create/
  // update the API accepts the polygon only.
  readonly widthM: string;
  readonly lengthM: string;
  readonly heightM: string;
  readonly floorPlanOutline: readonly FloorPlanPoint[];
  readonly loadoutCount?: number;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function listVenues(): Promise<Venue[]> {
  return api.get<Venue[]>("/venues");
}

export interface VenueDetail extends Venue {
  readonly spaces: readonly Space[];
}

export async function getVenue(venueId: string): Promise<VenueDetail> {
  return api.get<VenueDetail>(`/venues/${venueId}`);
}

export interface UpdateVenueInput {
  readonly name?: string;
  readonly address?: string;
  readonly logoUrl?: string | null;
  readonly brandColour?: string | null;
}

export async function updateVenue(venueId: string, data: UpdateVenueInput): Promise<Venue> {
  return api.patch<Venue>(`/venues/${venueId}`, data);
}

export interface CreateVenueInput {
  readonly name: string;
  readonly slug: string;
  readonly address: string;
}

export async function createVenue(data: CreateVenueInput): Promise<Venue> {
  return api.post<Venue>("/venues", data);
}

export interface CreateSpaceInput {
  readonly name: string;
  readonly slug: string;
  readonly heightM: number;
  readonly floorPlanOutline: readonly FloorPlanPoint[];
}

export async function createSpace(venueId: string, data: CreateSpaceInput): Promise<Space> {
  return api.post<Space>(`/venues/${venueId}/spaces`, data);
}

export async function listSpaces(venueId: string): Promise<Space[]> {
  return api.get<Space[]>(`/venues/${venueId}/spaces`);
}

export async function getSpace(venueId: string, spaceId: string): Promise<Space> {
  return api.get<Space>(`/venues/${venueId}/spaces/${spaceId}`);
}

export interface UpdateSpaceInput {
  readonly name?: string;
  readonly heightM?: number;
  readonly floorPlanOutline?: readonly FloorPlanPoint[];
}

export async function updateSpace(venueId: string, spaceId: string, data: UpdateSpaceInput): Promise<Space> {
  return api.patch<Space>(`/venues/${venueId}/spaces/${spaceId}`, data);
}

export async function deleteSpace(venueId: string, spaceId: string): Promise<void> {
  await api.delete(`/venues/${venueId}/spaces/${spaceId}`);
}

export async function deleteVenue(venueId: string): Promise<void> {
  await api.delete(`/venues/${venueId}`);
}
