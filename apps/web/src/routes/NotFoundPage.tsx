import { Link } from 'react-router-dom';
import { Topbar } from '~/components/Topbar';
import { Button } from '~/ui/Button';
import { Marker, Masthead } from '~/ui/Masthead';

export function NotFoundPage() {
  return (
    <>
      <Topbar breadcrumbs={[{ label: 'Страница не найдена' }]} />
      <div className="min-h-0 flex-1 overflow-y-auto bg-bg">
        <div className="mx-auto max-w-2xl p-4 sm:p-6 lg:p-8">
          <Masthead
            kicker="ошибка 404"
            title={
              <>
                Такой страницы <Marker>нет</Marker>
              </>
            }
            note="Ссылка устарела, или объект удалён."
          />
          <div className="pt-6">
            <Link to="/">
              <Button variant="primary" size="md">
                На главную
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
