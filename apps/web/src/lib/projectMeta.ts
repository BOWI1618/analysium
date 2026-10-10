import {
  BarChart3,
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  Bug,
  Building2,
  CalendarDays,
  Camera,
  ClipboardList,
  Code,
  Compass,
  Database,
  Eye,
  Factory,
  FileText,
  Flag,
  FlaskConical,
  Globe,
  GraduationCap,
  Handshake,
  Heart,
  Leaf,
  Lightbulb,
  Lock,
  Map,
  Megaphone,
  MessageSquare,
  Package,
  Palette,
  Puzzle,
  Rocket,
  Scale,
  Server,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Star,
  Target,
  TrendingUp,
  Trophy,
  Truck,
  UserCheck,
  Users,
  Wallet,
  Wrench,
  Zap,
} from 'lucide-react';

export interface ProjectIconOption {
  name: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}

/**
 * The icons a project can wear. The first twelve are the original set; the
 * rest were added when a dozen stopped being enough to tell projects apart.
 * Names are what is stored on the project, so an entry is never renamed.
 */
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
  { name: 'briefcase', label: 'Портфель', Icon: Briefcase },
  { name: 'users', label: 'Команда', Icon: Users },
  { name: 'user-check', label: 'Кадры', Icon: UserCheck },
  { name: 'graduation-cap', label: 'Обучение', Icon: GraduationCap },
  { name: 'book-open', label: 'Книга', Icon: BookOpen },
  { name: 'file-text', label: 'Документ', Icon: FileText },
  { name: 'clipboard-list', label: 'Список', Icon: ClipboardList },
  { name: 'calendar-days', label: 'Календарь', Icon: CalendarDays },
  { name: 'megaphone', label: 'Рупор', Icon: Megaphone },
  { name: 'handshake', label: 'Рукопожатие', Icon: Handshake },
  { name: 'scale', label: 'Весы', Icon: Scale },
  { name: 'wallet', label: 'Кошелёк', Icon: Wallet },
  { name: 'lightbulb', label: 'Идея', Icon: Lightbulb },
  { name: 'target', label: 'Цель', Icon: Target },
  { name: 'trending-up', label: 'Рост', Icon: TrendingUp },
  { name: 'trophy', label: 'Кубок', Icon: Trophy },
  { name: 'star', label: 'Звезда', Icon: Star },
  { name: 'flag', label: 'Флаг', Icon: Flag },
  { name: 'heart', label: 'Сердце', Icon: Heart },
  { name: 'zap', label: 'Молния', Icon: Zap },
  { name: 'building-2', label: 'Здание', Icon: Building2 },
  { name: 'factory', label: 'Завод', Icon: Factory },
  { name: 'truck', label: 'Доставка', Icon: Truck },
  { name: 'shopping-cart', label: 'Корзина', Icon: ShoppingCart },
  { name: 'map', label: 'Карта', Icon: Map },
  { name: 'leaf', label: 'Лист', Icon: Leaf },
  { name: 'camera', label: 'Камера', Icon: Camera },
  { name: 'eye', label: 'Наблюдение', Icon: Eye },
  { name: 'code', label: 'Код', Icon: Code },
  { name: 'database', label: 'База данных', Icon: Database },
  { name: 'server', label: 'Сервер', Icon: Server },
  { name: 'bot', label: 'Робот', Icon: Bot },
  { name: 'brain', label: 'Интеллект', Icon: Brain },
  { name: 'lock', label: 'Замок', Icon: Lock },
  { name: 'bug', label: 'Жук', Icon: Bug },
  { name: 'puzzle', label: 'Пазл', Icon: Puzzle },
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
