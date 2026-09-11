/**
 * Opaque cursor helpers. A cursor is base64url of `${sortValue}|${id}`; the id
 * tiebreaker guarantees a total order so pages never repeat or skip rows.
 */
export interface Cursor {
  value: string;
  id: string;
}

export function encodeCursor(value: string | number | Date | null, id: string): string {
  const raw = value instanceof Date ? value.toISOString() : String(value ?? '');
  return Buffer.from(`${raw}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): Cursor | null {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = decoded.lastIndexOf('|');
    if (sep < 0) return null;
    return { value: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
  } catch {
    return null;
  }
}

/** Fetches `limit + 1` rows to detect a next page without a COUNT query. */
export function slicePage<T>(rows: T[], limit: number): { items: T[]; hasMore: boolean } {
  if (rows.length > limit) return { items: rows.slice(0, limit), hasMore: true };
  return { items: rows, hasMore: false };
}
