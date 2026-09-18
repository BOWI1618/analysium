import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import type { ActivityDto, IssueSummaryDto, UserDto, WorkspaceRole } from '@flowdesk/contracts';
import { useState } from 'react';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { Topbar } from '~/components/Topbar';
import { IssueRow, DEFAULT_COLUMNS } from '~/components/IssueRow';
import { Avatar } from '~/ui/Avatar';
import { Badge } from '~/ui/Badge';
import { EmptyState, ErrorState, Skeleton } from '~/ui/Feedback';
import { fullDate, relativeTime } from '~/lib/format';
import { ROLE_LABEL } from '~/lib/labels';

interface ProfileResponse {
  user: UserDto & { createdAt: string };
  role: string;
  joinedAt: string;
  stats: { assigned: number; created: number; completed: number };
  assignedIssues: IssueSummaryDto[];
  createdIssues: IssueSummaryDto[];
  activity: (Pick<ActivityDto, 'id' | 'type' | 'field' | 'fromValue' | 'toValue' | 'createdAt'> & {
    issue: { id: string; issueKey: string; title: string };
  })[];
}

const TABS = ['assigned', 'created', 'activity'] as const;

const TAB_LABEL: Record<(typeof TABS)[number], string> = {
  assigned: 'Назначено',
  created: 'Создано',
  activity: 'История',
};
type Tab = (typeof TABS)[number];

export function ProfilePage() {
  const { userId = '' } = useParams();
  const { workspace, user: currentUser } = useSession();
  const openIssue = useUiStore((s) => s.openIssue);
  const [tab, setTab] = useState<Tab>('assigned');

  const workspaceId = workspace?.id ?? '';
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.userProfile(workspaceId, userId),
    queryFn: () => api.get<ProfileResponse>(`/workspaces/${workspaceId}/users/${userId}`),
    enabled: Boolean(workspaceId && userId),
  });

  const isMe = currentUser?.id === userId;

  return (
    <>
      <Topbar breadcrumbs={[{ label: isMe ? 'Мой профиль' : (data?.user.name ?? 'Профиль') }]} />

      <div className="min-h-0 flex-1 overflow-y-auto bg-bg scrollbar-thin">
        <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
          {error ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : isLoading || !data ? (
            <>
              <Skeleton className="h-28" />
              <Skeleton className="h-64" />
            </>
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-4 border-2 border-border-strong bg-surface p-4 shadow-lg">
                <Avatar user={data.user} size="xl" />
                <div className="min-w-0 flex-1">
                  <h1 className="fd-display text-[clamp(1.25rem,2vw,1.75rem)]">{data.user.name}</h1>
                  <p className="text-sm text-text-muted">{data.user.email}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge tone={data.role === 'OWNER' ? 'accent' : 'neutral'}>{ROLE_LABEL[data.role as WorkspaceRole]}</Badge>
                    <span className="fd-num text-2xs text-text-subtle" title={fullDate(data.joinedAt)}>
                      В команде {relativeTime(data.joinedAt)}
                    </span>
                    {data.user.lastActiveAt && (
                      <span className="fd-num text-2xs text-text-subtle">
                        Был(а) {relativeTime(data.user.lastActiveAt)}
                      </span>
                    )}
                    <span className="text-2xs text-text-subtle">{data.user.timezone}</span>
                  </p>
                </div>

                <dl className="flex gap-2">
                  {[
                    ['Открыто', data.stats.assigned],
                    ['Создано', data.stats.created],
                    ['Завершено', data.stats.completed],
                  ].map(([label, value]) => (
                    <div
                      key={label as string}
                      className="border-2 border-border-strong bg-surface-sunken px-3 py-1.5 text-center shadow-sm"
                    >
                      <dd className="fd-num text-xl font-semibold">{value}</dd>
                      <dt className="text-2xs text-text-subtle">{label}</dt>
                    </div>
                  ))}
                </dl>
              </header>

              <div className="flex items-center gap-1 border-b-2 border-border-strong">
                {TABS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTab(item)}
                    aria-selected={tab === item}
                    role="tab"
                    className={clsx(
                      '-mb-0.5 border-b-2 px-3 py-1.5 text-sm font-bold transition-colors',
                      tab === item ? 'border-accent text-text' : 'border-transparent text-text-muted hover:text-text',
                    )}
                  >
                    {TAB_LABEL[item]}
                  </button>
                ))}
              </div>

              <div className="border-2 border-border-strong bg-surface shadow-sm">
                {tab === 'activity' ? (
                  data.activity.length === 0 ? (
                    <EmptyState compact title="Истории пока нет" />
                  ) : (
                    <ul className="divide-y-2 divide-border-strong">
                      {data.activity.map((event) => (
                        <li key={event.id}>
                          <button
                            type="button"
                            onClick={() => openIssue(event.issue.id)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover"
                          >
                            <span className="fd-key shrink-0" style={{ width: 'var(--key-rail)' }}>
                              {event.issue.issueKey}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm">{event.issue.title}</span>
                            <span className="hidden text-2xs text-text-subtle sm:inline">
                              {event.type.replace(/_/g, ' ').toLowerCase()}
                            </span>
                            <span className="fd-num shrink-0 text-2xs text-text-subtle">
                              {relativeTime(event.createdAt)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )
                ) : (
                  (() => {
                    const issues = tab === 'assigned' ? data.assignedIssues : data.createdIssues;
                    if (issues.length === 0) {
                      return (
                        <EmptyState
                          compact
                          title={tab === 'assigned' ? 'Ничего не назначено' : 'Задач не создавал(а)'}
                          description={
                            tab === 'assigned'
                              ? 'На этого человека нет открытых задач.'
                              : 'Этот человек пока не создавал задачи.'
                          }
                        />
                      );
                    }
                    return issues.map((issue) => (
                      <IssueRow
                        key={issue.id}
                        issue={issue}
                        columns={[...DEFAULT_COLUMNS, 'project']}
                        selected={false}
                        onToggleSelect={() => undefined}
                selectable={false}
                        onOpen={() => openIssue(issue.id)}
                      />
                    ));
                  })()
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
