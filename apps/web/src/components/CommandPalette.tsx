import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  ArrowRight,
  LayoutGrid,
  Plus,
  Search,
  Settings,
  UserRound,
  Zap,
  Inbox,
  Home,
  Users,
  ListTodo,
  Network,
  Bookmark,
} from 'lucide-react';
import { useSession, useWorkspaceCan } from '~/app/session';
import { Permission } from '@flowdesk/contracts';
import { useUiStore } from '~/app/uiStore';
import { useSearch } from '~/features/search/hooks';
import { useDepartments } from '~/features/departments/hooks';
import { useProjects } from '~/features/projects/hooks';
import { useSavedViews } from '~/features/views/hooks';
import { viewPath } from '~/features/views/viewState';
import { Avatar } from '~/ui/Avatar';
import { Kbd } from '~/ui/Tooltip';
import { Shortcut } from '~/ui/Shortcut';
import { SHORTCUTS } from '~/lib/shortcuts';
import { Spinner } from '~/ui/Spinner';
import { IssueTypeIcon } from './IssueMeta';

interface Command {
  id: string;
  label: string;
  /** A combo from SHORTCUTS, drawn as keycaps next to the command. */
  hint?: string;
  icon: React.ReactNode;
  group: string;
  run: () => void;
}

/**
 * Cmd/Ctrl+K palette: navigation, actions and live search in one surface.
 * Results are keyboard-driven end to end — arrow keys move, Enter opens.
 */
