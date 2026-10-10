import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  addMember,
  createIssue,
  createProject,
  disconnectTestDb,
  migrateTestSchema,
  registerUser,
  type TestUser,
} from '../setup';

/**
 * The chart of the tests:
 *
 *   ГС ─┬─ ВС 1 ─┬─ Спец 1 ── МС 1
 *       │        ├─ Спец 2   (a guest who was added to no project)
 *       │        └─ Спец 4
 *       └─ ВС 2 ──── Спец 3   (ВС 2 is a guest who sees project A only)
 */
let app: FastifyInstance;
let owner: TestUser;
let gs: TestUser;
let vs1: TestUser;
let vs2: TestUser;
let spec1: TestUser;
let spec2: TestUser;
let spec3: TestUser;
let spec4: TestUser;
let ms1: TestUser;
let loner: TestUser;
let departmentId: string;
let projectA: { id: string };
let projectB: { id: string };
let backlogA: string;
let backlogB: string;
let doneA: string;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const call = (user: TestUser, method: Method, url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { cookie: user.cookie },
    ...(payload ? { payload: payload as never } : {}),
  });

type Figures = { backlog: number; active: number; overdue: number };
type Cascade = {
  person: { user: { id: string }; position: string | null };
  department: { id: string; name: string } | null;
  chain: { user: { id: string } }[];
  manager: { user: { id: string } } | null;
  own: Figures;
  branch: Figures;
  branchSize: number;
  reports: { user: { id: string }; position: string | null; own: Figures; below: Figures; belowUserIds: string[] }[];
};
const cascade = async (user: TestUser, viewed?: TestUser) =>
  call(user, 'GET', `/workspaces/${owner.workspaceId}/cascade${viewed ? `?userId=${viewed.id}` : ''}`);
const cascadeOf = async (user: TestUser, viewed?: TestUser) => (await cascade(user, viewed)).json() as Cascade;

type Task = { id: string; issueKey: string; updatedAt: string; assignee: { id: string } | null };
const read = async (id: string) => (await call(owner, 'GET', `/issues/${id}`)).json() as Task & Record<string, unknown>;

/** A task in the backlog of project A, held by the given person. */
const pooled = (holder: TestUser, title: string, extra: Record<string, unknown> = {}) =>
  createIssue(app, owner, projectA.id, { title, assigneeId: holder.id, statusId: backlogA, ...extra }) as Promise<Task>;

const hand = (
  sender: TestUser,
  to: TestUser,
  items: { issueId: string; expectedAssigneeId: string | null; expectedUpdatedAt?: string }[],
) => call(sender, 'POST', `/workspaces/${owner.workspaceId}/cascade/handoff`, { toUserId: to.id, items });

const place = (user: TestUser, position: string, manager: TestUser | null) => ({
  userId: user.id,
  position,
  managerId: manager?.id ?? null,
});

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();

  owner = await registerUser(app, { name: 'Администратор Каскада', workspaceName: 'Каскад' });
  const join = async (name: string, role: 'MEMBER' | 'GUEST' = 'MEMBER') => {
    const user = await registerUser(app, { name });
    await addMember(app, owner, user.email, role);
    return user;
  };
  gs = await join('Главный Специалист');
  vs1 = await join('Ведущий Первый');
  vs2 = await join('Ведущий Второй', 'GUEST');
  spec1 = await join('Специалист Первый');
  spec2 = await join('Специалист Второй', 'GUEST');
  spec3 = await join('Специалист Третий');
  spec4 = await join('Специалист Четвёртый');
  ms1 = await join('Младший Первый');
  loner = await join('Без Отдела');

  projectA = await createProject(app, owner, { name: 'Проект А' });
  projectB = await createProject(app, owner, { name: 'Проект Б' });
  const statuses = async (projectId: string) =>
    (await call(owner, 'GET', `/projects/${projectId}`)).json().statuses as { id: string; category: string }[];
  backlogA = (await statuses(projectA.id)).find((status) => status.category === 'BACKLOG')!.id;
  doneA = (await statuses(projectA.id)).find((status) => status.category === 'COMPLETED')!.id;
  backlogB = (await statuses(projectB.id)).find((status) => status.category === 'BACKLOG')!.id;
  // The guest manager sees project A only.
  expect((await call(owner, 'POST', `/projects/${projectA.id}/members`, { userId: vs2.id, role: 'CONTRIBUTOR' })).statusCode).toBeLessThan(300);

  const people = [gs, vs1, vs2, spec1, spec2, spec3, spec4, ms1];
  const created = await call(owner, 'POST', `/workspaces/${owner.workspaceId}/departments`, {
    name: 'Отдел анализа',
    memberIds: people.map((user) => user.id),
    structure: [
      place(gs, 'Главный специалист', null),
      place(vs1, 'Ведущий специалист', gs),
      place(vs2, 'Ведущий специалист', gs),
      place(spec1, 'Специалист', vs1),
      place(spec2, 'Специалист', vs1),
      place(spec4, 'Специалист', vs1),
      place(spec3, 'Специалист', vs2),
      place(ms1, 'Младший специалист', spec1),
    ],
  });
  expect(created.statusCode).toBe(201);
  departmentId = created.json().id;
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

