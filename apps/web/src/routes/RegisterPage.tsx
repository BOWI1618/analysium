import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '~/lib/api';
import { useSession } from '~/app/session';
import { AuthLayout } from './AuthLayout';
import { Button } from '~/ui/Button';
import { Checkbox, Input } from '~/ui/Input';

export function RegisterPage() {
  const { register } = useSession();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', email: '', password: '', workspaceName: '' });
  const [consent, setConsent] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const resend = async (email: string) => {
    // Answers the same regardless of whether the address is known, so a failure
    // here says nothing worth reporting differently.
    await api.post('/auth/resend-verification', { email }).catch(() => undefined);
    setResent(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const awaitingVerification = await register({
        name: form.name,
        email: form.email,
        password: form.password,
        consent: true,
        ...(form.workspaceName.trim() ? { workspaceName: form.workspaceName.trim() } : {}),
      });
      if (awaitingVerification) setSentTo(form.email);
      else navigate('/', { replace: true });
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

  // The account exists but has no session yet — nothing to do here but open the
  // message, so the form is replaced rather than left on screen half-usable.
  if (sentTo) {
    return (
      <AuthLayout
        title="Проверьте почту"
        subtitle={`Ссылка для подтверждения отправлена на ${sentTo}. Откройте её, чтобы завершить регистрацию.`}
        footer={
          <>
            Письмо не пришло?{' '}
            <button
              type="button"
              onClick={() => void resend(sentTo)}
              className="font-bold text-accent hover:underline"
            >
              Отправить ещё раз
            </button>
            {resent && <span className="ml-2 text-xs text-text-subtle">Отправлено.</span>}
          </>
        }
      >
        <p className="text-sm leading-relaxed text-text-muted">
          Проверьте папку «Спам», если письма нет во входящих. Ссылка действует ограниченное
          время — если она устареет, запросите новую.
        </p>
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

        <Checkbox
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          label={
            <span className="text-xs leading-relaxed text-text-muted">
              Я согласен на обработку персональных данных в соответствии с{' '}
              <Link to="/privacy" target="_blank" className="font-bold text-accent hover:underline">
                политикой обработки персональных данных
              </Link>
              .
            </span>
          }
        />
        {fieldErrors.consent && (
          <p role="alert" className="text-xs font-medium text-danger">
            {fieldErrors.consent}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" fullWidth loading={pending} disabled={!consent}>
          Создать аккаунт
        </Button>
      </form>
    </AuthLayout>
  );
}
