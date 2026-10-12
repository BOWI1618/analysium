import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '~/lib/api';
import { useAuthConfig, useSession } from '~/app/session';
import { AuthLayout } from './AuthLayout';
import { Button } from '~/ui/Button';
import { Input } from '~/ui/Input';

/**
 * The first account of the installation: whoever makes it owns the workspace
 * and lets everyone else in. Once it exists there is no sign-up — the page
 * says so and points at the two ways in that remain.
 */
export function RegisterPage() {
  const { register } = useSession();
  const { data: authConfig } = useAuthConfig();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', email: '', password: '', workspaceName: '' });
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
      await register({
        name: form.name,
        email: form.email,
        password: form.password,
        ...(form.workspaceName.trim() ? { workspaceName: form.workspaceName.trim() } : {}),
      });
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fields);
      } else {
        setError('Сервер недоступен. API запущен?');
      }
    } finally {
      setPending(false);
    }
  };

  // Filling in the form would only end in a refusal, so it is not shown.
  if (authConfig && !authConfig.registrationOpen) {
    return (
      <AuthLayout
        title="Регистрация закрыта"
        subtitle="Доступ выдаёт владелец пространства: попросите у него ссылку для входа и откройте её."
        footer={
          <>
            Уже есть аккаунт?{' '}
            <Link to="/login" className="font-bold text-accent hover:underline">
              Войти
            </Link>
          </>
        }
      >
        <Link to="/login">
          <Button variant="primary" size="lg" fullWidth>
            Ко входу
          </Button>
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Создать аккаунт"
      subtitle="Настройка пространства займёт меньше минуты."
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
          <div role="alert" className="rounded-md border-2 border-danger-border bg-danger-subtle px-3 py-2 text-sm text-danger font-medium">
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
        <Input
          label="Название пространства"
          inputSize="lg"
          value={form.workspaceName}
          error={fieldErrors.workspaceName}
          onChange={update('workspaceName')}
          placeholder="Acme (необязательно)"
          hint="Переименовать пространство можно позже."
        />

        <Button type="submit" variant="primary" size="lg" fullWidth loading={pending}>
          Создать аккаунт
        </Button>
      </form>
    </AuthLayout>
  );
}
