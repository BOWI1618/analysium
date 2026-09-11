/**
 * Fractional ranking ("LexoRank-lite").
 *
 * Board / backlog ordering is stored as a short base-62 string. Inserting an
 * item between two neighbours only ever writes ONE row, so a drag & drop is a
 * single UPDATE instead of renumbering a column. The same function runs on the
 * client for optimistic reordering, which keeps server and UI in agreement.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = ALPHABET.length; // 62
const MIN_CHAR = ALPHABET[0]!; // '0'
const MAX_CHAR = ALPHABET[BASE - 1]!; // 'z'

function charValue(c: string): number {
  const v = ALPHABET.indexOf(c);
  return v < 0 ? 0 : v;
}

/**
 * Returns a rank strictly between `prev` and `next` (either may be null for
 * "start of list" / "end of list"). Throws if prev >= next.
 */
export function rankBetween(prev: string | null, next: string | null): string {
  const a = prev ?? '';
  const b = next ?? '';

  if (a && b && a >= b) {
    throw new RangeError(`rankBetween: prev (${a}) must sort before next (${b})`);
  }

  let result = '';
  let i = 0;

  for (;;) {
    const ca = i < a.length ? charValue(a[i]!) : 0;
    const cb = i < b.length ? charValue(b[i]!) : BASE;

    if (cb - ca > 1) {
      // Room to fit a character strictly between the two.
      const mid = ca + Math.floor((cb - ca) / 2);
      return result + ALPHABET[mid]!;
    }

    // No gap at this position: copy the lower bound's char and descend.
    result += i < a.length ? a[i]! : MIN_CHAR;
    i += 1;

    // Safety valve — ranks this deep mean the column needs rebalancing.
    if (i > 64) return result + ALPHABET[Math.floor(BASE / 2)]!;
  }
}

/** Evenly spaced ranks for bulk inserts (seeding, sprint import). */
export function initialRanks(count: number): string[] {
  const ranks: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < count; i += 1) {
    prev = rankBetween(prev, null);
    ranks.push(prev);
  }
  return ranks;
}

export const RANK_MIN = MIN_CHAR;
export const RANK_MAX = MAX_CHAR;

/** Rank that sorts after every existing rank in `ranks`. */
export function rankAfterAll(ranks: string[]): string {
  const max = ranks.reduce<string | null>((acc, r) => (acc === null || r > acc ? r : acc), null);
  return rankBetween(max, null);
}

/** Rank that sorts before every existing rank in `ranks`. */
export function rankBeforeAll(ranks: string[]): string {
  const min = ranks.reduce<string | null>((acc, r) => (acc === null || r < acc ? r : acc), null);
  return rankBetween(null, min);
}
