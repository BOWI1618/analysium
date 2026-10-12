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
