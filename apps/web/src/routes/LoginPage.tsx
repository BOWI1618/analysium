import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '~/lib/api';
import { useAuthConfig, useSession } from '~/app/session';
import { AuthLayout } from './AuthLayout';
import { Button } from '~/ui/Button';
import { Input } from '~/ui/Input';

/** Seeded demo account — see the block at the bottom of the form. */
const DEMO = { email: 'alex@acme.test', password: 'demo1234' };

export function LoginPage() {
  const { login } = useSession();
  const { data: authConfig } = useAuthConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resent, setResent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const submit = async (credentials: { email: string; password: string }) => {
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      await login(credentials);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fields);
        // The password was right — the address just has not been proven yet, so
        // the useful next step is another link, not another attempt.
        setNeedsVerification(err.code === 'EMAIL_NOT_VERIFIED');
      } else {
        setError('Сервер недоступен. API запущен?');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout
      title="Вход"
      subtitle="С возвращением — продолжим с того же места."
      footer={
        <>
          Есть код приглашения?{' '}
          <Link to="/join" className="font-bold text-accent hover:underline">
            Присоединиться
          </Link>
          {authConfig?.registrationOpen && (
            <>
              {' · '}
              <Link to="/register" className="font-bold text-accent hover:underline">
                Создать аккаунт
              </Link>
            </>
          )}
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit({ email, password });
        }}
      >
        {error && (
          <div role="alert" className="rounded-md border-2 border-danger-border bg-danger-subtle px-3 py-2 text-sm text-danger font-medium">
            {error}
            {needsVerification && (
              <button
                type="button"
                className="mt-1.5 block font-bold underline hover:no-underline"
                onClick={() => {
                  void api
                    .post('/auth/resend-verification', { email })
                    .catch(() => undefined)
                    .finally(() => setResent(true));
                }}
              >
                {resent ? 'Письмо отправлено' : 'Отправить письмо ещё раз'}
              </button>
            )}
          </div>
        )}

        <Input
          label="Почта"
          type="email"
          autoComplete="email"
          required
          inputSize="lg"
          value={email}
          error={fieldErrors.email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
        />

        <Input
          label="Пароль"
          type="password"
          autoComplete="current-password"
          required
          inputSize="lg"
          value={password}
          error={fieldErrors.password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="••••••••"
        />

        <Button type="submit" variant="primary" size="lg" fullWidth loading={pending}>
          Войти
        </Button>
      </form>

      {/* Development only. `import.meta.env.DEV` is replaced with `false` at
          build time, so the bundler drops this block and the credentials above
          along with it — a production bundle contains neither. */}
      {import.meta.env.DEV && (
        <div className="mt-4 rounded-lg border-2 border-border-strong bg-surface-raised p-3 shadow-xs">
          <p className="text-xs font-bold">Демо-пространство</p>
          <p className="mt-0.5 text-xs text-text-muted">
            Готовое пространство с проектами, спринтами и 70+ задачами.
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            disabled={pending}
            onClick={() => {
              setEmail(DEMO.email);
              setPassword(DEMO.password);
              void submit(DEMO);
            }}
          >
            Войти как Алекс (владелец)
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