describe('подчинённость в справочнике отделов', () => {
  it('справочник хранит должность и непосредственного руководителя каждого', async () => {
    const department = (await call(owner, 'GET', `/workspaces/${owner.workspaceId}/departments`)).json().items[0] as {
      structure: { userId: string; position: string | null; managerId: string | null }[];
    };
    const of = (user: TestUser) => department.structure.find((entry) => entry.userId === user.id)!;
    expect(of(gs)).toEqual({ userId: gs.id, position: 'Главный специалист', managerId: null });
    expect(of(vs1)).toMatchObject({ position: 'Ведущий специалист', managerId: gs.id });
    expect(of(ms1)).toMatchObject({ position: 'Младший специалист', managerId: spec1.id });
  });

  it('руководитель самому себе, круг и руководитель из другого отдела отклоняются; ведёт справочник администратор', async () => {
    const save = (user: TestUser, structure: unknown[]) => call(user, 'PATCH', `/departments/${departmentId}`, { structure });

    expect((await save(owner, [place(vs1, 'Ведущий специалист', vs1)])).statusCode).toBe(400);
    // ГС под своим же младшим специалистом: круг через три уровня.
    const ring = await save(owner, [place(gs, 'Главный специалист', ms1)]);
    expect(ring.statusCode).toBe(400);
    expect(ring.json().error.message).toMatch(/круг/i);
    // Two edits that are each fine alone and make a ring together.
    expect((await save(owner, [place(spec1, 'Специалист', spec4), place(spec4, 'Специалист', spec1)])).statusCode).toBe(400);
    // Someone who is not in the department cannot be a manager here, nor be given a place.
    expect((await save(owner, [place(vs1, 'Ведущий специалист', loner)])).statusCode).toBe(400);
    expect((await save(owner, [place(loner, 'Специалист', gs)])).statusCode).toBe(400);
    // The register is the administrator's.
    expect((await save(gs, [place(vs1, 'Начальник', null)])).statusCode).toBe(403);

    // Nothing of the refused edits was saved.
    const department = (await call(owner, 'GET', `/workspaces/${owner.workspaceId}/departments`)).json().items[0];
    const of = (user: TestUser) =>
      (department.structure as { userId: string; managerId: string | null }[]).find((entry) => entry.userId === user.id)!;
    expect(of(vs1).managerId).toBe(gs.id);
    expect(of(gs).managerId).toBeNull();
    expect(of(spec1).managerId).toBe(vs1.id);
  });

  it('перевод в другой отдел снимает связи вверх и вниз, а задачи не трогает', async () => {
    const mover = await registerUser(app, { name: 'Переводимый Руководитель' });
    const under = await registerUser(app, { name: 'Его Подчинённый' });
    await addMember(app, owner, mover.email, 'MEMBER');
    await addMember(app, owner, under.email, 'MEMBER');
    const first = (
      await call(owner, 'POST', `/workspaces/${owner.workspaceId}/departments`, {
        name: 'Временный отдел',
        memberIds: [mover.id, under.id],
        structure: [place(mover, 'Руководитель', null), place(under, 'Сотрудник', mover)],
      })
    ).json();
    const task = await createIssue(app, owner, projectA.id, { title: 'Остаётся у подчинённого', assigneeId: under.id });

    const second = await call(owner, 'POST', `/workspaces/${owner.workspaceId}/departments`, {
      name: 'Новый отдел',
      memberIds: [mover.id],
    });
    expect(second.statusCode).toBe(201);

    const left = (await call(owner, 'GET', `/workspaces/${owner.workspaceId}/departments`)).json().items.find(
      (item: { id: string }) => item.id === first.id,
    );
    expect(left.structure).toEqual([{ userId: under.id, position: 'Сотрудник', managerId: null }]);
    expect(second.json().structure).toEqual([{ userId: mover.id, position: 'Руководитель', managerId: null }]);
    expect((await read(task.id)).assignee?.id).toBe(under.id);
  });
});

