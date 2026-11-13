import {
  VenueOperatingSettingsSchema,
  type UpdateVenueOperatingSettings,
  type VenueOperatingSettings,
} from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// The venue's operating settings (goal 19 S7): windows, quiet hours, the
// duty admin, the wall's day boundary. Null when the venue has set none.
// ---------------------------------------------------------------------------

const MaybeSettings = VenueOperatingSettingsSchema.nullable();

export async function getOperatingSettings(venueId: string, signal?: AbortSignal): Promise<VenueOperatingSettings | null> {
  return api.get(`/venues/${encodeURIComponent(venueId)}/operating-settings`, MaybeSettings, signal);
}

export async function updateOperatingSettings(venueId: string, patch: UpdateVenueOperatingSettings): Promise<VenueOperatingSettings> {
  return api.patch(`/venues/${encodeURIComponent(venueId)}/operating-settings`, patch, VenueOperatingSettingsSchema);
}
