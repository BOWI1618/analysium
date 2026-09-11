import { useMemo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  ChevronsLeft,
  ChevronsRight,
  Home,
  Inbox,
  LayoutGrid,
  Plus,
  Settings,
  Star,
  UserRound,
  Check,
  ChevronDown,
  LogOut,
  Moon,
  Sun,
  Monitor,
  Keyboard,
} from 'lucide-react';
import { useSession } from '~/app/session';
import { useTheme } from '~/app/theme';
import { useUiStore } from '~/app/uiStore';
import { useProjects } from '~/features/projects/hooks';
import { useUnreadCount } from '~/features/notifications/hooks';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '~/ui/Menu';
import { Avatar } from '~/ui/Avatar';
import { CountBadge } from '~/ui/Badge';
import { IconButton } from '~/ui/Button';
import { Tooltip, Kbd } from '~/ui/Tooltip';
import { useRealtime } from '~/app/realtime';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
  collapsed: boolean;
  end?: boolean;
  onClick?: () => void;
}

function NavItem({ to, icon, label, badge, collapsed, end, onClick }: NavItemProps) {
  const link = (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        clsx(
          'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-surface-active text-text'
            : 'text-text-muted hover:bg-surface-hover hover:text-text',
        )
      }
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {badge}
        </>
      )}
    </NavLink>
  );

  return collapsed ? (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, workspace, workspaces, switchWorkspace, logout } = useSession();
  const { mode, setMode } = useTheme();
  const { state: connection } = useRealtime();
  const navigate = useNavigate();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);

  const { data: projects } = useProjects(workspace?.id ?? '');
  const unread = useUnreadCount(workspace?.id ?? '');

  const favorites = useMemo(() => projects?.filter((p) => p.isFavorite) ?? [], [projects]);
  const recent = useMemo(() => (projects ?? []).slice(0, 8), [projects]);

  if (!workspace || !user) return null;

  return (
    <aside
      className={clsx(
        'flex h-full flex-col border-r border-border bg-bg-subtle',
        collapsed ? 'w-14' : 'w-62',
      )}
      style={{ width: collapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)' }}
    >
      {/* Workspace switcher */}
      <div className="flex items-center gap-1 p-2">
        <Menu>
          <MenuTrigger>
            <button
              type="button"
              className={clsx(
                'flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-surface-hover',
                collapsed && 'justify-center px-0',
              )}
            >
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-sm"
                style={{ background: 'var(--accent-subtle)' }}
                aria-hidden="true"
              >
                {workspace.logo ?? workspace.name[0]?.toUpperCase()}
              </span>
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{workspace.name}</span>
                  <ChevronDown className="size-3.5 shrink-0 text-text-subtle" />
                </>
              )}
            </button>
          </MenuTrigger>
          <MenuContent width={240} label="Сменить пространство">
            <MenuLabel>Пространства</MenuLabel>
            {workspaces.map((ws) => (
              <MenuItem
                key={ws.id}
                selected={ws.id === workspace.id}
                onSelect={() => switchWorkspace(ws.id)}
                icon={<span aria-hidden="true">{ws.logo ?? '🗂'}</span>}
              >
                {ws.name}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem icon={<Plus className="size-3.5" />} onSelect={() => navigate('/workspaces/new')}>
              Create workspace
            </MenuItem>
            <MenuItem icon={<Settings className="size-3.5" />} onSelect={() => navigate('/settings/workspace')}>
              Workspace settings
            </MenuItem>
          </MenuContent>
        </Menu>

        {!collapsed && (
          <IconButton label="Свернуть панель" size="sm" onClick={toggleSidebar}>
            <ChevronsLeft className="size-4" />
          </IconButton>
        )}
      </div>

      {collapsed && (
        <div className="flex justify-center pb-1">
          <IconButton label="Развернуть панель" size="sm" onClick={toggleSidebar}>
            <ChevronsRight className="size-4" />
          </IconButton>
        </div>
      )}

      {/* Primary navigation */}
      <nav className="flex flex-col gap-0.5 px-2" aria-label="Основная навигация">
        <NavItem to="/" end icon={<Home className="size-4" />} label="Главная" collapsed={collapsed} onClick={onNavigate} />
        <NavItem
          to="/my-work"
          icon={<UserRound className="size-4" />}
          label="Мои задачи"
          collapsed={collapsed}
          onClick={onNavigate}
        />
        <NavItem
          to="/inbox"
          icon={<Inbox className="size-4" />}
          label="Входящие"
          badge={<CountBadge count={unread} tone="accent" />}
          collapsed={collapsed}
          onClick={onNavigate}
        />
        <NavItem
          to="/projects"
          icon={<LayoutGrid className="size-4" />}
          label="Проекты"
          collapsed={collapsed}
          onClick={onNavigate}
        />
      </nav>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 scrollbar-thin">
        {favorites.length > 0 && !collapsed && (
          <section className="mb-3">
            <h2 className="flex items-center gap-1 px-2 py-1 text-2xs font-semibold tracking-wide text-text-subtle uppercase">
              <Star className="size-3" />
              Избранное
            </h2>
            <div className="flex flex-col gap-0.5">
              {favorites.map((project) => (
                <NavItem
                  key={project.id}
                  to={`/projects/${project.id}`}
                  icon={<span aria-hidden="true">{project.icon}</span>}
                  label={project.name}
                  collapsed={false}
                  onClick={onNavigate}
                />
              ))}
            </div>
          </section>
        )}

        {!collapsed && (
          <section>
            <h2 className="flex items-center justify-between px-2 py-1 text-2xs font-semibold tracking-wide text-text-subtle uppercase">
              Проекты
              <Tooltip content="Новый проект">
                <button
                  type="button"
                  onClick={() => navigate('/projects/new')}
                  aria-label="Новый проект"
                  className="rounded-sm p-0.5 hover:bg-surface-hover hover:text-text"
                >
                  <Plus className="size-3" />
                </button>
              </Tooltip>
            </h2>
            <div className="flex flex-col gap-0.5">
              {recent.map((project) => (
                <NavItem
                  key={project.id}
                  to={`/projects/${project.id}`}
                  icon={<span aria-hidden="true">{project.icon}</span>}
                  label={project.name}
                  collapsed={false}
                  onClick={onNavigate}
                  badge={
                    project.openIssueCount ? (
                      <span className="text-2xs text-text-subtle tabular-nums">{project.openIssueCount}</span>
                    ) : undefined
                  }
                />
              ))}
              {projects?.length === 0 && (
                <p className="px-2 py-2 text-xs text-text-subtle">Проектов пока нет</p>
              )}
            </div>
          </section>
        )}
      </div>

      {/* User menu */}
      <div className="border-t border-border p-2">
        <Menu>
          <MenuTrigger>
            <button
              type="button"
              className={clsx(
                'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-surface-hover',
                collapsed && 'justify-center px-0',
              )}
            >
              <span className="relative">
                <Avatar user={user} size="md" />
                <span
                  className={clsx(
                    'absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-[var(--bg-subtle)]',
                    connection === 'open' ? 'bg-success' : connection === 'connecting' ? 'bg-warning' : 'bg-text-subtle',
                  )}
                  title={
                    connection === 'open'
                      ? 'Обновления в реальном времени'
                      : connection === 'connecting'
                        ? 'Подключаемся…'
                        : 'Нет связи — переподключаемся'
                  }
                />
              </span>
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{user.name}</span>
                  <span className="block truncate text-2xs text-text-subtle">{user.email}</span>
                </span>
              )}
            </button>
          </MenuTrigger>
          <MenuContent side="top" width={230} label="Меню аккаунта">
            <MenuItem icon={<UserRound className="size-3.5" />} onSelect={() => navigate(`/people/${user.id}`)}>
              My profile
            </MenuItem>
            <MenuItem icon={<Settings className="size-3.5" />} onSelect={() => navigate('/settings/account')}>
              Preferences
            </MenuItem>
            <MenuItem
              icon={<Keyboard className="size-3.5" />}
              shortcut={<Kbd>?</Kbd>}
              onSelect={() => setShortcutsOpen(true)}
            >
              Keyboard shortcuts
            </MenuItem>
            <MenuSeparator />
            <MenuLabel>Тема</MenuLabel>
            <MenuItem icon={<Sun className="size-3.5" />} selected={mode === 'light'} onSelect={() => setMode('light')}>
              Light
            </MenuItem>
            <MenuItem icon={<Moon className="size-3.5" />} selected={mode === 'dark'} onSelect={() => setMode('dark')}>
              Dark
            </MenuItem>
            <MenuItem
              icon={<Monitor className="size-3.5" />}
              selected={mode === 'system'}
              onSelect={() => setMode('system')}
            >
              System
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<LogOut className="size-3.5" />}
              danger
              onSelect={() => {
                void logout().then(() => navigate('/login'));
              }}
            >
              Sign out
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </aside>
  );
}

export { Check };
