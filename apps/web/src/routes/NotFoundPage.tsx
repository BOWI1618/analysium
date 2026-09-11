import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Topbar } from '~/components/Topbar';
import { EmptyState } from '~/ui/Feedback';
import { Button } from '~/ui/Button';

export function NotFoundPage() {
  return (
    <>
      <Topbar breadcrumbs={[{ label: 'Страница не найдена' }]} />
      <EmptyState
        icon={<Compass className="size-6" />}
        title="Такой страницы нет"
        description="Ссылка устарела или объект удалён."
        action={
          <Link to="/">
            <Button variant="primary" size="sm">
              На главную
            </Button>
          </Link>
        }
      />
    </>
  );
}
