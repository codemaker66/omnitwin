import { z } from "zod";

// ---------------------------------------------------------------------------
// Pagination — parse query params, format response envelope
// ---------------------------------------------------------------------------

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export interface PaginatedResponse<T> {
  readonly data: readonly T[];
  readonly meta: {
    readonly total: number;
    readonly limit: number;
    readonly offset: number;
  };
}

/** Wraps a data array + total count into the paginated envelope. */
export function paginate<T>(
  data: readonly T[],
  total: number,
  query: PaginationQuery,
): PaginatedResponse<T> {
  return {
    data,
    meta: { total, limit: query.limit, offset: query.offset },
  };
}
