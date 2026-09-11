import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Bell, CheckCheck, Inbox } from 'lucide-react';
import type { NotificationDto } from '@flowdesk/contracts';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from '~/features/notifications/hooks';
import { Popover } from '~/ui/Popover';
import { Avatar } from '~/ui/Avatar';
import { CountBadge } from '~/ui/Badge';
import { EmptyState, SkeletonText } from '~/ui/Feedback';
import { relativeTime } from '~/lib/format';

const TYPE_LABEL: Record<string, string> = {
  ISSUE_ASSIGNED: 'Назначено',
  ISSUE_MENTIONED: 'Упоминание',
  ISSUE_STATUS_CHANGED: 'Статус',
  ISSUE_COMMENTED: 'Комментарий',
  ISSUE_DUE_SOON: 'Скоро срок',
  ISSUE_DUE_DATE_CHANGED: 'Срок',
  ISSUE_UNASSIGNED: 'Снято назначение',
  SPRINT_STARTED: 'Спринт',
  SPRINT_COMPLETED: 'Спринт',
};

export function NotificationBell() {
  const { workspace } = useSession();
  const workspaceId = workspace?.id ?? '';
  const unread = useUnreadCount(workspaceId);

  return (
    <Popover
      width={380}
      align="end"
      label="Уведомления"
      className="p-0"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={unread > 0 ? `Уведомления, ${unread} непрочитанных` : 'Уведомления'}
          className="relative inline-flex size-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 flex size-2 rounded-full bg-accent ring-2 ring-[var(--surface)]" />
          )}
        </button>
      )}
    >
      {({ close }) => <NotificationList workspaceId={workspaceId} onNavigate={close} />}
    </Popover>
  );
}

export function NotificationList({
  workspaceId,
  onNavigate,
  maxHeight = 'max-h-[26rem]',
}: {
  workspaceId: string;
  onNavigate?: () => void;
  maxHeight?: string;
}) {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useNotifications(workspaceId);
  const markRead = useMarkRead(workspaceId);
  const markAllRead = useMarkAllRead(workspaceId);
  const openIssue = useUiStore((s) => s.openIssue);
  const navigate = useNavigate();

  const items = data?.pages.flatMap((page) => page.items) ?? [];
  const unread = data?.pages[0]?.unreadCount ?? 0;

  const handleClick = (notification: NotificationDto) => {
    if (!notification.readAt) markRead.mutate(notification.id);
    if (notification.issue) {
      openIssue(notification.issue.id);
    } else {
      navigate('/inbox');
    }
    onNavigate?.();
  };

  return (
    <div className="flex flex-col">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          Уведомления
          <CountBadge count={unread} tone="accent" />
        </h2>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => markAllRead.mutate()}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-text-muted hover:bg-surface-hover hover:text-text"
          >
            <CheckCheck className="size-3.5" />
            Прочитать все
          </button>
        )}
      </header>

      <div className={clsx('overflow-y-auto scrollbar-thin', maxHeight)}>
        {isLoading ? (
          <div className="p-3">
            <SkeletonText lines={5} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            compact
            icon={<Inbox className="size-4" />}
            title="Всё прочитано"
            description="Здесь появятся упоминания, назначения и смены статусов."
          />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((notification) => (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => handleClick(notification)}
                  className={clsx(
                    'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover',
                    !notification.readAt && 'bg-accent-subtle/40',
                  )}
                >
                  <Avatar user={notification.actor} size="md" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-text">{notification.title}</span>
                      {!notification.readAt && <span className="size-1.5 shrink-0 rounded-full bg-accent" />}
                    </p>
                    {notification.body && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{notification.body}</p>
                    )}
                    <p className="mt-1 flex items-center gap-1.5 text-2xs text-text-subtle">
                      <span className="rounded-full bg-surface-active px-1.5 py-px">
                        {TYPE_LABEL[notification.type] ?? 'Обновление'}
                      </span>
                      {relativeTime(notification.createdAt)}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {hasNextPage && (
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            className="w-full py-2 text-xs text-text-muted hover:bg-surface-hover disabled:opacity-50"
          >
            {isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'}
          </button>
        )}
      </div>
    </div>
  );
}
