import { create } from 'zustand';

/**
 * Ephemeral UI state only.
 *
 * Anything that lives on the server (issues, projects, members) belongs to
 * React Query — this store never mirrors it. Keeping the boundary strict is
 * what stops the "two sources of truth" class of bug.
 */
interface UiState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  commandPaletteOpen: boolean;
  createIssueOpen: boolean;
  createIssueDefaults: { projectId?: string; statusId?: string; sprintId?: string; parentId?: string; epicId?: string } | null;
  shortcutsOpen: boolean;
  /** Issue currently shown in the side panel (null = closed). */
  openIssueId: string | null;

  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  openCreateIssue: (defaults?: UiState['createIssueDefaults']) => void;
  closeCreateIssue: () => void;
  setShortcutsOpen: (open: boolean) => void;
  openIssue: (issueId: string) => void;
  closeIssue: () => void;
}

const SIDEBAR_KEY = 'flowdesk.sidebar-collapsed';

function readSidebar(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistSidebar(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(collapsed));
  } catch {
    /* preference simply won't persist */
  }
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: readSidebar(),
  mobileNavOpen: false,
  commandPaletteOpen: false,
  createIssueOpen: false,
  createIssueDefaults: null,
  shortcutsOpen: false,
  openIssueId: null,

  toggleSidebar: () =>
    set((state) => {
      const next = !state.sidebarCollapsed;
      persistSidebar(next);
      return { sidebarCollapsed: next };
    }),
  setSidebarCollapsed: (collapsed) => {
    persistSidebar(collapsed);
    set({ sidebarCollapsed: collapsed });
  },
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  openCreateIssue: (defaults) => set({ createIssueOpen: true, createIssueDefaults: defaults ?? null }),
  closeCreateIssue: () => set({ createIssueOpen: false, createIssueDefaults: null }),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  openIssue: (issueId) => set({ openIssueId: issueId }),
  closeIssue: () => set({ openIssueId: null }),
}));
