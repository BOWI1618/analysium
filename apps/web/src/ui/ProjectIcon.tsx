import { memo } from 'react';
import {
  BarChart3,
  Compass,
  FlaskConical,
  Globe,
  LayoutGrid,
  MessageSquare,
  Package,
  Palette,
  Rocket,
  Settings2,
  ShieldCheck,
  Smartphone,
  Wrench,
  type LucideProps,
} from 'lucide-react';

export const PROJECT_ICON_NAMES = [
  'package',
  'globe',
  'smartphone',
  'wrench',
  'rocket',
  'palette',
  'shield-check',
  'bar-chart-3',
  'settings-2',
  'flask-conical',
  'message-square',
  'compass',
] as const;

export type ProjectIconName = (typeof PROJECT_ICON_NAMES)[number];

const ICONS: Record<ProjectIconName, React.ComponentType<LucideProps>> = {
  package: Package,
  globe: Globe,
  smartphone: Smartphone,
  wrench: Wrench,
  rocket: Rocket,
  palette: Palette,
  'shield-check': ShieldCheck,
  'bar-chart-3': BarChart3,
  'settings-2': Settings2,
  'flask-conical': FlaskConical,
  'message-square': MessageSquare,
  compass: Compass,
};

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
};

export const ProjectIcon = memo(function ProjectIcon({ icon, color, size = 'md', className }: ProjectIconProps) {
  const key = icon.toLowerCase().trim() as ProjectIconName;
  const Icon = ICONS[key];

  if (!Icon) {
    return (
      <span
        className={`flex items-center justify-center ${SIZE_MAP[size]} ${className ?? ''}`}
        aria-hidden="true"
      >
        {icon}
      </span>
    );
  }

  return (
    <span
      className={`flex items-center justify-center ${SIZE_MAP[size]} ${className ?? ''}`}
      style={color ? { color } : undefined}
      aria-hidden="true"
    >
      <Icon className="size-full" strokeWidth={2} />
    </span>
  );
});

/** Fallback icon used when a project has no icon at all. */
export function ProjectIconFallback({ size = 'md', className }: Omit<ProjectIconProps, 'icon' | 'color'>) {
  return <LayoutGrid className={`${SIZE_MAP[size]} ${className ?? ''}`} aria-hidden="true" />;
}
