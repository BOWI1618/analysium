import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { format, isToday } from 'date-fns';
import { CalendarCard, startCardDrag, type CalendarDrag, type CardFields } from './CalendarCard';
import { dayKey, layoutTimed, type CalendarItem } from './items';

const HOUR_PX = 56;
const PX_PER_MIN = HOUR_PX / 60;
const snap = (minutes: number, step: number) => Math.round(minutes / step) * step;
const clampDay = (minutes: number) => Math.min(24 * 60 - 15, Math.max(0, minutes));

export interface DayViewProps {
  day: Date;
  items: CalendarItem[];
  fields: CardFields;
  canEdit: boolean;
  /** Hour the grid opens at when today's current time is not on screen. */
  dayStartsAt: number;
  drag: CalendarDrag | null;
  onDragChange: (drag: CalendarDrag | null) => void;
  onOpen: (issueId: string) => void;
  onToggleDone: (item: CalendarItem) => void;
  onDropAtTime: (minutes: number) => void;
  onDropWholeDay: () => void;
  onResize: (item: CalendarItem, end: Date) => void;
  onCreateAt: (minutes: number) => void;
}

/**
 * One day by the hour. Whole-day tasks and periods sit in a strip on top; a
 * task with a time is a block from its start to its end. Blocks are dragged to
 * another time, stretched by their lower edge, and an empty hour is clicked to
 * add a task at that time.
 */
export function DayView({
  day,
  items,
  fields,
  canEdit,
  dayStartsAt,
  drag,
  onDragChange,
  onOpen,
  onToggleDone,
  onDropAtTime,
  onDropWholeDay,
  onResize,
  onCreateAt,
}: DayViewProps) {
  const key = dayKey(day);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [overWholeDay, setOverWholeDay] = useState(false);
  const [resize, setResize] = useState<{ item: CalendarItem; end: number } | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Open at the current time today, otherwise at the start of the working day.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hour = isToday(day) ? Math.max(0, new Date().getHours() - 1) : dayStartsAt;
    el.scrollTop = hour * HOUR_PX;
    // Only when the day or the setting changes — not on every re-render.
  }, [key, dayStartsAt]);

  const minutesAt = (clientY: number) => {
    const rect = gridRef.current!.getBoundingClientRect();
    return (clientY - rect.top) / PX_PER_MIN;
  };

  const touching = items.filter((item) => item.startKey <= key && item.endKey >= key);
  const wholeDay = touching.filter((item) => !item.timed);
  const timed = layoutTimed(touching.filter((item) => item.timed));
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);

  // A resize follows the pointer until it is released anywhere on the page.
  useEffect(() => {
    if (!resize) return undefined;
    const move = (event: PointerEvent) =>
      setResize((current) =>
        current
          ? {
              ...current,
              end: Math.max(
                (current.item.start.getTime() - dayStart.getTime()) / 60000 + 15,
                clampDay(snap(minutesAt(event.clientY), 15)) + 0,
              ),
            }
          : null,
      );
    const up = () => {
      setResize((current) => {
        if (current) onResize(current.item, new Date(dayStart.getTime() + current.end * 60000));
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

  const nowMinutes = isToday(day) ? now.getHours() * 60 + now.getMinutes() : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Whole day */}
      <div
        onDragOver={(event) => {
          if (!canEdit || !drag) return;
          event.preventDefault();
          setOverWholeDay(true);
        }}
        onDragLeave={() => setOverWholeDay(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOverWholeDay(false);
          if (canEdit && drag) onDropWholeDay();
        }}
        className={clsx(
          'flex min-h-10 shrink-0 items-start gap-2 border-b-2 border-border-strong bg-surface-sunken px-2 py-1.5',
          overWholeDay && 'bg-accent-subtle',
        )}
      >
        <span className="fd-eyebrow w-12 shrink-0 pt-1 text-[9px]">Весь день</span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {wholeDay.length === 0 ? (
            <span className="py-1 text-2xs text-text-subtle">
              {canEdit ? 'Перетащите сюда задачу, чтобы она была на весь день' : 'Нет задач на весь день'}
            </span>
          ) : (
            wholeDay.map((item) => (
              <CalendarCard
                key={item.issue.id}
                item={item}
                fields={fields}
                canEdit={canEdit}
                compact
                className="max-w-64"
                dragging={drag?.issueId === item.issue.id}
                onOpen={() => onOpen(item.issue.id)}
                onToggleDone={() => onToggleDone(item)}
                onDragStart={(event) => onDragChange(startCardDrag(event, item, item.issue.id, key))}
                onDragEnd={() => onDragChange(null)}
              />
            ))
          )}
        </div>
      </div>

      {/* Hours */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="relative flex" style={{ height: 24 * HOUR_PX }}>
          <div className="w-14 shrink-0 border-r-2 border-border-strong bg-surface-sunken" aria-hidden="true">
            {Array.from({ length: 24 }, (_, hour) => (
              <div key={hour} className="fd-num relative text-right text-[10px] text-text-subtle" style={{ height: HOUR_PX }}>
                {hour > 0 && <span className="absolute -top-2 right-1.5">{String(hour).padStart(2, '0')}:00</span>}
              </div>
            ))}
          </div>

          <div
            ref={gridRef}
            className={clsx('relative flex-1', canEdit && 'cursor-cell')}
            onClick={(event) => {
              if (!canEdit || event.target !== event.currentTarget) return;
              onCreateAt(clampDay(Math.floor(minutesAt(event.clientY) / 30) * 30));
            }}
            onDragOver={(event) => {
              if (!canEdit || !drag) return;
              event.preventDefault();
              setHover(clampDay(snap(minutesAt(event.clientY) - drag.grabMinutes, 15)));
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setHover(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (canEdit && drag) onDropAtTime(clampDay(snap(minutesAt(event.clientY) - drag.grabMinutes, 15)));
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

            {hover !== null && (
              <div
                className="pointer-events-none absolute inset-x-1 z-10 border-2 border-dashed border-accent bg-accent-subtle/60"
                style={{ top: hover * PX_PER_MIN, height: 30 * PX_PER_MIN }}
              >
                <span className="fd-num absolute -top-4 left-0 bg-accent px-1 text-[10px] font-bold text-accent-fg">
                  {format(new Date(dayStart.getTime() + hover * 60000), 'HH:mm')}
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
                        setResize({ item, end: endMinutes });
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
        </div>
      </div>
    </div>
  );
}
