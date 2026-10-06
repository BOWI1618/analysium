import { useMemo, useState } from 'react';
import type { DepartmentDto, UserSummaryDto } from '@flowdesk/contracts';
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { ApiError } from '~/lib/api';
import { useSession } from '~/app/session';
import { useToast } from '~/app/toast';
import { useMembers } from '~/features/members/hooks';
import {
  useDeleteDepartment,
  useDepartments,
  useSaveDepartment,
  type DepartmentForm,
} from '~/features/departments/hooks';
import { MultiSelect, UserPicker } from '~/components/Pickers';
import { Avatar } from '~/ui/Avatar';
import { Button, IconButton } from '~/ui/Button';
import { ConfirmDialog, Dialog, DialogCloseButton } from '~/ui/Dialog';
import { EmptyState, Skeleton } from '~/ui/Feedback';
import { Input } from '~/ui/Input';
import { pluralize } from '~/lib/format';

const EMPTY_FORM: DepartmentForm = { name: '', leadId: null, memberIds: [] };

/**
 * The register of departments. It is kept by hand, here: who is in a
 * department is a fact about the organisation, and guessing it from project
 * teams would be wrong the first time someone helps out on a neighbour's task.
 */
export function DepartmentsSection() {
  const { workspace } = useSession();
  const workspaceId = workspace?.id ?? '';
  const { data, isLoading } = useDepartments(workspaceId);
  const { data: members } = useMembers(workspaceId);
  const deleteDepartment = useDeleteDepartment(workspaceId);

  const [form, setForm] = useState<DepartmentForm | null>(null);
  const [removing, setRemoving] = useState<DepartmentDto | null>(null);

  const people = useMemo(() => (members ?? []).map((member) => member.user), [members]);
  const departments = data?.items ?? [];

  return (
    <section className="border-2 border-border-strong bg-surface p-4 shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="fd-eyebrow">Отделы</h2>
          <p className="mt-1 max-w-prose text-xs text-text-muted">
            Кто в каком отделе и кто им руководит. Руководитель видит задачи своих сотрудников на экране «Отдел».
            Доступа к проектам отдел не даёт: каждый видит только те задачи, которые мог открыть и раньше.
          </p>
        </div>
        <Button size="sm" variant="primary" iconLeft={<Plus className="size-3.5" />} onClick={() => setForm(EMPTY_FORM)}>
          Новый отдел
        </Button>
      </div>

      <div className="mt-3.5">
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : departments.length === 0 ? (
          <EmptyState
            compact
            title="Отделов пока нет"
            description="Создайте отдел, назначьте руководителя и добавьте сотрудников."
          />
        ) : (
          <ul className="divide-y-2 divide-border-strong border-2 border-border-strong">
            {departments.map((department) => (
              <li key={department.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-2.5">
                <div className="min-w-0 flex-1 basis-48">
                  <h3 className="truncate text-sm font-bold">{department.name}</h3>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
                    {department.lead ? (
                      <>
                        <Avatar user={department.lead} size="xs" />
                        <span className="truncate">Руководитель: {department.lead.name}</span>
                      </>
                    ) : (
                      <span className="font-bold text-warning">Руководитель не назначен</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1" title={department.members.map((member) => member.name).join(', ')}>
                  {department.members.slice(0, 5).map((member) => (
                    <Avatar key={member.id} user={member} size="sm" />
                  ))}
                  <span className="fd-num pl-1 text-2xs text-text-subtle">
                    {pluralize(department.members.length, ['сотрудник', 'сотрудника', 'сотрудников'])}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="xs"
                    variant="secondary"
                    iconLeft={<Pencil className="size-3" />}
                    onClick={() =>
                      setForm({
                        id: department.id,
                        name: department.name,
                        leadId: department.lead?.id ?? null,
                        memberIds: department.members.map((member) => member.id),
                      })
                    }
                  >
                    Изменить
                  </Button>
                  <IconButton label={`Удалить отдел «${department.name}»`} size="sm" onClick={() => setRemoving(department)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {form && (
        <DepartmentDialog
          workspaceId={workspaceId}
          initial={form}
          people={people}
          departments={departments}
          onClose={() => setForm(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          deleteDepartment.mutate(removing, { onSettled: () => setRemoving(null) });
        }}
        title={`Удалить отдел «${removing?.name ?? ''}»?`}
        message="Сотрудники и их задачи останутся как были — исчезнет только сам отдел и его экран у руководителя."
        confirmLabel="Удалить отдел"
        danger
        loading={deleteDepartment.isPending}
      />
    </section>
  );
}

function DepartmentDialog({
  workspaceId,
  initial,
  people,
  departments,
  onClose,
}: {
  workspaceId: string;
  initial: DepartmentForm;
  people: UserSummaryDto[];
  departments: DepartmentDto[];
  onClose: () => void;
}) {
  const toast = useToast();
  const save = useSaveDepartment(workspaceId);
  const [name, setName] = useState(initial.name);
  const [leadId, setLeadId] = useState(initial.leadId);
  const [memberIds, setMemberIds] = useState(initial.memberIds);
  const [nameError, setNameError] = useState<string | undefined>();

  const lead = people.find((person) => person.id === leadId) ?? null;

  // A person is in one department at a time, so picking someone from another
  // department moves them. Said before saving, not discovered after.
  const moving = useMemo(() => {
    const elsewhere = new Map<string, string>();
    for (const department of departments) {
      if (department.id === initial.id) continue;
      for (const member of department.members) elsewhere.set(member.id, department.name);
    }
    return memberIds
      .filter((id) => elsewhere.has(id))
      .map((id) => `${people.find((person) => person.id === id)?.name ?? 'Сотрудник'} — из отдела «${elsewhere.get(id)}»`);
  }, [departments, initial.id, memberIds, people]);

  const dirty =
    name !== initial.name || leadId !== initial.leadId || memberIds.join() !== initial.memberIds.join();

  const submit = () => {
    if (!name.trim()) {
      setNameError('Укажите название отдела');
      return;
    }
    save.mutate(
      { id: initial.id, name: name.trim(), leadId, memberIds },
      {
        onSuccess: onClose,
        onError: (error) => {
          // A taken name is shown at the field; anything else has no field to sit at.
          if (error instanceof ApiError && error.fields.name) setNameError(error.fields.name);
          else toast.error(error, 'Не удалось сохранить отдел');
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dirty={dirty}
      title={initial.id ? 'Отдел' : 'Новый отдел'}
      size="md"
      footer={
        <>
          <DialogCloseButton size="sm" variant="ghost">
            Отмена
          </DialogCloseButton>
          <Button size="sm" variant="primary" loading={save.isPending} onClick={submit}>
            {initial.id ? 'Сохранить' : 'Создать отдел'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          data-autofocus="true"
          label="Название"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          error={nameError}
          maxLength={80}
          placeholder="Например, «Аналитика»"
        />

        <div>
          <p className="mb-1 text-xs font-bold text-text">Руководитель</p>
          <UserPicker users={people} value={leadId} onChange={setLeadId} label="Руководителя" noneLabel="Не назначен">
            <button
              type="button"
              aria-label={`Руководитель: ${lead?.name ?? 'не назначен'}`}
              className="flex w-full items-center gap-2 border-2 border-border-strong bg-surface px-2 py-1.5 text-left text-sm hover:bg-surface-hover hover:shadow-xs"
            >
              <Avatar user={lead} size="sm" />
              <span className="min-w-0 flex-1 truncate">{lead?.name ?? 'Не назначен'}</span>
              <ChevronDown className="size-3.5 shrink-0 text-text-subtle" />
            </button>
          </UserPicker>
          <p className="mt-1 text-xs text-text-subtle">
            Видит задачи сотрудников отдела в проектах, к которым у него самого есть доступ.
          </p>
        </div>

        <div>
          <p className="mb-1 text-xs font-bold text-text">Сотрудники</p>
          <MultiSelect
            title="Сотрудники отдела"
            options={people.map((person) => ({
              value: person.id,
              label: person.name,
              icon: <Avatar user={person} size="sm" />,
            }))}
            value={memberIds}
            onChange={setMemberIds}
          >
            <button
              type="button"
              aria-label={`Сотрудники отдела: ${memberIds.length}`}
              className="flex w-full items-center gap-2 border-2 border-border-strong bg-surface px-2 py-1.5 text-left text-sm hover:bg-surface-hover hover:shadow-xs"
            >
              <span className="flex min-w-0 flex-1 items-center gap-1">
                {memberIds.length === 0 ? (
                  <span className="text-text-subtle">Никто не выбран</span>
                ) : (
                  <>
                    {memberIds.slice(0, 6).map((id) => (
                      <Avatar key={id} user={people.find((person) => person.id === id) ?? null} size="sm" />
                    ))}
                    <span className="fd-num pl-1 text-xs text-text-muted">
                      {pluralize(memberIds.length, ['сотрудник', 'сотрудника', 'сотрудников'])}
                    </span>
                  </>
                )}
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-text-subtle" />
            </button>
          </MultiSelect>
          {moving.length > 0 && (
            <p className="mt-1 text-xs text-text-muted" role="status">
              Сотрудник состоит в одном отделе, поэтому перейдут сюда: {moving.join('; ')}.
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
