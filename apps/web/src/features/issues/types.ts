import type { IssueFilterInput, IssueSummaryDto, StatusDto } from '@flowdesk/contracts';

export interface BoardColumnDto {
  status: StatusDto;
  issues: IssueSummaryDto[];
  total: number;
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
  epicId?: string[];
  projectId?: string[];
  includeDone?: boolean;
  includeSubtasks?: boolean;
  isOverdue?: boolean;
  noSprint?: boolean;
  dueBefore?: string;
  dueAfter?: string;
  sort?: IssueFilterInput['sort'];
  order?: IssueFilterInput['order'];
}

export const EMPTY_FILTERS: IssueFilters = {};

/** Count of active filters — drives the "Filters (3)" affordance. */
export function activeFilterCount(filters: IssueFilters): number {
  let count = 0;
  for (const [key, value] of Object.entries(filters)) {
    if (key === 'sort' || key === 'order' || key === 'search') continue;
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
