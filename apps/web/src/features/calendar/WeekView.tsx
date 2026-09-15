import { useState } from 'react';
import clsx from 'clsx';
import { format, isToday } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Plus } from 'lucide-react';
import { CalendarCard, startCardDrag, type CalendarDrag, type CardFields } from './CalendarCard';
import { dayKey, layoutPeriods, type CalendarItem } from './items';

export interface WeekViewProps {
  days: Date[];
  items: CalendarItem[];
  fields: CardFields;
  showPeriods: boolean;
  canEdit: boolean;
  drag: CalendarDrag | null;
  onDragChange: (drag: CalendarDrag | null) => void;
  onOpen: (issueId: string) => void;
  onToggleDone: (item: CalendarItem) => void;
  onDropOnDay: (day: Date) => void;
  onCreate: (day: Date) => void;
  onOpenDay: (day: Date) => void;
}

/**
 * The week as columns, one per day. Tasks with a period run across the top;
 * inside a day come whole-day tasks, then tasks with a time in order. A task
 * is dragged to another column to move it to that day.
 */
export function WeekView({
  days,
  items,
  fields,
  showPeriods,
  canEdit,
  drag,
  onDragChange,
  onOpen,
  onToggleDone,
  onDropOnDay,
  onCreate,
  onOpenDay,
}: WeekViewProps) {
  const [overKey, setOverKey] = useState<string | null>(null);
  const keys = days.map(dayKey);
  const columns = `repeat(${days.length}, minmax(9rem, 1fr))`;
  const periods = showPeriods ? layoutPeriods(items.filter((i) => i.period), keys) : [];
  const periodRows = Math.max(0, ...periods.map((p) => p.row + 1));

  return (
    <div className="min-w-fit">
      {/* Day headings */}
      <div className="sticky top-0 z-20 grid border-b-2 border-border-strong bg-surface-sunken" style={{ gridTemplateColumns: columns }}>
        {days.map((day) => (
          <button
            key={dayKey(day)}
            type="button"
            onClick={() => onOpenDay(day)}
            title="Открыть день по часам"
            className={clsx(
              'flex items-baseline gap-1.5 border-l-2 border-border-strong px-2 py-1.5 text-left first:border-l-0 hover:bg-surface-hover',
              isToday(day) && 'bg-marker-subtle',
            )}
          >
            <span className="text-2xs font-bold tracking-wide text-text-subtle uppercase">
              {format(day, 'EEEEEE', { locale: ru })}
            </span>
            <span
              className={clsx(
                'fd-num text-sm font-bold',
                isToday(day) ? 'bg-accent px-1 text-accent-fg' : 'text-text',
              )}
            >
              {format(day, 'd')}
            </span>
            {day.getDate() === 1 && (
              <span className="text-2xs text-text-subtle">{format(day, 'LLL', { locale: ru })}</span>
            )}
          </button>
        ))}
      </div>

      {/* Periods */}
      {periodRows > 0 && (
        <div
          className="grid gap-y-1 border-b-2 border-border-strong bg-surface-sunken p-1"
          style={{ gridTemplateColumns: columns, gridTemplateRows: `repeat(${periodRows}, auto)` }}
          aria-label="Задачи с периодом"
        >
          {periods.map(({ item, row, from, to }) => (
            <CalendarCard
              key={item.issue.id}
              item={item}
              fields={fields}
              canEdit={canEdit}
              compact
              className="mx-0.5"
              style={{ gridColumn: `${from + 1} / ${to + 2}`, gridRow: row + 1 }}
              dragging={drag?.issueId === item.issue.id}
              onOpen={() => onOpen(item.issue.id)}
              onToggleDone={() => onToggleDone(item)}
              // A period is moved by its start, as in the month view.
              onDragStart={(event) => onDragChange(startCardDrag(event, item, item.issue.id, keys[from] ?? item.startKey))}
              onDragEnd={() => onDragChange(null)}
            />
          ))}
        </div>
      )}

      {/* Day columns */}
      <div className="grid" style={{ gridTemplateColumns: columns }}>
        {days.map((day, index) => {
          const key = keys[index]!;
          const own = items.filter((item) => !item.period && item.endKey === key);
          const wholeDay = own.filter((item) => !item.timed);
          const timed = own.filter((item) => item.timed).sort((a, b) => a.start.getTime() - b.start.getTime());

          return (
            <div
              key={key}
              onDragOver={(event) => {
                if (!canEdit || !drag) return;
                event.preventDefault();
                setOverKey(key);
              }}
              onDragLeave={() => setOverKey((current) => (current === key ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                setOverKey(null);
                if (canEdit && drag) onDropOnDay(day);
              }}
              className={clsx(
                'group/day flex min-h-[60vh] flex-col gap-1 border-l-2 border-border-strong p-1.5 first:border-l-0',
                isToday(day) ? 'bg-marker-subtle/40' : 'bg-surface',
                overKey === key && 'bg-accent-subtle',
              )}
            >
              {wholeDay.length > 0 && timed.length > 0 && <p className="fd-eyebrow px-0.5 text-[9px]">Весь день</p>}
              {wholeDay.map((item) => (
                <CalendarCard
                  key={item.issue.id}
                  item={item}
                  fields={fields}
                  canEdit={canEdit}
                  dragging={drag?.issueId === item.issue.id}
                  onOpen={() => onOpen(item.issue.id)}
                  onToggleDone={() => onToggleDone(item)}
                  onDragStart={(event) => onDragChange(startCardDrag(event, item, item.issue.id, key))}
                  onDragEnd={() => onDragChange(null)}
                />
              ))}

              {timed.length > 0 && wholeDay.length > 0 && <p className="fd-eyebrow mt-1 px-0.5 text-[9px]">Со временем</p>}
              {timed.map((item) => (
                <CalendarCard
                  key={item.issue.id}
                  item={item}
                  fields={fields}
                  canEdit={canEdit}
                  dragging={drag?.issueId === item.issue.id}
                  onOpen={() => onOpen(item.issue.id)}
                  onToggleDone={() => onToggleDone(item)}
                  onDragStart={(event) => onDragChange(startCardDrag(event, item, item.issue.id, key))}
                  onDragEnd={() => onDragChange(null)}
                />
              ))}

              {canEdit && (
                <button
                  type="button"
                  onClick={() => onCreate(day)}
                  aria-label={`Добавить задачу на ${format(day, 'd MMMM', { locale: ru })}`}
                  className="mt-auto flex items-center gap-1 px-1 py-1 text-2xs text-text-subtle opacity-0 group-hover/day:opacity-100 hover:text-accent focus:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <Plus className="size-3" />
                  Задача
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
