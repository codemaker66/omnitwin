import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlacedObject {
  readonly id: string;
  readonly configurationId: string;
  readonly assetDefinitionId: string;
  readonly positionX: string;
  readonly positionY: string;
  readonly positionZ: string;
  readonly rotationX: string;
  readonly rotationY: string;
  readonly rotationZ: string;
  readonly scale: string;
  readonly sortOrder: number;
  readonly metadata: unknown;
}

export interface Configuration {
  readonly id: string;
  readonly spaceId: string;
  readonly venueId: string;
  readonly userId: string | null;
  readonly name: string;
  readonly isPublicPreview: boolean;
  readonly objects?: readonly PlacedObject[];
}

export interface BatchObjectInput {
  readonly id?: string;
  readonly assetDefinitionId: string;
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly rotationX: number;
  readonly rotationY: number;
  readonly rotationZ: number;
  readonly scale: number;
  readonly sortOrder: number;
}

// ---------------------------------------------------------------------------
// Public endpoints (no auth)
// ---------------------------------------------------------------------------

export async function createPublicConfig(spaceId: string, name?: string): Promise<Configuration> {
  return api.post<Configuration>("/public/configurations", { spaceId, name }, true);
}

export async function publicBatchSave(configId: string, objects: readonly BatchObjectInput[]): Promise<PlacedObject[]> {
  return api.post<PlacedObject[]>(`/public/configurations/${configId}/objects/batch`, { objects }, true);
}

export async function getPublicConfig(configId: string): Promise<Configuration> {
  return api.get<Configuration>(`/public/configurations/${configId}`);
}

// ---------------------------------------------------------------------------
// Authenticated endpoints
// ---------------------------------------------------------------------------

export async function getConfig(configId: string): Promise<Configuration> {
  return api.get<Configuration>(`/configurations/${configId}`);
}

export async function claimConfig(configId: string): Promise<Configuration> {
  return api.post<Configuration>(`/configurations/${configId}/claim`);
}

export async function authBatchSave(configId: string, objects: readonly BatchObjectInput[]): Promise<PlacedObject[]> {
  return api.post<PlacedObject[]>(`/configurations/${configId}/objects/batch`, { objects });
}

// ---------------------------------------------------------------------------
// Guest enquiry
// ---------------------------------------------------------------------------

export interface GuestEnquiryInput {
  readonly configurationId: string;
  readonly email: string;
  readonly phone?: string;
  readonly name?: string;
  readonly eventDate?: string;
  readonly eventType?: string;
  readonly guestCount?: number;
  readonly message?: string;
}

export interface GuestEnquiryResponse {
  readonly enquiryId: string;
  readonly message: string;
}

export async function submitGuestEnquiry(input: GuestEnquiryInput): Promise<GuestEnquiryResponse> {
  return api.post<GuestEnquiryResponse>("/public/enquiries", input, true);
}
