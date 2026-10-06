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

let app: FastifyInstance;
let owner: TestUser;
let lead: TestUser;
let anna: TestUser;
let boris: TestUser;
let guestLead: TestUser;
let stranger: TestUser;
let borisMemberId: string;
let leadMemberId: string;
let open: { id: string };
let closed: { id: string };

type Department = { id: string; name: string; lead: { id: string } | null; members: { id: string }[] };

const call = (user: TestUser, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { cookie: user.cookie }, ...(payload ? { payload: payload as never } : {}) });

const departments = async (user: TestUser) =>
  (await call(user, 'GET', `/workspaces/${owner.workspaceId}/departments`)).json() as {
    items: Department[];
    canManage: boolean;
  };
const createDepartment = (user: TestUser, body: unknown) =>
  call(user, 'POST', `/workspaces/${owner.workspaceId}/departments`, body);
const titles = async (user: TestUser, departmentId: string, query = '') => {
  const response = await call(user, 'GET', `/departments/${departmentId}/issues?limit=200${query}`);
  expect(response.statusCode).toBe(200);
  return (response.json().items as { title: string }[]).map((issue) => issue.title).sort();
};

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();

  owner = await registerUser(app, { name: 'Администратор Отделов', workspaceName: 'Отделы' });
  lead = await registerUser(app, { name: 'Лидия Руководитель' });
  anna = await registerUser(app, { name: 'Анна Аналитик' });
  boris = await registerUser(app, { name: 'Борис Аналитик' });
  guestLead = await registerUser(app, { name: 'Гость Руководитель' });
  stranger = await registerUser(app, { name: 'Чужой Человек' });
  leadMemberId = await addMember(app, owner, lead.email, 'MEMBER');
  await addMember(app, owner, anna.email, 'MEMBER');
  borisMemberId = await addMember(app, owner, boris.email, 'MEMBER');
  await addMember(app, owner, guestLead.email, 'GUEST');

  open = await createProject(app, owner, { name: 'Открытый проект' });
  closed = await createProject(app, owner, { name: 'Закрытый для гостя' });
  await call(owner, 'POST', `/projects/${open.id}/members`, { userId: guestLead.id, role: 'VIEWER' });

  await createIssue(app, owner, open.id, { title: 'Анна: открытая', assigneeId: anna.id });
  await createIssue(app, owner, closed.id, { title: 'Анна: закрытая', assigneeId: anna.id, dueDate: '2020-01-01T12:00:00.000Z' });
  await createIssue(app, owner, open.id, { title: 'Борис: открытая', assigneeId: boris.id });
  // Lead works in the same projects but is not a member of the department.
  await createIssue(app, owner, open.id, { title: 'Руководитель: своя', assigneeId: lead.id });
  await createIssue(app, owner, open.id, { title: 'Ничья' });
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

