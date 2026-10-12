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
 * Roles of a workspace's own making: a name and the ticks of the permission
 * table, given to members of the workspace and of projects the way the
 * built-in roles are.
 */
let app: FastifyInstance;
let owner: TestUser;
let admin: TestUser;
let member: TestUser;
let second: TestUser;
let guest: TestUser;
let memberId: string;
let secondId: string;
let guestId: string;
let projectA: { id: string };
let projectB: { id: string };

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const call = (user: TestUser, method: Method, url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { cookie: user.cookie },
    ...(payload ? { payload: payload as never } : {}),
  });

type Role = { id: string; scope: string; name: string; permissions: string[]; allProjects: boolean; memberCount: number };
const ws = () => `/workspaces/${owner.workspaceId}`;
const makeRole = async (body: Record<string, unknown>, as: TestUser = owner) => call(as, 'POST', `${ws()}/roles`, body);
const role = async (body: Record<string, unknown>) => (await makeRole(body)).json() as Role;
const giveWorkspaceRole = (to: string, ref: Record<string, string>, as: TestUser = owner) =>
  call(as, 'PATCH', `${ws()}/members/${to}`, ref);
const sessionOf = async (user: TestUser) =>
  (await call(user, 'GET', '/auth/session')).json().workspaces.find((w: { id: string }) => w.id === owner.workspaceId) as {
    role: string;
    customRole: { id: string; name: string } | null;
    permissions: string[];
  };
const comment = (user: TestUser, issueId: string) =>
  call(user, 'POST', `/issues/${issueId}/comments`, {
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Замечание' }] }] },
  });

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();

  owner = await registerUser(app, { name: 'Владелец Ролей', workspaceName: 'Роли' });
  admin = await registerUser(app, { name: 'Администратор Ролей' });
  member = await registerUser(app, { name: 'Участник Первый' });
  second = await registerUser(app, { name: 'Участник Второй' });
  guest = await registerUser(app, { name: 'Гость Ролей' });
  await addMember(app, owner, admin.email, 'ADMIN');
  memberId = await addMember(app, owner, member.email, 'MEMBER');
  secondId = await addMember(app, owner, second.email, 'MEMBER');
  guestId = await addMember(app, owner, guest.email, 'GUEST');
  projectA = await createProject(app, owner, { name: 'Проект А' });
  projectB = await createProject(app, owner, { name: 'Проект Б' });
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

