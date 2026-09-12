import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  ArrowRight,
  CornerDownLeft,
  LayoutGrid,
  Plus,
  Search,
  Settings,
  UserRound,
  Zap,
  Inbox,
  Home,
} from 'lucide-react';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useSearch } from '~/features/search/hooks';
import { Avatar } from '~/ui/Avatar';
import { Kbd } from '~/ui/Tooltip';
import { Spinner } from '~/ui/Spinner';
import { IssueTypeIcon } from './IssueMeta';

interface Command {
  id: string;
  label: string;
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

  const { data: results, isFetching } = useSearch(workspace?.id ?? '', term, open);

  useEffect(() => {
    if (!open) {
      setTerm('');
      setActiveIndex(0);
    }
  }, [open]);

  const staticCommands = useMemo<Command[]>(
    () => [
      {
        id: 'nav-home',
        label: 'Перейти на главную',
        icon: <Home className="size-4" />,
        group: 'Навигация',
        run: () => navigate('/'),
      },
      {
        id: 'nav-my-work',
        label: 'Перейти в «Мои задачи»',
        icon: <UserRound className="size-4" />,
        group: 'Навигация',
        run: () => navigate('/my-work'),
      },
      {
        id: 'nav-inbox',
        label: 'Перейти во «Входящие»',
        icon: <Inbox className="size-4" />,
        group: 'Навигация',
        run: () => navigate('/inbox'),
      },
      {
        id: 'nav-projects',
        label: 'Перейти к проектам',
        icon: <LayoutGrid className="size-4" />,
        group: 'Навигация',
        run: () => navigate('/projects'),
      },
      {
        id: 'action-create-issue',
        label: 'Создать задачу',
        hint: 'C',
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
      {
        id: 'action-shortcuts',
        label: 'Горячие клавиши',
        hint: '?',
        icon: <Zap className="size-4" />,
        group: 'Действия',
        run: () => setShortcutsOpen(true),
      },
      {
        id: 'nav-settings',
        label: 'Настройки пространства',
        icon: <Settings className="size-4" />,
        group: 'Навигация',
        run: () => navigate('/settings/workspace'),
      },
    ],
    [navigate, openCreateIssue, setShortcutsOpen],
  );

  const commands = useMemo<Command[]>(() => {
    const q = term.trim().toLowerCase();
    const matched = q
      ? staticCommands.filter((c) => c.label.toLowerCase().includes(q))
      : staticCommands;

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
  }, [term, staticCommands, results, navigate, openIssue]);

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

  if (!open) return null;

  const grouped = commands.reduce<Record<string, { command: Command; index: number }[]>>((acc, command, index) => {
    (acc[command.group] ??= []).push({ command, index });
    return acc;
  }, {});

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[10vh]">
      <div className="fixed inset-0 bg-[var(--overlay)] animate-in" onClick={() => setOpen(false)} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Командная палитра"
        className="relative z-10 w-full max-w-xl overflow-hidden border-2 border-border-strong bg-surface shadow-xl animate-slide-up"
      >
        <div className="flex items-center gap-2 border-b-2 border-border-strong bg-surface-raised px-3">
          <Search className="size-4 shrink-0 text-text-subtle" />
          <input
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Поиск задач, проектов, людей — или команда…"
            aria-label="Поиск"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-text-subtle"
          />
          {isFetching && <Spinner className="size-3.5 text-text-subtle" />}
          <Kbd>Esc</Kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5 scrollbar-thin">
          {commands.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-text-subtle">
              Ничего не найдено по запросу «{term}»
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
                    {command.hint && (
                      <span className="fd-key shrink-0">{command.hint}</span>
                    )}
                    {index === activeIndex && <CornerDownLeft className="size-3 shrink-0" />}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t-2 border-border-strong bg-surface-raised px-3 py-1.5 text-2xs text-text-subtle">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> навигация
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> открыть
          </span>
          <span className="ml-auto flex items-center gap-1">
            <ArrowRight className="size-3" />
            {results?.issues.length ?? 0} задач найдено
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
