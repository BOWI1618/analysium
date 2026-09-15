import { useState } from 'react';
import clsx from 'clsx';
import { format, isSameMonth, isToday } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Plus } from 'lucide-react';
import { CalendarCard, startCardDrag, type CalendarDrag, type CardFields } from './CalendarCard';
import { dayKey, layoutPeriods, type CalendarItem } from './items';

const VISIBLE_PER_DAY = 3;

export interface MonthViewProps {
  weeks: Date[][];
  anchor: Date;
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
 * The month: a period is one bar across its days, a day's own tasks are listed
 * under the bars. Dragging moves a task — a period by its start.
 */
export function MonthView({
  weeks,
  anchor,
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
}: MonthViewProps) {
  const [overKey, setOverKey] = useState<string | null>(null);
  const columnCount = weeks[0]?.length ?? 7;
  const columns = `repeat(${columnCount}, minmax(6rem, 1fr))`;

  // Every part of a day's column — number, bar rows, task list — takes a drop for that day.
  const dropTarget = (day: Date, key: string) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!canEdit || !drag) return;
      event.preventDefault();
      setOverKey(key);
    },
    onDragLeave: () => setOverKey((current) => (current === key ? null : current)),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      setOverKey(null);
      if (canEdit && drag) onDropOnDay(day);
    },
  });

  return (
    <div className="min-w-fit">
      <div className="sticky top-0 z-20 grid border-b-2 border-border-strong bg-surface-sunken" style={{ gridTemplateColumns: columns }}>
        {weeks[0]?.map((day) => (
          <div key={dayKey(day)} className="px-2 py-1.5 text-2xs font-bold tracking-wide text-text-subtle uppercase">
            {format(day, 'EEEEEE', { locale: ru })}
          </div>
        ))}
      </div>

      {weeks.map((week) => {
        const keys = week.map(dayKey);
        const periods = showPeriods ? layoutPeriods(items.filter((i) => i.period), keys) : [];
        const periodRows = Math.max(0, ...periods.map((p) => p.row + 1));
        const listRow = 2 + periodRows;
        const cellTone = (day: Date, key: string) =>
          clsx(
            'border-l-2 border-border-strong first:border-l-0',
            isSameMonth(day, anchor) ? 'bg-surface' : 'bg-surface-sunken',
            overKey === key && 'bg-accent-subtle',
          );

        return (
          <div
            key={keys[0]}
            className="grid border-b-2 border-border-strong"
            style={{
              gridTemplateColumns: columns,
              // `repeat(0, …)` is invalid CSS and would drop the whole declaration.
              gridTemplateRows: `auto ${periodRows > 0 ? `repeat(${periodRows}, 22px) ` : ''}minmax(4.5rem, auto)`,
            }}
          >
            {week.map((day, index) => {
              const key = keys[index]!;
              const column = index + 1;
              const own = items
                .filter((item) => !item.period && item.endKey === key)
                .sort((a, b) => Number(a.timed) - Number(b.timed) || a.start.getTime() - b.start.getTime());
              const outside = !isSameMonth(day, anchor);

              return [
                <div
                  key={`${key}-head`}
                  {...dropTarget(day, key)}
                  className={clsx(cellTone(day, key), 'group/day flex items-center gap-1 p-1')}
                  style={{ gridColumn: column, gridRow: 1 }}
                >
                  <button
                    type="button"
                    onClick={() => onOpenDay(day)}
                    title="Открыть день по часам"
                    className={clsx(
                      'fd-num inline-flex size-5 items-center justify-center text-2xs font-bold hover:ring-2 hover:ring-accent/40',
                      isToday(day) ? 'bg-accent text-accent-fg' : outside ? 'text-text-subtle' : 'text-text-muted',
                    )}
                  >
                    {format(day, 'd')}
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => onCreate(day)}
                      aria-label={`Добавить задачу на ${format(day, 'd MMMM', { locale: ru })}`}
                      className="ml-auto p-0.5 text-text-subtle opacity-0 group-hover/day:opacity-100 hover:text-accent focus:opacity-100 [@media(hover:none)]:hidden"
                    >
                      <Plus className="size-3" />
                    </button>
                  )}
                </div>,

                periodRows > 0 && (
                  <div
                    key={`${key}-bars`}
                    {...dropTarget(day, key)}
                    className={cellTone(day, key)}
                    style={{ gridColumn: column, gridRow: `2 / span ${periodRows}` }}
                    aria-hidden="true"
                  />
                ),

                <div
                  key={`${key}-list`}
                  {...dropTarget(day, key)}
                  className={clsx(cellTone(day, key), 'flex flex-col gap-1 p-1')}
                  style={{ gridColumn: column, gridRow: listRow }}
                >
                  {/* Phones: a dot per task; the day opens by the hour on tap. */}
                  {own.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onOpenDay(day)}
                      className="flex flex-wrap gap-1 sm:hidden"
                      aria-label={`Задач: ${own.length}`}
                    >
                      {own.slice(0, 8).map((item) => (
                        <span key={item.issue.id} className="size-1.5 bg-accent" aria-hidden="true" />
                      ))}
                    </button>
                  )}
                  <div className="hidden flex-col gap-1 sm:flex">
                    {own.slice(0, VISIBLE_PER_DAY).map((item) => (
                      <CalendarCard
                        key={item.issue.id}
                        item={item}
                        fields={{ ...fields, labels: false }}
                        canEdit={canEdit}
                        compact
                        dragging={drag?.issueId === item.issue.id}
                        onOpen={() => onOpen(item.issue.id)}
                        onToggleDone={() => onToggleDone(item)}
                        onDragStart={(event) => onDragChange(startCardDrag(event, item, item.issue.id, key))}
                        onDragEnd={() => onDragChange(null)}
                      />
                    ))}
                    {own.length > VISIBLE_PER_DAY && (
                      <button
                        type="button"
                        onClick={() => onOpenDay(day)}
                        className="px-1 text-left text-2xs text-text-subtle hover:text-accent"
                      >
                        ещё {own.length - VISIBLE_PER_DAY}
                      </button>
                    )}
                  </div>
                </div>,
              ];
            })}

            {periods.map(({ item, row, from, to }) => (
              <CalendarCard
                key={item.issue.id}
                item={item}
                fields={{ assignee: false, priority: false, labels: false }}
                canEdit={canEdit}
                compact
                className="z-10 mx-1 my-px hidden sm:flex"
                style={{ gridColumn: `${from + 1} / ${to + 2}`, gridRow: 2 + row }}
                dragging={drag?.issueId === item.issue.id}
                onOpen={() => onOpen(item.issue.id)}
                onToggleDone={() => onToggleDone(item)}
                onDragStart={(event) => onDragChange(startCardDrag(event, item, item.issue.id, keys[from] ?? item.startKey))}
                onDragEnd={() => onDragChange(null)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
