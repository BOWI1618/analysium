import { Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { carriedFilters } from '~/features/issues/useFilterState';
import {
  CalendarDays,
  Columns3,
  GanttChartSquare,
  LayoutList,
  ListTodo,
  FolderPlus,
  PieChart,
  Plus,
  Settings,
  Star,
  StarOff,
} from 'lucide-react';
import { Permission } from '@flowdesk/contracts';
import { useSession, useWorkspaceCan } from '~/app/session';
import { useProject, useProjects, useToggleFavorite } from '~/features/projects/hooks';
import { Topbar } from '~/components/Topbar';
import { RouteTabs, type TabItem } from '~/ui/Tabs';
import { ErrorState, Skeleton } from '~/ui/Feedback';
import { Button, IconButton } from '~/ui/Button';
import { ProjectIcon } from '~/ui/ProjectIcon';

/**
 * Project chrome: breadcrumbs, favourite toggle and the view tabs. The views
 * themselves are routes, so a board or a filtered list is always a real URL.
 */
export function ProjectLayout() {
  const { projectId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const { workspace } = useSession();
  const navigate = useNavigate();
  const canCreateProject = useWorkspaceCan(Permission.PROJECT_CREATE);
  const { data: projects } = useProjects(workspace?.id ?? '');
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
  // Named in the breadcrumbs when the viewer can open it; otherwise the subproject reads as a project of its own.
  const parent = project.parentId ? projects?.find((candidate) => candidate.id === project.parentId) : undefined;
  // The views that show tasks hand the current filter to each other; analytics
  // and settings are not filtered lists and get a clean address.
  const filtered = carriedFilters(searchParams);
  const tabs: TabItem[] = [
    { to: `${base}/board${filtered}`, label: 'Доска', icon: <Columns3 className="size-3.5" /> },
    { to: `${base}/list${filtered}`, label: 'Список', icon: <LayoutList className="size-3.5" /> },
    ...(project.projectType === 'SCRUM'
      ? [{ to: `${base}/backlog${filtered}`, label: 'Спринты', icon: <ListTodo className="size-3.5" /> }]
      : []),
    { to: `${base}/gantt${filtered}`, label: 'Гант', icon: <GanttChartSquare className="size-3.5" /> },
    { to: `${base}/calendar${filtered}`, label: 'Календарь', icon: <CalendarDays className="size-3.5" /> },
    { to: `${base}/dashboard`, label: 'Аналитика', icon: <PieChart className="size-3.5" /> },
    ...(project.permissions.includes(Permission.PROJECT_UPDATE)
      ? [{ to: `${base}/settings`, label: 'Настройки', icon: <Settings className="size-3.5" /> }]
      : []),
  ];

  return (
    <>
      <Topbar
        breadcrumbs={[
          ...(project.isSystem ? [] : [{ label: 'Проекты', to: '/projects' }]),
          ...(parent ? [{ label: parent.name, to: `/projects/${parent.id}` }] : []),
          { label: project.name, icon: <ProjectIcon icon={project.icon} color={project.color} size="sm" /> },
        ]}
        actions={
          project.isSystem ? undefined : (
          <>
          {/* One level deep: a subproject is added to a project of its own. */}
          {canCreateProject && !project.parentId && !project.isArchived && (
            <>
              {/* In words where the bar has room for them; as an icon where the breadcrumbs need it more. */}
              <Button
                size="sm"
                variant="ghost"
                className="hidden xl:inline-flex"
                iconLeft={<Plus className="size-3.5" />}
                onClick={() => navigate(`/projects/new?parent=${project.id}`)}
              >
                Подпроект
              </Button>
              <span className="hidden sm:inline-flex xl:hidden">
                <IconButton
                  label="Новый подпроект"
                  size="sm"
                  onClick={() => navigate(`/projects/new?parent=${project.id}`)}
                >
                  <FolderPlus className="size-4" />
                </IconButton>
              </span>
            </>
          )}
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
          </>
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
