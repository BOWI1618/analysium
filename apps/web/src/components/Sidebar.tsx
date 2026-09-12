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
  Keyboard,
  Briefcase,
} from 'lucide-react';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useProjects } from '~/features/projects/hooks';
import { useUnreadCount } from '~/features/notifications/hooks';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '~/ui/Menu';
import { Avatar } from '~/ui/Avatar';
import { CountBadge } from '~/ui/Badge';
import { IconButton } from '~/ui/Button';
import { Tooltip, Kbd } from '~/ui/Tooltip';
import { useRealtime } from '~/app/realtime';
import { useToast } from '~/app/toast';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
  /** Rubric number shown on the right when the item carries no badge. */
  index?: string;
  collapsed: boolean;
  end?: boolean;
  onClick?: () => void;
}

function NavItem({ to, icon, label, badge, index, collapsed, end, onClick }: NavItemProps) {
  const link = (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        clsx(
          'group flex items-center gap-2.5 border-2 px-2 py-1.5 text-sm font-bold',
          'transition-[background-color,color,box-shadow] duration-100',
          collapsed && 'justify-center px-0',
          // The current rubric is printed in reverse: ink plate, paper type.
          isActive
            ? 'border-border-strong bg-ink text-text-inverted shadow-sm'
            : 'border-transparent text-text-muted hover:bg-surface-hover hover:text-text',
        )
      }
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {badge ?? (index && <span className="fd-num shrink-0 text-2xs opacity-60">{index}</span>)}
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

/**
 * A project reads as a colour chip in the rail, not as an icon: at 12px a
 * bordered square of the project's own colour is far easier to find again
 * than a glyph, and it keeps the rail on the same hard-edged grammar as the
 * rest of the product.
 */
function ProjectSwatch({ color }: { color?: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="size-3 shrink-0 border-2 border-border-strong"
      style={{ backgroundColor: color || 'var(--accent)' }}
    />
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, workspace, workspaces, switchWorkspace, logout } = useSession();
  const { state: connection } = useRealtime();
  const navigate = useNavigate();
  const toast = useToast();
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
        'flex h-full flex-col border-r-2 border-border-strong bg-bg-subtle',
        collapsed ? 'w-14' : 'w-62',
      )}
      style={{ width: collapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)' }}
    >
      {/* Workspace switcher — the nameplate at the top of the rail */}
      <div className="flex items-center gap-1 border-b-2 border-border-strong p-2.5">
        <Menu>
          <MenuTrigger>
            <button
              type="button"
              className={clsx(
                'flex min-w-0 flex-1 items-center gap-2.5 border-2 border-transparent px-1 py-0.5 text-left hover:border-border-strong hover:bg-surface-hover',
                collapsed && 'justify-center px-0',
              )}
            >
              <span
                className="grid size-7 shrink-0 place-items-center border-2 border-border-strong bg-accent font-display text-xs font-extrabold text-accent-fg shadow-xs"
                aria-hidden="true"
              >
                {workspace.logo ?? workspace.name[0]?.toUpperCase()}
              </span>
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-xs font-extrabold uppercase leading-none">
                      {workspace.name}
                    </span>
                    <span className="fd-num mt-1 block text-[10px] text-text-subtle">пространство</span>
                  </span>
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
                icon={<span aria-hidden="true" className="text-sm">{ws.logo ?? <Briefcase className="size-3.5" />}</span>}
              >
                {ws.name}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem icon={<Plus className="size-3.5" />} onSelect={() => navigate('/workspaces/new')}>
              Создать пространство
            </MenuItem>
            <MenuItem icon={<Settings className="size-3.5" />} onSelect={() => navigate('/settings/workspace')}>
              Настройки пространства
            </MenuItem>
          </MenuContent>
        </Menu>

        {!collapsed && (
          <IconButton label="Свернуть панель" size="sm" variant="secondary" onClick={toggleSidebar}>
            <ChevronsLeft className="size-4" />
          </IconButton>
        )}
      </div>

      {collapsed && (
        <div className="flex justify-center pb-1">
          <IconButton label="Развернуть панель" size="sm" variant="secondary" onClick={toggleSidebar}>
            <ChevronsRight className="size-4" />
          </IconButton>
        </div>
      )}

      {/* Primary navigation — the rubrics of the publication, numbered */}
      <nav className="flex flex-col gap-1 px-3 pt-4" aria-label="Основная навигация">
        {!collapsed && <div className="fd-eyebrow px-2 pb-2">Рубрики</div>}
        <NavItem
          to="/"
          end
          icon={<Home className="size-4" />}
          label="Главная"
          index="01"
          collapsed={collapsed}
          onClick={onNavigate}
        />
        <NavItem
          to="/my-work"
          icon={<UserRound className="size-4" />}
          label="Мои задачи"
          index="02"
          collapsed={collapsed}
          onClick={onNavigate}
        />
        <NavItem
          to="/inbox"
          icon={<Inbox className="size-4" />}
          label="Входящие"
          index="03"
          badge={unread > 0 ? <CountBadge count={unread} tone="accent" /> : undefined}
          collapsed={collapsed}
          onClick={onNavigate}
        />
        <NavItem
          to="/projects"
          // A project you are inside already highlights itself in the list
          // below, so the rubric only lights up on the index itself.
          end
          icon={<LayoutGrid className="size-4" />}
          label="Проекты"
          index="04"
          collapsed={collapsed}
          onClick={onNavigate}
        />
      </nav>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 scrollbar-thin">
        {favorites.length > 0 && !collapsed && (
          <section className="mb-4 border-t-2 border-border-strong pt-3.5">
            <h2 className="fd-eyebrow flex items-center gap-1.5 px-2 pb-2.5">
              <Star className="size-3" />
              Избранное
            </h2>
            <div className="flex flex-col gap-0.5">
              {favorites.map((project) => (
                <NavItem
                  key={project.id}
                  to={`/projects/${project.id}`}
                  icon={<ProjectSwatch color={project.color} />}
                  label={project.name}
                  collapsed={false}
                  onClick={onNavigate}
                />
              ))}
            </div>
          </section>
        )}

        {!collapsed && (
          <section className="border-t-2 border-border-strong pt-3.5">
            <h2 className="fd-eyebrow flex items-center justify-between px-2 pb-2.5">
              Проекты
              <Tooltip content="Новый проект">
                <button
                  type="button"
                  onClick={() => navigate('/projects/new')}
                  aria-label="Новый проект"
                  className="p-0.5 hover:bg-surface-hover hover:text-text"
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
                  icon={<ProjectSwatch color={project.color} />}
                  label={project.name}
                  collapsed={false}
                  onClick={onNavigate}
                  badge={
                    project.openIssueCount ? (
                      <span className="fd-num shrink-0 text-2xs opacity-60">{project.openIssueCount}</span>
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

      {/* User menu — the colophon at the foot of the rail */}
      <div className="border-t-2 border-border-strong p-2.5">
        <Menu>
          <MenuTrigger>
            <button
              type="button"
              className={clsx(
                'flex w-full items-center gap-2.5 border-2 border-transparent px-1 py-0.5 text-left hover:border-border-strong hover:bg-surface-hover',
                collapsed && 'justify-center px-0',
              )}
            >
              <span className="relative">
                <Avatar user={user} size="md" />
                <span
                  className={clsx(
                    'absolute -right-0.5 -bottom-0.5 size-2 ring-2 ring-[var(--bg-subtle)]',
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
                  <span className="block truncate text-sm font-bold">{user.name}</span>
                  <span className="fd-num block truncate text-[10px] text-text-subtle">{user.email}</span>
                </span>
              )}
              {!collapsed && <Settings className="size-3.5 shrink-0 text-text-subtle" />}
            </button>
          </MenuTrigger>
          <MenuContent side="top" width={230} label="Меню аккаунта">
            <MenuItem icon={<UserRound className="size-3.5" />} onSelect={() => navigate(`/people/${user.id}`)}>
              Мой профиль
            </MenuItem>
            <MenuItem icon={<Settings className="size-3.5" />} onSelect={() => navigate('/settings/account')}>
              Настройки
            </MenuItem>
            <MenuItem
              icon={<Keyboard className="size-3.5" />}
              shortcut={<Kbd>?</Kbd>}
              onSelect={() => setShortcutsOpen(true)}
            >
              Горячие клавиши
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<LogOut className="size-3.5" />}
              danger
              onSelect={() => {
                void logout()
                  .catch((error) => toast.error(error, 'Не удалось выйти'))
                  .finally(() => navigate('/login'));
              }}
            >
              Выйти
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </aside>
  );
}

export { Check };
