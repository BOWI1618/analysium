import { useMemo, useState } from 'react';
import type { IssueDetailDto, IssueLinkDto } from '@flowdesk/contracts';
import { Link2, Plus, Search, Unlink, X } from 'lucide-react';
import { useUiStore } from '~/app/uiStore';
import { useCreateDependency, useDeleteDependency, useIssueLinks } from '~/features/gantt/hooks';
import { StatusDot } from '~/components/IssueMeta';
import { Button, IconButton } from '~/ui/Button';
import { ConfirmDialog } from '~/ui/Dialog';
import { SegmentedControl } from '~/ui/Tabs';
import { flattenPages, useIssueList } from './hooks';

type Direction = 'dependsOn' | 'blocks';

/**
 * Everything an issue is tied to, in one place: the task it is a subtask of,
 * the issues it waits for and the issues waiting for it. Dependencies used to
 * be visible, and removable, only by hovering an arrow tip on the Gantt chart.
 */
export function IssueLinks({
  issue,
  canEdit,
  onDetach,
}: {
  issue: IssueDetailDto;
  canEdit: boolean;
  /** Turns a subtask into a task of its own. */
  onDetach: () => void;
}) {
  const openIssue = useUiStore((s) => s.openIssue);
  const { data: links } = useIssueLinks(issue.id);
  const createDependency = useCreateDependency(issue.projectId);
  const deleteDependency = useDeleteDependency(issue.projectId);

  const [adding, setAdding] = useState(false);
  const [confirmDetach, setConfirmDetach] = useState(false);

  const linkedIds = useMemo(
    () => new Set([...(links?.dependsOn ?? []), ...(links?.blocks ?? [])].map((l) => l.issue.id)),
    [links],
  );
  const empty = !issue.parent && links && links.dependsOn.length === 0 && links.blocks.length === 0;

  return (
    <section className="mt-5" aria-label="Связи">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="fd-eyebrow">Связи</h3>
        {canEdit && !adding && (
          <Button size="xs" variant="ghost" iconLeft={<Plus className="size-3" />} onClick={() => setAdding(true)}>
            Добавить
          </Button>
        )}
      </div>

      {adding && (
        <AddLink
          issue={issue}
          excludeIds={linkedIds}
          pending={createDependency.isPending}
          onCancel={() => setAdding(false)}
          onPick={(direction, otherId) =>
            createDependency.mutate(
              direction === 'dependsOn'
                ? { predecessorId: otherId, successorId: issue.id, type: 'FINISH_TO_START', lagDays: 0 }
                : { predecessorId: issue.id, successorId: otherId, type: 'FINISH_TO_START', lagDays: 0 },
              { onSuccess: () => setAdding(false) },
            )
          }
        />
      )}

      {empty && !adding && (
        <p className="text-xs text-text-subtle">
          Связей нет. «Зависит от» значит, что задача начинается после другой — на диаграмме Ганта это стрелка.
        </p>
      )}

      <div className="space-y-3">
        {issue.parent && (
          <LinkGroup title="Подзадача задачи">
            <li className="flex items-center gap-2 px-2 py-1.5">
              <button
                type="button"
                onClick={() => openIssue(issue.parent!.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-accent"
              >
                <span className="fd-key shrink-0">{issue.parent.issueKey}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{issue.parent.title}</span>
              </button>
              {canEdit && (
                <Button
                  size="xs"
                  variant="ghost"
                  iconLeft={<Unlink className="size-3" />}
                  onClick={() => setConfirmDetach(true)}
                >
                  Отвязать
                </Button>
              )}
            </li>
          </LinkGroup>
        )}

        {links && links.dependsOn.length > 0 && (
          <LinkGroup title="Зависит от">
            {links.dependsOn.map((link) => (
              <LinkRow
                key={link.dependencyId}
                link={link}
                canEdit={canEdit}
                onOpen={() => openIssue(link.issue.id)}
                onDelete={() => deleteDependency.mutate(link.dependencyId)}
              />
            ))}
          </LinkGroup>
        )}

        {links && links.blocks.length > 0 && (
          <LinkGroup title="Блокирует">
            {links.blocks.map((link) => (
              <LinkRow
                key={link.dependencyId}
                link={link}
                canEdit={canEdit}
                onOpen={() => openIssue(link.issue.id)}
                onDelete={() => deleteDependency.mutate(link.dependencyId)}
              />
            ))}
          </LinkGroup>
        )}
      </div>

      <ConfirmDialog
        open={confirmDetach}
        onClose={() => setConfirmDetach(false)}
        onConfirm={() => {
          setConfirmDetach(false);
          onDetach();
        }}
        title={`Отвязать ${issue.issueKey} от ${issue.parent?.issueKey}?`}
        message="Подзадача станет отдельной задачей проекта и получит свой номер. Старый номер продолжит открывать её."
        confirmLabel="Отвязать"
      />
    </section>
  );
}

function LinkGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-2xs font-bold text-text-subtle uppercase">{title}</p>
      <ul className="divide-y-2 divide-border-strong border-2 border-border-strong">{children}</ul>
    </div>
  );
}

