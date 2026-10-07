import type { SavedViewDisplay, SavedViewDto } from '@flowdesk/contracts';

/**
 * What a page shows right now, in the shape a view is stored in: the filters,
 * and whatever else the page keeps — whose tasks, which period, the columns.
 */
export interface ViewState {
  filters: Record<string, unknown>;
  display?: SavedViewDisplay | null;
}

const isEmpty = (value: unknown) =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

/** The same object with empty entries dropped and keys in order, so two equal states print the same. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => !isEmpty(entry))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

/** Whether a page already shows exactly what a view holds — that view is then marked as the current one. */
export function sameViewState(a: ViewState, b: ViewState): boolean {
  const print = (state: ViewState) =>
    JSON.stringify([canonical(state.filters ?? {}), canonical(state.display ?? {})]);
  return print(a) === print(b);
}

/**
 * A view as an address: the page's own parameters, then the filters, written
 * the way the filter bar writes them. Every list that spans projects keeps its
 * whole state there, so opening a view is opening an address.
 */
export function viewSearchParams(view: Pick<SavedViewDto, 'filters' | 'display'>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(view.display?.params ?? {})) {
    if (value) params.set(key, value);
  }
  for (const [key, value] of Object.entries(view.filters ?? {})) {
    if (isEmpty(value)) continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return params;
}

/** The parameters of an address that are the page's own, not the filter bar's. */
export function pageParams(searchParams: URLSearchParams, keys: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value) result[key] = value;
  }
  return result;
}

/** Where a view opens, for links from outside its page (the command palette). */
export function viewPath(view: SavedViewDto): string | null {
  const search = viewSearchParams(view).toString();
  const withSearch = (path: string) => (search ? `${path}?${search}` : path);
  switch (view.layout) {
    case 'LIST':
      return view.projectId ? withSearch(`/projects/${view.projectId}/list`) : null;
    case 'BOARD':
      return view.projectId ? withSearch(`/projects/${view.projectId}/board`) : null;
    case 'CALENDAR':
      return view.projectId ? withSearch(`/projects/${view.projectId}/calendar`) : null;
    case 'MY_WORK':
      return withSearch('/my-work');
    case 'EMPLOYEE':
      return withSearch('/employee-work');
    case 'PLANNING':
      return withSearch('/planning');
    case 'DEPARTMENT':
      return withSearch('/department-work');
    default:
      return null;
  }
}
