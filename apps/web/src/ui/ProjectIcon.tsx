import { memo } from 'react';
import { PROJECT_ICONS } from '~/lib/projectMeta';

/**
 * Renders the icon a project has stored.
 *
 * The lookup is built from `PROJECT_ICONS` — the same list the icon picker
 * offers — so the two can never drift: an icon added to the palette is
 * renderable everywhere the moment it can be chosen.
 */
const ICONS = new Map(PROJECT_ICONS.map(({ name, Icon }) => [name, Icon]));

export interface ProjectIconProps {
  icon: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_MAP = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-6',
} as const;

export const ProjectIcon = memo(function ProjectIcon({ icon, color, size = 'md', className }: ProjectIconProps) {
  const Icon = ICONS.get(icon.toLowerCase().trim());

  return (
    <span
      className={`flex items-center justify-center ${SIZE_MAP[size]} ${className ?? ''}`}
      style={color ? { color } : undefined}
      aria-hidden="true"
    >
      {/* A project saved before an icon was retired still renders: whatever is
          stored is shown as-is rather than disappearing. */}
      {Icon ? <Icon className="size-full" /> : icon}
    </span>
  );
});
