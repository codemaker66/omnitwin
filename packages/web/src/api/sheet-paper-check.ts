import {
  SheetPaperCheckResultSchema,
  isIssuedPaperQuery,
  type SheetPaperCheckQuery,
  type SheetPaperCheckResult,
} from "@omnitwin/types";
import { api } from "./client.js";

/**
 * Ask whether a printed hallkeeper sheet is current. Public: no sign-in, and
 * the answer is version state only (packages/api/src/routes/public-sheet-check.ts).
 * Only the link's own identifiers are sent; the paper's printed time stays here.
 */
export function checkSheetPaper(query: SheetPaperCheckQuery, signal?: AbortSignal): Promise<SheetPaperCheckResult> {
  const params = new URLSearchParams(isIssuedPaperQuery(query)
    ? { s: query.s, v: String(query.v), h: query.h }
    : { c: query.c });
  return api.get(`/public/sheet-check?${params.toString()}`, SheetPaperCheckResultSchema, signal);
}
