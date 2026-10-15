import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { format, getISOWeek, isToday } from 'date-fns';
import { ru } from 'date-fns/locale';
import { CalendarCard, startCardDrag, type CalendarDrag, type CardFields } from './CalendarCard';
import { dayKey, layoutTimed, type CalendarItem } from './items';

// Taller than the project's day view: a half-hour task has room for its time and title.
const HOUR_PX = 80;
const PX_PER_MIN = HOUR_PX / 60;
const snap = (minutes: number, step: number) => Math.round(minutes / step) * step;
const clampDay = (minutes: number) => Math.min(24 * 60 - 15, Math.max(0, minutes));
const midnight = (day: Date) => {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  return start;
};

export interface TimeGridViewProps {
  days: Date[];
  /** Only tasks with a time; anything else is the caller's to leave out. */
  items: CalendarItem[];
  fields: CardFields;
  canEdit: boolean;
  /** Hour the grid opens at when the current time is not on screen. */
  dayStartsAt: number;
  drag: CalendarDrag | null;
  onDragChange: (drag: CalendarDrag | null) => void;
  onOpen: (issueId: string) => void;
  onToggleDone: (item: CalendarItem) => void;
  onDropAt: (day: Date, minutes: number) => void;
  onResize: (item: CalendarItem, end: Date) => void;
  onCreateAt: (day: Date, minutes: number) => void;
}

/**
 * Several days side by side by the hour, the way Weeek's own calendar is laid
 * out: a column per day, a task is a block from its start to its end. Blocks
 * are dragged to another day and time, stretched by their lower edge, and an
 * empty slot is clicked to add a task there.
 */
