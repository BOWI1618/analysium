import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '~/lib/api';
import { AuthLayout } from './AuthLayout';
import { Button } from '~/ui/Button';

type State = { status: 'checking' } | { status: 'done' } | { status: 'failed'; message: string };

/**
 * Lands here from the link in the verification e-mail.
 *
 * The token is spent on arrival, so the request must fire exactly once — mail
 * clients and browsers both prefetch links, and React runs effects twice in
 * development. A ref guards it rather than a dependency array.
 */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<State>({ status: 'checking' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!token) {
      setState({ status: 'failed', message: 'В ссылке нет кода подтверждения.' });
      return;
    }

    api
      .post('/auth/verify-email', { token })
      .then(() => setState({ status: 'done' }))
      .catch((error) => setState({ status: 'failed', message: errorMessage(error) }));
  }, [token]);

  if (state.status === 'checking') {
    return <AuthLayout title="Подтверждаем" subtitle="Секунду — проверяем ссылку." footer={null}>{null}</AuthLayout>;
  }

  if (state.status === 'done') {
    return (
      <AuthLayout
        title="Почта подтверждена"
        subtitle="Теперь можно войти — аккаунт активен."
        footer={null}
      >
        <Link to="/login">
          <Button variant="primary" size="lg" fullWidth>
            Войти
          </Button>
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Ссылка не сработала"
      subtitle={state.message}
      footer={
        <Link to="/login" className="font-bold text-accent hover:underline">
          Вернуться ко входу
        </Link>
      }
    >
      <p className="text-sm leading-relaxed text-text-muted">
        Ссылку можно открыть один раз, и она живёт ограниченное время. Если срок вышел, запросите
        новое письмо на странице входа.
      </p>
    </AuthLayout>
  );
}
