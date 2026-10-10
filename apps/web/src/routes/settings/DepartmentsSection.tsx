import { useMemo, useState } from 'react';
import type { DepartmentDto, UserSummaryDto } from '@flowdesk/contracts';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
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

const EMPTY_FORM: DepartmentForm = { name: '', leadId: null, memberIds: [], structure: [] };

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
  const [shownTrees, setShownTrees] = useState<string[]>([]);

  const people = useMemo(() => (members ?? []).map((member) => member.user), [members]);
  const departments = data?.items ?? [];

  return (
    <section className="border-2 border-border-strong bg-surface p-4 shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="fd-eyebrow">Отделы</h2>
          <p className="mt-1 max-w-prose text-xs text-text-muted">
            Кто в каком отделе, в какой должности и кому подчиняется. Руководитель отдела видит задачи своих
            сотрудников на экране «Задачи отдела»; по подчинённости задачи передаются сверху вниз в разделе
            «Распределение». Доступа к проектам отдел не даёт: каждый видит только те задачи, которые мог открыть и
            раньше.
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
                        structure: department.structure,
                      })
                    }
                  >
                    Изменить
                  </Button>
                  <IconButton label={`Удалить отдел «${department.name}»`} size="sm" onClick={() => setRemoving(department)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
                {department.members.length > 0 && (
                  <div className="w-full">
                    <button
                      type="button"
                      aria-expanded={shownTrees.includes(department.id)}
                      onClick={() =>
                        setShownTrees((shown) =>
                          shown.includes(department.id) ? shown.filter((id) => id !== department.id) : [...shown, department.id],
                        )
                      }
                      className="inline-flex items-center gap-1 text-xs font-bold text-text-muted hover:text-text"
                    >
                      <ChevronRight
                        className={clsx('size-3.5 transition-transform', shownTrees.includes(department.id) && 'rotate-90')}
                      />
                      Структура отдела
                    </button>
                    {shownTrees.includes(department.id) && <DepartmentTree department={department} />}
                  </div>
                )}
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

/**
 * Who reports to whom, drawn as it is said: a person, and under them the
 * people whose immediate manager they are. Someone with no manager named
 * stands at the top — whether they head the department or were simply not
 * placed yet.
 */
function DepartmentTree({ department }: { department: DepartmentDto }) {
  const userOf = new Map(department.members.map((member) => [member.id, member]));
  const placeOf = new Map(department.structure.map((place) => [place.userId, place]));
  const reportsOf = new Map<string, string[]>();
  for (const place of department.structure) {
    if (place.managerId && userOf.has(place.managerId)) {
      reportsOf.set(place.managerId, [...(reportsOf.get(place.managerId) ?? []), place.userId]);
    }
  }
  const byName = (a: string, b: string) => (userOf.get(a)?.name ?? '').localeCompare(userOf.get(b)?.name ?? '', 'ru');
  const roots = department.members
    .map((member) => member.id)
    .filter((id) => {
      const managerId = placeOf.get(id)?.managerId;
      return !managerId || !userOf.has(managerId);
    })
    .sort(byName);

  const branch = (userId: string, seen: Set<string>): React.ReactNode => {
    const person = userOf.get(userId);
    // A ring cannot be saved, but a drawing must not hang on data it did not check.
    if (!person || seen.has(userId)) return null;
    const below = [...(reportsOf.get(userId) ?? [])].sort(byName);
    return (
      <li key={userId}>
        <span className="flex items-center gap-2 py-1">
          <Avatar user={person} size="sm" />
          <span className="min-w-0 truncate text-sm font-bold">{person.name}</span>
          <span className="truncate text-xs text-text-subtle">{placeOf.get(userId)?.position ?? 'должность не указана'}</span>
        </span>
        {below.length > 0 && (
          <ul className="ml-2.5 border-l-2 border-border-strong pl-3">
            {below.map((id) => branch(id, new Set([...seen, userId])))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <ul className="mt-2" aria-label={`Структура отдела «${department.name}»`}>
      {roots.map((id) => branch(id, new Set()))}
    </ul>
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
  // A title and an immediate manager per person, kept by user id.
  const initialPlaces = useMemo(
    () =>
      Object.fromEntries(
        initial.structure.map((place) => [place.userId, { position: place.position ?? '', managerId: place.managerId ?? '' }]),
      ) as Record<string, { position: string; managerId: string }>,
    [initial.structure],
  );
  const [places, setPlaces] = useState(initialPlaces);
  const [structureError, setStructureError] = useState<string | undefined>();
  const placeOf = (userId: string) => places[userId] ?? { position: '', managerId: '' };
  const setPlace = (userId: string, patch: Partial<{ position: string; managerId: string }>) => {
    setPlaces((current) => ({ ...current, [userId]: { ...(current[userId] ?? { position: '', managerId: '' }), ...patch } }));
    setStructureError(undefined);
  };
  const chosenPeople = people
    .filter((person) => memberIds.includes(person.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  // What is saved: only people of the department, and only a manager who is one of them.
  const structure = memberIds.map((userId) => {
    const place = placeOf(userId);
    return {
      userId,
      position: place.position.trim() || null,
      managerId: place.managerId && memberIds.includes(place.managerId) ? place.managerId : null,
    };
  });
  const structureKey = (list: { userId: string; position: string | null; managerId: string | null }[]) =>
    JSON.stringify([...list].sort((a, b) => a.userId.localeCompare(b.userId)));

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
    name !== initial.name ||
    leadId !== initial.leadId ||
    memberIds.join() !== initial.memberIds.join() ||
    structureKey(structure) !== structureKey(initial.structure.filter((place) => initial.memberIds.includes(place.userId)));

  const submit = () => {
    if (!name.trim()) {
      setNameError('Укажите название отдела');
      return;
    }
    save.mutate(
      { id: initial.id, name: name.trim(), leadId, memberIds, structure },
      {
        onSuccess: onClose,
        onError: (error) => {
          // A taken name and a broken reporting line are shown where they were entered;
          // anything else has no field to sit at.
          if (error instanceof ApiError && error.fields.name) setNameError(error.fields.name);
          else if (error instanceof ApiError && error.fields.structure) setStructureError(error.fields.structure);
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
      size="lg"
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
          <p className="mb-1 text-xs font-bold text-text">Руководитель отдела</p>
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

        {chosenPeople.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-bold text-text">Должности и подчинённость</p>
            <p className="mb-2 text-xs text-text-subtle">
              Непосредственный руководитель передаёт сотруднику задачи в разделе «Распределение». У сотрудника он один;
              у того, кто стоит во главе, руководителя нет. Смена руководителя задачи не переназначает.
            </p>
            <ul className="divide-y-2 divide-border-strong border-2 border-border-strong" aria-label="Должности и подчинённость">
              {chosenPeople.map((person) => {
                const place = placeOf(person.id);
                return (
                  <li key={person.id} className="flex flex-wrap items-center gap-2 p-2">
                    <span className="flex min-w-0 flex-1 basis-40 items-center gap-2">
                      <Avatar user={person} size="sm" />
                      <span className="truncate text-sm font-bold">{person.name}</span>
                    </span>
                    <input
                      value={place.position}
                      maxLength={80}
                      onChange={(event) => setPlace(person.id, { position: event.target.value })}
                      placeholder="Должность"
                      aria-label={`Должность: ${person.name}`}
                      className="h-7 min-w-0 flex-1 basis-40 border-2 border-border-strong bg-surface px-2 text-xs focus:border-accent focus:outline-none"
                    />
                    <select
                      value={memberIds.includes(place.managerId) ? place.managerId : ''}
                      onChange={(event) => setPlace(person.id, { managerId: event.target.value })}
                      aria-label={`Непосредственный руководитель: ${person.name}`}
                      className="h-7 min-w-0 flex-1 basis-44 border-2 border-border-strong bg-surface px-1.5 text-xs focus:border-accent focus:outline-none"
                    >
                      <option value="">Без руководителя</option>
                      {chosenPeople
                        .filter((candidate) => candidate.id !== person.id)
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            Руководитель: {candidate.name}
                          </option>
                        ))}
                    </select>
                  </li>
                );
              })}
            </ul>
            {structureError && (
              <p className="mt-1 text-xs font-bold text-danger" role="alert">
                {structureError}
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
