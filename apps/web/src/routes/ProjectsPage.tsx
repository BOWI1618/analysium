import { useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Archive, ChevronRight, FolderPlus, LayoutGrid, Plus, Star, StarOff } from 'lucide-react';
import type { ProjectDto } from '@flowdesk/contracts';
import { useSession, useWorkspaceCan } from '~/app/session';
import { Permission } from '@flowdesk/contracts';
import { useProjects, useToggleFavorite } from '~/features/projects/hooks';
import { projectTree } from '~/features/projects/tree';
import { Topbar } from '~/components/Topbar';
import { Marker, Masthead } from '~/ui/Masthead';
import { Avatar } from '~/ui/Avatar';
import { Badge } from '~/ui/Badge';
import { Button, IconButton } from '~/ui/Button';
import { EmptyState, ErrorState, ProgressBar, Skeleton } from '~/ui/Feedback';
import { Checkbox } from '~/ui/Input';
import { ProjectIcon } from '~/ui/ProjectIcon';
import { useLocalStorage } from '~/lib/hooks/useLocalStorage';
import { fullDate, pluralize, relativeTime } from '~/lib/format';

/**
 * All projects as a list. A project with subprojects opens by its arrow, the
 * way it does in the sidebar: the subprojects stand under it, on a rule.
 *
 * It used to be a grid of cards, where a subproject was one more card with a
 * tag saying whose it was — twelve blocks of the same weight, and the
 * structure had to be read off the tags.
 */
