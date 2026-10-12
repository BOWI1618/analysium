import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '~/lib/api';
import { useSession } from '~/app/session';
import { AuthLayout } from './AuthLayout';
import { Button } from '~/ui/Button';
import { Input } from '~/ui/Input';

/**
 * Getting into a workspace by the link its owner gave.
 *
 * The link is the invitation: `/join?code=…` carries a one-time code, so the
 * person only says who they are and how they will sign in. Opened without a
 * code — the link was retyped, or only the code was passed on — the page asks
 * for it.
 */
export function JoinPage() {
  const [params] = useSearchParams();
  const { joinWithCode } = useSession();
  const navigate = useNavigate();

  const codeFromLink = params.get('code') ?? '';
  const [form, setForm] = useState({ code: codeFromLink, name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      await joinWithCode({
        code: form.code,
        name: form.name,
        email: form.email,
        password: form.password,
      });
      navigate('/', { replace: true });
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

  return (
    <AuthLayout
      title="Присоединиться"
      subtitle={
        codeFromLink
          ? 'Вас пригласили в Analysium. Назовитесь и придумайте, как будете входить.'
          : 'Сюда попадают по ссылке от владельца пространства. Если у вас только код из неё — введите его.'
      }
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

        {/* The link already carries the code: showing it would only invite retyping. */}
        {!codeFromLink && (
          <Input
            label="Код из ссылки"
            required
            autoComplete="one-time-code"
            inputSize="lg"
            value={form.code}
            error={fieldErrors.code}
            onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value.toUpperCase() }))}
            placeholder="ABCD-EFGH"
            className="fd-num tracking-[0.15em]"
          />
        )}
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
          label="Логин"
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          inputSize="lg"
          value={form.email}
          error={fieldErrors.email}
          onChange={update('email')}
          placeholder="ada"
          hint="По нему вы будете входить. Буквы, цифры и знаки . _ - @ +, без пробелов."
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
