import {
  CreateRevenueScenarioSchema,
  PipelineSummarySchema,
  RevenueScenarioBundleSchema,
  RevenueSummarySchema,
  RoomUtilisationRowSchema,
  VenueDashboardAnalyticsSchema,
  type CreateRevenueScenario,
  type PipelineSummary,
  type RevenueScenarioBundle,
  type RevenueSummary,
  type RoomUtilisationRow,
  type VenueDashboardAnalytics,
} from "@omnitwin/types";
import { api } from "./client.js";

const RoomUtilisationRowsSchema = RoomUtilisationRowSchema.array();

export async function createRevenueScenario(input: CreateRevenueScenario): Promise<RevenueScenarioBundle> {
  const body = CreateRevenueScenarioSchema.parse(input);
  return api.post<RevenueScenarioBundle>("/revenue-scenarios", body, false, RevenueScenarioBundleSchema);
}

export async function getEventRevenueSummary(eventId: string): Promise<RevenueSummary> {
  return api.get<RevenueSummary>(`/events/${eventId}/revenue-summary`, RevenueSummarySchema);
}

export async function getVenueDashboardAnalytics(venueId?: string): Promise<VenueDashboardAnalytics> {
  const query = venueId === undefined ? "" : `?venueId=${encodeURIComponent(venueId)}`;
  return api.get<VenueDashboardAnalytics>(`/analytics/venue-dashboard${query}`, VenueDashboardAnalyticsSchema);
}

export async function getPipelineSummary(venueId?: string): Promise<PipelineSummary> {
  const query = venueId === undefined ? "" : `?venueId=${encodeURIComponent(venueId)}`;
  return api.get<PipelineSummary>(`/analytics/pipeline-summary${query}`, PipelineSummarySchema);
}

export async function getRoomUtilisation(venueId?: string): Promise<readonly RoomUtilisationRow[]> {
  const query = venueId === undefined ? "" : `?venueId=${encodeURIComponent(venueId)}`;
  return api.get<readonly RoomUtilisationRow[]>(`/analytics/room-utilisation${query}`, RoomUtilisationRowsSchema);
}