describe('мой пул и подчинённые', () => {
  it('у каждого свой пул: цифры считают только собственные задачи, ветка — всех ниже, каждую задачу один раз', async () => {
    await pooled(gs, 'В бэклоге у ГС');
    await pooled(gs, 'Ещё одна у ГС');
    // Not a backlog task: in the pool only when another state is chosen.
    await createIssue(app, owner, projectA.id, { title: 'В очереди у ГС', assigneeId: gs.id });
    await pooled(vs1, 'В бэклоге у ВС 1');
    await pooled(spec1, 'В бэклоге у Спец 1', { dueDate: '2020-01-01T12:00:00.000Z' });
    await pooled(ms1, 'В бэклоге у МС 1');
    // Someone outside the department is in nobody's branch.
    await pooled(loner, 'У человека без отдела');

    const mine = await cascadeOf(gs);
    expect(mine.person).toMatchObject({ user: { id: gs.id }, position: 'Главный специалист' });
    expect(mine.department).toMatchObject({ name: 'Отдел анализа' });
    expect(mine.chain.map((link) => link.user.id)).toEqual([gs.id]);
    expect(mine.manager).toBeNull();
    expect(mine.own).toEqual({ backlog: 2, active: 3, overdue: 0 });
    // ГС + ВС 1 + Спец 1 + МС 1; the loner's task is not there.
    expect(mine.branch).toEqual({ backlog: 5, active: 6, overdue: 1 });
    expect(mine.branchSize).toBe(8);
    expect(mine.reports.map((report) => report.user.id).sort()).toEqual([vs1.id, vs2.id].sort());

    const first = mine.reports.find((report) => report.user.id === vs1.id)!;
    expect(first.position).toBe('Ведущий специалист');
    expect(first.own).toEqual({ backlog: 1, active: 1, overdue: 0 });
    // What ВС 1 has passed on or what his people hold: Спец 1 and МС 1.
    expect(first.below).toEqual({ backlog: 2, active: 2, overdue: 1 });
    expect(first.belowUserIds.sort()).toEqual([spec1.id, spec2.id, spec4.id, ms1.id].sort());

    // The list behind the figure is the ordinary list of a person's tasks.
    const listed = (
      await call(gs, 'GET', `/workspaces/${owner.workspaceId}/issues?assigneeId=${gs.id}&statusCategory=BACKLOG&includeSubtasks=true`)
    ).json().items as { title: string }[];
    expect(listed.map((issue) => issue.title).sort()).toEqual(['В бэклоге у ГС', 'Ещё одна у ГС']);
  });

  it('руководитель смотрит ветку подчинённого с цепочкой до него; соседнюю ветку и своего руководителя — нет', async () => {
    const viewed = await cascadeOf(gs, spec1);
    expect(viewed.chain.map((link) => link.user.id)).toEqual([gs.id, vs1.id, spec1.id]);
    expect(viewed.person.user.id).toBe(spec1.id);
    expect(viewed.manager?.user.id).toBe(vs1.id);
    expect(viewed.reports.map((report) => report.user.id)).toEqual([ms1.id]);

    // A neighbouring branch, one's own manager, a stranger: not found, with nothing said about them.
    expect((await cascade(vs1, spec3)).statusCode).toBe(404);
    expect((await cascade(spec1, vs1)).statusCode).toBe(404);
    expect((await cascade(vs1, gs)).statusCode).toBe(404);
    expect((await cascade(gs, loner)).statusCode).toBe(404);

    // Someone the register does not list has a pool of their own and nobody under them.
    const alone = await cascadeOf(loner);
    expect(alone).toMatchObject({ department: null, reports: [], branchSize: 1, own: { backlog: 1, active: 1, overdue: 0 } });
  });

  it('подчинённость не открывает проекты: цифры руководителя-гостя считают только доступное ему', async () => {
    await createIssue(app, owner, projectA.id, { title: 'Спец 3 в проекте А', assigneeId: spec3.id, statusId: backlogA });
    await createIssue(app, owner, projectB.id, { title: 'Спец 3 в проекте Б', assigneeId: spec3.id, statusId: backlogB });
    await createIssue(app, owner, projectB.id, { title: 'Ещё одна в проекте Б', assigneeId: spec3.id, statusId: backlogB });

    // ВС 2 is a guest added to project A only.
    const guestView = (await cascadeOf(vs2)).reports.find((report) => report.user.id === spec3.id)!;
    expect(guestView.own).toEqual({ backlog: 1, active: 1, overdue: 0 });
    // ГС sees both projects, and the same person counts for more.
    const fullView = (await cascadeOf(gs, vs2)).reports.find((report) => report.user.id === spec3.id)!;
    expect(fullView.own).toEqual({ backlog: 3, active: 3, overdue: 0 });
  });
});

