import { createContext, useContext } from 'react';
import clsx from 'clsx';
import { ProjectIcon } from '~/ui/ProjectIcon';

/**
 * The project whose screens are open. A project's board, list, calendar and
 * chart show its own tasks together with those of its subprojects; this is
 * how a card or a row tells which of the two it is drawing.
 */
const HomeProjectContext = createContext<string | null>(null);
export const HomeProjectProvider = HomeProjectContext.Provider;

/**
 * The icon of the subproject a task comes from, in that subproject's colour.
 *
 * Shown only on the screens of the project above it, and only for a task
 * that is not the project's own — there the icon answers «whose is this?»
 * at a glance. Everywhere else every task would carry one, and it would say
 * nothing.
 */
export function SubprojectMark({
  project,
  className,
}: {
  project: { id: string; name: string; icon: string; color: string };
  className?: string;
}) {
  const home = useContext(HomeProjectContext);
  if (!home || project.id === home) return null;
  return (
    <span
      role="img"
      aria-label={`Подпроект: ${project.name}`}
      title={`Подпроект: ${project.name}`}
      className={clsx('inline-flex shrink-0 align-middle', className)}
    >
      <ProjectIcon icon={project.icon} color={project.color} size="sm" />
    </span>
  );
}
