import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '~/lib/api';
import { useSession } from '~/app/session';
import { AuthLayout } from './AuthLayout';
import { Button } from '~/ui/Button';
import { Input } from '~/ui/Input';

/**
 * Joining a workspace with a code from its admin.
 *
 * Works whether or not public registration is open — a code is the invitation.
 * A link shared as `/join?code=…` fills the code in, so the person only has to
 * say who they are.
 */
export function JoinPage() {
  const [params] = useSearchParams();
  const { joinWithCode } = useSession();
  const navigate = useNavigate();

  const [form, setForm] = useState({ code: params.get('code') ?? '', name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const awaitingVerification = await joinWithCode({
        code: form.code,
        name: form.name,
        email: form.email,
        password: form.password,
      });
      if (awaitingVerification) setSentTo(form.email);
      else navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fields);
      } else {
        setError('Сервер недоступен. Попробуйте ещё раз.');
      }
    } finally {
      setPending(false);
    }
  };

  // With mail switched on the account exists but still needs its address
  // confirmed, exactly as after a normal registration.
  if (sentTo) {
    return (
      <AuthLayout
        title="Проверьте почту"
        subtitle={`Ссылка для подтверждения отправлена на ${sentTo}. Откройте её, чтобы войти.`}
        footer={
          <Link to="/login" className="font-bold text-accent hover:underline">
            Ко входу
          </Link>
        }
      >
        {null}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Присоединиться"
      subtitle="Введите код от администратора пространства и придумайте, как будете входить."
      footer={
        <>
          Уже есть аккаунт?{' '}
          <Link to="/login" className="font-bold text-accent hover:underline">
            Войти
          </Link>
        </>
      }
    >
      <form className="space-y-3" onSubmit={submit}>
        {error && (
          <div
            role="alert"
            className="rounded-md border-2 border-danger-border bg-danger-subtle px-3 py-2 text-sm font-medium text-danger"
          >
            {error}
          </div>
        )}

        <Input
          label="Код приглашения"
          required
          autoComplete="one-time-code"
          inputSize="lg"
          value={form.code}
          error={fieldErrors.code}
          onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value.toUpperCase() }))}
          placeholder="ABCD-EFGH"
          className="fd-num tracking-[0.15em]"
        />
        <Input
          label="Ваше имя"
          required
          autoComplete="name"
          inputSize="lg"
          value={form.name}
          error={fieldErrors.name}
          onChange={update('name')}
          placeholder="Ада Лавлейс"
        />
        <Input
          label="Почта для входа"
          type="email"
          required
          autoComplete="email"
          inputSize="lg"
          value={form.email}
          error={fieldErrors.email}
          onChange={update('email')}
          placeholder="you@company.com"
        />
        <Input
          label="Пароль"
          type="password"
          required
          autoComplete="new-password"
          inputSize="lg"
          value={form.password}
          error={fieldErrors.password}
          onChange={update('password')}
          hint="Минимум 8 символов, включая букву и цифру."
          placeholder="••••••••"
        />

        <Button type="submit" variant="primary" size="lg" fullWidth loading={pending}>
          Присоединиться
        </Button>
      </form>
    </AuthLayout>
  );
}
