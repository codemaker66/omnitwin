import { z } from "zod";
import { FloorPlanPointSchema, type FloorPlanPoint } from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Response schemas — Zod validation at the API boundary.
//
// Venue/Space responses parsed from server JSON are validated before reaching
// the dashboard and editor. widthM/lengthM/heightM stay strings (DB numeric
// columns serialised as strings). FloorPlanPointSchema is reused from
// @omnitwin/types. Request inputs stay plain interfaces — they are outbound
// payloads composed by application code, and on create/update the API accepts
// the polygon only.
// ---------------------------------------------------------------------------

const VenueSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  address: z.string(),
  logoUrl: z.string().nullable(),
  brandColour: z.string().nullable(),
});

export type Venue = z.infer<typeof VenueSchema>;

const SpaceSchema = z.object({
  id: z.string(),
  venueId: z.string(),
  name: z.string(),
  slug: z.string(),
  widthM: z.string(),
  lengthM: z.string(),
  heightM: z.string(),
  floorPlanOutline: z.array(FloorPlanPointSchema),
  loadoutCount: z.number().optional(),
});

export type Space = z.infer<typeof SpaceSchema>;

const VenueDetailSchema = VenueSchema.extend({
  spaces: z.array(SpaceSchema),
});

export type VenueDetail = z.infer<typeof VenueDetailSchema>;

export interface UpdateVenueInput {
  readonly name?: string;
  readonly address?: string;
  readonly logoUrl?: string | null;
  readonly brandColour?: string | null;
}

export interface CreateVenueInput {
  readonly name: string;
  readonly slug: string;
  readonly address: string;
}

export interface CreateSpaceInput {
  readonly name: string;
  readonly slug: string;
  readonly heightM: number;
  readonly floorPlanOutline: readonly FloorPlanPoint[];
}

export interface UpdateSpaceInput {
  readonly name?: string;
  readonly heightM?: number;
  readonly floorPlanOutline?: readonly FloorPlanPoint[];
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function listVenues(): Promise<Venue[]> {
  return api.get("/venues", z.array(VenueSchema));
}

export async function getVenue(venueId: string): Promise<VenueDetail> {
  return api.get(`/venues/${venueId}`, VenueDetailSchema);
}

export async function updateVenue(venueId: string, data: UpdateVenueInput): Promise<Venue> {
  return api.patch(`/venues/${venueId}`, data, VenueSchema);
}

export async function createVenue(data: CreateVenueInput): Promise<Venue> {
  return api.post("/venues", data, undefined, VenueSchema);
}

export async function createSpace(venueId: string, data: CreateSpaceInput): Promise<Space> {
  return api.post(`/venues/${venueId}/spaces`, data, undefined, SpaceSchema);
}

export async function listSpaces(venueId: string): Promise<Space[]> {
  return api.get(`/venues/${venueId}/spaces`, z.array(SpaceSchema));
}

export async function getSpace(venueId: string, spaceId: string): Promise<Space> {
  return api.get(`/venues/${venueId}/spaces/${spaceId}`, SpaceSchema);
}

export async function updateSpace(venueId: string, spaceId: string, data: UpdateSpaceInput): Promise<Space> {
  return api.patch(`/venues/${venueId}/spaces/${spaceId}`, data, SpaceSchema);
}

export async function deleteSpace(venueId: string, spaceId: string): Promise<void> {
  await api.delete(`/venues/${venueId}/spaces/${spaceId}`);
}

export async function deleteVenue(venueId: string): Promise<void> {
  await api.delete(`/venues/${venueId}`);
}
