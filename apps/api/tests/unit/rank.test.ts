import { describe, expect, it } from 'vitest';
import { initialRanks, rankAfterAll, rankBeforeAll, rankBetween } from '@flowdesk/contracts';

describe('rankBetween', () => {
  it('produces a rank that sorts between its neighbours', () => {
    const a = rankBetween(null, null);
    const b = rankBetween(a, null);
    const mid = rankBetween(a, b);
    expect(a < mid).toBe(true);
    expect(mid < b).toBe(true);
  });

  it('prepends before an existing first item', () => {
    const first = rankBetween(null, null);
    const before = rankBetween(null, first);
    expect(before < first).toBe(true);
  });

  it('appends after an existing last item', () => {
    const last = rankBetween(null, null);
    const after = rankBetween(last, null);
    expect(after > last).toBe(true);
  });

  it('rejects neighbours given in the wrong order', () => {
    const a = rankBetween(null, null);
    const b = rankBetween(a, null);
    expect(() => rankBetween(b, a)).toThrow(RangeError);
  });

  it('survives repeated insertion at the same position', () => {
    // Dragging into the same gap 200 times must keep producing distinct,
    // correctly ordered keys rather than colliding.
    let low = rankBetween(null, null);
    const high = rankBetween(low, null);
    const seen = new Set<string>([low, high]);

    for (let i = 0; i < 200; i += 1) {
      const next = rankBetween(low, high);
      expect(low < next).toBe(true);
      expect(next < high).toBe(true);
      expect(seen.has(next)).toBe(false);
      seen.add(next);
      low = next;
    }
  });

  it('keeps a whole column ordered after arbitrary moves', () => {
    const column = initialRanks(10).map((rank, index) => ({ id: `i${index}`, rank }));

    // Move the last card to the top, then the first to the middle.
    const first = column[0]!;
    const last = column[column.length - 1]!;
    last.rank = rankBetween(null, first.rank);

    const sorted = [...column].sort((x, y) => (x.rank < y.rank ? -1 : 1));
    expect(sorted[0]!.id).toBe(last.id);

    const middleBefore = sorted[4]!;
    const middleAfter = sorted[5]!;
    first.rank = rankBetween(middleBefore.rank, middleAfter.rank);

    const resorted = [...column].sort((x, y) => (x.rank < y.rank ? -1 : 1));
    expect(resorted.map((c) => c.id)).toContain(first.id);
    expect(new Set(resorted.map((c) => c.rank)).size).toBe(column.length);
  });
});

describe('initialRanks', () => {
  it('returns strictly ascending, unique keys', () => {
    const ranks = initialRanks(50);
    expect(ranks).toHaveLength(50);
    expect(new Set(ranks).size).toBe(50);
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i - 1]! < ranks[i]!).toBe(true);
    }
  });

  it('returns an empty list for a count of zero', () => {
    expect(initialRanks(0)).toEqual([]);
  });
});

describe('rankAfterAll / rankBeforeAll', () => {
  it('sorts outside every existing rank regardless of input order', () => {
    const ranks = initialRanks(5);
    const shuffled = [ranks[3]!, ranks[0]!, ranks[4]!, ranks[1]!, ranks[2]!];

    const after = rankAfterAll(shuffled);
    const before = rankBeforeAll(shuffled);

    for (const rank of ranks) {
      expect(after > rank).toBe(true);
      expect(before < rank).toBe(true);
    }
  });

  it('handles an empty column', () => {
    expect(rankAfterAll([])).toBeTruthy();
    expect(rankBeforeAll([])).toBeTruthy();
  });
});
