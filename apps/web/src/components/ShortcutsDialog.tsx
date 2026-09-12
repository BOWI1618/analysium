import { useUiStore } from '~/app/uiStore';
import { Dialog } from '~/ui/Dialog';
import { Kbd } from '~/ui/Tooltip';

const GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: 'Везде',
    items: [
      { keys: ['C'], label: 'Создать задачу' },
      { keys: ['/'], label: 'Перейти к поиску' },
      { keys: ['⌘', 'K'], label: 'Командная палитра' },
      { keys: ['G', 'P'], label: 'К проектам' },
      { keys: ['G', 'M'], label: 'К моим задачам' },
      { keys: ['G', 'I'], label: 'Во входящие' },
      { keys: ['G', 'H'], label: 'На главную' },
      { keys: ['?'], label: 'Показать это окно' },
      { keys: ['Esc'], label: 'Закрыть панель или окно' },
    ],
  },
  {
    title: 'Задача',
    items: [
      { keys: ['E'], label: 'Изменить заголовок' },
      { keys: ['A'], label: 'Сменить исполнителя' },
      { keys: ['S'], label: 'Сменить статус' },
      { keys: ['P'], label: 'Сменить приоритет' },
      { keys: ['L'], label: 'Изменить метки' },
      { keys: ['⌘', '↵'], label: 'Сохранить / отправить комментарий' },
      { keys: ['Esc'], label: 'Закрыть панель задачи' },
    ],
  },
  {
    title: 'Доска и списки',
    items: [
      { keys: ['↑', '↓'], label: 'Переход между задачами' },
      { keys: ['↵'], label: 'Открыть выбранную задачу' },
      { keys: ['Space'], label: 'Выбрать для массовых действий' },
      { keys: ['Shift', 'Click'], label: 'Выбрать диапазон' },
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
      description="FlowDesk рассчитан на работу без мыши."
      size="lg"
    >
      <div className="grid gap-6 sm:grid-cols-2">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h3 className="fd-eyebrow mb-2.5">
              {group.title}
            </h3>
            <ul className="space-y-1.5">
              {group.items.map((item) => (
                <li key={item.label} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-text-muted">{item.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {item.keys.map((key, index) => (
                      <span key={`${key}-${index}`} className="flex items-center gap-1">
                        {index > 0 && <span className="text-2xs text-text-subtle">затем</span>}
                        <Kbd>{key}</Kbd>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
