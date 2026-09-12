import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import { useClickOutside } from '~/lib/hooks/useClickOutside';

interface MenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  menuId: string;
}

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenu(): MenuContextValue {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error('Menu components must be used inside <Menu>');
  return ctx;
}

export interface MenuProps {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Menu({ children, open: controlledOpen, onOpenChange }: MenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuId = useId();

  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  const value = useMemo(() => ({ open, setOpen, triggerRef, menuId }), [open, setOpen, menuId]);
  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

/**
 * The trigger keeps a box of its own even when it only wraps a single child:
 * the menu is positioned from this element's rect, and `display: contents`
 * would measure as zero. Callers that need the child to fill the row stretch
 * it from the container instead.
 */
export function MenuTrigger({ children }: { children: ReactNode }) {
  const { open, setOpen, triggerRef, menuId } = useMenu();

  return (
    <span
      ref={triggerRef as React.RefObject<HTMLSpanElement>}
      className="inline-flex"
      onClick={(event) => {
        event.stopPropagation();
        setOpen(!open);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setOpen(!open);
        }
      }}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
    >
      {children}
    </span>
  );
}

export interface MenuContentProps {
  children: ReactNode;
  align?: 'start' | 'end' | 'center';
  side?: 'bottom' | 'top';
  className?: string;
  /** Fixed width; otherwise the menu hugs its content. */
  width?: number;
  label?: string;
}

/**
 * Portalled dropdown with roving keyboard focus. Positioned against the
 * trigger's viewport rect and flipped when it would overflow the window.
 */
export function MenuContent({
  children,
  align = 'start',
  side = 'bottom',
  className,
  width,
  label,
}: MenuContentProps) {
  const { open, setOpen, triggerRef, menuId } = useMenu();
  const contentRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useClickOutside([contentRef, triggerRef], () => setOpen(false), open);

  useEffect(() => {
    if (!open || !triggerRef.current) return undefined;

    const place = () => {
      const trigger = triggerRef.current;
      const content = contentRef.current;
      if (!trigger || !content) return;

      const rect = trigger.getBoundingClientRect();
      const menuRect = content.getBoundingClientRect();
      const gap = 4;

      let top = side === 'bottom' ? rect.bottom + gap : rect.top - menuRect.height - gap;
      let left =
        align === 'start' ? rect.left : align === 'end' ? rect.right - menuRect.width : rect.left + rect.width / 2 - menuRect.width / 2;

      // Flip / clamp so the menu always stays on screen.
      if (top + menuRect.height > window.innerHeight - 8) {
        top = Math.max(8, rect.top - menuRect.height - gap);
      }
      left = Math.min(Math.max(8, left), window.innerWidth - menuRect.width - 8);
      setCoords({ top, left });
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align, side, triggerRef]);

  useEffect(() => {
    if (!open) return undefined;

    const items = () =>
      Array.from(
        contentRef.current?.querySelectorAll<HTMLElement>('[data-menu-item]:not([data-disabled])') ?? [],
      );

    const onKeyDown = (event: KeyboardEvent) => {
      const list = items();
      if (list.length === 0) return;
      const index = list.indexOf(document.activeElement as HTMLElement);

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        list[(index + 1) % list.length]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        list[(index - 1 + list.length) % list.length]?.focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        list[0]?.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        list[list.length - 1]?.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        (triggerRef.current?.querySelector('button') ?? triggerRef.current)?.focus?.();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    // Focus the first item so the menu is immediately keyboard-navigable.
    const raf = requestAnimationFrame(() => items()[0]?.focus());
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      cancelAnimationFrame(raf);
    };
  }, [open, setOpen, triggerRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={contentRef}
      id={menuId}
      role="menu"
      aria-label={label}
      className={clsx(
        'fixed z-[var(--z-menu)] min-w-40 overflow-hidden rounded-md border-2 border-border-strong bg-surface p-1 shadow-lg',
        'animate-scale-in origin-top scrollbar-thin max-h-[min(28rem,80vh)] overflow-y-auto',
        className,
      )}
      style={{
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        width,
        visibility: coords ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface MenuItemProps {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  shortcut?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  selected?: boolean;
  /** Keeps the menu open — used by multi-select filter menus. */
  keepOpen?: boolean;
}

export function MenuItem({
  children,
  onSelect,
  icon,
  shortcut,
  disabled,
  danger,
  selected,
  keepOpen,
}: MenuItemProps) {
  const { setOpen } = useMenu();

  return (
    <button
      type="button"
      role="menuitem"
      data-menu-item
      data-disabled={disabled || undefined}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        onSelect?.();
        if (!keepOpen) setOpen(false);
      }}
      className={clsx(
        'flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm font-medium',
        'transition-colors duration-75 outline-none',
        'hover:bg-surface-active focus:bg-surface-active',
        disabled && 'cursor-not-allowed opacity-40',
        danger && 'text-danger hover:bg-danger-subtle focus:bg-danger-subtle',
        selected && 'bg-marker font-bold text-ink',
      )}
    >
      {icon && <span className="flex size-4 shrink-0 items-center justify-center text-text-subtle">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected && <Check className="size-3.5 shrink-0" />}
      {shortcut && <span className="shrink-0 text-text-subtle">{shortcut}</span>}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-0.5 bg-border-strong" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 py-1 text-2xs font-semibold tracking-wide text-text-subtle uppercase">{children}</div>
  );
}
