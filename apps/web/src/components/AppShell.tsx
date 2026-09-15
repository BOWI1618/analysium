import { useEffect } from 'react';
import { useCanCreateIssue } from '~/features/projects/hooks';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useUiStore } from '~/app/uiStore';
import { useHotkeys } from '~/lib/hooks/useHotkeys';
import { SHORTCUTS } from '~/lib/shortcuts';
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
  const canCreateIssue = useCanCreateIssue(currentProjectId);

  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const openCreateIssue = useUiStore((s) => s.openCreateIssue);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const openIssueId = useUiStore((s) => s.openIssueId);
  const closeIssue = useUiStore((s) => s.closeIssue);

  useHotkeys({
    [SHORTCUTS.commandPalette]: () => setCommandPaletteOpen(true),
    [SHORTCUTS.showShortcuts]: () => setShortcutsOpen(true),
    [SHORTCUTS.createIssue]: () => {
      if (canCreateIssue) openCreateIssue(currentProjectId ? { projectId: currentProjectId } : undefined);
    },
    [SHORTCUTS.goHome]: () => navigate('/'),
    [SHORTCUTS.goMyWork]: () => navigate('/my-work'),
    [SHORTCUTS.goInbox]: () => navigate('/inbox'),
    [SHORTCUTS.goProjects]: () => navigate('/projects'),
    escape: () => {
      if (openIssueId) closeIssue();
      else setMobileNavOpen(false);
    },
  });

  // The mobile drawer must not survive a viewport change.
  useEffect(() => {
    if (!isMobile) setMobileNavOpen(false);
  }, [isMobile, setMobileNavOpen]);

  // Nor a change of page. Closing it here rather than on each link covers
  // every way of navigating — menu items, the account button, a project in the
  // list, a link inside the page — including ones added later.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname, setMobileNavOpen]);

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
          {/* Sized by the sidebar itself. A fixed w-64 wrapper was 12px wider
              than the 244px rail, so the page showed through a gap and the hard
              drop shadow drew a second black bar beyond it. */}
          <div className="relative z-10 h-full w-fit max-w-[85vw] animate-in shadow-xl">
            <Sidebar inDrawer onNavigate={() => setMobileNavOpen(false)} />
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
