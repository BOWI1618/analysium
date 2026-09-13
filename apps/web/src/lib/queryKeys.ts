/**
 * Centralised React Query keys.
 *
 * Keeping them here (rather than inline strings) means an invalidation can
 * target exactly the right subtree, and a renamed key breaks the build instead
 * of silently leaving stale data on screen.
 */
export const qk = {
  session: ['session'] as const,

  workspaces: ['workspaces'] as const,
  workspace: (id: string) => ['workspace', id] as const,
  members: (workspaceId: string) => ['workspace', workspaceId, 'members'] as const,
  inviteCodes: (workspaceId: string) => ['workspace', workspaceId, 'invite-codes'] as const,
  auditLogs: (workspaceId: string) => ['workspace', workspaceId, 'audit'] as const,
  presence: (workspaceId: string) => ['workspace', workspaceId, 'presence'] as const,

  projects: (workspaceId: string) => ['workspace', workspaceId, 'projects'] as const,
  project: (projectId: string) => ['project', projectId] as const,
  labels: (projectId: string) => ['project', projectId, 'labels'] as const,
  sprints: (projectId: string) => ['project', projectId, 'sprints'] as const,
  board: (projectId: string, filters: unknown) => ['project', projectId, 'board', filters] as const,
  dashboard: (projectId: string, days: number) => ['project', projectId, 'dashboard', days] as const,
  /** Root key so every filtered Gantt query for a project invalidates together. */
  ganttRoot: (projectId: string) => ['project', projectId, 'gantt'] as const,
  gantt: (projectId: string, filters: unknown) => ['project', projectId, 'gantt', filters] as const,

  issues: (scope: string, filters: unknown) => ['issues', scope, filters] as const,
  issue: (issueId: string) => ['issue', issueId] as const,
  /**
   * The standalone /issue/:key page resolves by human key, not id, so it reads
   * through a key of its own. `issuesByKey` is the root every such query hangs
   * off — invalidate it whenever an issue changes, or that page keeps showing
   * what it fetched on load.
   */
  issueByKey: (workspaceId: string, issueKey: string | undefined) =>
    ['issue-by-key', workspaceId, issueKey] as const,
  issuesByKey: ['issue-by-key'] as const,
  issueComments: (issueId: string) => ['issue', issueId, 'comments'] as const,
  issueActivity: (issueId: string) => ['issue', issueId, 'activity'] as const,

  notifications: (workspaceId: string, unreadOnly: boolean) =>
    ['workspace', workspaceId, 'notifications', unreadOnly] as const,
  myWork: (workspaceId: string) => ['workspace', workspaceId, 'my-work'] as const,
  search: (workspaceId: string, q: string) => ['workspace', workspaceId, 'search', q] as const,
  views: (workspaceId: string) => ['workspace', workspaceId, 'views'] as const,
  userProfile: (workspaceId: string, userId: string) =>
    ['workspace', workspaceId, 'user', userId] as const,
} as const;