describe('передача задач по подчинённости', () => {
  it('ГС → ВС → Спец → МС: одна и та же задача, меняется только ответственный', async () => {
    const task = await pooled(gs, 'Идёт сверху вниз', {
      description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Суть задачи' }] }] },
      dueDate: '2030-05-20T12:00:00.000Z',
      priority: 'HIGH',
    });
    const before = await read(task.id);
    const gsBefore = (await cascadeOf(gs)).own.backlog;
    const vsBefore = (await cascadeOf(vs1)).own.backlog;

    const step = async (sender: TestUser, to: TestUser) => {
      const current = await read(task.id);
      const response = await hand(sender, to, [
        { issueId: task.id, expectedAssigneeId: sender.id, expectedUpdatedAt: current.updatedAt },
      ]);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ updated: 1 });
    };

    await step(gs, vs1);
    // Out of the sender's pool, into the recipient's.
    expect((await cascadeOf(gs)).own.backlog).toBe(gsBefore - 1);
    expect((await cascadeOf(vs1)).own.backlog).toBe(vsBefore + 1);
    await step(vs1, spec1);
    await step(spec1, ms1);

    const after = await read(task.id);
    expect(after.assignee?.id).toBe(ms1.id);
    for (const field of ['id', 'issueKey', 'projectId', 'statusId', 'dueDate', 'priority', 'title', 'description', 'reporter']) {
      expect(after[field], field).toEqual(before[field]);
    }

    // Each step is in the history with who did it and between whom.
    const history = (await call(owner, 'GET', `/issues/${task.id}/activity`)).json();
    const moves = ((history.items ?? history) as { type: string; actor: { id: string }; fromValue: string; toValue: string }[])
      .filter((event) => event.type === 'ASSIGNEE_CHANGED')
      .map((event) => [event.actor.id, event.fromValue, event.toValue]);
    expect(moves).toEqual(
      expect.arrayContaining([
        [gs.id, gs.id, vs1.id],
        [vs1.id, vs1.id, spec1.id],
        [spec1.id, spec1.id, ms1.id],
      ]),
    );
    expect(moves).toHaveLength(3);

    // The manager still sees the task in his branch after it went further down.
    const view = await cascadeOf(gs);
    expect(view.reports.find((report) => report.user.id === vs1.id)!.belowUserIds).toContain(ms1.id);
    const further = (
      await call(gs, 'GET', `/workspaces/${owner.workspaceId}/issues?assigneeId=${ms1.id}&includeSubtasks=true`)
    ).json().items as { id: string }[];
    expect(further.map((issue) => issue.id)).toContain(task.id);

    // The recipient heard about it once, not once per mechanism.
    const notices = (await call(ms1, 'GET', `/workspaces/${owner.workspaceId}/notifications`)).json();
    const about = ((notices.items ?? notices) as { type: string; issue: { id: string } | null }[]).filter(
      (notice) => notice.issue?.id === task.id && notice.type === 'ISSUE_ASSIGNED',
    );
    expect(about).toHaveLength(1);
  });

  it('ВС создаёт задачу себе и передаёт её специалисту; несколько задач передаются одним действием', async () => {
    const created = await call(vs1, 'POST', '/issues', {
      projectId: projectA.id,
      title: 'ВС создал себе',
      assigneeId: vs1.id,
      statusId: backlogA,
    });
    expect(created.statusCode).toBe(201);
    const own = created.json() as Task;
    expect(own.assignee?.id).toBe(vs1.id);

    const second = await pooled(vs1, 'Вторая в пакете');
    const third = await pooled(vs1, 'Третья в пакете');
    const batch = await hand(
      vs1,
      spec4,
      [own, second, third].map((issue) => ({ issueId: issue.id, expectedAssigneeId: vs1.id })),
    );
    expect(batch.statusCode).toBe(200);
    expect(batch.json()).toEqual({ updated: 3 });
    for (const issue of [own, second, third]) expect((await read(issue.id)).assignee?.id).toBe(spec4.id);

    // Between one's own direct reports, and back into one's own pool.
    expect((await hand(vs1, spec1, [{ issueId: second.id, expectedAssigneeId: spec4.id }])).statusCode).toBe(200);
    expect((await read(second.id)).assignee?.id).toBe(spec1.id);
    expect((await hand(vs1, vs1, [{ issueId: third.id, expectedAssigneeId: spec4.id }])).statusCode).toBe(200);
    expect((await read(third.id)).assignee?.id).toBe(vs1.id);
  });

  it('только на один шаг по своей ветке: через уровень, в соседнюю ветку и вверх — нельзя', async () => {
    const mine = await pooled(gs, 'Не уйдёт мимо ВС');
    const vsTask = await pooled(vs1, 'Не уйдёт в чужую ветку');
    const specTask = await pooled(spec1, 'Не уйдёт вверх');

    // Past the direct report, straight to a specialist.
    expect((await hand(gs, spec1, [{ issueId: mine.id, expectedAssigneeId: gs.id }])).statusCode).toBe(403);
    // Into the neighbouring branch, and to a peer.
    expect((await hand(vs1, spec3, [{ issueId: vsTask.id, expectedAssigneeId: vs1.id }])).statusCode).toBe(403);
    expect((await hand(vs1, vs2, [{ issueId: vsTask.id, expectedAssigneeId: vs1.id }])).statusCode).toBe(403);
    // Up to one's own manager.
    expect((await hand(spec1, vs1, [{ issueId: specTask.id, expectedAssigneeId: spec1.id }])).statusCode).toBe(403);
    // Someone else's task named as one's own: the claim does not match, nothing moves.
    expect((await hand(spec1, ms1, [{ issueId: vsTask.id, expectedAssigneeId: spec1.id }])).statusCode).toBe(409);
    // A task held two levels down is not the manager's to pull back in one move.
    const deep = await pooled(ms1, 'У младшего специалиста');
    expect((await hand(vs1, vs1, [{ issueId: deep.id, expectedAssigneeId: ms1.id }])).statusCode).toBe(403);
    // Not in the register at all.
    const stray = await pooled(loner, 'Некому передать');
    expect((await hand(loner, gs, [{ issueId: stray.id, expectedAssigneeId: loner.id }])).statusCode).toBe(403);

    expect((await read(mine.id)).assignee?.id).toBe(gs.id);
    expect((await read(vsTask.id)).assignee?.id).toBe(vs1.id);
    expect((await read(specTask.id)).assignee?.id).toBe(spec1.id);
    expect((await read(deep.id)).assignee?.id).toBe(ms1.id);
  });

  it('получателю без доступа к проекту задача не назначается; закрытая задача не передаётся; чужая — не находится', async () => {
    const task = await pooled(vs1, 'Гостю без проекта не достанется');
    // Спец 2 is a guest who was added to no project.
    const refused = await hand(vs1, spec2, [{ issueId: task.id, expectedAssigneeId: vs1.id }]);
    expect(refused.statusCode).toBe(400);
    expect((await read(task.id)).assignee?.id).toBe(vs1.id);
    // And the handover did not open the project to him.
    expect((await call(spec2, 'GET', `/issues/${task.id}`)).statusCode).toBeGreaterThanOrEqual(403);

    const finished = await pooled(vs1, 'Уже завершена');
    await call(owner, 'PATCH', `/issues/${finished.id}`, { statusId: doneA });
    const closed = await hand(vs1, spec1, [{ issueId: finished.id, expectedAssigneeId: vs1.id }]);
    expect(closed.statusCode).toBe(400);
    expect(closed.json().error.message).toContain(finished.issueKey);
    expect((await read(finished.id)).assignee?.id).toBe(vs1.id);

    // ВС 2 is a guest without project B: a task there does not exist for him, even by its id.
    // His own report holds it, so the move itself — back to the manager — is one he may make.
    const hidden = await createIssue(app, owner, projectB.id, { title: 'В закрытом для гостя проекте', assigneeId: spec3.id, statusId: backlogB });
    const blind = await hand(vs2, vs2, [{ issueId: hidden.id, expectedAssigneeId: spec3.id }]);
    expect(blind.statusCode).toBe(404);
    expect(blind.body).not.toContain(hidden.issueKey);
    expect((await read(hidden.id)).assignee?.id).toBe(spec3.id);
  });

  it('одновременные действия не теряют назначение: устаревшая передача отклоняется целиком', async () => {
    const task = await pooled(gs, 'Передают двое');
    const other = await pooled(gs, 'В том же пакете');
    const seen = await read(task.id);

    // ГС already gave it to ВС 1 from another tab…
    expect((await hand(gs, vs1, [{ issueId: task.id, expectedAssigneeId: gs.id, expectedUpdatedAt: seen.updatedAt }])).statusCode).toBe(200);
    // …and the stale tab now tries to give both to ВС 2.
    const stale = await hand(gs, vs2, [
      { issueId: other.id, expectedAssigneeId: gs.id },
      { issueId: task.id, expectedAssigneeId: gs.id, expectedUpdatedAt: seen.updatedAt },
    ]);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.message).toContain(task.issueKey);
    // Nothing of the batch was applied: the first assignment stands, the other task did not move.
    expect((await read(task.id)).assignee?.id).toBe(vs1.id);
    expect((await read(other.id)).assignee?.id).toBe(gs.id);

    // A task edited after it was looked at: the version no longer matches.
    const edited = await pooled(gs, 'Правили, пока смотрели');
    const looked = await read(edited.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await call(owner, 'PATCH', `/issues/${edited.id}`, { priority: 'URGENT' });
    const outdated = await hand(gs, vs1, [{ issueId: edited.id, expectedAssigneeId: gs.id, expectedUpdatedAt: looked.updatedAt }]);
    expect(outdated.statusCode).toBe(409);
    expect((await read(edited.id)).assignee?.id).toBe(gs.id);
    // With the fresh version it goes through.
    const fresh = await read(edited.id);
    expect((await hand(gs, vs1, [{ issueId: edited.id, expectedAssigneeId: gs.id, expectedUpdatedAt: fresh.updatedAt }])).statusCode).toBe(200);
  });
});
