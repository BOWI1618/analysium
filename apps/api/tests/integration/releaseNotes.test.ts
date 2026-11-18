import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addMember, disconnectTestDb, migrateTestSchema, registerUser, type TestUser } from '../setup';
import { RELEASES, releaseBody } from '../../src/domain/releases';
import { announceLatestRelease } from '../../src/jobs/releaseNotes';

let app: FastifyInstance;
let owner: TestUser;
let member: TestUser;

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();
  owner = await registerUser(app, { name: 'Владелец Новостей', workspaceName: 'Новости' });
  member = await registerUser(app, { name: 'Участник Новостей' });
  await addMember(app, owner, member.email, 'MEMBER');
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

const releaseNotesOf = async (user: TestUser) => {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/workspaces/${owner.workspaceId}/notifications`,
    headers: { cookie: user.cookie },
  });
  return response.json().items.filter((n: { type: string }) => n.type === 'RELEASE_NOTES');
};

describe('сводка обновления', () => {
  it('приходит каждому в уведомления один раз, повторный запуск ничего не дублирует', async () => {
    const release = RELEASES[0]!;
    expect(await announceLatestRelease(release)).toBeGreaterThan(0);

    for (const user of [owner, member]) {
      const notes = await releaseNotesOf(user);
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe(release.title);
      expect(notes[0].body).toBe(releaseBody(release));
      expect(notes[0].readAt).toBeNull();
    }

    // A restart after the same deploy.
    await announceLatestRelease(release);
    expect(await releaseNotesOf(owner)).toHaveLength(1);

    // The next update is announced on its own.
    await announceLatestRelease({ id: 'test-next', title: 'Следующее обновление', items: ['Ещё одна новость.'] });
    expect(await releaseNotesOf(member)).toHaveLength(2);
  });
});
