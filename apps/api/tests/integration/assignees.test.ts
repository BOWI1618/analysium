import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createProject, disconnectTestDb, migrateTestSchema, registerUser } from '../setup';

let app: FastifyInstance;

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

async function addWorkspaceMember(cookie: string, workspaceId: string, email: string, role: string) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${workspaceId}/members`,
    headers: { cookie },
    payload: { email, role },
  });
  expect(response.statusCode).toBe(201);
  return response.json().user.id as string;
}

describe('кого можно назначить исполнителем', () => {
  it('в проекте доступны все участники пространства, а гости — только добавленные в проект', async () => {
    const owner = await registerUser(app, { workspaceName: 'Исполнители' });
    const project = await createProject(app, owner);

    const memberId = await addWorkspaceMember(owner.cookie, owner.workspaceId, 'plain-member@test.local', 'MEMBER');
    const insideGuestId = await addWorkspaceMember(owner.cookie, owner.workspaceId, 'guest-in@test.local', 'GUEST');
    const outsideGuestId = await addWorkspaceMember(owner.cookie, owner.workspaceId, 'guest-out@test.local', 'GUEST');

    const addToProject = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/members`,
      headers: { cookie: owner.cookie },
      payload: { userId: insideGuestId },
    });
    expect(addToProject.statusCode).toBe(204);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}`,
      headers: { cookie: owner.cookie },
    });
    const assigneeIds = detail.json().assignees.map((u: { id: string }) => u.id);

    // The explicit roster has the lead and the guest added by hand — not the
    // ordinary member, who can still work here. Offering the roster as the
    // assignee list is what made teammates impossible to pick.
    const rosterIds = detail.json().members.map((m: { userId: string }) => m.userId);
    expect(rosterIds).not.toContain(memberId);
    expect(assigneeIds).toEqual(expect.arrayContaining([owner.id, memberId, insideGuestId]));
    expect(assigneeIds).not.toContain(outsideGuestId);
  });

  it('гостя без доступа к проекту назначить нельзя, участника — можно', async () => {
    const owner = await registerUser(app, { workspaceName: 'Проверка назначения' });
    const project = await createProject(app, owner);
    const memberId = await addWorkspaceMember(owner.cookie, owner.workspaceId, 'assign-me@test.local', 'MEMBER');
    const outsideGuestId = await addWorkspaceMember(owner.cookie, owner.workspaceId, 'no-access@test.local', 'GUEST');

    const create = (assigneeId: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/issues',
        headers: { cookie: owner.cookie },
        payload: { projectId: project.id, title: 'Назначение', assigneeId },
      });

    expect((await create(memberId)).statusCode).toBe(201);

    // Used to succeed: workspace membership was the only check, so work could be
    // handed to a guest who cannot even open the project.
    const refused = await create(outsideGuestId);
    expect(refused.statusCode).toBe(400);
  });
});
