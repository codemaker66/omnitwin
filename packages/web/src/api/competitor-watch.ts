import { z } from "zod";
import {
  CompetitorNamesSchema,
  CompetitorWatchSchema,
  MarketContextSchema,
  PageCheckRunSchema,
  type CaptureCreateInput,
  type CompetitorCreate,
  type CompetitorNames,
  type CompetitorUpdate,
  type CompetitorWatch,
  type MarketContext,
  type PageCheckRun,
} from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// The competitor watch (routes/competitor-watch.ts): the venue's comp set,
// dated price captures, who won lost deals and the page-change check. Every
// write answers with the watch as it now stands, so the desk shows what is
// true after one round trip.
// ---------------------------------------------------------------------------

export type {
  CaptureCreateInput,
  Competitor,
  CompetitorCapture,
  CompetitorCreate,
  CompetitorNames,
  CompetitorUpdate,
  CompetitorWatch,
  MarketContext,
  MarketContextLine,
  PageCheckRun,
} from "@omnitwin/types";

const AfterWrite = z.object({ watch: CompetitorWatchSchema });
const AfterAdd = AfterWrite.extend({ id: z.string().uuid() });
const AfterChange = AfterWrite.extend({ checkReset: z.boolean() });
const AfterRun = AfterWrite.extend({ run: PageCheckRunSchema });

function base(venueId: string): string {
  return `/venues/${encodeURIComponent(venueId)}/competitor-watch`;
}

export async function getCompetitorWatch(venueId: string, signal?: AbortSignal): Promise<CompetitorWatch> {
  return api.get(base(venueId), CompetitorWatchSchema, signal);
}

/** The set by name, for "who won" when a deal is marked lost. */
export async function getCompetitorNames(venueId: string, signal?: AbortSignal): Promise<CompetitorNames> {
  return api.get(`${base(venueId)}/names`, CompetitorNamesSchema, signal);
}

/** Current figures for one year, beside a suggestion. */
export async function getMarketContext(venueId: string, year: number, signal?: AbortSignal): Promise<MarketContext> {
  return api.get(`${base(venueId)}/context?year=${String(year)}`, MarketContextSchema, signal);
}

export async function startSuggestedSet(venueId: string): Promise<CompetitorWatch> {
  return (await api.post(`${base(venueId)}/suggested`, {}, undefined, AfterWrite)).watch;
}

export async function addCompetitor(venueId: string, body: CompetitorCreate): Promise<{ readonly id: string; readonly watch: CompetitorWatch }> {
  return api.post(base(venueId), body, undefined, AfterAdd);
}

export async function changeCompetitor(venueId: string, competitorId: string, body: CompetitorUpdate): Promise<{ readonly checkReset: boolean; readonly watch: CompetitorWatch }> {
  return api.patch(`${base(venueId)}/${encodeURIComponent(competitorId)}`, body, AfterChange);
}

export async function removeCompetitor(venueId: string, competitorId: string): Promise<CompetitorWatch> {
  return (await api.delete(`${base(venueId)}/${encodeURIComponent(competitorId)}`, AfterWrite)).watch;
}

export async function markReviewed(venueId: string, competitorId: string): Promise<CompetitorWatch> {
  return (await api.post(`${base(venueId)}/${encodeURIComponent(competitorId)}/reviewed`, {}, undefined, AfterWrite)).watch;
}

export async function allowPageCheck(venueId: string, competitorId: string): Promise<CompetitorWatch> {
  return (await api.put(`${base(venueId)}/${encodeURIComponent(competitorId)}/page-check`, { termsRead: true, robotsRead: true }, AfterWrite)).watch;
}

export async function stopPageCheck(venueId: string, competitorId: string): Promise<CompetitorWatch> {
  return (await api.delete(`${base(venueId)}/${encodeURIComponent(competitorId)}/page-check`, AfterWrite)).watch;
}

export async function dismissPageChange(venueId: string, competitorId: string): Promise<CompetitorWatch> {
  return (await api.post(`${base(venueId)}/${encodeURIComponent(competitorId)}/page-change/dismissal`, {}, undefined, AfterWrite)).watch;
}

export async function recordCapture(venueId: string, competitorId: string, body: CaptureCreateInput): Promise<{ readonly id: string; readonly watch: CompetitorWatch }> {
  return api.post(`${base(venueId)}/${encodeURIComponent(competitorId)}/captures`, body, undefined, AfterAdd);
}

export async function markSourceGone(venueId: string, competitorId: string, captureId: string): Promise<CompetitorWatch> {
  return (await api.post(`${base(venueId)}/${encodeURIComponent(competitorId)}/captures/${encodeURIComponent(captureId)}/source-gone`, {}, undefined, AfterWrite)).watch;
}

export async function checkPagesNow(venueId: string): Promise<{ readonly run: PageCheckRun; readonly watch: CompetitorWatch }> {
  return api.post(`${base(venueId)}/page-checks`, {}, undefined, AfterRun);
}
