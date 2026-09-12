import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useUiStore } from '~/app/uiStore';
import { useHotkeys } from '~/lib/hooks/useHotkeys';
import { useIsMobile } from '~/lib/hooks/useMediaQuery';
import { Sidebar } from './Sidebar';
import { CommandPalette } from './CommandPalette';
import { CreateIssueDialog } from './CreateIssueDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { IssueDetailPanel } from '~/features/issues/IssueDetailPanel';

/**
 * Application chrome: sidebar + routed content, plus the global overlays
 * (command palette, quick-create, issue panel) and the keyboard map that makes
 * the product usable without a mouse.
 */
export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();

  // Quick-create should default to the project you are looking at, not the
  // first project in the workspace.
  // `/projects/new` is a route, not a project id.
  const routeProjectId = /^\/projects\/([^/]+)/.exec(location.pathname)?.[1];
  const currentProjectId = routeProjectId && routeProjectId !== 'new' ? routeProjectId : undefined;

  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const openCreateIssue = useUiStore((s) => s.openCreateIssue);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const openIssueId = useUiStore((s) => s.openIssueId);
  const closeIssue = useUiStore((s) => s.closeIssue);

  useHotkeys({
    c: () => openCreateIssue(currentProjectId ? { projectId: currentProjectId } : undefined),
    '/': () => setCommandPaletteOpen(true),
    'mod+k': () => setCommandPaletteOpen(true),
    '?': () => setShortcutsOpen(true),
    'g p': () => navigate('/projects'),
    'g m': () => navigate('/my-work'),
    'g i': () => navigate('/inbox'),
    'g h': () => navigate('/'),
    escape: () => {
      if (openIssueId) closeIssue();
      else setMobileNavOpen(false);
    },
  });


  // The mobile drawer must not survive a viewport change.
  useEffect(() => {
    if (!isMobile) setMobileNavOpen(false);
  }, [isMobile, setMobileNavOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
      {/* Desktop sidebar */}
      <div className="hidden shrink-0 md:block">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-[75] md:hidden">
          <div
            className="fixed inset-0 bg-[var(--overlay)] animate-in"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full w-64 animate-in shadow-xl">
            <Sidebar onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}

      <main className={clsx('flex min-w-0 flex-1 flex-col overflow-hidden')}>
        <Outlet />
      </main>

      <CommandPalette />
      <CreateIssueDialog />
      <ShortcutsDialog />
      <IssueDetailPanel />
    </div>
  );
}
