import type { ReactNode } from 'react';

/** Split layout: form on the left, product framing on the right. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh bg-bg">
      <div className="flex w-full flex-col justify-center px-6 py-10 lg:w-[46%] lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2">
            <span
              className="flex size-9 items-center justify-center border-2 border-border-strong bg-accent text-accent-fg shadow-sm"
              aria-hidden="true"
            >
              <svg viewBox="0 0 32 32" className="size-5" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M9 9h14M9 16h9M9 23h5" strokeLinecap="square" />
              </svg>
            </span>
            <span>
              <span className="block font-display text-base font-extrabold uppercase leading-none">FlowDesk</span>
              <span className="fd-num mt-1 block text-[10px] text-text-subtle">трекер задач · v1.0</span>
            </span>
          </div>

          <h1 className="fd-display text-[clamp(1.75rem,3vw,2.5rem)]">{title}</h1>
          <p className="mt-2 border-t-2 border-border-strong pt-3 font-mono text-2xs leading-relaxed text-text-muted">
            {subtitle}
          </p>

          <div className="mt-6">{children}</div>

          <div className="mt-6 text-sm text-text-muted">{footer}</div>
        </div>
      </div>

      <aside className="relative hidden flex-1 overflow-hidden border-l-2 border-border-strong bg-bg-subtle lg:block">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, var(--text) 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
          aria-hidden="true"
        />
        <div className="relative flex h-full flex-col justify-center px-16">
          <blockquote className="max-w-md">
            <p className="fd-display text-[clamp(1.5rem,2.4vw,2.125rem)]">
              Планируйте, ведите и выпускайте — <span className="marker-hl">без лишних ритуалов</span>.
            </p>
            <p className="mt-5 font-mono text-2xs leading-relaxed text-text-muted">
              Доски, спринты и интерфейс под клавиатуру, который успевает за командой,
              а не тормозит её.
            </p>
          </blockquote>

          <ul className="mt-10 grid max-w-md grid-cols-2 gap-4 text-sm">
            {[
              ['Канбан и Скрам', 'Доски, бэклоги, спринты и аналитика'],
              ['Реальное время', 'Изменения коллег видно сразу'],
              ['Клавиатура прежде всего', 'Создать, назначить и переместить без мыши'],
              ['Точные права', 'Права пространства и отдельных проектов'],
            ].map(([title, body]) => (
              <li key={title} className="border-2 border-border-strong bg-surface p-3.5 shadow-md">
                <p className="fd-eyebrow">{title}</p>
                <p className="mt-1.5 text-xs text-text-muted">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
