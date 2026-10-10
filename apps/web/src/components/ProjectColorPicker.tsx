import { Pipette } from 'lucide-react';
import { PROJECT_COLORS } from '~/lib/projectMeta';

const RING = '0 0 0 2px var(--surface), 0 0 0 4px var(--border-strong)';

/** Whether ink or paper reads better on a colour: the pipette has to stay visible on whatever was picked. */
function readsDarkOn(hex: string): boolean {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000';
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(value.slice(start, start + 2), 16));
  return (0.299 * r! + 0.587 * g! + 0.114 * b!) / 255 > 0.6;
}

/**
 * A project's colour: the palette's own eight, or any other.
 *
 * Eight were enough for eight projects. The last swatch opens the browser's
 * colour picker — the full range, with a field for an exact value — and then
 * wears the colour picked, so what is chosen is always one of the squares.
 */
export function ProjectColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const custom = !PROJECT_COLORS.some((color) => color.value.toLowerCase() === value.toLowerCase());

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PROJECT_COLORS.map(({ value: color, label }) => {
        const selected = !custom && value.toLowerCase() === color.toLowerCase();
        return (
          <button
            key={color}
            type="button"
            onClick={() => onChange(color)}
            aria-pressed={selected}
            aria-label={`Цвет: ${label}`}
            title={label}
            className="size-7 border-2 border-border-strong"
            style={{ backgroundColor: color, boxShadow: selected ? RING : undefined }}
          />
        );
      })}

      <label
        title={custom ? `Свой цвет: ${value}` : 'Выбрать свой цвет'}
        className="relative flex size-7 cursor-pointer items-center justify-center border-2 border-border-strong bg-surface text-text hover:bg-surface-hover"
        style={custom ? { backgroundColor: value, boxShadow: RING, color: readsDarkOn(value) ? '#14225a' : '#ffffff' } : undefined}
      >
        <Pipette className="size-3.5" aria-hidden="true" />
        {/* The real control lies over the square, invisible: a click anywhere on it opens the picker. */}
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#005dac'}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Свой цвет"
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
      {custom && <span className="fd-num text-2xs text-text-subtle">{value}</span>}
    </div>
  );
}