export function ProjectsPage() {
  const { workspace } = useSession();
  const workspaceId = workspace?.id ?? '';
  const [showArchived, setShowArchived] = useState(false);

  const { data: projects, isLoading, error, refetch } = useProjects(workspaceId, showArchived);
  const toggleFavorite = useToggleFavorite(workspaceId);

  const canCreate = useWorkspaceCan(Permission.PROJECT_CREATE);
  // Counted even when hidden, so an empty page can say that everything is archived.
  const { data: withArchived } = useProjects(workspaceId, true);
  const archivedCount = (withArchived ?? []).filter((p) => p.isArchived).length;

  const tree = projectTree(projects ?? []);
  const branches = tree.filter((branch) => branch.children.length > 0);
  // Which projects are open is remembered: it is a way of looking at the list, kept between visits.
  const [openIds, setOpenIds] = useLocalStorage<string[]>('flowdesk.projects-open', []);
  const allOpen = branches.length > 0 && branches.every((branch) => openIds.includes(branch.project.id));
  const toggle = (projectId: string) =>
    setOpenIds((open) => (open.includes(projectId) ? open.filter((id) => id !== projectId) : [...open, projectId]));

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
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {branches.length > 0 && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setOpenIds(allOpen ? [] : branches.map((branch) => branch.project.id))}
                  >
                    {allOpen ? 'Свернуть подпроекты' : 'Раскрыть подпроекты'}
                  </Button>
                )}
                <Checkbox
                  checked={showArchived}
                  onChange={(event) => setShowArchived(event.target.checked)}
                  label={<span className="text-xs text-text-muted">Показать архивные</span>}
                />
              </div>
            }
          />

          {error ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : isLoading ? (
            <div className="space-y-0.5 border-2 border-border-strong">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : projects && projects.length === 0 && !showArchived && archivedCount > 0 ? (
            <EmptyState
              icon={<Archive className="size-6" />}
              title="Все проекты в архиве"
              description={`${pluralize(archivedCount, ['проект', 'проекта', 'проектов'])} в архиве. Их можно открыть и вернуть обратно.`}
              action={
                <Button variant="secondary" size="sm" onClick={() => setShowArchived(true)}>
                  Показать архивные
                </Button>
              }
            />
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
            <ul className="divide-y-2 divide-border-strong border-2 border-border-strong bg-surface shadow-sm" aria-label="Проекты">
              {tree.map(({ project, children }) => {
                const open = children.length > 0 && openIds.includes(project.id);
                return (
                  <li key={project.id}>
                    <ProjectRow
                      project={project}
                      subprojects={children.length}
                      open={open}
                      onToggle={() => toggle(project.id)}
                      // Keeps every name in one column once any project has an arrow.
                      indent={branches.length > 0}
                      onFavorite={() => toggleFavorite.mutate(project.id)}
                    />
                    {open && (
                      <ul
                        aria-label={`Подпроекты «${project.name}»`}
                        className="ml-6 divide-y-2 divide-border-strong border-t-2 border-l-2 border-border-strong sm:ml-8"
                      >
                        {children.map((child) => (
                          <li key={child.id}>
                            <ProjectRow project={child} onFavorite={() => toggleFavorite.mutate(child.id)} />
                          </li>
                        ))}
                      </ul>
                    )}
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

/** One project as a line: what it is, how far along, who leads it. The whole line opens it. */
function ProjectRow({
  project,
  subprojects = 0,
  open = false,
  onToggle,
  indent = false,
  onFavorite,
}: {
  project: ProjectDto;
  /** How many subprojects stand under it; with any, the line gets an arrow. */
  subprojects?: number;
  open?: boolean;
  onToggle?: () => void;
  /** Leaves room for an arrow the line itself does not have. */
  indent?: boolean;
  onFavorite: () => void;
}) {
  const total = project.totalIssueCount ?? 0;
  const openTasks = project.openIssueCount ?? 0;
  const done = Math.max(0, total - openTasks);

  return (
    <div
      className={clsx(
        'group relative flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 transition-colors hover:bg-surface-hover',
        project.isArchived && 'opacity-60',
      )}
    >
      {subprojects > 0 && onToggle ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? `Свернуть подпроекты «${project.name}»` : `Показать подпроекты «${project.name}»`}
          title={open ? 'Свернуть подпроекты' : `Подпроекты: ${subprojects}`}
          onClick={onToggle}
          className="relative z-10 flex size-6 shrink-0 items-center justify-center text-text-subtle hover:bg-surface-active hover:text-text"
        >
          <ChevronRight className={clsx('size-4 transition-transform', open && 'rotate-90')} />
        </button>
      ) : (
        indent && <span className="size-6 shrink-0" aria-hidden="true" />
      )}

      <span className="flex size-8 shrink-0 items-center justify-center bg-surface-active" aria-hidden="true">
        <ProjectIcon icon={project.icon} color={project.color} size="md" />
      </span>

      <div className="min-w-0 flex-1 basis-52">
        <Link to={`/projects/${project.id}`} className="block truncate text-sm font-bold group-hover:text-accent">
          {project.name}
          <span className="absolute inset-0" aria-hidden="true" />
        </Link>
        <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="fd-key">{project.key}</span>
          {subprojects > 0 && (
            <span className="fd-num text-2xs text-text-subtle">
              {pluralize(subprojects, ['подпроект', 'подпроекта', 'подпроектов'])}
            </span>
          )}
          {project.projectType === 'SCRUM' && <Badge>спринты</Badge>}
          {project.isArchived && (
            <Badge tone="warning">
              <Archive className="size-2.5" />
              В архиве
            </Badge>
          )}
          {project.description && <span className="min-w-0 truncate text-xs text-text-muted">{project.description}</span>}
        </p>
      </div>

      <div className="w-full sm:w-44">
        <ProgressBar value={done} max={Math.max(total, 1)} tone="success" label={`Готово ${done} из ${total} задач`} />
        <p className="fd-num mt-1 truncate text-2xs whitespace-nowrap text-text-subtle">
          {openTasks} открыто · {done} готово
        </p>
      </div>

      <span className="flex w-24 shrink-0 items-center justify-end gap-1.5">
        {project.lead && <Avatar user={project.lead} size="sm" />}
        <span className="fd-num text-2xs whitespace-nowrap text-text-subtle" title={fullDate(project.updatedAt)}>
          {relativeTime(project.updatedAt)}
        </span>
      </span>

      <IconButton
        label={project.isFavorite ? 'Убрать из избранного' : 'В избранное'}
        size="xs"
        className="relative z-10"
        onClick={onFavorite}
      >
        {project.isFavorite ? (
          <Star className="size-3.5 fill-warning text-warning" />
        ) : (
          <StarOff className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" />
        )}
      </IconButton>
    </div>
  );
}
