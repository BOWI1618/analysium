import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '~/lib/api';
import { useSession } from '~/app/session';
import { AuthLayout } from './AuthLayout';
import { Button } from '~/ui/Button';
import { Input } from '~/ui/Input';

export function RegisterPage() {
  const { register } = useSession();
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
          label="Рабочая почта"
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
        <Input
          label="Название пространства"
          inputSize="lg"
          value={form.workspaceName}
          error={fieldErrors.workspaceName}
          onChange={update('workspaceName')}
          placeholder="Acme (необязательно)"
          hint="Переименовать или добавить пространства можно позже."
        />

        <Button type="submit" variant="primary" size="lg" fullWidth loading={pending}>
          Создать аккаунт
        </Button>
      </form>
    </AuthLayout>
  );
}