export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const openCreateIssue = useUiStore((s) => s.openCreateIssue);
  const openIssue = useUiStore((s) => s.openIssue);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const { workspace } = useSession();
  const navigate = useNavigate();

  const [term, setTerm] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: results, isFetching, isTyping } = useSearch(workspace?.id ?? '', term, open);
  // Until the answer for what is typed now arrives, an empty list means «still
  // looking», not «nothing there» — it used to say the latter mid-request.
  const searching = Boolean(term.trim()) && (isFetching || isTyping);

  useEffect(() => {
    if (!open) {
      setTerm('');
      setActiveIndex(0);
    }
  }, [open]);

  const canCreateIssue = useWorkspaceCan(Permission.ISSUE_CREATE);
  const canCreateProject = useWorkspaceCan(Permission.PROJECT_CREATE);
  // The same two conditions the sidebar shows these screens by.
  const canAssign = useWorkspaceCan(Permission.ISSUE_ASSIGN);
  const { data: departments } = useDepartments(workspace?.id);
  const showDepartment = Boolean(departments && (departments.items.length > 0 || departments.canManage));
  const staticCommands = useMemo<Command[]>(
    () => ([
      {
        id: 'nav-home',
        label: 'Перейти на главную',
        icon: <Home className="size-4" />,
        hint: SHORTCUTS.goHome,
        group: 'Навигация',
        run: () => navigate('/'),
      },
      {
        id: 'nav-my-work',
        label: 'Перейти в «Мои задачи»',
        icon: <UserRound className="size-4" />,
        hint: SHORTCUTS.goMyWork,
        group: 'Навигация',
        run: () => navigate('/my-work'),
      },
      {
        id: 'nav-inbox',
        label: 'Перейти во «Входящие»',
        icon: <Inbox className="size-4" />,
        hint: SHORTCUTS.goInbox,
        group: 'Навигация',
        run: () => navigate('/inbox'),
      },
      {
        id: 'nav-projects',
        label: 'Перейти к проектам',
        icon: <LayoutGrid className="size-4" />,
        hint: SHORTCUTS.goProjects,
        group: 'Навигация',
        run: () => navigate('/projects'),
      },
      {
        id: 'nav-employee-work',
        label: 'Перейти к задачам сотрудника',
        icon: <Users className="size-4" />,
        group: 'Навигация',
        run: () => navigate('/employee-work'),
      },
      ...(canAssign
        ? [
            {
              id: 'nav-planning',
              label: 'Перейти к распределению задач',
              icon: <ListTodo className="size-4" />,
              group: 'Навигация',
              run: () => navigate('/planning'),
            },
          ]
        : []),
      ...(showDepartment
        ? [
            {
              id: 'nav-department',
              label: 'Перейти к задачам отдела',
              icon: <Network className="size-4" />,
              group: 'Навигация',
              run: () => navigate('/department-work'),
            },
          ]
        : []),
      {
        id: 'action-create-issue',
        label: 'Создать задачу',
        hint: SHORTCUTS.createIssue,
        icon: <Plus className="size-4" />,
        group: 'Действия',
        run: () => openCreateIssue(),
      },
      {
        id: 'action-create-project',
        label: 'Создать проект',
        icon: <Plus className="size-4" />,
        group: 'Действия',
        run: () => navigate('/projects/new'),
      },
      // A phone has no keyboard to learn shortcuts for.
      ...(typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches
        ? []
        : [
            {
              id: 'action-shortcuts',
              label: 'Горячие клавиши',
              hint: SHORTCUTS.showShortcuts,
              icon: <Zap className="size-4" />,
              group: 'Действия',
              run: () => setShortcutsOpen(true),
            },
          ]),
      {
        id: 'nav-settings',
        label: 'Настройки пространства',
        icon: <Settings className="size-4" />,
        group: 'Навигация',
        run: () => navigate('/settings/workspace'),
      },
    ] as Command[]).filter(
      (command) =>
        (command.id !== 'action-create-issue' || canCreateIssue) &&
        (command.id !== 'action-create-project' || canCreateProject),
    ),
    [navigate, openCreateIssue, setShortcutsOpen, canCreateIssue, canCreateProject, canAssign, showDepartment],
  );

  // Saved views are places to go, like the screens above: «Просроченные
  // отдела» is one line here instead of a screen, a menu and a click.
  const { data: savedViews } = useSavedViews(open ? workspace?.id : undefined);
  const { data: projects } = useProjects(workspace?.id ?? '', false, { includeSystem: true });
  const viewCommands = useMemo<Command[]>(
    () =>
      (savedViews ?? []).flatMap((view) => {
        const path = viewPath(view);
        if (!path) return [];
        const project = view.projectId ? projects?.find((item) => item.id === view.projectId) : undefined;
        return [
          {
            id: `view-${view.id}`,
            label: project ? `Вид: ${view.name} — ${project.name}` : `Вид: ${view.name}`,
            icon: <Bookmark className="size-4" />,
            group: 'Виды',
            // The columns and grouping of a list are not in the address; they travel with the navigation.
            run: () => navigate(path, { state: { viewDisplay: view.display } }),
          },
        ];
      }),
    [savedViews, projects, navigate],
  );

  const commands = useMemo<Command[]>(() => {
    const q = term.trim().toLowerCase();
    const known = [...staticCommands, ...viewCommands];
    const matched = q ? known.filter((c) => c.label.toLowerCase().includes(q)) : known;

    const searchCommands: Command[] = [];

    if (results) {
      for (const issue of results.issues) {
        searchCommands.push({
          id: `issue-${issue.id}`,
          label: issue.title,
          hint: issue.issueKey,
          icon: <IssueTypeIcon type={issue.type} withTooltip={false} />,
          group: 'Задачи',
          run: () => openIssue(issue.id),
        });
      }
      for (const project of results.projects) {
        searchCommands.push({
          id: `project-${project.id}`,
          label: project.name,
          hint: project.key,
          icon: <span aria-hidden="true">{project.icon}</span>,
          group: 'Проекты',
          run: () => navigate(`/projects/${project.id}`),
        });
      }
      for (const epic of results.epics) {
        searchCommands.push({
          id: `epic-${epic.id}`,
          label: epic.title,
          hint: epic.issueKey,
          icon: <Zap className="size-4" style={{ color: epic.color }} />,
          group: 'Эпики',
          run: () => openIssue(epic.id),
        });
      }
      for (const user of results.users) {
        searchCommands.push({
          id: `user-${user.id}`,
          label: user.name,
          hint: user.email,
          icon: <Avatar user={user} size="md" />,
          group: 'Люди',
          run: () => navigate(`/people/${user.id}`),
        });
      }
    }

    return q ? [...searchCommands, ...matched] : matched;
  }, [term, staticCommands, viewCommands, results, navigate, openIssue]);

  useEffect(() => setActiveIndex(0), [term, results]);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, commands.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const command = commands[activeIndex];
        if (command) {
          command.run();
          setOpen(false);
        }
      } else if (event.key === 'Escape') {
        // Swallow the event so layers below (drawer, dialogs) stay open.
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, commands, activeIndex, setOpen]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Where the search field is on screen. The palette opens out of it: its input
  // lands on the field and the results drop below. Measured before paint so it
  // never flashes in the middle first. When the field is not rendered — phone
  // widths hide it — there is no anchor and the centred dialog is used instead.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const field = [...document.querySelectorAll<HTMLElement>('[data-palette-anchor]')].find(
        (el) => el.getBoundingClientRect().width > 0,
      );
      setAnchor(field ? field.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  if (!open) return null;

  // Wider than the field so results have room, but grown leftwards: the field
  // is at the right edge, and the panel's right edge stays on the field's.
  const MARGIN = 8;
  const panelWidth = anchor ? Math.min(576, window.innerWidth - MARGIN * 2) : 0;
  const panelLeft = anchor
    ? Math.min(Math.max(anchor.right - panelWidth, MARGIN), window.innerWidth - panelWidth - MARGIN)
    : 0;

  const grouped = commands.reduce<Record<string, { command: Command; index: number }[]>>((acc, command, index) => {
    (acc[command.group] ??= []).push({ command, index });
    return acc;
  }, {});

  return createPortal(
    <div
      className={clsx('fixed inset-0 z-[90]', !anchor && 'flex items-start justify-center p-4 pt-[10vh]')}
    >
      {/* A dropdown does not dim the page; the centred dialog does. Either way a
          click outside closes it. */}
      <div
        className={clsx('fixed inset-0', anchor ? 'bg-transparent' : 'bg-[var(--overlay)] animate-in')}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Командная палитра"
        className={clsx(
          'z-10 overflow-hidden border-2 border-border-strong bg-surface shadow-xl',
          anchor ? 'fixed animate-in' : 'relative w-full max-w-xl animate-slide-up',
        )}
        style={anchor ? { top: anchor.top, left: panelLeft, width: panelWidth } : undefined}
      >
        <div
          className="flex items-center gap-2 border-b-2 border-border-strong bg-surface-raised px-3"
          // Anchored, the input row matches the field it replaces, so the search
          // box stays exactly where it was and only the list appears.
          style={anchor ? { height: Math.max(anchor.height - 2, 28) } : undefined}
        >
          <Search className="size-4 shrink-0 text-text-subtle" />
          <input
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Найти задачу, проект, человека — или выбрать команду…"
            aria-label="Поиск"
            className={clsx(
              'w-full bg-transparent outline-none placeholder:text-text-subtle',
              anchor ? 'h-full text-xs' : 'h-11 text-sm',
            )}
          />
          {isFetching && <Spinner className="size-3.5 text-text-subtle" />}
          <Kbd className="[@media(hover:none)]:hidden">Esc</Kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5 scrollbar-thin">
          {commands.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-text-subtle" role="status">
              {searching ? 'Ищем…' : `Ничего не найдено по запросу «${term}»`}
            </p>
          ) : (
            Object.entries(grouped).map(([group, entries]) => (
              <div key={group} className="mb-1">
                <p className="fd-eyebrow px-2 py-1.5">
                  {group}
                </p>
                {entries.map(({ command, index }) => (
                  <button
                    key={command.id}
                    type="button"
                    data-active={index === activeIndex}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => {
                      command.run();
                      setOpen(false);
                    }}
                    className={clsx(
                      'flex w-full items-center gap-2.5 px-2 py-2 text-left text-sm font-semibold',
                      // The keyboard cursor is printed in reverse, so it is
                      // unmistakable while typing.
                      index === activeIndex ? 'bg-ink text-text-inverted' : 'hover:bg-surface-hover',
                    )}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">{command.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{command.label}</span>
                    {command.hint && <Shortcut combo={command.hint} />}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Spelled out, key by key: the old footer's lone arrows and a ↵ glyph
            left people unsure what to press. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t-2 border-border-strong bg-surface-raised px-3 py-1.5 text-2xs text-text-subtle [@media(hover:none)]:hidden">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> выбрать
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Enter</Kbd> выполнить
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd> закрыть
          </span>
          {term.trim() && (
            <span className="ml-auto flex items-center gap-1">
              <ArrowRight className="size-3" />
              Задач: {results?.issues.length ?? 0}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
