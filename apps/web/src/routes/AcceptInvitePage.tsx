import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '~/lib/api';
import { useSession } from '~/app/session';
import { AuthLayout } from './AuthLayout';
import { Button } from '~/ui/Button';
import { Input } from '~/ui/Input';

/**
 * Where an invitation link lands.
 *
 * An invited account exists but has no password, so this is the only way in.
 * Opening the link already proves the address, which is why nothing is e-mailed
 * afterwards: the person names themselves, picks a password and is signed in.
 */
export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { acceptInvite } = useSession();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <AuthLayout
        title="Ссылка неполная"
        subtitle="В адресе нет кода приглашения. Откройте ссылку из письма целиком."
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      await acceptInvite({ token, name: form.name, password: form.password });
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
      title="Вас пригласили"
      subtitle="Осталось представиться и придумать пароль — и вы внутри."
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
          label="Ваше имя"
          required
          autoComplete="name"
          inputSize="lg"
          value={form.name}
          error={fieldErrors.name}
          onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
          placeholder="Ада Лавлейс"
        />
        <Input
          label="Пароль"
          type="password"
          required
          autoComplete="new-password"
          inputSize="lg"
          value={form.password}
          error={fieldErrors.password}
          onChange={(event) => setForm((f) => ({ ...f, password: event.target.value }))}
          hint="Минимум 8 символов, включая букву и цифру."
          placeholder="••••••••"
        />

        <Button type="submit" variant="primary" size="lg" fullWidth loading={pending}>
          Принять приглашение
        </Button>
      </form>
    </AuthLayout>
  );
}
