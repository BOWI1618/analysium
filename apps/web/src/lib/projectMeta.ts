import {
  BarChart3,
  Compass,
  FlaskConical,
  Globe,
  MessageSquare,
  Package,
  Palette,
  Rocket,
  Settings2,
  ShieldCheck,
  Smartphone,
  Wrench,
} from 'lucide-react';

export interface ProjectIconOption {
  name: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}

export const PROJECT_ICONS: ProjectIconOption[] = [
  { name: 'package', label: 'Коробка', Icon: Package },
  { name: 'globe', label: 'Глобус', Icon: Globe },
  { name: 'smartphone', label: 'Телефон', Icon: Smartphone },
  { name: 'wrench', label: 'Инструмент', Icon: Wrench },
  { name: 'rocket', label: 'Ракета', Icon: Rocket },
  { name: 'palette', label: 'Палитра', Icon: Palette },
  { name: 'shield-check', label: 'Щит', Icon: ShieldCheck },
  { name: 'bar-chart-3', label: 'График', Icon: BarChart3 },
  { name: 'settings-2', label: 'Настройки', Icon: Settings2 },
  { name: 'flask-conical', label: 'Лаборатория', Icon: FlaskConical },
  { name: 'message-square', label: 'Сообщение', Icon: MessageSquare },
  { name: 'compass', label: 'Компас', Icon: Compass },
];

export interface ProjectColorOption {
  value: string;
  label: string;
}

/**
 * The palette a project picks its colour from.
 *
 * These are literal hex values, not `var(--…)` references: the colour is
 * persisted on the project and the API validates it as `#rrggbb`, so a CSS
 * variable would be rejected on save and would mean nothing to any consumer
 * outside the browser. The values mirror the palette tokens by hand.
 */
export const PROJECT_COLORS: ProjectColorOption[] = [
  { value: '#005dac', label: 'Фирменный синий' },
  { value: '#283a97', label: 'Индиго' },
  { value: '#00aeef', label: 'Голубой' },
  { value: '#14225a', label: 'Тёмно-синий' },
  { value: '#0f7a44', label: 'Зелёный' },
  { value: '#e06412', label: 'Оранжевый' },
  { value: '#c22e1f', label: 'Красный' },
  { value: '#7c88a1', label: 'Нейтральный' },
];
