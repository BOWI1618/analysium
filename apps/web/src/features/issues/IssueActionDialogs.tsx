import { useState } from 'react';
import type { IssueDetailDto } from '@flowdesk/contracts';
import { CornerDownRight, Search } from 'lucide-react';
import { StatusDot } from '~/components/IssueMeta';
import { Button } from '~/ui/Button';
import { Dialog, DialogCloseButton } from '~/ui/Dialog';
import { Checkbox, Input } from '~/ui/Input';
import { flattenPages, useDuplicateIssue, useIssueList } from './hooks';

const PARTS = [
  { key: 'description', label: 'Описание' },
  { key: 'subtasks', label: 'Подзадачи' },
  { key: 'assignee', label: 'Исполнитель' },
  { key: 'labels', label: 'Метки' },
  { key: 'dates', label: 'Сроки' },
] as const;

type Part = (typeof PARTS)[number]['key'];

/**
 * «Дублировать задачу»: the copy lands next to the original, in the same
 * column, and opens. Comments, files and history stay with the original.
 */
export function DuplicateIssueDialog({
  issue,
  onClose,
  onDuplicated,
}: {
  issue: IssueDetailDto;
  onClose: () => void;
  onDuplicated: (copy: IssueDetailDto) => void;
}) {
  const duplicate = useDuplicateIssue(issue.id);
  const [title, setTitle] = useState(issue.title);
  const [parts, setParts] = useState<Record<Part, boolean>>({
    description: true,
    subtasks: true,
    assignee: true,
    labels: true,
    dates: true,
  });
  const available = PARTS.filter((part) => part.key !== 'subtasks' || issue.subtasks.length > 0);

  const submit = () => {
    if (!title.trim()) return;
    duplicate.mutate(
      { title: title.trim(), ...parts, subtasks: parts.subtasks && issue.subtasks.length > 0 },
      { onSuccess: (copy) => onDuplicated(copy) },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Дублировать ${issue.issueKey}`}
      description="Копия появится в том же проекте и в той же колонке. Комментарии, файлы и история останутся у исходной задачи."
      footer={
        <>
          <DialogCloseButton size="sm" variant="ghost">
            Отмена
          </DialogCloseButton>
          <Button size="sm" variant="primary" loading={duplicate.isPending} disabled={!title.trim()} onClick={submit}>
            Дублировать
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input label="Название копии" value={title} autoFocus onChange={(event) => setTitle(event.target.value)} />
        <fieldset>
          <legend className="mb-1.5 text-2xs font-bold tracking-wide text-text-subtle uppercase">Скопировать</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {available.map((part) => (
              <Checkbox
                key={part.key}
                checked={parts[part.key]}
                onChange={(event) => setParts({ ...parts, [part.key]: event.target.checked })}
                label={
                  <span className="text-sm">
                    {part.label}
                    {part.key === 'subtasks' && <span className="fd-num text-text-subtle"> · {issue.subtasks.length}</span>}
                  </span>
                }
              />
            ))}
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}

/**
 * «Сделать подзадачей»: picks the task this one becomes a part of. Only tasks
 * of the same project without a parent of their own qualify — one level of
 * subtasks, numbered after the parent (WEB-4.1).
 */
export function AttachToParentDialog({
  issue,
  onClose,
  onPick,
}: {
  issue: IssueDetailDto;
  onClose: () => void;
  onPick: (parentId: string) => void;
}) {
  const [term, setTerm] = useState('');
  const query = useIssueList(
    { projectId: issue.projectId },
    { includeDone: true, search: term.trim() || undefined, sort: 'updated', order: 'desc' },
    { limit: 30 },
  );
  const candidates = flattenPages(query.data)
    .filter((candidate) => candidate.id !== issue.id && !candidate.parent && candidate.type !== 'EPIC')
    .slice(0, 10);

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={`Сделать ${issue.issueKey} подзадачей`}
      description="Выберите задачу, частью которой она станет. Номер сменится на номер подзадачи, старая ссылка продолжит открываться."
      footer={
        <DialogCloseButton size="sm" variant="ghost">
          Отмена
        </DialogCloseButton>
      }
    >
      <div className="flex items-center gap-1.5 border-2 border-border-strong bg-surface px-2 py-1">
        <Search className="size-3.5 shrink-0 text-text-subtle" />
        <input
          autoFocus
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Задача этого проекта: номер или название"
          aria-label="Найти родительскую задачу"
          className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-text-subtle"
        />
      </div>
      <ul className="mt-2 max-h-72 overflow-y-auto">
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            <button
              type="button"
              onClick={() => onPick(candidate.id)}
              className="flex w-full items-center gap-2 px-1.5 py-1.5 text-left hover:bg-surface-hover"
            >
              <CornerDownRight className="size-3 shrink-0 text-text-subtle" />
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
    </Dialog>
  );
}
