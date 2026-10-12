import type { IssueFilterInput, IssueSummaryDto, StatusDto } from '@flowdesk/contracts';

export interface BoardColumnDto {
  status: StatusDto;
  issues: IssueSummaryDto[];
  total: number;
  /** The project's own tasks among them: the column's limit is counted against these. */
  ownTotal: number;
  hasMore: boolean;
}

export interface BoardDto {
  columns: BoardColumnDto[];
}

/** The subset of filters the UI exposes; mirrors the server's filter schema. */
export interface IssueFilters {
  search?: string;
  statusId?: string[];
  statusCategory?: string[];
  assigneeId?: string[];
  reporterId?: string[];
  priority?: string[];
  type?: string[];
  labelId?: string[];
  sprintId?: string[];
  projectId?: string[];
  includeDone?: boolean;
  includeSubtasks?: boolean;
  isOverdue?: boolean;
  noSprint?: boolean;
  dueBefore?: string;
  dueAfter?: string;
  overlapsFrom?: string;
  overlapsTo?: string;
  noDates?: boolean;
  /** Only tasks without a deadline — the ones planning has not reached yet. */
  noDueDate?: boolean;
  /** Only tasks nobody has estimated yet. */
  noEstimate?: boolean;
  /**
   * Set by a project's own screens, never by the person: the project's tasks
   * together with those of its subprojects.
   */
  withSubprojects?: boolean;
  /** Finished tasks after the open ones — for a list of every state at once. */
  openFirst?: boolean;
  sort?: IssueFilterInput['sort'];
  order?: IssueFilterInput['order'];
}


/** Count of active filters — drives the "Filters (3)" affordance. */
export function activeFilterCount(filters: IssueFilters): number {
  let count = 0;
  for (const [key, value] of Object.entries(filters)) {
    // `withSubprojects` and `openFirst` are how a screen asks, not something the person filtered by.
    if (key === 'sort' || key === 'order' || key === 'search' || key === 'withSubprojects' || key === 'openFirst') continue;
    if (Array.isArray(value) ? value.length > 0 : value !== undefined && value !== false) count += 1;
  }
  return count;
}

export function filtersToQuery(filters: IssueFilters): Record<string, string | string[] | boolean | undefined> {
  const query: Record<string, string | string[] | boolean | undefined> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length) query[key] = value;
    } else {
      query[key] = value as string | boolean;
    }
  }
  return query;
}
