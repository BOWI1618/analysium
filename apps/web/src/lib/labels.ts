/**
 * Russian labels for domain enums.
 *
 * Enum *values* stay English on the wire (they are part of the API contract);
 * only their presentation is localised. Keeping the maps here means a label is
 * written once and every screen — pickers, settings, toasts — agrees.
 */
import type { ProjectRole, StatusCategory, WorkspaceRole } from '@flowdesk/contracts';

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  OWNER: 'владелец',
  ADMIN: 'администратор',
  MEMBER: 'участник',
  GUEST: 'гость',
};

export const PROJECT_ROLE_LABEL: Record<ProjectRole, string> = {
  LEAD: 'ведущий',
  CONTRIBUTOR: 'участник',
  VIEWER: 'наблюдатель',
};

export const STATUS_CATEGORY_LABEL: Record<StatusCategory, string> = {
  BACKLOG: 'бэклог',
  UNSTARTED: 'к выполнению',
  STARTED: 'в работе',
  COMPLETED: 'завершено',
  CANCELED: 'отменено',
};