describe('справочник отделов', () => {
  let analytics: Department;

  it('администратор создаёт отдел с руководителем и составом; участнику это запрещено', async () => {
    const refused = await createDepartment(lead, { name: 'Самозванцы' });
    expect(refused.statusCode).toBe(403);

    const response = await createDepartment(owner, { name: 'Аналитика', leadId: lead.id, memberIds: [anna.id, boris.id] });
    expect(response.statusCode).toBe(201);
    analytics = response.json();
    expect(analytics.lead?.id).toBe(lead.id);
    expect(analytics.members.map((member) => member.id).sort()).toEqual([anna.id, boris.id].sort());

    const duplicate = await createDepartment(owner, { name: 'Аналитика' });
    expect(duplicate.statusCode).toBe(409);
  });

  it('руководитель видит свой отдел, рядовой сотрудник — никакие, администратор — все', async () => {
    await createDepartment(owner, { name: 'Бухгалтерия' });

    const forOwner = await departments(owner);
    expect(forOwner.canManage).toBe(true);
    expect(forOwner.items.map((department) => department.name)).toEqual(['Аналитика', 'Бухгалтерия']);

    const forLead = await departments(lead);
    expect(forLead.canManage).toBe(false);
    expect(forLead.items.map((department) => department.name)).toEqual(['Аналитика']);

    // Being in a department does not show it; leading it does.
    expect((await departments(anna)).items).toEqual([]);
  });

  it('человека не из пространства в отдел не добавить', async () => {
    const response = await call(owner, 'PATCH', `/departments/${analytics.id}`, { memberIds: [anna.id, stranger.id] });
    expect(response.statusCode).toBe(400);
    const [current] = (await departments(owner)).items;
    expect(current!.members).toHaveLength(2);
  });

  it('сотрудник состоит в одном отделе: добавление в другой переносит его', async () => {
    const support = (await createDepartment(owner, { name: 'Поддержка', memberIds: [boris.id] })).json() as Department;
    expect(support.members.map((member) => member.id)).toEqual([boris.id]);

    const all = (await departments(owner)).items;
    expect(all.find((department) => department.name === 'Аналитика')!.members.map((member) => member.id)).toEqual([anna.id]);

    // Back again for the tests below.
    await call(owner, 'PATCH', `/departments/${analytics.id}`, { memberIds: [anna.id, boris.id] });
    expect((await departments(owner)).items.find((department) => department.name === 'Поддержка')!.members).toEqual([]);
  });

  describe('задачи отдела', () => {
    it('показывают задачи его людей — и только их', async () => {
      expect(await titles(lead, analytics.id)).toEqual(['Анна: закрытая', 'Анна: открытая', 'Борис: открытая']);

      const stats = (await call(lead, 'GET', `/departments/${analytics.id}/stats`)).json().items as {
        userId: string;
        active: number;
        overdue: number;
      }[];
      expect(stats.find((row) => row.userId === anna.id)).toMatchObject({ active: 2, overdue: 1 });
      expect(stats.find((row) => row.userId === boris.id)).toMatchObject({ active: 1, overdue: 0 });
      expect(stats).toHaveLength(2);
    });

    it('фильтр по человеку вне отдела ничего не добавляет', async () => {
      expect(await titles(lead, analytics.id, `&assigneeId=${anna.id}`)).toEqual(['Анна: закрытая', 'Анна: открытая']);
      expect(await titles(lead, analytics.id, `&assigneeId=${lead.id}`)).toEqual([]);
      expect(await titles(lead, analytics.id, '&assigneeId=none')).toEqual([]);
    });

    it('пустой отдел — пустой список, а не всё пространство', async () => {
      const empty = (await departments(owner)).items.find((department) => department.name === 'Бухгалтерия')!;
      expect(await titles(owner, empty.id)).toEqual([]);
      expect((await call(owner, 'GET', `/departments/${empty.id}/stats`)).json().items).toEqual([]);
    });

    it('руководство отделом не открывает проекты: гость видит задачи только своих проектов', async () => {
      await call(owner, 'PATCH', `/departments/${analytics.id}`, { leadId: guestLead.id });
      expect((await departments(guestLead)).items.map((department) => department.name)).toEqual(['Аналитика']);

      expect(await titles(guestLead, analytics.id)).toEqual(['Анна: открытая', 'Борис: открытая']);
      const stats = (await call(guestLead, 'GET', `/departments/${analytics.id}/stats`)).json().items as {
        userId: string;
        active: number;
        overdue: number;
      }[];
      // The overdue task sits in a project the guest cannot open: not counted.
      expect(stats.find((row) => row.userId === anna.id)).toMatchObject({ active: 1, overdue: 0 });

      // Nor does it let them change a task they could only read.
      const issues = (await call(guestLead, 'GET', `/departments/${analytics.id}/issues`)).json().items as { id: string }[];
      const patch = await call(guestLead, 'PATCH', `/issues/${issues[0]!.id}`, { assigneeId: boris.id });
      expect(patch.statusCode).toBe(403);

      await call(owner, 'PATCH', `/departments/${analytics.id}`, { leadId: lead.id });
    });

    it('чужой отдел по идентификатору недоступен', async () => {
      // A colleague who does not lead it, and someone from another workspace.
      for (const user of [anna, stranger]) {
        expect((await call(user, 'GET', `/departments/${analytics.id}/issues`)).statusCode).toBe(404);
        expect((await call(user, 'GET', `/departments/${analytics.id}/stats`)).statusCode).toBe(404);
      }
      expect((await call(anna, 'PATCH', `/departments/${analytics.id}`, { name: 'Захват' })).statusCode).toBe(403);
      expect((await call(stranger, 'PATCH', `/departments/${analytics.id}`, { name: 'Захват' })).statusCode).toBe(404);
      expect((await call(anna, 'DELETE', `/departments/${analytics.id}`)).statusCode).toBe(403);
    });
  });

  it('кто покинул пространство, тот покинул и отдел; ушедший руководитель оставляет отдел без руководителя', async () => {
    expect((await call(owner, 'DELETE', `/workspaces/${owner.workspaceId}/members/${borisMemberId}`)).statusCode).toBe(204);
    let current = (await departments(owner)).items.find((department) => department.name === 'Аналитика')!;
    expect(current.members.map((member) => member.id)).toEqual([anna.id]);

    expect((await call(owner, 'DELETE', `/workspaces/${owner.workspaceId}/members/${leadMemberId}`)).statusCode).toBe(204);
    current = (await departments(owner)).items.find((department) => department.name === 'Аналитика')!;
    expect(current.lead).toBeNull();
  });

  it('администратор удаляет отдел', async () => {
    const before = (await departments(owner)).items.length;
    expect((await call(owner, 'DELETE', `/departments/${analytics.id}`)).statusCode).toBe(204);
    expect((await departments(owner)).items).toHaveLength(before - 1);
  });
});
