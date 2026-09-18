/**
 * Russian labels for domain enums.
 *
 * Enum *values* stay English on the wire (they are part of the API contract);
 * only their presentation is localised. Keeping the maps here means a label is
 * written once and every screen — pickers, settings, toasts — agrees.
 */
import type { IssueRecurrence, ProjectRole, StatusCategory, WorkspaceRole } from '@flowdesk/contracts';

export const RECURRENCE_LABEL: Record<IssueRecurrence, string> = {
  DAILY: 'каждый день',
  WEEKDAYS: 'по будням',
  WEEKLY: 'каждую неделю',
  MONTHLY: 'каждый месяц',
};

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

/** What an audit entry records, as a phrase after the actor's name. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  USER_LOGIN: 'вошёл(ла) в систему',
  USER_LOGOUT: 'вышел(ла) из системы',
  USER_REGISTERED: 'зарегистрировался(ась)',
  USER_PASSWORD_SET: 'задал(а) новый пароль',
  WORKSPACE_CREATED: 'создал(а) пространство',
  WORKSPACE_UPDATED: 'изменил(а) пространство',
  WORKSPACE_DELETED: 'удалил(а) пространство',
  MEMBER_INVITED: 'пригласил(а) участника',
  MEMBER_JOINED: 'присоединился(ась) к пространству',
  MEMBER_ROLE_CHANGED: 'сменил(а) роль участника',
  MEMBER_REMOVED: 'убрал(а) участника',
  MEMBER_PASSWORD_RESET: 'сбросил(а) пароль участника',
  PROJECT_CREATED: 'создал(а) проект',
  PROJECT_UPDATED: 'изменил(а) проект',
  PROJECT_ARCHIVED: 'архивировал(а) проект',
  PROJECT_DELETED: 'удалил(а) проект',
  WORKFLOW_UPDATED: 'изменил(а) статусы проекта',
  ISSUE_DELETED: 'удалил(а) задачу',
  SPRINT_STARTED: 'запустил(а) спринт',
  SPRINT_COMPLETED: 'завершил(а) спринт',
};

const AUDIT_FIELD_LABEL: Record<string, string> = {
  name: 'название',
  description: 'описание',
  icon: 'иконка',
  color: 'цвет',
  logo: 'логотип',
  projectType: 'спринты',
  leadId: 'ведущий',
  isArchived: 'архив',
};

/**
 * The details of an audit entry in words — the facts a reader needs, not the
 * stored JSON.
 */
export function describeAuditDetails(action: string, metadata: Record<string, unknown> | null): string {
  if (!metadata) return '';
  const m = metadata as Record<string, string | number | boolean | undefined>;
  const role = (value: unknown) => ROLE_LABEL[value as WorkspaceRole] ?? String(value ?? '');
  const parts: string[] = [];

  if (typeof m.issueKey === 'string') parts.push(m.issueKey);
  if (typeof m.key === 'string' && typeof m.name === 'string' && action === 'PROJECT_CREATED') {
    parts.push(`«${m.name}», ключ ${m.key}`);
  } else if (action === 'PROJECT_UPDATED' || action === 'WORKSPACE_UPDATED') {
    const fields = Object.keys(metadata).map((key) => AUDIT_FIELD_LABEL[key] ?? key);
    if (fields.length) parts.push(`изменено: ${fields.join(', ')}`);
  } else if (typeof m.name === 'string') {
    parts.push(`«${m.name}»`);
  }
  if (typeof m.email === 'string') parts.push(m.email);
  if (m.from !== undefined && m.to !== undefined) parts.push(`${role(m.from)} → ${role(m.to)}`);
  else if (m.role !== undefined) parts.push(`роль: ${role(m.role)}`);
  if (m.via === 'code') parts.push('по коду приглашения');
  if (m.self === true) parts.push('сам(а) покинул(а)');
  if (typeof m.movedCount === 'number' && m.movedCount > 0) parts.push(`незавершённых перенесено: ${m.movedCount}`);
  return parts.join(' · ');
}