import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Venue {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly address: string;
}

export interface Space {
  readonly id: string;
  readonly venueId: string;
  readonly name: string;
  readonly slug: string;
  readonly widthM: string;
  readonly lengthM: string;
  readonly heightM: string;
  readonly loadoutCount?: number;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function listVenues(): Promise<Venue[]> {
  return api.get<Venue[]>("/venues");
}

export async function listSpaces(venueId: string): Promise<Space[]> {
  return api.get<Space[]>(`/venues/${venueId}/spaces`);
}

export async function getSpace(venueId: string, spaceId: string): Promise<Space> {
  return api.get<Space>(`/venues/${venueId}/spaces/${spaceId}`);
}