describe('своя роль в пространстве', () => {
  let watcher: Role;

  it('без единой галочки даёт только чтение — и тот, кому её выдали, ничего не меняет', async () => {
    const created = await makeRole({ scope: 'WORKSPACE', name: 'Наблюдатель', permissions: [] });
    expect(created.statusCode).toBe(201);
    watcher = created.json();
    // Reading is what being let in means: it is there without being asked for.
    expect([...watcher.permissions].sort()).toEqual(['issue:view', 'project:view', 'workspace:view']);
    expect(watcher).toMatchObject({ scope: 'WORKSPACE', allProjects: true, memberCount: 0 });

    expect((await giveWorkspaceRole(memberId, { roleId: watcher.id })).statusCode).toBe(204);
    const listed = (await call(owner, 'GET', `${ws()}/members`)).json() as { id: string; role: string; customRole: unknown }[];
    expect(listed.find((item) => item.id === memberId)).toMatchObject({
      role: 'MEMBER',
      customRole: { id: watcher.id, name: 'Наблюдатель' },
    });
    // The person's own pages are told the same thing the server enforces.
    const mine = await sessionOf(member);
    expect(mine.customRole).toEqual({ id: watcher.id, name: 'Наблюдатель' });
    expect(mine.permissions).not.toContain('issue:create');
    expect(mine.permissions).toContain('issue:view');

    const task = await createIssue(app, owner, projectA.id, { title: 'Чужая задача' });
    // Every project is open to read…
    expect((await call(member, 'GET', `/projects/${projectA.id}`)).statusCode).toBe(200);
    expect((await call(member, 'GET', `/issues/${task.id}`)).statusCode).toBe(200);
    // …and nothing in it can be changed.
    expect((await call(member, 'POST', '/issues', { projectId: projectA.id, title: 'Не создастся' })).statusCode).toBe(403);
    expect((await call(member, 'PATCH', `/issues/${task.id}`, { title: 'Не поправится' })).statusCode).toBe(403);
    expect((await comment(member, task.id)).statusCode).toBe(403);
    expect((await call(member, 'DELETE', `/issues/${task.id}`)).statusCode).toBe(403);
  });

  it('правка роли действует сразу для всех, кто её носит; половина галочки не сохраняется', async () => {
    const task = await createIssue(app, owner, projectA.id, { title: 'Задача с обсуждением' });
    const edited = await call(owner, 'PATCH', `${ws()}/roles/${watcher.id}`, {
      // Comments whole; of «задачи» only a part — creating without editing is not a tick of the table.
      permissions: ['comment:create', 'comment:update_own', 'issue:create'],
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().permissions).toEqual(expect.arrayContaining(['comment:create', 'comment:update_own']));
    expect(edited.json().permissions).not.toContain('issue:create');
    expect(edited.json().memberCount).toBe(1);

    expect((await comment(member, task.id)).statusCode).toBe(201);
    expect((await call(member, 'POST', '/issues', { projectId: projectA.id, title: 'Всё ещё нельзя' })).statusCode).toBe(403);
  });

  it('«только свои проекты» закрывает остальные — как гостю; роль в проекте добавляет права там', async () => {
    const narrowed = await call(owner, 'PATCH', `${ws()}/roles/${watcher.id}`, { allProjects: false });
    expect(narrowed.json().allProjects).toBe(false);
    const listed = (await call(owner, 'GET', `${ws()}/members`)).json() as { id: string; role: string }[];
    expect(listed.find((item) => item.id === memberId)!.role).toBe('GUEST');

    expect((await call(member, 'GET', `/projects/${projectA.id}`)).statusCode).toBe(404);
    expect((await call(owner, 'POST', `/projects/${projectA.id}/members`, { userId: member.id, role: 'CONTRIBUTOR' })).statusCode).toBe(204);
    expect((await call(member, 'GET', `/projects/${projectA.id}`)).statusCode).toBe(200);
    // What the role in the workspace does not give, the role in the project adds — in that project only.
    expect((await call(member, 'POST', '/issues', { projectId: projectA.id, title: 'Теперь можно' })).statusCode).toBe(201);
    expect((await call(member, 'GET', `/projects/${projectB.id}`)).statusCode).toBe(404);

    // Back to seeing everything, and to a built-in role: the role of the workspace's own lets go.
    await call(owner, 'PATCH', `${ws()}/roles/${watcher.id}`, { allProjects: true });
    expect((await call(member, 'GET', `/projects/${projectB.id}`)).statusCode).toBe(200);
    expect((await giveWorkspaceRole(memberId, { role: 'MEMBER' })).statusCode).toBe(204);
    expect((await sessionOf(member)).customRole).toBeNull();
    expect((await call(member, 'POST', '/issues', { projectId: projectB.id, title: 'Обычный участник' })).statusCode).toBe(201);
  });

  it('роли создаёт, меняет и удаляет только владелец; читают их все', async () => {
    for (const person of [admin, member, guest]) {
      expect((await makeRole({ scope: 'WORKSPACE', name: 'Самозванец', permissions: [] }, person)).statusCode).toBe(403);
      expect((await call(person, 'PATCH', `${ws()}/roles/${watcher.id}`, { name: 'Переименовал' })).statusCode).toBe(403);
      expect((await call(person, 'DELETE', `${ws()}/roles/${watcher.id}`)).statusCode).toBe(403);
      const read = await call(person, 'GET', `${ws()}/roles`);
      expect(read.statusCode).toBe(200);
      expect((read.json() as Role[]).some((item) => item.id === watcher.id)).toBe(true);
    }
    // A name is taken once per kind of role.
    const twin = await makeRole({ scope: 'WORKSPACE', name: 'Наблюдатель', permissions: [] });
    expect(twin.statusCode).toBe(409);
    expect(twin.json().error.fields.name).toBeTruthy();
    expect((await makeRole({ scope: 'PROJECT', name: 'Наблюдатель', permissions: [] })).statusCode).toBe(201);
  });

  it('роль называют одним способом: встроенную по имени или свою по номеру', async () => {
    expect((await giveWorkspaceRole(memberId, {})).statusCode).toBe(422);
    expect((await giveWorkspaceRole(memberId, { role: 'MEMBER', roleId: watcher.id })).statusCode).toBe(422);
    expect((await giveWorkspaceRole(memberId, { roleId: 'nosuchrole000' })).statusCode).toBe(400);
    // A role made for projects is not a role in the workspace.
    const forProjects = await role({ scope: 'PROJECT', name: 'Не для пространства', permissions: [] });
    expect((await giveWorkspaceRole(memberId, { roleId: forProjects.id })).statusCode).toBe(400);
  });
});

describe('своя роль в проекте', () => {
  it('даёт гостю в этом проекте ровно отмеченное; смена роли меняет права сразу', async () => {
    const tester = await role({
      scope: 'PROJECT',
      name: 'Тестировщик',
      // The last one is a tick of the workspace's table: it has no place in a project role.
      permissions: ['issue:create', 'issue:update', 'issue:move', 'comment:create', 'comment:update_own', 'workspace:manage_members'],
    });
    expect(tester.permissions).toEqual(expect.arrayContaining(['issue:update', 'comment:create', 'project:view', 'issue:view']));
    expect(tester.permissions).not.toContain('workspace:manage_members');
    expect(tester.permissions).not.toContain('issue:delete');

    expect((await call(owner, 'POST', `/projects/${projectB.id}/members`, { userId: guest.id, roleId: tester.id })).statusCode).toBe(204);
    const seen = (await call(guest, 'GET', `/projects/${projectB.id}`)).json();
    expect(seen.members.find((item: { userId: string }) => item.userId === guest.id)).toMatchObject({
      role: 'VIEWER',
      customRole: { id: tester.id, name: 'Тестировщик' },
    });
    expect(seen.permissions).toContain('issue:update');
    expect(seen.permissions).not.toContain('issue:delete');

    const made = await call(guest, 'POST', '/issues', { projectId: projectB.id, title: 'Нашёл ошибку' });
    expect(made.statusCode).toBe(201);
    const task = made.json();
    expect((await call(guest, 'PATCH', `/issues/${task.id}`, { title: 'Нашёл и описал ошибку' })).statusCode).toBe(200);
    expect((await call(guest, 'DELETE', `/issues/${task.id}`)).statusCode).toBe(403);
    // The role is this project's: the other one stays closed to a guest.
    expect((await call(guest, 'GET', `/projects/${projectA.id}`)).statusCode).toBe(404);

    // The same person, another role — from the list of the project's members.
    const change = (ref: Record<string, string>) => call(owner, 'PATCH', `/projects/${projectB.id}/members/${guest.id}`, ref);
    expect((await change({ role: 'VIEWER' })).statusCode).toBe(204);
    expect((await call(guest, 'PATCH', `/issues/${task.id}`, { title: 'Уже нельзя' })).statusCode).toBe(403);
    expect((await change({ roleId: tester.id })).statusCode).toBe(204);
    expect((await call(guest, 'PATCH', `/issues/${task.id}`, { title: 'Снова можно' })).statusCode).toBe(200);
    // Someone who is not in the project has no role there to change.
    expect((await call(owner, 'PATCH', `/projects/${projectB.id}/members/${second.id}`, { role: 'VIEWER' })).statusCode).toBe(404);
  });
});

describe('никто не выдаёт больше, чем может сам', () => {
  it('тот, кому доверили участников, не раздаёт права, которых у него нет', async () => {
    const staff = await role({ scope: 'WORKSPACE', name: 'Кадровик', permissions: ['workspace:manage_members'] });
    const editor = await role({
      scope: 'WORKSPACE',
      name: 'Редактор',
      permissions: ['issue:create', 'issue:update', 'issue:move'],
    });
    expect((await giveWorkspaceRole(secondId, { roleId: staff.id })).statusCode).toBe(204);

    // «Кадровик» manages people, but cannot edit tasks — so cannot make an editor of a guest.
    expect((await giveWorkspaceRole(guestId, { roleId: editor.id }, second)).statusCode).toBe(403);
    // Nor lift anyone to a rung at or above their own.
    expect((await giveWorkspaceRole(guestId, { role: 'ADMIN' }, second)).statusCode).toBe(403);
    expect((await giveWorkspaceRole(guestId, { role: 'MEMBER' }, second)).statusCode).toBe(403);
    // Their own role is as far as they go, and the owner is not held by any of this.
    expect((await giveWorkspaceRole(guestId, { roleId: editor.id })).statusCode).toBe(204);
    expect((await giveWorkspaceRole(guestId, { role: 'GUEST' })).statusCode).toBe(204);
    expect((await giveWorkspaceRole(secondId, { role: 'MEMBER' })).statusCode).toBe(204);
  });

  it('руководитель проекта не выдаёт роль, которая разрешает удалить проект', async () => {
    const master = await role({
      scope: 'PROJECT',
      name: 'Хозяин проекта',
      permissions: ['project:update', 'project:delete', 'project:manage_members'],
    });
    await call(owner, 'POST', `/projects/${projectA.id}/members`, { userId: second.id, role: 'LEAD' });
    // A lead manages the members of the project, yet deleting it is not theirs to do or to give.
    const attempt = await call(second, 'POST', `/projects/${projectA.id}/members`, { userId: guest.id, roleId: master.id });
    expect(attempt.statusCode).toBe(403);
    expect((await call(second, 'POST', `/projects/${projectA.id}/members`, { userId: guest.id, role: 'CONTRIBUTOR' })).statusCode).toBe(204);
    expect((await call(owner, 'POST', `/projects/${projectA.id}/members`, { userId: guest.id, roleId: master.id })).statusCode).toBe(204);
  });
});

describe('пространство со своими ролями', () => {
  it('удаляется целиком — вместе с ролями и теми, кто их носит', async () => {
    const boss = await registerUser(app, { name: 'Владелец Временного', workspaceName: 'Временное' });
    const hired = await registerUser(app, { name: 'Носитель Роли' });
    const base = `/workspaces/${boss.workspaceId}`;
    const temp = (await call(boss, 'POST', `${base}/roles`, { scope: 'WORKSPACE', name: 'Временная', permissions: [] })).json() as Role;
    const inProject = (await call(boss, 'POST', `${base}/roles`, { scope: 'PROJECT', name: 'Проектная', permissions: [] })).json() as Role;
    const hiredId = await addMember(app, boss, hired.email, 'MEMBER');
    expect((await call(boss, 'PATCH', `${base}/members/${hiredId}`, { roleId: temp.id })).statusCode).toBe(204);
    const project = await createProject(app, boss, { name: 'Проект временного' });
    expect((await call(boss, 'POST', `/projects/${project.id}/members`, { userId: hired.id, roleId: inProject.id })).statusCode).toBe(204);
    await call(boss, 'POST', `${base}/invite-codes`, { roleId: temp.id });

    // Roles and the memberships that point at them go in one sweep, whichever is taken first.
    const removed = await call(boss, 'DELETE', base);
    expect(removed.statusCode, removed.body).toBe(204);
    const { prisma } = await import('../../src/lib/prisma');
    expect(await prisma.role.count({ where: { workspaceId: boss.workspaceId } })).toBe(0);
    expect(await prisma.workspaceMember.count({ where: { workspaceId: boss.workspaceId } })).toBe(0);
  });
});

describe('ссылка для входа и удаление роли', () => {
  it('по ссылке можно впустить сразу со своей ролью; роль, которую носят, не удаляется', async () => {
    const intern = await role({ scope: 'WORKSPACE', name: 'Стажёр', permissions: ['comment:create', 'comment:update_own'] });
    const link = await call(owner, 'POST', `${ws()}/invite-codes`, { roleId: intern.id });
    expect(link.statusCode).toBe(201);
    expect(link.json()).toMatchObject({ role: 'MEMBER', customRole: { id: intern.id, name: 'Стажёр' } });

    const joined = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/join',
      payload: { code: link.json().code, name: 'Новый Стажёр', email: 'intern.of.roles', password: 'password123' },
    });
    expect(joined.statusCode).toBe(201);
    const membership = joined.json().workspaces[0];
    expect(membership).toMatchObject({ role: 'MEMBER', customRole: { id: intern.id, name: 'Стажёр' } });
    expect(membership.permissions).toContain('comment:create');
    expect(membership.permissions).not.toContain('issue:create');

    // Held by someone: deleting it would leave them with whatever lies beneath.
    const refused = await call(owner, 'DELETE', `${ws()}/roles/${intern.id}`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toContain('Стажёр');

    const listed = (await call(owner, 'GET', `${ws()}/members`)).json() as { id: string; user: { email: string } }[];
    const internMember = listed.find((item) => item.user.email === 'intern.of.roles')!;
    expect((await giveWorkspaceRole(internMember.id, { role: 'GUEST' })).statusCode).toBe(204);

    // A link still waiting for the role goes with it: it must not let anyone in as something else.
    const waiting = await call(owner, 'POST', `${ws()}/invite-codes`, { roleId: intern.id });
    expect((await call(owner, 'DELETE', `${ws()}/roles/${intern.id}`)).statusCode).toBe(204);
    const late = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/join',
      payload: { code: waiting.json().code, name: 'Опоздавший Стажёр', email: 'late.intern', password: 'password123' },
    });
    expect(late.statusCode).toBe(400);
    expect(((await call(owner, 'GET', `${ws()}/roles`)).json() as Role[]).some((item) => item.id === intern.id)).toBe(false);
  });
});
