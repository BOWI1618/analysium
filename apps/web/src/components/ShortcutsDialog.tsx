import type { ReactNode } from 'react';
import { useUiStore } from '~/app/uiStore';
import { SHORTCUTS } from '~/lib/shortcuts';
import { Dialog } from '~/ui/Dialog';
import { Shortcut } from '~/ui/Shortcut';
import { Kbd } from '~/ui/Tooltip';

/**
 * Only what actually works is listed. Every combo comes from SHORTCUTS, the
 * same table the handlers are registered from.
 */
const either = (a: string, b: string) => (
  <span className="inline-flex items-center gap-1">
    <Shortcut combo={a} />
    <span className="text-2xs text-text-subtle">или</span>
    <Shortcut combo={b} />
  </span>
);

const GROUPS: { title: string; items: { label: string; keys: ReactNode }[] }[] = [
  {
    title: 'Везде',
    items: [
      { label: 'Поиск и команды', keys: <Shortcut combo={SHORTCUTS.commandPalette} /> },
      { label: 'Создать задачу', keys: <Shortcut combo={SHORTCUTS.createIssue} /> },
      { label: 'Главная', keys: <Shortcut combo={SHORTCUTS.goHome} /> },
      { label: 'Мои задачи', keys: <Shortcut combo={SHORTCUTS.goMyWork} /> },
      { label: 'Входящие', keys: <Shortcut combo={SHORTCUTS.goInbox} /> },
      { label: 'Проекты', keys: <Shortcut combo={SHORTCUTS.goProjects} /> },
      { label: 'Это окно', keys: <Shortcut combo={SHORTCUTS.showShortcuts} /> },
      { label: 'Закрыть панель или окно', keys: <Shortcut combo="escape" /> },
    ],
  },
  {
    title: 'Открытая задача',
    items: [
      { label: 'Переименовать', keys: <Shortcut combo={SHORTCUTS.issueTitle} /> },
      { label: 'Статус', keys: <Shortcut combo={SHORTCUTS.issueStatus} /> },
      { label: 'Исполнитель', keys: <Shortcut combo={SHORTCUTS.issueAssignee} /> },
      { label: 'Приоритет', keys: <Shortcut combo={SHORTCUTS.issuePriority} /> },
      { label: 'Метки', keys: <Shortcut combo={SHORTCUTS.issueLabels} /> },
      { label: 'Отправить комментарий', keys: <Shortcut combo={SHORTCUTS.submit} /> },
      { label: 'Закрыть задачу', keys: <Shortcut combo="escape" /> },
    ],
  },
  {
    title: 'Списки задач',
    items: [
      { label: 'Следующая или предыдущая', keys: either('arrowdown', 'arrowup') },
      { label: 'Открыть задачу', keys: <Shortcut combo="enter" /> },
      { label: 'Отметить', keys: <Shortcut combo="space" /> },
      {
        label: 'Отметить диапазон',
        keys: (
          <span className="inline-flex items-center gap-1">
            <Kbd>Shift</Kbd>
            <span className="text-2xs text-text-subtle">+ клик</span>
          </span>
        ),
      },
    ],
  },
  {
    title: 'Поиск и команды',
    items: [
      { label: 'Выбрать пункт', keys: either('arrowdown', 'arrowup') },
      { label: 'Выполнить', keys: <Shortcut combo="enter" /> },
      { label: 'Закрыть', keys: <Shortcut combo="escape" /> },
    ],
  },
];

export function ShortcutsDialog() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title="Горячие клавиши"
      description="Клавиши нажимаются одновременно. Работают на любой раскладке."
      size="lg"
    >
      <div className="grid gap-6 sm:grid-cols-2">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h3 className="fd-eyebrow mb-2.5">{group.title}</h3>
            <ul className="space-y-1.5">
              {group.items.map((item) => (
                <li key={item.label} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-text-muted">{item.label}</span>
                  {item.keys}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
