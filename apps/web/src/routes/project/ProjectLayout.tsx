import { Outlet, useParams } from 'react-router-dom';
import {
  CalendarDays,
  Columns3,
  GanttChartSquare,
  LayoutList,
  ListTodo,
  PieChart,
  Settings,
  Star,
  StarOff,
} from 'lucide-react';
import { Permission } from '@flowdesk/contracts';
import { useSession } from '~/app/session';
import { useProject, useToggleFavorite } from '~/features/projects/hooks';
import { Topbar } from '~/components/Topbar';
import { RouteTabs, type TabItem } from '~/ui/Tabs';
import { ErrorState, Skeleton } from '~/ui/Feedback';
import { IconButton } from '~/ui/Button';
import { ProjectIcon } from '~/ui/ProjectIcon';

/**
 * Project chrome: breadcrumbs, favourite toggle and the view tabs. The views
 * themselves are routes, so a board or a filtered list is always a real URL.
 */
export function ProjectLayout() {
  const { projectId = '' } = useParams();
  const { workspace } = useSession();
  const { data: project, isLoading, error, refetch } = useProject(projectId);
  const toggleFavorite = useToggleFavorite(workspace?.id ?? '');

  if (isLoading) {
    return (
      <>
        <Topbar breadcrumbs={[{ label: 'Проекты', to: '/projects' }, { label: '…' }]} />
        <div className="space-y-3 bg-bg p-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-8 w-full max-w-md" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }

  if (error || !project) {
    return (
      <>
        <Topbar breadcrumbs={[{ label: 'Проекты', to: '/projects' }, { label: 'Не найден' }]} />
        <div className="bg-bg">
          <ErrorState error={error} onRetry={() => void refetch()} />
        </div>
      </>
    );
  }

  const base = `/projects/${project.id}`;
  const tabs: TabItem[] = [
    { to: `${base}/board`, label: 'Доска', icon: <Columns3 className="size-3.5" /> },
    { to: `${base}/list`, label: 'Список', icon: <LayoutList className="size-3.5" /> },
    ...(project.projectType === 'SCRUM'
      ? [{ to: `${base}/backlog`, label: 'Бэклог', icon: <ListTodo className="size-3.5" /> }]
      : []),
    { to: `${base}/gantt`, label: 'Гант', icon: <GanttChartSquare className="size-3.5" /> },
    { to: `${base}/calendar`, label: 'Календарь', icon: <CalendarDays className="size-3.5" /> },
    { to: `${base}/dashboard`, label: 'Аналитика', icon: <PieChart className="size-3.5" /> },
    // The list of tasks without a project has nothing to configure: it cannot
    // be renamed, archived or deleted, and the server refuses to.
    ...(project.permissions.includes(Permission.PROJECT_UPDATE) && !project.isSystem
      ? [{ to: `${base}/settings`, label: 'Настройки', icon: <Settings className="size-3.5" /> }]
      : []),
  ];

  return (
    <>
      <Topbar
        breadcrumbs={[
          ...(project.isSystem ? [] : [{ label: 'Проекты', to: '/projects' }]),
          { label: project.name, icon: <ProjectIcon icon={project.icon} color={project.color} size="sm" /> },
        ]}
        actions={
          project.isSystem ? undefined : (
          <IconButton
            label={project.isFavorite ? 'Убрать из избранного' : 'В избранное'}
            size="sm"
            onClick={() => toggleFavorite.mutate(project.id)}
          >
            {project.isFavorite ? (
              <Star className="size-4 fill-warning text-warning" />
            ) : (
              <StarOff className="size-4" />
            )}
          </IconButton>
          )
        }
      />

      <div className="flex items-stretch border-b-2 border-border-strong bg-bg-subtle">
        <span className="fd-eyebrow hidden shrink-0 items-center border-r-2 border-border-strong px-4 sm:flex">
          {project.key}
        </span>
        <RouteTabs items={tabs} />
      </div>

      <Outlet />
    </>
  );
}
