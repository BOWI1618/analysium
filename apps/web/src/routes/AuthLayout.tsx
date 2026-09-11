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
              className="flex size-8 items-center justify-center rounded-lg text-white"
              style={{ background: 'var(--accent)' }}
              aria-hidden="true"
            >
              <svg viewBox="0 0 32 32" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M9 9h14M9 16h9M9 23h5" strokeLinecap="round" />
              </svg>
            </span>
            <span className="text-lg font-semibold tracking-tight">FlowDesk</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-text-muted">{subtitle}</p>

          <div className="mt-6">{children}</div>

          <div className="mt-6 text-sm text-text-muted">{footer}</div>
        </div>
      </div>

      <aside className="relative hidden flex-1 overflow-hidden border-l border-border bg-bg-subtle lg:block">
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
            <p className="text-xl leading-relaxed font-medium">
              Планируйте, ведите и выпускайте — без лишних ритуалов.
            </p>
            <p className="mt-4 text-sm text-text-muted">
              Доски, спринты и интерфейс под клавиатуру, который успевает за командой,
              а не тормозит её.
            </p>
          </blockquote>

          <ul className="mt-10 grid max-w-md grid-cols-2 gap-4 text-sm">
            {[
              ['Канбан и Скрам', 'Доски, бэклоги, спринты и velocity'],
              ['Реальное время', 'Изменения коллег видно сразу'],
              ['Клавиатура прежде всего', 'Создать, назначить и переместить без мыши'],
              ['Точные права', 'Права пространства и отдельных проектов'],
            ].map(([title, body]) => (
              <li key={title} className="rounded-lg border border-border bg-surface p-3">
                <p className="font-medium">{title}</p>
                <p className="mt-0.5 text-xs text-text-muted">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
