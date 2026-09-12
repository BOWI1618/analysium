import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  addMember,
  createIssue,
  createProject,
  disconnectTestDb,
  login,
  migrateTestSchema,
  registerUser,
  type TestUser,
} from '../setup';

let app: FastifyInstance;
let owner: TestUser;
let project: { id: string; statuses: { id: string; name: string; category: string }[] };

const iso = (day: number) => new Date(`2026-04-${String(day).padStart(2, '0')}T00:00:00.000Z`).toISOString();

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();
  owner = await registerUser(app, { name: 'Планировщик', email: 'owner@gantt.test' });
  project = await createProject(app, owner, { name: 'План', key: 'PLN' });
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

const gantt = (cookie = owner.cookie) =>
  app.inject({ method: 'GET', url: `/api/v1/projects/${project.id}/gantt`, headers: { cookie } });

const linkIssues = (predecessorId: string, successorId: string, cookie = owner.cookie, extra = {}) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/projects/${project.id}/dependencies`,
    headers: { cookie },
    payload: { predecessorId, successorId, ...extra },
  });

describe('GET /projects/:id/gantt', () => {
  it('returns a row per issue with its scheduled window', async () => {
    const issue = await createIssue(app, owner, project.id, {
      title: 'Со сроками',
      startDate: iso(1),
      dueDate: iso(5),
    });

    const response = await gantt();
    expect(response.statusCode).toBe(200);

    const row = response.json().rows.find((r: { id: string }) => r.id === issue.id);
    expect(row.start).toBe(iso(1));
    expect(row.end).toBe(iso(5));
    expect(row.isSummary).toBe(false);
  });

  it('counts issues with no dates as unscheduled', async () => {
    await createIssue(app, owner, project.id, { title: 'Без дат' });
    const body = (await gantt()).json();
    expect(body.unscheduledCount).toBeGreaterThan(0);
  });

  it('includes an issue that only has a deadline in the range', async () => {
    await createIssue(app, owner, project.id, { title: 'Только срок', dueDate: iso(20) });
    const body = (await gantt()).json();
    expect(body.range.end >= iso(20)).toBe(true);
  });

  it('rolls a parent bar up from its children', async () => {
    const parent = await createIssue(app, owner, project.id, { title: 'Родитель' });
    await createIssue(app, owner, project.id, {
      title: 'Ребёнок 1',
      type: 'SUBTASK',
      parentId: parent.id,
      startDate: iso(10),
      dueDate: iso(12),
    });
    await createIssue(app, owner, project.id, {
      title: 'Ребёнок 2',
      type: 'SUBTASK',
      parentId: parent.id,
      startDate: iso(8),
      dueDate: iso(15),
    });

    const row = (await gantt()).json().rows.find((r: { id: string }) => r.id === parent.id);
    expect(row.start).toBe(iso(8));
    expect(row.end).toBe(iso(15));
    expect(row.isSummary).toBe(true);
    expect(row.hasChildren).toBe(true);
  });

  it('places a child directly after its parent and indents it', async () => {
    const rows = (await gantt()).json().rows as { id: string; parentId: string | null; depth: number }[];
    const childIndex = rows.findIndex((r) => r.parentId !== null);
    expect(childIndex).toBeGreaterThan(0);

    const child = rows[childIndex]!;
    const parentIndex = rows.findIndex((r) => r.id === child.parentId);
    expect(parentIndex).toBeLessThan(childIndex);
    expect(child.depth).toBe(rows[parentIndex]!.depth + 1);
  });

  it('reports the caller’s permissions for UI gating', async () => {
    expect((await gantt()).json().permissions).toContain('issue:update');
  });

  it('hides another workspace’s project', async () => {
    const outsider = await registerUser(app, { email: 'outsider@gantt.test' });
    expect((await gantt(outsider.cookie)).statusCode).toBe(404);
  });
});

describe('dependencies', () => {
  it('creates a link between two issues of the same project', async () => {
    const a = await createIssue(app, owner, project.id, { title: 'A', startDate: iso(1), dueDate: iso(3) });
    const b = await createIssue(app, owner, project.id, { title: 'B', startDate: iso(4), dueDate: iso(6) });

    const response = await linkIssues(a.id, b.id);
    expect(response.statusCode).toBe(201);
    expect(response.json().type).toBe('FINISH_TO_START');

    const body = (await gantt()).json();
    expect(body.dependencies.some((d: { id: string }) => d.id === response.json().id)).toBe(true);
  });

  it('rejects a self-dependency', async () => {
    const a = await createIssue(app, owner, project.id, { title: 'Сам на себя' });
    const response = await linkIssues(a.id, a.id);
    expect(response.statusCode).toBe(400);
  });

  it('rejects a link that would close a cycle, naming the issues', async () => {
    const a = await createIssue(app, owner, project.id, { title: 'Ц1', startDate: iso(1), dueDate: iso(2) });
    const b = await createIssue(app, owner, project.id, { title: 'Ц2', startDate: iso(3), dueDate: iso(4) });
    const c = await createIssue(app, owner, project.id, { title: 'Ц3', startDate: iso(5), dueDate: iso(6) });

    expect((await linkIssues(a.id, b.id)).statusCode).toBe(201);
    expect((await linkIssues(b.id, c.id)).statusCode).toBe(201);

    const closing = await linkIssues(c.id, a.id);
    expect(closing.statusCode).toBe(400);
    expect(closing.json().error.message).toContain('цикл');
  });

  it('refuses to link issues from different projects', async () => {
    const other = await createProject(app, owner, { name: 'Другой', key: 'OTR' });
    const here = await createIssue(app, owner, project.id, { title: 'Тут' });
    const there = await createIssue(app, owner, other.id, { title: 'Там' });

    expect((await linkIssues(here.id, there.id)).statusCode).toBe(400);
  });

  it('deletes a link', async () => {
    const a = await createIssue(app, owner, project.id, { title: 'Д1', startDate: iso(1), dueDate: iso(2) });
    const b = await createIssue(app, owner, project.id, { title: 'Д2', startDate: iso(3), dueDate: iso(4) });
    const created = await linkIssues(a.id, b.id);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dependencies/${created.json().id}`,
      headers: { cookie: owner.cookie },
    });
    expect(deleted.statusCode).toBe(204);
  });

  it('hides another workspace’s dependency', async () => {
    const a = await createIssue(app, owner, project.id, { title: 'П1', startDate: iso(1), dueDate: iso(2) });
    const b = await createIssue(app, owner, project.id, { title: 'П2', startDate: iso(3), dueDate: iso(4) });
    const created = await linkIssues(a.id, b.id);

    const outsider = await registerUser(app, { email: 'nosy@gantt.test' });
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dependencies/${created.json().id}`,
      headers: { cookie: outsider.cookie },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('critical path', () => {
  it('marks a dependent chain critical and leaves slack on a short branch', async () => {
    const cpProject = await createProject(app, owner, { name: 'КП', key: 'CPX' });

    const start = await createIssue(app, owner, cpProject.id, { title: 'Старт', startDate: iso(1), dueDate: iso(2) });
    const long = await createIssue(app, owner, cpProject.id, { title: 'Длинная', startDate: iso(2), dueDate: iso(12) });
    const short = await createIssue(app, owner, cpProject.id, { title: 'Короткая', startDate: iso(2), dueDate: iso(3) });
    const end = await createIssue(app, owner, cpProject.id, { title: 'Финиш', startDate: iso(12), dueDate: iso(14) });

    const link = (p: string, sId: string) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/projects/${cpProject.id}/dependencies`,
        headers: { cookie: owner.cookie },
        payload: { predecessorId: p, successorId: sId },
      });

    await link(start.id, long.id);
    await link(start.id, short.id);
    await link(long.id, end.id);
    await link(short.id, end.id);

    const rows = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${cpProject.id}/gantt`,
        headers: { cookie: owner.cookie },
      })
    ).json().rows as { id: string; isCritical: boolean; slackDays: number }[];

    expect(rows.find((r) => r.id === long.id)!.isCritical).toBe(true);
    expect(rows.find((r) => r.id === short.id)!.isCritical).toBe(false);
    expect(rows.find((r) => r.id === short.id)!.slackDays).toBeGreaterThan(0);
  });
});

describe('POST /issues/:id/reschedule', () => {
  it('moves both edges and records the change in the activity feed', async () => {
    const issue = await createIssue(app, owner, project.id, {
      title: 'Переносимая',
      startDate: iso(1),
      dueDate: iso(3),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${issue.id}/reschedule`,
      headers: { cookie: owner.cookie },
      payload: { startDate: iso(10), dueDate: iso(14), cascade: false },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().issue.dueDate).toBe(iso(14));

    const activity = await app.inject({
      method: 'GET',
      url: `/api/v1/issues/${issue.id}/activity`,
      headers: { cookie: owner.cookie },
    });
    const fields = activity.json().map((e: { field: string }) => e.field);
    expect(fields).toContain('startDate');
    expect(fields).toContain('dueDate');
  });

  it('rejects an inverted window', async () => {
    const issue = await createIssue(app, owner, project.id, { title: 'Наоборот' });
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${issue.id}/reschedule`,
      headers: { cookie: owner.cookie },
      payload: { startDate: iso(10), dueDate: iso(2), cascade: false },
    });
    expect(response.statusCode).toBe(422);
  });

  it('suggests shifting a dependent issue without moving it', async () => {
    const shiftProject = await createProject(app, owner, { name: 'Сдвиг', key: 'SHF' });
    const a = await createIssue(app, owner, shiftProject.id, { title: 'Первая', startDate: iso(1), dueDate: iso(3) });
    const b = await createIssue(app, owner, shiftProject.id, { title: 'Вторая', startDate: iso(4), dueDate: iso(6) });

    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${shiftProject.id}/dependencies`,
      headers: { cookie: owner.cookie },
      payload: { predecessorId: a.id, successorId: b.id },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${a.id}/reschedule`,
      headers: { cookie: owner.cookie },
      payload: { startDate: iso(10), dueDate: iso(15), cascade: false },
    });

    expect(response.json().suggestedShifts).toHaveLength(1);
    expect(response.json().appliedShifts).toBe(0);

    // The successor must still be where it was.
    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/issues/${b.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(after.json().dueDate).toBe(iso(6));
  });

  it('applies the shifts when cascade is requested, preserving duration', async () => {
    const cascadeProject = await createProject(app, owner, { name: 'Каскад', key: 'CSD' });
    const a = await createIssue(app, owner, cascadeProject.id, { title: 'Первая', startDate: iso(1), dueDate: iso(3) });
    const b = await createIssue(app, owner, cascadeProject.id, { title: 'Вторая', startDate: iso(4), dueDate: iso(6) });

    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${cascadeProject.id}/dependencies`,
      headers: { cookie: owner.cookie },
      payload: { predecessorId: a.id, successorId: b.id },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${a.id}/reschedule`,
      headers: { cookie: owner.cookie },
      payload: { startDate: iso(10), dueDate: iso(15), cascade: true },
    });
    expect(response.json().appliedShifts).toBe(1);

    const moved = await app.inject({
      method: 'GET',
      url: `/api/v1/issues/${b.id}`,
      headers: { cookie: owner.cookie },
    });
    const start = new Date(moved.json().startDate).getTime();
    const end = new Date(moved.json().dueDate).getTime();
    // The successor keeps its two-day duration and now starts after the predecessor.
    expect(end - start).toBe(2 * 24 * 60 * 60 * 1000);
    expect(start).toBeGreaterThanOrEqual(new Date(iso(15)).getTime());
  });
});

describe('scheduling permissions', () => {
  it('lets a member reschedule but stops a guest', async () => {
    const member = await registerUser(app, { email: 'member@gantt.test' });
    await addMember(app, owner, member.email, 'MEMBER');
    const memberCookie = await login(app, member.email);

    const issue = await createIssue(app, owner, project.id, {
      title: 'Права',
      startDate: iso(1),
      dueDate: iso(2),
    });

    const allowed = await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${issue.id}/reschedule`,
      headers: { cookie: memberCookie },
      payload: { startDate: iso(3), dueDate: iso(4), cascade: false },
    });
    expect(allowed.statusCode).toBe(200);

    const guest = await registerUser(app, { email: 'guest@gantt.test' });
    await addMember(app, owner, guest.email, 'GUEST');
    const guestCookie = await login(app, guest.email);

    const blocked = await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${issue.id}/reschedule`,
      headers: { cookie: guestCookie },
      payload: { startDate: iso(5), dueDate: iso(6), cascade: false },
    });
    // A guest cannot see this project at all.
    expect(blocked.statusCode).toBe(404);
  });
});
