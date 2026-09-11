import { Link, useLocation } from 'react-router-dom';
import { Menu as MenuIcon, Plus, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { useUiStore } from '~/app/uiStore';
import { Button, IconButton } from '~/ui/Button';
import { Kbd } from '~/ui/Tooltip';
import { NotificationBell } from './NotificationCenter';

export interface Crumb {
  label: string;
  to?: string;
  icon?: ReactNode;
}

export function Topbar({ breadcrumbs, actions }: { breadcrumbs: Crumb[]; actions?: ReactNode }) {
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const openCreateIssue = useUiStore((s) => s.openCreateIssue);
  const location = useLocation();
  // `/projects/new` is a route, not a project id.
  const routeProjectId = /^\/projects\/([^/]+)/.exec(location.pathname)?.[1];
  const currentProjectId = routeProjectId && routeProjectId !== 'new' ? routeProjectId : undefined;

  return (
    <header
      className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3"
      style={{ height: 'var(--topbar-height)' }}
    >
      <IconButton
        label="Открыть меню"
        size="sm"
        className="md:hidden"
        onClick={() => setMobileNavOpen(true)}
      >
        <MenuIcon className="size-4" />
      </IconButton>

      <nav aria-label="Навигационная цепочка" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1 text-sm">
          {breadcrumbs.map((crumb, index) => (
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 && <span className="shrink-0 text-text-subtle">/</span>}
              {crumb.to ? (
                <Link
                  to={crumb.to}
                  className="flex min-w-0 items-center gap-1.5 truncate rounded-sm px-1 py-0.5 text-text-muted hover:bg-surface-hover hover:text-text"
                >
                  {crumb.icon}
                  <span className="truncate">{crumb.label}</span>
                </Link>
              ) : (
                <span
                  className="flex min-w-0 items-center gap-1.5 truncate px-1 py-0.5 font-medium text-text"
                  aria-current="page"
                >
                  {crumb.icon}
                  <span className="truncate">{crumb.label}</span>
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex shrink-0 items-center gap-1.5">
        {actions}

        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          className="hidden items-center gap-2 rounded-md border border-border bg-surface-sunken px-2 py-1 text-xs text-text-subtle hover:bg-surface-hover sm:flex"
          aria-label="Поиск — Cmd или Ctrl + K"
        >
          <Search className="size-3.5" />
          <span className="hidden lg:inline">Поиск…</span>
          <Kbd className="ml-2">⌘K</Kbd>
        </button>

        <IconButton
          label="Поиск"
          size="sm"
          className="sm:hidden"
          onClick={() => setCommandPaletteOpen(true)}
        >
          <Search className="size-4" />
        </IconButton>

        <NotificationBell />

        <Button
          size="sm"
          variant="primary"
          iconLeft={<Plus className="size-3.5" />}
          onClick={() => openCreateIssue(currentProjectId ? { projectId: currentProjectId } : undefined)}
          title="Создать задачу (C)"
        >
          <span className="hidden sm:inline">Создать</span>
        </Button>
      </div>
    </header>
  );
}