function LinkRow({
  link,
  canEdit,
  onOpen,
  onDelete,
}: {
  link: IssueLinkDto;
  canEdit: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex items-center gap-2 px-2 py-1.5">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-accent">
        <StatusDot status={link.issue.status} className="size-3 shrink-0" />
        <span className="fd-key shrink-0">{link.issue.issueKey}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{link.issue.title}</span>
        {link.lagDays !== 0 && (
          <span className="fd-num shrink-0 text-2xs text-text-subtle">
            {link.lagDays > 0 ? `+${link.lagDays}` : link.lagDays} дн
          </span>
        )}
      </button>
      {canEdit && (
        <IconButton label={`Удалить связь с ${link.issue.issueKey}`} size="xs" onClick={onDelete}>
          <X className="size-3.5" />
        </IconButton>
      )}
    </li>
  );
}

/** Picks the direction and the other issue — from the same project, as the chart requires. */
function AddLink({
  issue,
  excludeIds,
  pending,
  onCancel,
  onPick,
}: {
  issue: IssueDetailDto;
  excludeIds: Set<string>;
  pending: boolean;
  onCancel: () => void;
  onPick: (direction: Direction, otherId: string) => void;
}) {
  const [direction, setDirection] = useState<Direction>('dependsOn');
  const [term, setTerm] = useState('');
  const query = useIssueList(
    { projectId: issue.projectId },
    { includeDone: true, includeSubtasks: true, search: term.trim() || undefined, sort: 'updated', order: 'desc' },
    { limit: 20 },
  );
  const candidates = flattenPages(query.data)
    .filter((candidate) => candidate.id !== issue.id && !excludeIds.has(candidate.id))
    .slice(0, 8);

  return (
    <div className="mb-3 space-y-2 border-2 border-border-strong bg-surface-sunken p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-muted">{issue.issueKey}</span>
        <SegmentedControl
          label="Вид связи"
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'dependsOn', label: 'Зависит от' },
            { value: 'blocks', label: 'Блокирует' },
          ]}
        />
        <IconButton label="Отменить добавление связи" size="xs" className="ml-auto" onClick={onCancel}>
          <X className="size-3.5" />
        </IconButton>
      </div>

      <div className="flex items-center gap-1.5 border-2 border-border-strong bg-surface px-2 py-1">
        <Search className="size-3.5 shrink-0 text-text-subtle" />
        <input
          autoFocus
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Задача этого проекта: номер или название"
          aria-label="Найти задачу для связи"
          className="w-full bg-transparent text-sm outline-none placeholder:text-text-subtle"
        />
      </div>

      <ul className="max-h-64 overflow-y-auto">
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            <button
              type="button"
              disabled={pending}
              onClick={() => onPick(direction, candidate.id)}
              className="flex w-full items-center gap-2 px-1.5 py-1 text-left hover:bg-surface-hover disabled:opacity-60"
            >
              <Link2 className="size-3 shrink-0 text-text-subtle" />
              <StatusDot status={candidate.status} className="size-3 shrink-0" />
              <span className="fd-key shrink-0">{candidate.issueKey}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{candidate.title}</span>
            </button>
          </li>
        ))}
        {!query.isLoading && candidates.length === 0 && (
          <li className="px-1.5 py-2 text-xs text-text-subtle">Подходящих задач нет</li>
        )}
      </ul>
    </div>
  );
}
