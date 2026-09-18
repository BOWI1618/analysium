import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { IssueFilters } from './types';

const ARRAY_KEYS = new Set([
  'statusId',
  'statusCategory',
  'assigneeId',
  'reporterId',
  'priority',
  'type',
  'labelId',
  'sprintId',
  'epicId',
  'projectId',
]);

const BOOL_KEYS = new Set(['includeDone', 'includeSubtasks', 'isOverdue', 'noSprint']);
const SCALAR_KEYS = new Set(['sort', 'order', 'search']);

const isFilterKey = (key: string) => ARRAY_KEYS.has(key) || BOOL_KEYS.has(key) || SCALAR_KEYS.has(key);

/**
 * Filter state lives in the URL, not in a store.
 *
 * That makes every filtered view shareable by copying the address bar, keeps
 * back/forward working, and means a page reload lands you exactly where you
 * were — none of which is true for filters held in memory.
 */
export function useFilterState(defaults: IssueFilters = {}): [IssueFilters, (next: IssueFilters) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo<IssueFilters>(() => {
    const result: IssueFilters = { ...defaults };

    for (const [key, value] of searchParams.entries()) {
      if (!value) continue;
      if (ARRAY_KEYS.has(key)) {
        (result as Record<string, unknown>)[key] = value.split(',').filter(Boolean);
      } else if (BOOL_KEYS.has(key)) {
        (result as Record<string, unknown>)[key] = value === 'true';
      } else if (SCALAR_KEYS.has(key)) {
        (result as Record<string, unknown>)[key] = value;
      }
    }

    return result;
    // `defaults` is a literal at every call site; re-reading it per render is
    // cheaper than asking callers to memoise it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const setFilters = useCallback(
    (next: IssueFilters) => {
      // Parameters the filters do not own (a page's tab, say) survive a
      // filter change; only the filter keys are rewritten.
      setSearchParams(
        (current) => {
          const params = new URLSearchParams();
          for (const [key, value] of current.entries()) {
            if (!isFilterKey(key)) params.set(key, value);
          }
          for (const [key, value] of Object.entries(next)) {
            if (value === undefined || value === null || value === '') continue;
            if (Array.isArray(value)) {
              if (value.length) params.set(key, value.join(','));
            } else {
              params.set(key, String(value));
            }
          }
          return params;
        },
        // Replace rather than push: typing in the filter box must not fill history.
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [filters, setFilters];
}
