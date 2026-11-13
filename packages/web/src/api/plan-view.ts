import { z } from "zod";
import {
  IssuedPlanViewLinkSchema,
  PlanViewLinkSchema,
  PlanViewSchema,
  type IssuedPlanViewLink,
  type PlanView,
  type PlanViewLink,
} from "@omnitwin/types";
import { API_URL } from "../config/env.js";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// View-only links to a visitor's plan (fix-first item 11).
//
// The organiser's browser makes, lists and stops links with the plan's id,
// which it already holds; no account is involved, so no credentials are
// sent. A recipient's page reads the plan through the token alone. The
// planner address (the id, the short code) never goes into a link.
// ---------------------------------------------------------------------------

const encode = encodeURIComponent;

/** Make a link. The answer is the only time the token is ever seen. */
export function createPlanViewLink(configId: string): Promise<IssuedPlanViewLink> {
  return api.post(`/public/configurations/${encode(configId)}/view-tokens`, undefined, true, IssuedPlanViewLinkSchema);
}

/** The plan's working links, newest first; their tokens are not stored. */
export function listPlanViewLinks(configId: string, signal?: AbortSignal): Promise<PlanViewLink[]> {
  return api.get(`/public/configurations/${encode(configId)}/view-tokens`, z.array(PlanViewLinkSchema), signal);
}

/** Stop a link; whoever holds it then sees that it is not working. */
export async function stopPlanViewLink(configId: string, linkId: string): Promise<void> {
  await api.post(`/public/configurations/${encode(configId)}/view-tokens/${encode(linkId)}/revoke`, undefined, true);
}

/** The plan a recipient's link shows. */
export function fetchPlanView(token: string, signal?: AbortSignal): Promise<PlanView> {
  return api.get(`/public/plan-views/${encode(token)}`, PlanViewSchema, signal);
}

/** The page a recipient opens, on this site. */
export function planViewPageUrl(token: string, origin: string = window.location.origin): string {
  return `${origin}/plan-view/${encode(token)}`;
}

/** The same plan as a one-page PDF, straight from the API. */
export function planViewPdfUrl(token: string): string {
  return `${API_URL}/public/plan-views/${encode(token)}/plan.pdf`;
}
