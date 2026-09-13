import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Menu as MenuIcon, Plus, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { useUiStore } from '~/app/uiStore';
import { Button, IconButton } from '~/ui/Button';
import { Shortcut } from '~/ui/Shortcut';
import { SHORTCUTS, comboText } from '~/lib/shortcuts';
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
      className="flex shrink-0 items-stretch border-b-2 border-border-strong bg-surface"
      style={{ height: 'var(--topbar-height)' }}
    >
      <div className="flex shrink-0 items-center gap-2 px-2 md:hidden">
        <IconButton
          label="Открыть меню"
          size="sm"
          variant="secondary"
          onClick={() => setMobileNavOpen(true)}
        >
          <MenuIcon className="size-4" />
        </IconButton>
      </div>

      {/* Dateline: everything but the last crumb is set small and quiet, the
          current page is the only thing in the display face. */}
      <nav
        aria-label="Навигационная цепочка"
        className="flex min-w-0 flex-1 items-center gap-2 border-r-2 border-border-strong px-3 sm:px-4"
      >
        <ol className="flex min-w-0 items-center gap-2">
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;
            return (
              <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-2">
                {index > 0 && <ChevronRight className="size-3.5 shrink-0 text-text-subtle" />}
                {crumb.to && !isLast ? (
                  <Link
                    to={crumb.to}
                    className="fd-kicker flex min-w-0 items-center gap-1.5 truncate hover:text-text"
                  >
                    {crumb.icon}
                    <span className="truncate">{crumb.label}</span>
                  </Link>
                ) : isLast ? (
                  <span
                    className="flex min-w-0 items-center gap-1.5 truncate font-display text-xs font-extrabold uppercase"
                    aria-current="page"
                  >
                    {crumb.icon}
                    <span className="truncate">{crumb.label}</span>
                  </span>
                ) : (
                  <span className="fd-kicker flex min-w-0 items-center gap-1.5 truncate">
                    {crumb.icon}
                    <span className="truncate">{crumb.label}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Search sits at the right edge, next to the actions it belongs with; the
          breadcrumbs take whatever width is left. The palette opens out of this
          very field — it reads the button's position through the data attribute. */}
      <div className="hidden shrink-0 items-center px-3 sm:flex">
        <button
          type="button"
          data-palette-anchor
          onClick={() => setCommandPaletteOpen(true)}
          className="flex w-56 items-center gap-2 border-2 border-border-strong bg-surface px-2.5 py-1 text-xs text-text-subtle transition-[box-shadow,translate] duration-100 hover:-translate-x-px hover:-translate-y-px hover:shadow-sm lg:w-72"
          aria-label={`Поиск — ${comboText(SHORTCUTS.commandPalette)}`}
        >
          <Search className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">Поиск: ключ, слово, @человек…</span>
          <Shortcut combo={SHORTCUTS.commandPalette} />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-l-2 border-border-strong px-2 sm:px-3">
        {actions}

        <IconButton
          label="Поиск"
          size="sm"
          variant="secondary"
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
          title={`Создать задачу (${comboText(SHORTCUTS.createIssue)})`}
        >
          <span className="hidden sm:inline">Создать</span>
        </Button>
      </div>
    </header>
  );
}
