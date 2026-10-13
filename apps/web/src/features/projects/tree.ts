/**
 * Projects as people see them: a subproject under the project it belongs to.
 *
 * A subproject is a project in every respect; the tree is only how the
 * navigation and the pickers lay projects out. It is one level deep. A
 * subproject whose parent is not in the list — archived, or closed to this
 * person — stands on its own: hiding it together with the parent would hide
 * work the person can open.
 */
interface Nested {
  id: string;
  parentId?: string | null;
}

export interface ProjectBranch<T> {
  project: T;
  children: T[];
}

export function projectTree<T extends Nested>(projects: T[]): ProjectBranch<T>[] {
  const listed = new Set(projects.map((project) => project.id));
  const branches = new Map<string, ProjectBranch<T>>();
  const roots: ProjectBranch<T>[] = [];

  for (const project of projects) {
    if (project.parentId && listed.has(project.parentId)) continue;
    const branch = { project, children: [] as T[] };
    branches.set(project.id, branch);
    roots.push(branch);
  }
  for (const project of projects) {
    if (project.parentId && listed.has(project.parentId)) branches.get(project.parentId)?.children.push(project);
  }
  return roots;
}

/**
 * The figures of a project as its own screens count them: together with its
 * subprojects.
 *
 * A project's board, list and analytics show its subprojects' tasks too, and
 * the number next to its name used to count only its own — «1» in the menu
 * over a board of ten. A subproject keeps its own figures, so the parent's
 * reads as their sum plus its own.
 *
 * The same subprojects are taken as the board takes: the ones in the list —
 * so those the person may open — and not the archived ones.
 */
export function withFamilyCounts<
  T extends Nested & { isArchived?: boolean; openIssueCount?: number; totalIssueCount?: number },
>(projects: T[]): T[] {
  const extra = new Map<string, { open: number; total: number }>();
  const listed = new Set(projects.map((project) => project.id));
  for (const project of projects) {
    if (!project.parentId || !listed.has(project.parentId) || project.isArchived) continue;
    const sum = extra.get(project.parentId) ?? { open: 0, total: 0 };
    sum.open += project.openIssueCount ?? 0;
    sum.total += project.totalIssueCount ?? 0;
    extra.set(project.parentId, sum);
  }
  if (extra.size === 0) return projects;
  return projects.map((project) => {
    const sum = extra.get(project.id);
    return sum
      ? {
          ...project,
          openIssueCount: (project.openIssueCount ?? 0) + sum.open,
          totalIssueCount: (project.totalIssueCount ?? 0) + sum.total,
        }
      : project;
  });
}