export function TimeGridView({
  days,
  items,
  fields,
  canEdit,
  dayStartsAt,
  drag,
  onDragChange,
  onOpen,
  onToggleDone,
  onDropAt,
  onResize,
  onCreateAt,
}: TimeGridViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ key: string; minutes: number } | null>(null);
  const [resize, setResize] = useState<{ item: CalendarItem; dayStart: Date; end: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const keys = days.map(dayKey);
  const columns = `3.5rem repeat(${days.length}, minmax(8rem, 1fr))`;
  const showsToday = days.some((day) => isToday(day));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Open at the current time when today is on screen, otherwise at the start of the working day.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hour = showsToday ? Math.max(0, new Date().getHours() - 1) : dayStartsAt;
    el.scrollTop = hour * HOUR_PX;
    // Only when the period changes — not on every re-render.
  }, [keys.join(), dayStartsAt]);

  const minutesAt = (clientY: number) => {
    const rect = gridRef.current!.getBoundingClientRect();
    return (clientY - rect.top) / PX_PER_MIN;
  };

  // A resize follows the pointer until it is released anywhere on the page.
  useEffect(() => {
    if (!resize) return undefined;
    const move = (event: PointerEvent) =>
      setResize((current) =>
        current
          ? {
              ...current,
              end: Math.max(
                (current.item.start.getTime() - current.dayStart.getTime()) / 60000 + 15,
                clampDay(snap(minutesAt(event.clientY), 15)),
              ),
            }
          : null,
      );
    const up = () => {
      setResize((current) => {
        if (current) onResize(current.item, new Date(current.dayStart.getTime() + current.end * 60000));
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // Bound once per resize; the handlers read the latest state through the setter.
  }, [resize?.item.issue.id]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto scrollbar-thin">
      <div className="min-w-fit">
        {/* Day headings */}
        <div className="sticky top-0 z-20 grid border-b-2 border-border-strong bg-surface-sunken" style={{ gridTemplateColumns: columns }}>
          <span className="fd-num flex items-end border-r-2 border-border-strong px-1.5 py-1.5 text-[10px] whitespace-nowrap text-text-subtle">
            {days[0] ? `${getISOWeek(days[0])} нед.` : ''}
          </span>
          {days.map((day, index) => (
            <div
              key={dayKey(day)}
              className={clsx(
                'flex items-baseline justify-center gap-1.5 border-border-strong px-2 py-1.5',
                index > 0 && 'border-l-2',
                isToday(day) && 'bg-marker-subtle',
              )}
            >
              <span className="text-2xs font-bold tracking-wide text-text-subtle uppercase">
                {format(day, 'EEEEEE', { locale: ru })}
              </span>
              <span className={clsx('fd-num text-sm font-bold', isToday(day) ? 'bg-accent px-1 text-accent-fg' : 'text-text')}>
                {format(day, 'd')}
              </span>
            </div>
          ))}
        </div>

        {/* Hours */}
        <div ref={gridRef} className="relative grid" style={{ gridTemplateColumns: columns, height: 24 * HOUR_PX }}>
          <div className="border-r-2 border-border-strong bg-surface-sunken" aria-hidden="true">
            {Array.from({ length: 24 }, (_, hour) => (
              <div key={hour} className="fd-num relative text-right text-[10px] text-text-subtle" style={{ height: HOUR_PX }}>
                {hour > 0 && <span className="absolute -top-2 right-1.5">{String(hour).padStart(2, '0')}:00</span>}
              </div>
            ))}
          </div>

          {days.map((day, index) => {
            const key = keys[index]!;
            const dayStart = midnight(day);
            const timed = layoutTimed(items.filter((item) => item.startKey === key));
            const nowMinutes = isToday(day) ? now.getHours() * 60 + now.getMinutes() : null;
            const dropMinutes = (clientY: number) => clampDay(snap(minutesAt(clientY) - (drag?.grabMinutes ?? 0), 15));

            return (
              <div
                key={key}
                aria-label={format(day, 'EEEE, d MMMM', { locale: ru })}
                className={clsx('relative border-border-strong', index > 0 && 'border-l-2', canEdit && 'cursor-cell')}
                onClick={(event) => {
                  if (!canEdit || event.target !== event.currentTarget) return;
                  onCreateAt(day, clampDay(Math.floor(minutesAt(event.clientY) / 30) * 30));
                }}
                onDragOver={(event) => {
                  if (!canEdit || !drag) return;
                  event.preventDefault();
                  setHover({ key, minutes: dropMinutes(event.clientY) });
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) setHover(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (canEdit && drag) onDropAt(day, dropMinutes(event.clientY));
                  setHover(null);
                }}
              >
                {/* Hour and half-hour rules; the evening and the night are shaded. */}
                {Array.from({ length: 24 }, (_, hour) => (
                  <div
                    key={hour}
                    className={clsx(
                      'pointer-events-none absolute inset-x-0 border-t border-border',
                      (hour < 8 || hour >= 20) && 'bg-surface-sunken/60',
                    )}
                    style={{ top: hour * HOUR_PX, height: HOUR_PX }}
                  >
                    <div className="absolute inset-x-0 border-t border-dashed border-border/60" style={{ top: HOUR_PX / 2 }} />
                  </div>
                ))}

                {hover?.key === key && (
                  <div
                    className="pointer-events-none absolute inset-x-1 z-10 border-2 border-dashed border-accent bg-accent-subtle/60"
                    style={{ top: hover.minutes * PX_PER_MIN, height: 30 * PX_PER_MIN }}
                  >
                    <span className="fd-num absolute -top-4 left-0 bg-accent px-1 text-[10px] font-bold text-accent-fg">
                      {format(new Date(dayStart.getTime() + hover.minutes * 60000), 'HH:mm')}
                    </span>
                  </div>
                )}

                {timed.map(({ item, lane, lanes }) => {
                  const top = Math.max(0, (item.start.getTime() - dayStart.getTime()) / 60000);
                  const endMinutes =
                    resize?.item.issue.id === item.issue.id
                      ? resize.end
                      : Math.min(24 * 60, (item.end.getTime() - dayStart.getTime()) / 60000);
                  return (
                    <CalendarCard
                      key={item.issue.id}
                      item={item}
                      fields={fields}
                      canEdit={canEdit}
                      compact={endMinutes - top < 45}
                      floating
                      className="z-[5] overflow-hidden"
                      style={{
                        top: top * PX_PER_MIN + 1,
                        height: Math.max(18, (endMinutes - top) * PX_PER_MIN - 2),
                        left: `calc(${(lane / lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                      }}
                      dragging={drag?.issueId === item.issue.id}
                      onOpen={() => onOpen(item.issue.id)}
                      onToggleDone={() => onToggleDone(item)}
                      onDragStart={(event) => onDragChange(startCardDrag(event, item, item.issue.id, key, PX_PER_MIN))}
                      onDragEnd={() => {
                        onDragChange(null);
                        setHover(null);
                      }}
                    >
                      {canEdit && (
                        <span
                          role="presentation"
                          title="Потяните, чтобы изменить длительность"
                          draggable={false}
                          onClick={(event) => event.stopPropagation()}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            event.preventDefault();
                            setResize({ item, dayStart, end: endMinutes });
                          }}
                          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 group-hover:bg-accent/50 group-hover:opacity-100"
                        />
                      )}
                    </CalendarCard>
                  );
                })}

                {nowMinutes !== null && (
                  <div className="pointer-events-none absolute inset-x-0 z-[6] h-[3px] bg-danger" style={{ top: nowMinutes * PX_PER_MIN - 1 }}>
                    <span className="absolute -top-1 -left-1 size-2 bg-danger" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
