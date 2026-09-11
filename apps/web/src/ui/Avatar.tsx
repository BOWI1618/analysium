import clsx from 'clsx';
import type { UserSummaryDto } from '@flowdesk/contracts';
import { avatarColor, initials } from '~/lib/format';
import { Tooltip } from './Tooltip';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<AvatarSize, string> = {
  xs: 'size-4 text-[8px]',
  sm: 'size-5 text-[9px]',
  md: 'size-6 text-[10px]',
  lg: 'size-8 text-xs',
  xl: 'size-16 text-lg',
};

export interface AvatarProps {
  user?: Pick<UserSummaryDto, 'id' | 'name' | 'avatarUrl'> | null;
  size?: AvatarSize;
  className?: string;
  /** Renders a dashed placeholder when there is no user (unassigned). */
  showEmpty?: boolean;
  title?: string;
}

export function Avatar({ user, size = 'md', className, showEmpty = true, title }: AvatarProps) {
  if (!user) {
    if (!showEmpty) return null;
    return (
      <span
        className={clsx(
          'inline-flex items-center justify-center rounded-full border border-dashed border-border-strong text-text-subtle',
          SIZES[size],
          className,
        )}
        aria-label={title ?? 'Не назначен'}
        title={title ?? 'Не назначен'}
      >
        <svg viewBox="0 0 24 24" className="size-2/3" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20a7 7 0 0 1 14 0" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  const color = avatarColor(user.id);

  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none overflow-hidden',
        SIZES[size],
        className,
      )}
      style={user.avatarUrl ? undefined : { backgroundColor: color }}
      title={title ?? user.name}
      aria-label={user.name}
    >
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        initials(user.name)
      )}
    </span>
  );
}

export function AvatarWithTooltip({ user, ...props }: AvatarProps) {
  if (!user) return <Avatar user={user} {...props} />;
  return (
    <Tooltip content={user.name}>
      <span className="inline-flex">
        <Avatar user={user} {...props} />
      </span>
    </Tooltip>
  );
}

export interface AvatarGroupProps {
  users: (Pick<UserSummaryDto, 'id' | 'name' | 'avatarUrl'> | null)[];
  max?: number;
  size?: AvatarSize;
}

export function AvatarGroup({ users, max = 4, size = 'md' }: AvatarGroupProps) {
  const real = users.filter((u): u is NonNullable<typeof u> => Boolean(u));
  const shown = real.slice(0, max);
  const overflow = real.length - shown.length;

  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((user) => (
        <AvatarWithTooltip
          key={user.id}
          user={user}
          size={size}
          className="ring-2 ring-[var(--surface)]"
        />
      ))}
      {overflow > 0 && (
        <span
          className={clsx(
            'inline-flex items-center justify-center rounded-full bg-surface-active font-semibold text-text-muted ring-2 ring-[var(--surface)]',
            SIZES[size],
          )}
          title={real
            .slice(max)
            .map((u) => u.name)
            .join(', ')}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
