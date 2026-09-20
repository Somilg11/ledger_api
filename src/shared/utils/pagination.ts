import { config } from '../config/app.config';

export interface Pagination {
  limit: number;
  skip: number;
}

/**
 * Clamps client-supplied paging so a single request cannot ask the database
 * for an unbounded result set.
 */
export function parsePagination(query: Record<string, unknown>): Pagination {
  const rawLimit = Number(query.limit);
  const rawSkip = Number(query.skip);

  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), config.limits.maxPageSize)
    : 50;

  const skip = Number.isFinite(rawSkip) && rawSkip > 0 ? Math.floor(rawSkip) : 0;

  return { limit, skip };
}
