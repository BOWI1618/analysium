import { useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Archive, FolderPlus, LayoutGrid, Plus, Star, StarOff } from 'lucide-react';
import { useSession } from '~/app/session';
import { useProjects, useToggleFavorite } from '~/features/projects/hooks';
import { Topbar } from '~/components/Topbar';
import { Marker, Masthead } from '~/ui/Masthead';
import { Avatar } from '~/ui/Avatar';
import { Badge } from '~/ui/Badge';
import { Button, IconButton } from '~/ui/Button';
import { EmptyState, ErrorState, ProgressBar, Skeleton } from '~/ui/Feedback';
import { Checkbox } from '~/ui/Input';
import { ProjectIcon } from '~/ui/ProjectIcon';
import { fullDate, pluralize, relativeTime } from '~/lib/format';

export function ProjectsPage() {
  const { workspace } = useSession();
  const workspaceId = workspace?.id ?? '';
  const [showArchived, setShowArchived] = useState(false);

  const { data: projects, isLoading, error, refetch } = useProjects(workspaceId, showArchived);
  const toggleFavorite = useToggleFavorite(workspaceId);

  const canCreate = workspace?.role !== 'GUEST';

  return (
    <>
      <Topbar
        breadcrumbs={[{ label: 'Проекты' }]}
        actions={
          canCreate ? (
            <Link to="/projects/new">
              {/* On phones the label is hidden, and a bare plus sat right next to
                  the "create task" plus — two identical buttons doing different
                  things. The folder icon keeps them apart. */}
              <Button
                size="sm"
                variant="secondary"
                iconLeft={<FolderPlus className="size-3.5" />}
                aria-label="Новый проект"
              >
                <span className="hidden sm:inline">Новый проект</span>
              </Button>
            </Link>
          ) : undefined
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto bg-bg scrollbar-thin">
        <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
          <Masthead
            kicker={workspace?.name}
            title={
              <>
                Все <Marker>проекты</Marker>
              </>
            }
            note={
              projects
                ? `${pluralize(projects.length, ['проект', 'проекта', 'проектов'])} в «${workspace?.name}»`
                : 'Загружаем…'
            }
            actions={
              <Checkbox
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
                label={<span className="text-xs text-text-muted">Показать архивные</span>}
              />
            }
          />

          {error ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-36" />
              ))}
            </div>
          ) : projects && projects.length === 0 ? (
            <EmptyState
              icon={<LayoutGrid className="size-6" />}
              title="Проектов пока нет"
              description="В проекте есть доска, бэклог и собственный рабочий процесс. Создайте первый, чтобы начать."
              action={
                canCreate ? (
                  <Link to="/projects/new">
                    <Button variant="primary" size="sm" iconLeft={<Plus className="size-3.5" />}>
                      Создать первый проект
                    </Button>
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {projects?.map((project) => {
                const total = project.totalIssueCount ?? 0;
                const open = project.openIssueCount ?? 0;
                const done = Math.max(0, total - open);

                return (
                  <li key={project.id}>
                    <div
                      className={clsx(
                        'group relative h-full border-2 border-border-strong bg-surface p-3.5 shadow-sm transition-colors',
                        'hover:bg-surface-hover fd-lift',
                        project.isArchived && 'opacity-60',
                      )}
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className="flex size-9 shrink-0 items-center justify-center bg-surface-active text-text"
                          aria-hidden="true"
                        >
                          <ProjectIcon icon={project.icon} color={project.color} size="md" />
                        </span>

                        <div className="min-w-0 flex-1">
                          <Link
                            to={`/projects/${project.id}`}
                            className="block truncate text-sm font-semibold hover:text-accent"
                          >
                            {project.name}
                            <span className="absolute inset-0" aria-hidden="true" />
                          </Link>
                          <p className="mt-0.5 flex items-center gap-1.5">
                            <span className="fd-key">{project.key}</span>
                            {project.projectType === 'SCRUM' && <Badge>спринты</Badge>}
                            {project.isArchived && (
                              <Badge tone="warning">
                                <Archive className="size-2.5" />
                                В архиве
                              </Badge>
                            )}
                          </p>
                        </div>

                        <IconButton
                          label={project.isFavorite ? 'Убрать из избранного' : 'В избранное'}
                          size="xs"
                          className="relative z-10"
                          onClick={() => toggleFavorite.mutate(project.id)}
                        >
                          {project.isFavorite ? (
                            <Star className="size-3.5 fill-warning text-warning" />
                          ) : (
                            <StarOff className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                          )}
                        </IconButton>
                      </div>

                      {project.description && (
                        <p className="mt-2 line-clamp-2 text-xs text-text-muted">{project.description}</p>
                      )}

                      <ProgressBar
                        value={done}
                        max={Math.max(total, 1)}
                        className="mt-3"
                        tone="success"
                        label={`Готово ${done} из ${total} задач`}
                      />

                      <div className="mt-2 flex items-center gap-2">
                        <span className="fd-num truncate text-2xs whitespace-nowrap text-text-subtle">
                          {open} в работе · {done} готово
                        </span>
                        <span className="ml-auto flex shrink-0 items-center gap-1.5">
                          {project.lead && <Avatar user={project.lead} size="sm" />}
                          <span
                            className="fd-num text-2xs whitespace-nowrap text-text-subtle"
                            title={fullDate(project.updatedAt)}
                          >
                            {relativeTime(project.updatedAt)}
                          </span>
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
